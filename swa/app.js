import { generateKeypair, importPrivkey, verifyEvent } from './nostr.js';
import { generateMnemonic, validateMnemonic, deriveNostrKeypair } from './nip06.js';
import { RelayConnection } from './relay.js';
import { store } from './store.js';
import { LocalSigner, Nip07Signer } from './signer.js';
import { verifyNip05 } from './nip05.js';
import {
  renderEvent, renderReply, renderFollowItem,
  getDisplayName, formatTime, createNip05Badge, createOtsBadge,
  isOwnEvent,
} from './feedView.js';

const VERSION = '0.0.2';
const SUPPORTED_NIPS = ['01', '02', '03', '04', '05', '06', '07'];

// ── DOM refs ──────────────────────────────────────────────────────────────────

const pubkeyDisplay = document.getElementById('pubkey-display');
const privkeyDisplay = document.getElementById('privkey-display');
const privkeyDisplayWrapper = document.getElementById('privkey-display-wrapper');
const privkeyImport = document.getElementById('privkey-import');
const importBtn = document.getElementById('import-btn');
const importError = document.getElementById('import-error');
const generateBtn = document.getElementById('generate-btn');
const copyPubkeyBtn = document.getElementById('copy-pubkey-btn');
const copyPrivkeyBtn = document.getElementById('copy-privkey-btn');

const mnemonicStrengthSelect = document.getElementById('mnemonic-strength');
const generateMnemonicBtn = document.getElementById('generate-mnemonic-btn');
const mnemonicSection = document.getElementById('mnemonic-section');
const mnemonicDisplayWrapper = document.getElementById('mnemonic-display-wrapper');
const mnemonicDisplay = document.getElementById('mnemonic-display');
const copyMnemonicBtn = document.getElementById('copy-mnemonic-btn');
const mnemonicImport = document.getElementById('mnemonic-import');
const mnemonicImportBtn = document.getElementById('mnemonic-import-btn');
const mnemonicError = document.getElementById('mnemonic-error');

const profileNameInput = document.getElementById('profile-name');
const profileAboutInput = document.getElementById('profile-about');
const profilePictureInput = document.getElementById('profile-picture');
const profileNip05Input = document.getElementById('profile-nip05');
const profileSaveBtn = document.getElementById('profile-save-btn');
const profileResult = document.getElementById('profile-result');

const relayAddInput = document.getElementById('relay-add-input');
const relayAddBtn = document.getElementById('relay-add-btn');
const relayListEl = document.getElementById('relay-list');
const relayNotice = document.getElementById('relay-notice');

const followPubkeyInput = document.getElementById('follow-pubkey');
const followBtn = document.getElementById('follow-btn');
const followError = document.getElementById('follow-error');
const followsStatus = document.getElementById('follows-status');
const followsList = document.getElementById('follows-list');

const postContent = document.getElementById('post-content');
const charCount = document.getElementById('char-count');
const postBtn = document.getElementById('post-btn');
const postResult = document.getElementById('post-result');

const feedStatus = document.getElementById('feed-status');
const eventsList = document.getElementById('events-list');
const feedSinceSelect = document.getElementById('feed-since');
const feedUntilSelect = document.getElementById('feed-until');
const feedIdSearch = document.getElementById('feed-id-search');
const feedIdSearchBtn = document.getElementById('feed-id-search-btn');
const feedHeader = document.getElementById('feed-header');
const feedFilters = document.getElementById('feed-filters');
const tabFeed = document.getElementById('tab-feed');
const tabFollowing = document.getElementById('tab-following');
const tabMentions = document.getElementById('tab-mentions');
const mentionsList = document.getElementById('mentions-list');
const mentionsStatus = document.getElementById('mentions-status');

const dmConvsList = document.getElementById('dm-convs-list');
const dmRecipientInput = document.getElementById('dm-recipient');
const dmOpenBtn = document.getElementById('dm-open-btn');
const dmRecipientError = document.getElementById('dm-recipient-error');
const dmThread = document.getElementById('dm-thread');
const dmThreadTitle = document.getElementById('dm-thread-title');
const dmMessages = document.getElementById('dm-messages');
const dmCompose = document.getElementById('dm-compose');
const dmSendBtn = document.getElementById('dm-send-btn');
const dmResult = document.getElementById('dm-result');

const nip07LoginBtn = document.getElementById('nip07-login-btn');
const nip07Error = document.getElementById('nip07-error');
const nip07Badge = document.getElementById('nip07-badge');
const logoutBtn = document.getElementById('logout-btn');

const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalVersion = document.getElementById('modal-version');
const modalNipsList = document.getElementById('modal-nips-list');

// ── State ─────────────────────────────────────────────────────────────────────

const relays = new Map(); // url → { conn: RelayConnection|null, status: string }
const activeSubs = new Map(); // subId → filters (all live REQs, for re-subscribing new relays)

// Handler registries — replaces the closed if/else dispatcher in handleEvent
const kindHandlers = new Map(); // kind → fn(event, subId)
const subIdHandlers = new Map(); // subId → fn(event)

let ownProfileSubId = null;
let followsSubId = null;
let feedSubId = null;
let metadataSubId = null;
let metadataDebounceTimer = null;
let idSearchSubId = null;
let mentionsSubId = null;
let attestationSubId = null;
let dmSubId = null;
let currentDmContact = null; // pubkey of the open DM thread
const nip05Checked = new Set(); // pubkeys already attempted (verified or failed)
let feedRetryTimer = null;
let sinceFilter = 0; // seconds offset from now; 0 = no filter
let untilFilter = 0; // seconds offset from now; 0 = no filter
let feedActiveTab = 'feed'; // 'feed' | 'following' | 'mentions'
const replySubscriptions = new Map(); // eventId → { subId, container }
const replySubIdToContainer = new Map(); // subId → container element
const replyEventIds = new Map(); // subId → Set<eventId> (dedup across relays)

// ── Event handler registry setup ──────────────────────────────────────────────

kindHandlers.set(0, (event, subId) => {
  handleMetadataEvent(event);
  if (subId === ownProfileSubId) populateProfileForm(event.pubkey);
});

kindHandlers.set(1040, (event) => handleAttestationEvent(event));

kindHandlers.set(4, (event) => handleDmEvent(event));

// ── Info modal ────────────────────────────────────────────────────────────────

modalVersion.textContent = `v${VERSION}`;
for (const nip of SUPPORTED_NIPS) {
  const badge = document.createElement('span');
  badge.className = 'nip-badge';
  badge.textContent = `NIP-${nip}`;
  modalNipsList.appendChild(badge);
}

infoBtn.addEventListener('click', () => { infoModal.hidden = false; });
modalCloseBtn.addEventListener('click', () => { infoModal.hidden = true; });
infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') infoModal.hidden = true; });

// ── Initialization ────────────────────────────────────────────────────────────

// Migrate legacy single relayUrl to new list format
const legacyUrl = localStorage.getItem('relayUrl');
if (legacyUrl && !localStorage.getItem('relayUrls')) {
  store.setRelayUrls([legacyUrl]);
  const migrated = new Set([legacyUrl]);
  store.setConnectedRelayUrls(migrated);
  localStorage.removeItem('relayUrl');
}

const savedPrivkey = sessionStorage.getItem('privkeyHex');
if (savedPrivkey) {
  try {
    const keys = importPrivkey(savedPrivkey);
    store.signer = new LocalSigner(keys); // set directly — no emit needed at startup
    pubkeyDisplay.value = keys.pubkeyHex;
  } catch {
    sessionStorage.removeItem('privkeyHex');
  }
}

updateIdentityUI();

// Populate relay Map from store and auto-connect previously connected relays
for (const url of store.relayUrls) {
  relays.set(url, { conn: null, status: 'disconnected' });
}
rerenderRelayList();

for (const url of store.connectedRelayUrls) {
  if (relays.has(url)) connectRelay(url);
}

// ── Store subscriptions ───────────────────────────────────────────────────────

store.on('signer', (signer) => {
  pubkeyDisplay.value = signer ? signer.pubkeyHex : '';
  updateIdentityUI();
  if (isAnyConnected()) setupSubscriptions();
});

store.on('follows', (follows) => {
  followsStatus.textContent = follows.length === 0 ? 'Not following anyone yet.' : '';
  renderFollows(follows);
  updateFeedTabs();
  if (feedActiveTab === 'following') {
    subscribeToFeed();
  }
});

store.on('events', () => {
  // Fired only by clearEvents — reset the list
  eventsList.innerHTML = '';
});

store.on('eventAdded', ({ event, insertIdx }) => {
  feedStatus.textContent = '';
  const card = renderEvent(event, makeStoreSlice(), makeRenderCallbacks());
  const ref = eventsList.children[insertIdx];
  eventsList.insertBefore(card, ref ?? null);
  while (eventsList.children.length > store.events.length) {
    eventsList.lastChild.remove();
  }
});

store.on('profiles', (pubkey) => {
  if (store.events.some(e => e.pubkey === pubkey) || store.mentions.some(e => e.pubkey === pubkey)) rerenderFeed();
  renderFollows(store.follows);
  rerenderDmConvList();
});

store.on('nip05', (pubkey) => {
  if (store.events.some(e => e.pubkey === pubkey) || store.mentions.some(e => e.pubkey === pubkey)) rerenderFeed();
  renderFollows(store.follows);
  rerenderDmConvList();
});

store.on('attestation', (eventId) => {
  for (const list of [eventsList, mentionsList]) {
    const card = list.querySelector(`[data-event-id="${eventId}"]`);
    if (card && !card.querySelector('.ots-badge')) {
      card.querySelector('.event-meta-left')?.appendChild(createOtsBadge());
    }
  }
});

store.on('dm', (event) => {
  const contact = getDmContact(event, store.signer?.pubkeyHex);
  rerenderDmConvList();
  if (contact === currentDmContact) {
    appendDmMessage(event);
    dmMessages.scrollTop = dmMessages.scrollHeight;
  }
  tryDecryptDm(event);
});

store.on('dmDecrypted', (eventId) => {
  const wrapper = dmMessages.querySelector(`[data-dm-id="${eventId}"]`);
  if (wrapper) {
    const textEl = wrapper.querySelector('.dm-bubble');
    if (textEl) textEl.textContent = store.dmDecrypted.get(eventId);
    wrapper.classList.remove('dm-pending');
  }
  rerenderDmConvList();
});

store.on('mentions', (events) => {
  mentionsStatus.hidden = feedActiveTab !== 'mentions' || events.length > 0;
  mentionsList.innerHTML = '';
  for (const event of events) {
    mentionsList.appendChild(renderEvent(event, makeStoreSlice(), makeRenderCallbacks()));
  }
});

// ── Key management ────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', () => {
  const keys = generateKeypair();
  const signer = new LocalSigner(keys);
  store.setSigner(signer);
  privkeyDisplay.value = keys.privkeyHex;
  privkeyDisplayWrapper.hidden = false;
  importError.hidden = true;
  document.getElementById('privkey-section').open = true;
});

importBtn.addEventListener('click', () => {
  const hex = privkeyImport.value.trim();
  try {
    const keys = importPrivkey(hex);
    const signer = new LocalSigner(keys);
    store.setSigner(signer);
    privkeyDisplayWrapper.hidden = true;
    privkeyImport.value = '';
    importError.hidden = true;
  } catch (err) {
    importError.textContent = err.message;
    importError.hidden = false;
  }
});

copyPubkeyBtn.addEventListener('click', () => copyToClipboard(pubkeyDisplay.value, copyPubkeyBtn));
copyPrivkeyBtn.addEventListener('click', () => copyToClipboard(privkeyDisplay.value, copyPrivkeyBtn));

// ── NIP-06 mnemonic ───────────────────────────────────────────────────────────

generateMnemonicBtn.addEventListener('click', async () => {
  generateMnemonicBtn.disabled = true;
  try {
    const strength = parseInt(mnemonicStrengthSelect.value);
    const mnemonic = generateMnemonic(strength);
    const { privkeyHex } = await deriveNostrKeypair(mnemonic);
    const keys = importPrivkey(privkeyHex);
    const signer = new LocalSigner(keys);
    store.setSigner(signer);
    privkeyDisplayWrapper.hidden = true;
    importError.hidden = true;
    showMnemonic(mnemonic);
    mnemonicSection.open = true;
  } catch (err) {
    mnemonicError.textContent = err.message;
    mnemonicError.hidden = false;
  } finally {
    generateMnemonicBtn.disabled = false;
  }
});

mnemonicImportBtn.addEventListener('click', async () => {
  const mnemonic = mnemonicImport.value.trim().toLowerCase().replace(/\s+/g, ' ');
  mnemonicError.hidden = true;

  if (!validateMnemonic(mnemonic)) {
    mnemonicError.textContent = 'Invalid mnemonic — check word count and spelling.';
    mnemonicError.hidden = false;
    return;
  }

  mnemonicImportBtn.disabled = true;
  try {
    const { privkeyHex } = await deriveNostrKeypair(mnemonic);
    const keys = importPrivkey(privkeyHex);
    const signer = new LocalSigner(keys);
    store.setSigner(signer);
    mnemonicImport.value = '';
    privkeyDisplayWrapper.hidden = true;
    importError.hidden = true;
    mnemonicDisplayWrapper.hidden = true;
  } catch (err) {
    mnemonicError.textContent = err.message;
    mnemonicError.hidden = false;
  } finally {
    mnemonicImportBtn.disabled = false;
  }
});

copyMnemonicBtn.addEventListener('click', () => {
  const words = [...mnemonicDisplay.querySelectorAll('.mnemonic-word')]
    .map(el => el.querySelector('.mnemonic-word-text')?.textContent ?? '')
    .join(' ');
  copyToClipboard(words, copyMnemonicBtn);
});

function showMnemonic(mnemonic) {
  mnemonicDisplay.innerHTML = '';
  mnemonic.split(' ').forEach((word, i) => {
    const chip = document.createElement('div');
    chip.className = 'mnemonic-word';
    const num = document.createElement('span');
    num.className = 'mnemonic-word-num';
    num.textContent = i + 1;
    const text = document.createElement('span');
    text.className = 'mnemonic-word-text';
    text.textContent = word;
    chip.append(num, text);
    mnemonicDisplay.appendChild(chip);
  });
  mnemonicDisplayWrapper.hidden = false;
}

// ── NIP-07 extension login ────────────────────────────────────────────────────

nip07LoginBtn.addEventListener('click', async () => {
  nip07Error.hidden = true;
  if (!window.nostr) {
    nip07Error.textContent = 'No Nostr extension detected. Install one (e.g. Alby, nos2x) and reload.';
    nip07Error.hidden = false;
    return;
  }
  nip07LoginBtn.disabled = true;
  try {
    const signer = await new Nip07Signer(window.nostr).init();
    store.setSigner(signer);
  } catch (err) {
    nip07Error.textContent = err.message;
    nip07Error.hidden = false;
  } finally {
    nip07LoginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  store.setSigner(null);
});

// ── Profile ───────────────────────────────────────────────────────────────────

profileSaveBtn.addEventListener('click', async () => {
  if (!requireKeysAndRelay((msg) => setProfileResult(msg, 'err'))) return;

  const metadata = {
    name: profileNameInput.value.trim(),
    about: profileAboutInput.value.trim(),
    picture: profilePictureInput.value.trim(),
    nip05: profileNip05Input.value.trim() || undefined,
  };

  profileSaveBtn.disabled = true;
  setProfileResult('Saving…', '');

  try {
    const event = await createOwnEvent({ kind: 0, tags: [], content: JSON.stringify(metadata) });
    await publishToAll(event);
    store.setProfile(store.signer.pubkeyHex, { ...metadata, _created_at: event.created_at });
    setProfileResult('Saved.', 'ok');
  } catch (err) {
    setProfileResult(err.message, 'err');
  } finally {
    profileSaveBtn.disabled = false;
  }
});

// ── Feed filters ──────────────────────────────────────────────────────────────

feedSinceSelect.addEventListener('change', () => {
  sinceFilter = parseInt(feedSinceSelect.value) || 0;
  if (isAnyConnected()) subscribeToFeed();
});

feedUntilSelect.addEventListener('change', () => {
  untilFilter = parseInt(feedUntilSelect.value) || 0;
  if (isAnyConnected()) subscribeToFeed();
});

tabFeed.addEventListener('click', () => {
  if (feedActiveTab === 'feed') return;
  switchTab('feed');
  subscribeToFeed();
});

tabFollowing.addEventListener('click', () => {
  if (feedActiveTab === 'following') return;
  switchTab('following');
  subscribeToFeed();
});

tabMentions.addEventListener('click', () => switchTab('mentions'));

feedIdSearchBtn.addEventListener('click', () => {
  const id = feedIdSearch.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) {
    feedStatus.textContent = 'Event ID must be 64 hex characters.';
    return;
  }
  if (!isAnyConnected()) {
    feedStatus.textContent = 'Connect to a relay first.';
    return;
  }
  if (idSearchSubId) unsubscribeAll(idSearchSubId);
  idSearchSubId = crypto.randomUUID();
  subIdHandlers.set(idSearchSubId, (event) => store.addEvent(event));
  feedStatus.textContent = 'Searching…';
  subscribeAll(idSearchSubId, [{ ids: [id], limit: 1 }]);
});

// ── Relay management ──────────────────────────────────────────────────────────

relayAddBtn.addEventListener('click', addRelay);
relayAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addRelay(); });

function addRelay() {
  const url = relayAddInput.value.trim();
  if (!url) return;
  if (!isValidRelayUrl(url)) {
    relayNotice.textContent = 'Relay URL must start with wss:// or ws://';
    relayNotice.hidden = false;
    return;
  }
  if (relays.has(url)) {
    relayNotice.textContent = 'Relay already in list.';
    relayNotice.hidden = false;
    return;
  }
  relayNotice.hidden = true;
  relays.set(url, { conn: null, status: 'disconnected' });
  store.setRelayUrls([...relays.keys()]);
  relayAddInput.value = '';
  rerenderRelayList();
}

function connectRelay(url) {
  const entry = relays.get(url);
  if (!entry || entry.status === 'connected' || entry.status === 'connecting') return;

  const conn = new RelayConnection(url, {
    onEvent: handleEvent,
    onEOSE: handleEOSE,
    onClosed: (subId, message) => handleClosed(url, subId, message),
    onNotice: (msg) => handleNotice(url, msg),
    onStatus: (status) => handleRelayStatus(url, status),
  });
  entry.conn = conn;
  conn.connect().catch(() => {});

  const connected = store.connectedRelayUrls;
  connected.add(url);
  store.setConnectedRelayUrls(connected);
}

function disconnectRelay(url) {
  const entry = relays.get(url);
  if (entry?.conn) {
    entry.conn.disconnect();
    entry.conn = null;
  }

  const connected = store.connectedRelayUrls;
  connected.delete(url);
  store.setConnectedRelayUrls(connected);
}

function removeRelay(url) {
  disconnectRelay(url);
  relays.delete(url);
  store.setRelayUrls([...relays.keys()]);
  rerenderRelayList();
}

// ── Following ─────────────────────────────────────────────────────────────────

followBtn.addEventListener('click', async () => {
  if (!requireKeysAndRelay(showFollowError)) return;

  const pubkey = followPubkeyInput.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    showFollowError('Must be a 64-character hex public key.');
    return;
  }
  if (store.followedPubkeys.has(pubkey)) {
    showFollowError('Already following this key.');
    return;
  }

  followError.hidden = true;
  store.addFollow({ pubkey, relay: '', petname: '' });
  followPubkeyInput.value = '';

  try {
    await publishFollowList();
  } catch (err) {
    showFollowError(`Saved locally — relay error: ${err.message}`);
  }
});

async function handleUnfollow(pubkey) {
  store.removeFollow(pubkey);
  try {
    await publishFollowList();
  } catch {
    // Ignore relay error for unfollow
  }
}

async function publishFollowList() {
  const tags = store.follows.map(f => {
    const tag = ['p', f.pubkey];
    if (f.relay || f.petname) tag.push(f.relay || '');
    if (f.petname) tag.push(f.petname);
    return tag;
  });
  const event = await createOwnEvent({ kind: 3, tags, content: '' });
  return publishToAll(event);
}

function handleFollowListEvent(event) {
  const follows = event.tags
    .filter(t => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1]))
    .map(t => ({ pubkey: t[1], relay: t[2] || '', petname: t[3] || '' }));
  store.setFollows(follows);
}

function renderFollows(follows) {
  followsList.innerHTML = '';
  for (const f of follows) {
    followsList.appendChild(renderFollowItem(f,
      { profiles: store.profiles, nip05: store.nip05 },
      {
        onUnfollow: handleUnfollow,
        onPetnameChange: async (entry, newPetname) => {
          entry.petname = newPetname;
          try { await publishFollowList(); } catch { /* ignore */ }
        },
        onRelayChange: async (entry, newRelay) => {
          entry.relay = newRelay;
          try { await publishFollowList(); } catch { /* ignore */ }
        },
        isValidRelayUrl,
        bindSaveOnBlurOrEnter,
      }
    ));
  }
}

function showFollowError(msg) {
  followError.textContent = msg;
  followError.hidden = false;
}

// ── Post ──────────────────────────────────────────────────────────────────────

postContent.addEventListener('input', () => {
  charCount.textContent = postContent.value.length;
});

postBtn.addEventListener('click', async () => {
  if (!requireKeysAndRelay((msg) => setPostResult(msg, 'err'))) return;
  const content = postContent.value.trim();
  if (!content) return;

  postBtn.disabled = true;
  setPostResult('Publishing…', '');

  try {
    const event = await createOwnEvent({ kind: 1, tags: [], content });
    await publishToAll(event);
    store.addEvent(event);
    postContent.value = '';
    charCount.textContent = '0';
    setPostResult('Posted.', 'ok');
  } catch (err) {
    setPostResult(err.message, 'err');
  } finally {
    postBtn.disabled = false;
  }
});

// ── Relay event callbacks ─────────────────────────────────────────────────────

function handleEvent(subId, event) {
  if (!verifyEvent(event)) return;

  // kind 0 is always processed regardless of which subscription delivered it
  if (event.kind === 0) {
    kindHandlers.get(0)(event, subId);
    return;
  }

  // subId-specific handler takes priority
  if (subIdHandlers.has(subId)) {
    subIdHandlers.get(subId)(event);
    return;
  }

  // fall back to kind handler
  const kh = kindHandlers.get(event.kind);
  if (kh) kh(event, subId);
}

function handleEOSE(subId) {
  if (subId === followsSubId) {
    if (store.follows.length === 0) {
      followsStatus.textContent = 'Not following anyone yet.';
    } else {
      fetchMissingMetadata();
    }
  } else if (subId === feedSubId) {
    if (store.events.length === 0) feedStatus.textContent = 'No events found.';
    fetchMissingMetadata();
    subscribeAttestations();
  } else if (subId === idSearchSubId) {
    if (store.events.length === 0) feedStatus.textContent = 'Event not found.';
    else fetchMissingMetadata();
  } else if (subId === mentionsSubId) {
    if (store.mentions.length === 0) mentionsStatus.textContent = 'No mentions yet.';
    fetchMissingMetadata();
  } else if (subId === dmSubId) {
    fetchMissingMetadata();
    rerenderDmConvList();
  } else if (replySubIdToContainer.has(subId)) {
    const container = replySubIdToContainer.get(subId);
    if (container.querySelector('.replies-loading')) {
      container.querySelector('.replies-loading').remove();
      const empty = document.createElement('div');
      empty.className = 'replies-empty';
      empty.textContent = 'No replies yet.';
      container.appendChild(empty);
    }
  }
}

function relayHostname(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function handleClosed(url, subId, message) {
  const hostname = relayHostname(url);

  const label = subId === feedSubId ? 'feed'
    : subId === followsSubId ? 'follows'
    : subId === ownProfileSubId ? 'profile'
    : subId === metadataSubId ? 'metadata'
    : subId === idSearchSubId ? 'search'
    : subId === mentionsSubId ? 'mentions'
    : subId === attestationSubId ? 'attestations'
    : subId === dmSubId ? 'dms'
    : replySubIdToContainer.has(subId) ? 'replies'
    : 'unknown';
  relayNotice.textContent = `[${hostname}] closed ${label} subscription: ${message || 'no reason given'}`;
  relayNotice.hidden = false;

  if (subId === feedSubId && !feedRetryTimer) {
    feedStatus.textContent = 'Feed closed by relay. Retrying in 5s…';
    feedRetryTimer = setTimeout(() => {
      feedRetryTimer = null;
      const entry = relays.get(url);
      if (entry?.status === 'connected' && entry.conn && activeSubs.has(feedSubId)) {
        entry.conn.subscribe(feedSubId, activeSubs.get(feedSubId));
      }
    }, 5000);
  }
}

function handleNotice(url, message) {
  relayNotice.textContent = `[${relayHostname(url)}] ${message}`;
  relayNotice.hidden = false;
}

function handleRelayStatus(url, status) {
  const entry = relays.get(url);
  if (!entry) return;

  const wasAnyConnected = isAnyConnected();
  entry.status = status;
  rerenderRelayList();

  if (status === 'connected') {
    if (!wasAnyConnected) {
      // First relay to connect — clear state and set up all subscriptions
      store.clearEvents();
      store.clearMentions();
      store.setFollows([]);
      setupSubscriptions();
    } else {
      // Additional relay — subscribe it to all currently active subs
      for (const [subId, filters] of activeSubs) {
        entry.conn.subscribe(subId, filters);
      }
    }
    updateFeedTabs();
  } else if (!isAnyConnected()) {
    // All relays gone — reset subscription state
    ownProfileSubId = null;
    followsSubId = null;
    feedSubId = null;
    metadataSubId = null;
    clearTimeout(metadataDebounceTimer);
    idSearchSubId = null;
    mentionsSubId = null;
    activeSubs.clear();
    subIdHandlers.clear();
    attestationSubId = null;
    dmSubId = null;
    replySubscriptions.clear();
    replySubIdToContainer.clear();
    replyEventIds.clear();
    clearTimeout(feedRetryTimer);
    feedRetryTimer = null;
    feedStatus.textContent = 'Connect to a relay to see events.';
    followsStatus.textContent = 'Connect with an identity to load your follow list.';
    updateFeedTabs();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAnyConnected() {
  return [...relays.values()].some(e => e.status === 'connected');
}

function subscribeAll(subId, filters) {
  activeSubs.set(subId, filters);
  for (const { conn, status } of relays.values()) {
    if (status === 'connected' && conn) conn.subscribe(subId, filters);
  }
}

function unsubscribeAll(subId) {
  activeSubs.delete(subId);
  subIdHandlers.delete(subId);
  for (const { conn, status } of relays.values()) {
    if (status === 'connected' && conn) conn.unsubscribe(subId);
  }
}

async function publishToAll(event) {
  const connected = [...relays.values()].filter(e => e.status === 'connected' && e.conn);
  if (!connected.length) throw new Error('Not connected to any relay.');
  const results = await Promise.allSettled(connected.map(e => e.conn.publish(event)));
  const accepted = results.filter(r => r.status === 'fulfilled');
  if (!accepted.length) {
    const err = results.find(r => r.status === 'rejected');
    throw new Error(err?.reason?.message || 'All relays rejected the event.');
  }
}

function setupSubscriptions() {
  activeSubs.clear();
  subIdHandlers.clear();
  ownProfileSubId = null;
  followsSubId = null;
  feedSubId = null;
  metadataSubId = null;
  clearTimeout(metadataDebounceTimer);
  mentionsSubId = null;
  attestationSubId = null;
  dmSubId = null;
  idSearchSubId = null;

  if (store.signer) {
    ownProfileSubId = crypto.randomUUID();
    // kind 0 is handled by the global kindHandlers.get(0) — no subId handler needed
    subscribeAll(ownProfileSubId, [{ kinds: [0], authors: [store.signer.pubkeyHex], limit: 1 }]);

    followsSubId = crypto.randomUUID();
    subIdHandlers.set(followsSubId, (event) => { if (event.kind === 3) handleFollowListEvent(event); });
    followsStatus.textContent = 'Loading follow list…';
    subscribeAll(followsSubId, [{ kinds: [3], authors: [store.signer.pubkeyHex], limit: 1 }]);

    mentionsSubId = crypto.randomUUID();
    subIdHandlers.set(mentionsSubId, (event) => store.addMention(event));
    subscribeAll(mentionsSubId, [{ kinds: [1], '#p': [store.signer.pubkeyHex], limit: 20 }]);

    // kind 4 is handled globally by kindHandlers — dmSubId just subscribes the filter
    dmSubId = crypto.randomUUID();
    subscribeAll(dmSubId, [
      { kinds: [4], '#p': [store.signer.pubkeyHex], limit: 50 },
      { kinds: [4], authors: [store.signer.pubkeyHex], limit: 50 },
    ]);
  }

  subscribeToFeed();
  updateFeedTabs();
}

function subscribeToFeed() {
  clearTimeout(feedRetryTimer);
  feedRetryTimer = null;
  if (feedActiveTab === 'following' && store.follows.length === 0) {
    if (feedSubId) unsubscribeAll(feedSubId);
    feedSubId = null;
    store.clearEvents();
    feedStatus.textContent = 'Not following anyone yet.';
    return;
  }
  if (feedSubId) unsubscribeAll(feedSubId);
  feedSubId = crypto.randomUUID();
  subIdHandlers.set(feedSubId, (event) => store.addEvent(event));
  store.clearEvents();
  feedStatus.textContent = 'Loading events…';
  subscribeAll(feedSubId, [buildFeedFilter()]);
}

function buildFeedFilter(kinds = [1]) {
  const filter = { kinds, limit: 20 };
  if (feedActiveTab === 'following' && store.follows.length > 0) {
    filter.authors = store.follows.map(f => f.pubkey);
  }
  if (sinceFilter > 0) filter.since = Math.floor(Date.now() / 1000) - sinceFilter;
  if (untilFilter > 0) filter.until = Math.floor(Date.now() / 1000) - untilFilter;
  return filter;
}

function handleMetadataEvent(event) {
  try {
    const metadata = JSON.parse(event.content);
    const existing = store.profiles.get(event.pubkey);
    if (!existing || event.created_at > existing._created_at) {
      store.setProfile(event.pubkey, { ...metadata, _created_at: event.created_at });
      if (metadata.nip05) handleVerifyNip05(event.pubkey, metadata.nip05);
    }
  } catch {
    // Ignore invalid JSON in kind-0 content
  }
}

async function handleVerifyNip05(pubkey, identifier) {
  if (nip05Checked.has(pubkey)) return;
  nip05Checked.add(pubkey);
  try {
    await verifyNip05(pubkey, identifier, store);
  } catch {
    nip05Checked.delete(pubkey); // allow retry on transient failure
  }
}

function populateProfileForm(pubkey) {
  const profile = store.profiles.get(pubkey);
  if (!profile) return;
  profileNameInput.value = profile.name || profile.display_name || '';
  profileAboutInput.value = profile.about || '';
  profilePictureInput.value = profile.picture || '';
  profileNip05Input.value = profile.nip05 || '';
}

function handleAttestationEvent(event) {
  const refId = event.tags.find(t => t[0] === 'e')?.[1];
  if (refId) store.setAttestation(refId, event.content);
}

function subscribeAttestations() {
  const ids = store.events.map(e => e.id);
  if (!ids.length) return;
  if (attestationSubId) unsubscribeAll(attestationSubId);
  attestationSubId = crypto.randomUUID();
  subscribeAll(attestationSubId, [{ kinds: [1040], '#e': ids, limit: 50 }]);
}

// ── Direct Messages ───────────────────────────────────────────────────────────

function getDmContact(event, myPubkey) {
  if (!myPubkey) return null;
  return event.pubkey === myPubkey
    ? (event.tags.find(t => t[0] === 'p')?.[1] ?? null)
    : event.pubkey;
}

function handleDmEvent(event) {
  if (!store.signer) return;
  const myPubkey = store.signer.pubkeyHex;
  const isOutgoing = event.pubkey === myPubkey;
  const isIncoming = event.tags.some(t => t[0] === 'p' && t[1] === myPubkey);
  if (!isOutgoing && !isIncoming) return;
  store.addDm(event);
}

async function tryDecryptDm(event) {
  if (!store.signer || store.dmDecrypted.has(event.id)) return;
  const contact = getDmContact(event, store.signer.pubkeyHex);
  if (!contact) return;
  try {
    const plaintext = await store.signer.decrypt(contact, event.content);
    store.setDmDecrypted(event.id, plaintext);
  } catch {
    store.setDmDecrypted(event.id, '[decryption failed]');
  }
}

function rerenderDmConvList() {
  if (!store.signer) return;
  dmConvsList.innerHTML = '';
  const myPubkey = store.signer.pubkeyHex;
  const contacts = new Map(); // pubkey → latest event
  for (const event of store.dms) {
    const contact = getDmContact(event, myPubkey);
    if (!contact) continue;
    if (!contacts.has(contact) || event.created_at > contacts.get(contact).created_at) {
      contacts.set(contact, event);
    }
  }
  if (contacts.size === 0) return;
  const sorted = [...contacts.entries()].sort((a, b) => b[1].created_at - a[1].created_at);
  for (const [pubkey, latestEvent] of sorted) {
    const profile = store.profiles.get(pubkey);
    const displayName = getDisplayName(profile, pubkey.slice(0, 12) + '…');
    const preview = store.dmDecrypted.get(latestEvent.id) ?? '…';

    const item = document.createElement('div');
    item.className = 'dm-conv-item' + (pubkey === currentDmContact ? ' active' : '');

    const nameEl = document.createElement('span');
    nameEl.className = 'dm-conv-name';
    nameEl.textContent = displayName;

    const previewEl = document.createElement('span');
    previewEl.className = 'dm-conv-preview';
    previewEl.textContent = preview.length > 50 ? preview.slice(0, 50) + '…' : preview;

    item.append(nameEl, previewEl);
    item.addEventListener('click', () => openDmThread(pubkey));
    dmConvsList.appendChild(item);
  }
}

function openDmThread(pubkey) {
  currentDmContact = pubkey;
  const profile = store.profiles.get(pubkey);
  const displayName = getDisplayName(profile, pubkey.slice(0, 12) + '…');
  dmThreadTitle.textContent = `Conversation with ${displayName}`;
  dmMessages.innerHTML = '';
  const myPubkey = store.signer?.pubkeyHex;
  const msgs = store.dms
    .filter(e => getDmContact(e, myPubkey) === pubkey)
    .slice().reverse(); // oldest first
  for (const event of msgs) appendDmMessage(event);
  dmThread.hidden = false;
  dmMessages.scrollTop = dmMessages.scrollHeight;
  rerenderDmConvList();
}

function appendDmMessage(event) {
  if (!store.signer) return;
  const isOutgoing = event.pubkey === store.signer.pubkeyHex;
  const decrypted = store.dmDecrypted.get(event.id);

  const wrapper = document.createElement('div');
  wrapper.dataset.dmId = event.id;
  wrapper.className = 'dm-message-wrapper ' + (isOutgoing ? 'outgoing' : 'incoming');
  if (decrypted === undefined) wrapper.classList.add('dm-pending');

  const bubble = document.createElement('div');
  bubble.className = 'dm-bubble';
  bubble.textContent = decrypted !== undefined ? decrypted : '…';

  const timeEl = document.createElement('div');
  timeEl.className = 'dm-message-time';
  timeEl.textContent = formatTime(event.created_at);

  wrapper.append(bubble, timeEl);
  dmMessages.appendChild(wrapper);
}

dmOpenBtn.addEventListener('click', () => {
  const pubkey = dmRecipientInput.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    dmRecipientError.textContent = 'Must be a 64-character hex public key.';
    dmRecipientError.hidden = false;
    return;
  }
  dmRecipientError.hidden = true;
  openDmThread(pubkey);
});

dmRecipientInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') dmOpenBtn.click(); });

dmSendBtn.addEventListener('click', async () => {
  if (!requireKeysAndRelay((msg) => setResult(dmResult, msg, 'err'))) return;
  if (!currentDmContact) {
    setResult(dmResult, 'Open a conversation first.', 'err');
    return;
  }
  const content = dmCompose.value.trim();
  if (!content) return;

  dmSendBtn.disabled = true;
  setResult(dmResult, 'Sending…', '');

  try {
    const encrypted = await store.signer.encrypt(currentDmContact, content);
    const event = await createOwnEvent({ kind: 4, tags: [['p', currentDmContact]], content: encrypted });
    await publishToAll(event);
    store.addDm(event);
    dmCompose.value = '';
    setResult(dmResult, '', '');
  } catch (err) {
    setResult(dmResult, err.message, 'err');
  } finally {
    dmSendBtn.disabled = false;
  }
});

function fetchMissingMetadata() {
  clearTimeout(metadataDebounceTimer);
  metadataDebounceTimer = setTimeout(() => {
    const myPubkey = store.signer?.pubkeyHex;
    const allPubkeys = [
      ...store.events.map(e => e.pubkey),
      ...store.mentions.map(e => e.pubkey),
      ...store.follows.map(f => f.pubkey),
      ...store.dms.map(e => getDmContact(e, myPubkey)).filter(Boolean),
    ];
    const unknown = [...new Set(allPubkeys)].filter(pk => !store.profiles.has(pk));
    if (!unknown.length) return;
    if (metadataSubId) unsubscribeAll(metadataSubId);
    metadataSubId = crypto.randomUUID();
    subscribeAll(metadataSubId, [{ kinds: [0], authors: unknown, limit: unknown.length }]);
  }, 300);
}

function rerenderRelayList() {
  relayListEl.innerHTML = '';
  if (relays.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'relay-list-empty';
    empty.textContent = 'No relays configured.';
    relayListEl.appendChild(empty);
    return;
  }
  for (const [url, { status }] of relays) {
    const item = document.createElement('div');
    item.className = 'relay-item';

    const dot = document.createElement('span');
    dot.className = `dot ${status}`;

    const urlEl = document.createElement('span');
    urlEl.className = 'relay-item-url';
    urlEl.textContent = url;
    urlEl.title = url;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-relay-toggle';
    toggleBtn.disabled = status === 'connecting';
    toggleBtn.textContent = status === 'connected' ? 'Disconnect'
      : status === 'connecting' ? 'Connecting…'
      : 'Connect';
    toggleBtn.addEventListener('click', () => {
      if (status === 'connected') disconnectRelay(url);
      else connectRelay(url);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-relay-remove';
    removeBtn.title = 'Remove relay';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeRelay(url));

    item.append(dot, urlEl, toggleBtn, removeBtn);
    relayListEl.appendChild(item);
  }
}

function rerenderFeed() {
  if (!store.events.length) return;
  eventsList.innerHTML = '';
  for (const event of store.events) {
    eventsList.appendChild(renderEvent(event, makeStoreSlice(), makeRenderCallbacks()));
  }
}

function switchTab(tab) {
  feedActiveTab = tab;
  tabFeed.classList.toggle('active', tab === 'feed');
  tabFollowing.classList.toggle('active', tab === 'following');
  tabMentions.classList.toggle('active', tab === 'mentions');

  const isFeedLike = tab === 'feed' || tab === 'following';
  feedFilters.hidden = !isFeedLike;
  feedStatus.hidden = !isFeedLike;
  eventsList.hidden = !isFeedLike;
  mentionsStatus.hidden = tab !== 'mentions';
  mentionsList.hidden = tab !== 'mentions';
}

function updateFeedTabs() {
  feedHeader.hidden = !isAnyConnected();
  tabMentions.hidden = !store.signer;

  if (feedActiveTab === 'mentions' && !store.signer) {
    switchTab('feed');
  }
}

function requireKeysAndRelay(errorFn) {
  if (!store.signer) { errorFn('Generate or import a keypair first.'); return false; }
  if (!isAnyConnected()) { errorFn('Connect to a relay first.'); return false; }
  return true;
}

function updateIdentityUI() {
  const hasKeys = !!store.signer;
  const isNip07 = store.signer instanceof Nip07Signer;
  logoutBtn.hidden = !hasKeys;
  nip07Badge.hidden = !isNip07;
  nip07LoginBtn.hidden = isNip07;
  nip07Error.hidden = true;
  document.getElementById('privkey-section').hidden = isNip07;
  document.getElementById('mnemonic-section').hidden = isNip07;
  document.getElementById('local-key-btn-row').hidden = isNip07;
}

async function createOwnEvent({ kind, tags, content }) {
  if (!store.signer) throw new Error('No identity loaded.');
  return store.signer.signEvent({ created_at: Math.floor(Date.now() / 1000), kind, tags, content });
}

function isValidRelayUrl(url) {
  return url.startsWith('wss://') || url.startsWith('ws://');
}

function bindSaveOnBlurOrEnter(input, fn) {
  input.addEventListener('blur', fn);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}

function setResult(el, msg, cls) {
  el.textContent = msg;
  el.className = 'result-msg ' + cls;
}

function setPostResult(msg, cls) { setResult(postResult, msg, cls); }
function setProfileResult(msg, cls) { setResult(profileResult, msg, cls); }

// ── Store slice + callback factories for render functions ─────────────────────

function makeStoreSlice() {
  return {
    signer: store.signer,
    profiles: store.profiles,
    nip05: store.nip05,
    attestations: store.attestations,
    followedPubkeys: store.followedPubkeys,
    events: store.events,
  };
}

function makeRenderCallbacks() {
  return {
    onFollow: async (pubkey) => {
      store.addFollow({ pubkey, relay: '', petname: '' });
      rerenderFeed();
      try { await publishFollowList(); } catch { /* ignore relay error */ }
    },
    onReply: async (parentEvent, content) => {
      const event = await createOwnEvent({
        kind: 1,
        tags: [['e', parentEvent.id], ['p', parentEvent.pubkey]],
        content,
      });
      await publishToAll(event);
      store.addEvent(event);
    },
    onShowReplies: (event, repliesContainer, showRepliesBtn) => {
      const existing = replySubscriptions.get(event.id);
      if (existing) {
        repliesContainer.hidden = !repliesContainer.hidden;
        showRepliesBtn.textContent = repliesContainer.hidden ? 'Show replies' : 'Hide replies';
      } else {
        if (!isAnyConnected()) return;
        repliesContainer.hidden = false;
        showRepliesBtn.textContent = 'Hide replies';
        const loadingEl = document.createElement('div');
        loadingEl.className = 'replies-loading';
        loadingEl.textContent = 'Loading replies…';
        repliesContainer.appendChild(loadingEl);
        const subId = crypto.randomUUID();
        replySubscriptions.set(event.id, { subId, container: repliesContainer });
        replySubIdToContainer.set(subId, repliesContainer);
        replyEventIds.set(subId, new Set());
        subIdHandlers.set(subId, (replyEvent) => {
          const seen = replyEventIds.get(subId);
          if (seen && !seen.has(replyEvent.id)) {
            seen.add(replyEvent.id);
            repliesContainer.querySelector('.replies-loading')?.remove();
            repliesContainer.querySelector('.replies-empty')?.remove();
            repliesContainer.appendChild(
              renderReply(replyEvent, { profiles: store.profiles, nip05: store.nip05 })
            );
          }
        });
        subscribeAll(subId, [{ kinds: [1], '#e': [event.id], limit: 20 }]);
      }
    },
    requireKeysAndRelay,
  };
}

async function copyToClipboard(text, btn) {
  if (!text) return;
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  } finally {
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
}
