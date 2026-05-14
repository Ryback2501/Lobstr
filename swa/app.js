import { generateKeypair, importPrivkey, verifyEvent } from './nostr.js';
import { generateMnemonic, validateMnemonic, deriveNostrKeypair } from './mnemonic.js';
import { store } from './store.js';
import { LocalSigner, ExtensionSigner } from './signer.js';
import { verifyIdentity } from './identityVerifier.js';
import { VERSION } from './version.js';
import { buildReplyTags, buildMentionEvent, buildQuoteTag } from './threading.js';
import { fetchRelayInfo } from './relayInfo.js';
import { RelayPool } from './relayPool.js';
import { findAuthorizedDeletions } from './deletions.js';
import { getDmContact, aggregateDmContacts } from './dms.js';
import { renderDmConvItem, renderDmThreadTitle, renderDmMessage } from './dmView.js';
import {
  renderEvent, renderReply, renderFollowItem,
  createOtsBadge, createQuoteEmbed,
} from './feedView.js';
const SUPPORTED_SPECS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];

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

const securitySection = document.getElementById('security-section');
const mnemonicDisplayWrapper = document.getElementById('mnemonic-display-wrapper');
const mnemonicDisplay = document.getElementById('mnemonic-display');
const copyMnemonicBtn = document.getElementById('copy-mnemonic-btn');
const mnemonicImport = document.getElementById('mnemonic-import');
const mnemonicImportBtn = document.getElementById('mnemonic-import-btn');
const mnemonicError = document.getElementById('mnemonic-error');

const profileNameInput = document.getElementById('profile-name');
const profileAboutInput = document.getElementById('profile-about');
const profilePictureInput = document.getElementById('profile-picture');
const profileIdentityInput = document.getElementById('profile-identity');
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
const dmCharCount = document.getElementById('dm-char-count');
const dmSendBtn = document.getElementById('dm-send-btn');
const dmResult = document.getElementById('dm-result');

const extensionLoginBtn = document.getElementById('extension-login-btn');
const extensionError = document.getElementById('extension-error');
const extensionBadge = document.getElementById('extension-badge');
const logoutBtn = document.getElementById('logout-btn');

const loginModal = document.getElementById('login-modal');
const loginBtnList = document.getElementById('login-btn-list');
const usePrivkeyBtn = document.getElementById('use-privkey-btn');
const privkeySubview = document.getElementById('privkey-subview');
const privkeyCancelBtn = document.getElementById('privkey-cancel-btn');
const useMnemonicBtn = document.getElementById('use-mnemonic-btn');
const mnemonicSubview = document.getElementById('mnemonic-subview');
const mnemonicCancelBtn = document.getElementById('mnemonic-cancel-btn');
const generateMnemonic12Btn = document.getElementById('generate-mnemonic-12-btn');
const generateMnemonic24Btn = document.getElementById('generate-mnemonic-24-btn');
const generateError = document.getElementById('generate-error');

const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalVersion = document.getElementById('modal-version');
const modalSpecsList = document.getElementById('modal-specs-list');

const relayInfoModal = document.getElementById('relay-info-modal');
const relayModalClose = document.getElementById('relay-modal-close');
const relayModalIcon = document.getElementById('relay-modal-icon');
const relayModalName = document.getElementById('relay-modal-name');
const relayModalUrl = document.getElementById('relay-modal-url');
const relayModalDescription = document.getElementById('relay-modal-description');
const relayModalMeta = document.getElementById('relay-modal-meta');
const relayModalNipsSection = document.getElementById('relay-modal-nips-section');
const relayModalNips = document.getElementById('relay-modal-nips');
const relayModalLimitsSection = document.getElementById('relay-modal-limits-section');
const relayModalLimits = document.getElementById('relay-modal-limits');

// ── State ─────────────────────────────────────────────────────────────────────

const pool = new RelayPool({
  onEvent: handleEvent,
  onEOSE: handleEOSE,
  onClosed: handleClosed,
  onNotice: handleNotice,
  onStatus: handleRelayStatus,
});

// Handler registries
const globalKindHandlers = new Map(); // kind → fn(event, subId) — run for all events of this kind, bypasses subId routing
const kindHandlers = new Map(); // kind → fn(event, subId) — fallback when no subId handler matches
const subIdHandlers = new Map(); // subId → fn(event)
const subIdEOSEHandlers = new Map(); // subId → fn()
const subIdClosedHandlers = new Map(); // subId → fn(url, message)

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
const identityVerifyAttempted = new Set(); // pubkeys already attempted (verified or failed)
let feedRetryTimer = null;
const pendingQuoteIds = new Set();
let quoteFetchDebounceTimer = null;
let quoteFetchSubId = null;
let sinceFilter = 0; // seconds offset from now; 0 = no filter
let untilFilter = 0; // seconds offset from now; 0 = no filter
let feedActiveTab = 'feed'; // 'feed' | 'following' | 'mentions'
const replySubscriptions = new Map(); // eventId → { subId, container }
const replySubIdToContainer = new Map(); // subId → container element
const replyEventIds = new Map(); // subId → Set<eventId> (dedup across relays)

// ── Event handler registry setup ──────────────────────────────────────────────

// Kind 0 is always processed for metadata regardless of which subscription delivers it
globalKindHandlers.set(0, (event, subId) => {
  handleMetadataEvent(event);
  if (subId === ownProfileSubId) populateProfileForm(event.pubkey);
});

globalKindHandlers.set(5, (event) => handleIncomingDeletion(event));

kindHandlers.set(1040, (event) => handleAttestationEvent(event));

kindHandlers.set(4, (event) => handleDmEvent(event));

// ── Info modal ────────────────────────────────────────────────────────────────

modalVersion.textContent = `v${VERSION}`;
for (const spec of SUPPORTED_SPECS) {
  const badge = document.createElement('span');
  badge.className = 'spec-badge';
  badge.textContent = spec;
  modalSpecsList.appendChild(badge);
}

infoBtn.addEventListener('click', () => { infoModal.hidden = false; });
modalCloseBtn.addEventListener('click', () => { infoModal.hidden = true; });
infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    infoModal.hidden = true;
    relayInfoModal.hidden = true;
  }
});

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
    store.setSigner(new LocalSigner(keys));
    pubkeyDisplay.value = keys.pubkeyHex;
  } catch {
    sessionStorage.removeItem('privkeyHex');
  }
}

updateIdentityUI();

// Populate relay pool from store and auto-connect previously connected relays
for (const url of store.relayUrls) {
  pool.add(url);
}
rerenderRelayList();

for (const url of store.connectedRelayUrls) {
  if (pool.has(url)) connectRelay(url);
}

// ── Store subscriptions ───────────────────────────────────────────────────────

store.on('signer', (signer) => {
  pubkeyDisplay.value = signer ? signer.pubkeyHex : '';
  updateIdentityUI();
  if (signer) {
    for (const url of store.connectedRelayUrls) {
      if (pool.has(url)) connectRelay(url);
    }
    if (isAnyConnected()) setupSubscriptions();
  } else {
    identityVerifyAttempted.clear();
    updateFeedTabs();
  }
});

store.on('follows', (follows) => {
  followsStatus.textContent = follows.length === 0 ? 'Not following anyone yet.' : '';
  renderFollows(follows);
  updateFeedTabs();
  if (feedActiveTab === 'following' && store.signer && isAnyConnected()) {
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
  updateCardsForPubkey(pubkey);
  renderFollows(store.follows);
  rerenderDmConvList();
  if (pubkey === currentDmContact) updateDmThreadTitle(pubkey);
});

store.on('verifiedIdentity', (pubkey) => {
  updateCardsForPubkey(pubkey);
  renderFollows(store.follows);
  rerenderDmConvList();
  if (pubkey === currentDmContact) updateDmThreadTitle(pubkey);
});

store.on('attestation', (eventId) => {
  const attestation = store.attestations.get(eventId);
  for (const list of [eventsList, mentionsList]) {
    const card = list.querySelector(`[data-event-id="${eventId}"]`);
    if (card && !card.querySelector('.ots-badge')) {
      card.querySelector('.event-meta-left')?.appendChild(createOtsBadge(attestation.raw, eventId));
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

store.on('eventRemoved', (eventId) => {
  eventsList.querySelector(`[data-event-id="${eventId}"]`)?.remove();
  mentionsList.querySelector(`[data-event-id="${eventId}"]`)?.remove();
});

store.on('quotedEvent', (eventId) => {
  const event = store.quotedEvents.get(eventId);
  if (!event) return;
  if (!verifyEvent(event)) return;
  const profile = store.profiles.get(event.pubkey);
  for (const placeholder of document.querySelectorAll(`[data-quote-id="${eventId}"]`)) {
    placeholder.replaceWith(createQuoteEmbed(event, profile, store.verifiedIdentities));
  }
});

store.on('relayInfo', (url) => {
  rerenderRelayList();
  if (url === currentRelayModalUrl) openRelayModal(url);
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
});

privkeyImport.addEventListener('keydown', (e) => { if (e.key === 'Enter') importBtn.click(); });

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

// ── Mnemonic seed phrase ──────────────────────────────────────────────────────

usePrivkeyBtn.addEventListener('click', () => {
  loginBtnList.hidden = true;
  privkeySubview.hidden = false;
});

privkeyCancelBtn.addEventListener('click', () => showLoginBtns());

useMnemonicBtn.addEventListener('click', () => {
  loginBtnList.hidden = true;
  mnemonicSubview.hidden = false;
});

mnemonicCancelBtn.addEventListener('click', () => showLoginBtns());

async function doGenerateMnemonic(btn, strength) {
  btn.disabled = true;
  generateError.hidden = true;
  try {
    const mnemonic = generateMnemonic(strength);
    const { privkeyHex } = await deriveNostrKeypair(mnemonic);
    const keys = importPrivkey(privkeyHex);
    store.setSigner(new LocalSigner(keys));
    privkeyDisplayWrapper.hidden = true;
    showMnemonic(mnemonic);
  } catch (err) {
    generateError.textContent = err.message;
    generateError.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

generateMnemonic12Btn.addEventListener('click', () => doGenerateMnemonic(generateMnemonic12Btn, 128));
generateMnemonic24Btn.addEventListener('click', () => doGenerateMnemonic(generateMnemonic24Btn, 256));

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

// ── Extension login ───────────────────────────────────────────────────────────

extensionLoginBtn.addEventListener('click', async () => {
  extensionError.hidden = true;
  if (!window.nostr) {
    extensionError.textContent = 'No signing extension detected. Install one (e.g. Alby, nos2x) and reload.';
    extensionError.hidden = false;
    return;
  }
  extensionLoginBtn.disabled = true;
  try {
    const signer = await new ExtensionSigner(window.nostr).init();
    store.setSigner(signer);
  } catch (err) {
    extensionError.textContent = err.message;
    extensionError.hidden = false;
  } finally {
    extensionLoginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  for (const url of store.relayUrls) pool.disconnect(url);
  pool.clearActiveSubs();

  store.clearEvents();
  store.clearMentions();
  store.clearProfiles();
  store.clearVerifiedIdentities();
  store.clearRelayInfos();
  store.clearQuotedEvents();
  store.setFollows([]);
  store.setConnectedRelayUrls(new Set());

  dmConvsList.innerHTML = '';
  currentDmContact = null;
  dmThread.hidden = true;

  profileNameInput.value = '';
  profileAboutInput.value = '';
  profilePictureInput.value = '';
  profileIdentityInput.value = '';
  profileResult.textContent = '';

  feedStatus.textContent = 'Connect to a server to see events.';

  store.setSigner(null);
});

// ── Profile ───────────────────────────────────────────────────────────────────

profileSaveBtn.addEventListener('click', async () => {
  if (!requireKeysAndRelay((msg) => setProfileResult(msg, 'err'))) return;

  const metadata = {
    name: profileNameInput.value.trim(),
    about: profileAboutInput.value.trim(),
    picture: profilePictureInput.value.trim(),
    nip05: profileIdentityInput.value.trim() || undefined,
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
  subIdEOSEHandlers.set(idSearchSubId, () => {
    if (store.events.length === 0) feedStatus.textContent = 'Event not found.';
    else fetchMissingMetadata();
  });
  subIdClosedHandlers.set(idSearchSubId, (url, msg) => showSubClosedNotice(url, 'search', msg));
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
  if (pool.has(url)) {
    relayNotice.textContent = 'Relay already in list.';
    relayNotice.hidden = false;
    return;
  }
  relayNotice.hidden = true;
  pool.add(url);
  store.setRelayUrls(pool.urls());
  relayAddInput.value = '';
  rerenderRelayList();
}

function connectRelay(url) {
  pool.connect(url);
  const connected = store.connectedRelayUrls;
  connected.add(url);
  store.setConnectedRelayUrls(connected);
  fetchRelayInfo(url).then(info => store.setRelayInfo(url, info)).catch(() => {});
}

function disconnectRelay(url) {
  pool.disconnect(url);
  const connected = store.connectedRelayUrls;
  connected.delete(url);
  store.setConnectedRelayUrls(connected);
}

function removeRelay(url) {
  disconnectRelay(url);
  pool.remove(url);
  store.setRelayUrls(pool.urls());
  rerenderRelayList();
}

// ── Following ─────────────────────────────────────────────────────────────────

followPubkeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') followBtn.click(); });

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
  let msg = 'Unfollowed.';
  try {
    await publishFollowList();
  } catch {
    msg = 'Unfollowed locally — relay error.';
  }
  if (store.follows.length > 0) {
    followsStatus.textContent = msg;
    setTimeout(() => {
      if (followsStatus.textContent === msg) followsStatus.textContent = '';
    }, 2000);
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
      { profiles: store.profiles, verifiedIdentities: store.verifiedIdentities },
      {
        onUnfollow: handleUnfollow,
        onPetnameChange: async (entry, newPetname) => {
          entry.petname = newPetname;
          try { await publishFollowList(); } catch { /* ignore */ }
        },
        onRelayChange: async (entry, newRelay) => {
          if (newRelay && !isValidRelayUrl(newRelay)) return false;
          entry.relay = newRelay;
          try { await publishFollowList(); } catch { /* ignore */ }
        },
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
    const { content: transformedContent, tags: mentionTags } = buildMentionEvent(content);
    const event = await createOwnEvent({ kind: 1, tags: mentionTags, content: transformedContent });
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

  const gkh = globalKindHandlers.get(event.kind);
  if (gkh) { gkh(event, subId); return; }

  if (subIdHandlers.has(subId)) { subIdHandlers.get(subId)(event); return; }

  const kh = kindHandlers.get(event.kind);
  if (kh) kh(event, subId);
}

function handleEOSE(subId) {
  subIdEOSEHandlers.get(subId)?.();
}

function relayHostname(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function showSubClosedNotice(url, label, message) {
  relayNotice.textContent = `[${relayHostname(url)}] closed ${label} subscription: ${message || 'no reason given'}`;
  relayNotice.hidden = false;
}

function handleClosed(url, subId, message) {
  subIdClosedHandlers.get(subId)?.(url, message);
}

function handleNotice(url, message) {
  relayNotice.textContent = `[${relayHostname(url)}] ${message}`;
  relayNotice.hidden = false;
}

function handleRelayStatus(url, status, wasAnyConnected) {
  rerenderRelayList();

  if (status === 'connected') {
    if (!wasAnyConnected) {
      // First relay to connect — clear state and set up all subscriptions
      store.clearEvents();
      store.clearMentions();
      store.setFollows([]);
      setupSubscriptions();
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
    pool.clearActiveSubs();
    subIdHandlers.clear();
    subIdEOSEHandlers.clear();
    subIdClosedHandlers.clear();
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

function isAnyConnected() { return pool.isAnyConnected(); }

function subscribeAll(subId, filters) { pool.subscribe(subId, filters); }

function unsubscribeAll(subId) {
  pool.unsubscribe(subId);
  subIdHandlers.delete(subId);
  subIdEOSEHandlers.delete(subId);
  subIdClosedHandlers.delete(subId);
}

function publishToAll(event) { return pool.publish(event); }

function setupSubscriptions() {
  pool.clearActiveSubs();
  subIdHandlers.clear();
  subIdEOSEHandlers.clear();
  subIdClosedHandlers.clear();
  replySubscriptions.clear();
  replySubIdToContainer.clear();
  replyEventIds.clear();
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
    subIdClosedHandlers.set(ownProfileSubId, (url, msg) => showSubClosedNotice(url, 'profile', msg));
    subscribeAll(ownProfileSubId, [{ kinds: [0], authors: [store.signer.pubkeyHex], limit: 1 }]);

    followsSubId = crypto.randomUUID();
    subIdHandlers.set(followsSubId, (event) => { if (event.kind === 3) handleFollowListEvent(event); });
    subIdEOSEHandlers.set(followsSubId, () => {
      if (store.follows.length === 0) {
        followsStatus.textContent = 'Not following anyone yet.';
      } else {
        fetchMissingMetadata();
      }
    });
    subIdClosedHandlers.set(followsSubId, (url, msg) => showSubClosedNotice(url, 'follows', msg));
    followsStatus.textContent = 'Loading follow list…';
    subscribeAll(followsSubId, [{ kinds: [3], authors: [store.signer.pubkeyHex], limit: 1 }]);

    mentionsSubId = crypto.randomUUID();
    subIdHandlers.set(mentionsSubId, (event) => store.addMention(event));
    subIdEOSEHandlers.set(mentionsSubId, () => {
      if (store.mentions.length === 0) mentionsStatus.textContent = 'No mentions yet.';
      fetchMissingMetadata();
    });
    subIdClosedHandlers.set(mentionsSubId, (url, msg) => showSubClosedNotice(url, 'mentions', msg));
    subscribeAll(mentionsSubId, [{ kinds: [1], '#p': [store.signer.pubkeyHex], limit: 20 }]);

    dmSubId = crypto.randomUUID();
    subIdEOSEHandlers.set(dmSubId, () => {
      fetchMissingMetadata();
      rerenderDmConvList();
    });
    subIdClosedHandlers.set(dmSubId, (url, msg) => showSubClosedNotice(url, 'dms', msg));
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
  subIdEOSEHandlers.set(feedSubId, () => {
    if (store.events.length === 0) feedStatus.textContent = 'No events found.';
    fetchMissingMetadata();
    subscribeAttestations();
  });
  subIdClosedHandlers.set(feedSubId, (url, msg) => {
    showSubClosedNotice(url, 'feed', msg);
    if (!feedRetryTimer) {
      feedStatus.textContent = 'Feed closed by relay. Retrying in 5s…';
      feedRetryTimer = setTimeout(() => {
        feedRetryTimer = null;
        pool.resubscribeFor(url, feedSubId);
      }, 5000);
    }
  });
  store.clearEvents();
  feedStatus.textContent = 'Loading events…';
  subscribeAll(feedSubId, [buildFeedFilter()]);
}

function buildFeedFilter(kinds = [1, 5]) {
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
      if (metadata.nip05) handleVerifyIdentity(event.pubkey, metadata.nip05);
    }
  } catch {
    // Ignore invalid JSON in kind-0 content
  }
}

async function handleVerifyIdentity(pubkey, identifier) {
  if (identityVerifyAttempted.has(pubkey)) return;
  identityVerifyAttempted.add(pubkey);
  await verifyIdentity(pubkey, identifier, (p, id) => store.setVerifiedIdentity(p, id));
}

function populateProfileForm(pubkey) {
  const profile = store.profiles.get(pubkey);
  if (!profile) return;
  profileNameInput.value = profile.name || profile.display_name || '';
  profileAboutInput.value = profile.about || '';
  profilePictureInput.value = profile.picture || '';
  profileIdentityInput.value = profile.nip05 || '';
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
  subIdClosedHandlers.set(attestationSubId, (url, msg) => showSubClosedNotice(url, 'attestations', msg));
  subscribeAll(attestationSubId, [{ kinds: [1040], '#e': ids, limit: 50 }]);
}

// ── Direct Messages ───────────────────────────────────────────────────────────

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

function makeDmListSlice() {
  return {
    profiles: store.profiles,
    verifiedIdentities: store.verifiedIdentities,
    dmDecrypted: store.dmDecrypted,
    currentDmContact,
  };
}

function rerenderDmConvList() {
  if (!store.signer) return;
  dmConvsList.innerHTML = '';
  const sorted = aggregateDmContacts(store.dms, store.signer.pubkeyHex);
  const slice = makeDmListSlice();
  for (const [pubkey, latestEvent] of sorted) {
    dmConvsList.appendChild(renderDmConvItem(pubkey, latestEvent, slice, openDmThread));
  }
}

function updateDmThreadTitle(pubkey) {
  dmThreadTitle.textContent = '';
  dmThreadTitle.appendChild(renderDmThreadTitle(pubkey, {
    profiles: store.profiles,
    verifiedIdentities: store.verifiedIdentities,
  }));
}

function openDmThread(pubkey) {
  currentDmContact = pubkey;
  updateDmThreadTitle(pubkey);
  dmMessages.innerHTML = '';
  const myPubkey = store.signer?.pubkeyHex;
  const msgs = store.dms
    .filter(e => getDmContact(e, myPubkey) === pubkey)
    .slice().reverse();
  for (const event of msgs) appendDmMessage(event);
  dmThread.hidden = false;
  dmMessages.scrollTop = dmMessages.scrollHeight;
  rerenderDmConvList();
}

function appendDmMessage(event) {
  if (!store.signer) return;
  dmMessages.appendChild(renderDmMessage(event, {
    myPubkey: store.signer.pubkeyHex,
    dmDecrypted: store.dmDecrypted,
  }));
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

dmCompose.addEventListener('input', () => { dmCharCount.textContent = dmCompose.value.length; });

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
    dmCharCount.textContent = '0';
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
    subIdClosedHandlers.set(metadataSubId, (url, msg) => showSubClosedNotice(url, 'metadata', msg));
    subscribeAll(metadataSubId, [{ kinds: [0], authors: unknown, limit: unknown.length }]);
  }, 300);
}

function rerenderRelayList() {
  relayListEl.innerHTML = '';
  if (pool.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'relay-list-empty';
    empty.textContent = 'No relays configured.';
    relayListEl.appendChild(empty);
    return;
  }
  for (const [url, { status }] of pool.entries()) {
    const item = document.createElement('div');
    item.className = 'relay-item';

    const dot = document.createElement('span');
    dot.className = `dot ${status}`;

    const urlEl = document.createElement('span');
    urlEl.className = 'relay-item-url';
    const relayName = store.relayInfos.get(url)?.name;
    urlEl.textContent = relayName || url;
    urlEl.title = url;
    urlEl.addEventListener('click', () => openRelayModal(url));

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

let currentRelayModalUrl = null;

function openRelayModal(url) {
  currentRelayModalUrl = url;
  const info = store.relayInfos.get(url);

  relayModalName.textContent = info?.name || relayHostname(url);
  relayModalUrl.textContent = url;

  if (info?.icon) {
    relayModalIcon.src = info.icon;
    relayModalIcon.hidden = false;
  } else {
    relayModalIcon.hidden = true;
  }

  if (info?.description) {
    relayModalDescription.textContent = info.description;
    relayModalDescription.hidden = false;
  } else {
    relayModalDescription.hidden = true;
  }

  relayModalMeta.innerHTML = '';
  const metaFields = [
    ['Contact', info?.contact],
    ['Admin key', info?.pubkey ? `${info.pubkey.slice(0, 16)}…` : null],
    ['Software', info?.software ? (info.version ? `${info.software} ${info.version}` : info.software) : null],
  ];
  for (const [label, value] of metaFields) {
    if (!value) continue;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dd.title = value;
    relayModalMeta.append(dt, dd);
  }

  const nips = info?.supported_nips;
  if (Array.isArray(nips) && nips.length) {
    relayModalNips.innerHTML = '';
    for (const n of nips) {
      const badge = document.createElement('span');
      badge.className = 'spec-badge';
      badge.textContent = `NIP-${String(n).padStart(2, '0')}`;
      relayModalNips.appendChild(badge);
    }
    relayModalNipsSection.hidden = false;
  } else {
    relayModalNipsSection.hidden = true;
  }

  const lim = info?.limitation;
  if (lim && typeof lim === 'object') {
    relayModalLimits.innerHTML = '';
    const limitFields = [
      ['Max message', lim.max_message_length != null ? `${lim.max_message_length} bytes` : null],
      ['Max subscriptions', lim.max_subscriptions],
      ['Max limit', lim.max_limit],
      ['Default limit', lim.default_limit],
      ['Max event tags', lim.max_event_tags],
      ['Max content', lim.max_content_length != null ? `${lim.max_content_length} chars` : null],
      ['Min PoW', lim.min_pow_difficulty],
      ['Auth required', lim.auth_required != null ? (lim.auth_required ? 'yes' : 'no') : null],
      ['Payment required', lim.payment_required != null ? (lim.payment_required ? 'yes' : 'no') : null],
    ];
    let shown = 0;
    for (const [label, value] of limitFields) {
      if (value == null) continue;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      relayModalLimits.append(dt, dd);
      shown++;
    }
    relayModalLimitsSection.hidden = shown === 0;
  } else {
    relayModalLimitsSection.hidden = true;
  }

  relayInfoModal.hidden = false;
}

relayModalClose.addEventListener('click', () => { relayInfoModal.hidden = true; });
relayInfoModal.addEventListener('click', (e) => { if (e.target === relayInfoModal) relayInfoModal.hidden = true; });

function rerenderFeed() {
  if (!store.events.length) return;
  eventsList.innerHTML = '';
  for (const event of store.events) {
    eventsList.appendChild(renderEvent(event, makeStoreSlice(), makeRenderCallbacks()));
  }
}

function updateCardsForPubkey(pubkey) {
  const slice = makeStoreSlice();
  const callbacks = makeRenderCallbacks();
  for (const list of [eventsList, mentionsList]) {
    for (const oldCard of list.querySelectorAll(`[data-event-id]`)) {
      const eventId = oldCard.dataset.eventId;
      const event = store.events.find(e => e.id === eventId) || store.mentions.find(e => e.id === eventId);
      if (event && event.pubkey === pubkey) oldCard.replaceWith(renderEvent(event, slice, callbacks));
    }
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

function showLoginBtns() {
  loginBtnList.hidden = false;
  privkeySubview.hidden = true;
  mnemonicSubview.hidden = true;
  importError.hidden = true;
  mnemonicError.hidden = true;
  generateError.hidden = true;
  extensionError.hidden = true;
  privkeyImport.value = '';
  mnemonicImport.value = '';
}

function updateIdentityUI() {
  const hasKeys = !!store.signer;
  const isExtension = store.signer instanceof ExtensionSigner;
  loginModal.hidden = hasKeys;
  securitySection.hidden = !hasKeys;
  extensionBadge.hidden = !isExtension;
  extensionError.hidden = true;
  if (!hasKeys) {
    showLoginBtns();
    privkeyDisplay.value = '';
    privkeyDisplayWrapper.hidden = true;
    mnemonicDisplay.innerHTML = '';
    mnemonicDisplayWrapper.hidden = true;
  }
}

async function handleDeleteEvent(event) {
  const deletionEvent = await createOwnEvent({
    kind: 5,
    tags: [['e', event.id], ['k', String(event.kind)]],
    content: '',
  });
  await publishToAll(deletionEvent);
  store.removeEvent(event.id);
  store.removeMention(event.id);
}

function handleIncomingDeletion(deletionEvent) {
  const candidates = [...store.events, ...store.mentions];
  for (const id of findAuthorizedDeletions(deletionEvent, candidates)) {
    store.removeEvent(id);
    store.removeMention(id);
  }
}

async function createOwnEvent({ kind, tags, content }) {
  if (!store.signer) throw new Error('No identity loaded.');
  return store.signer.signEvent({ created_at: Math.floor(Date.now() / 1000), kind, tags, content });
}

function isValidRelayUrl(url) {
  return url.startsWith('wss://') || url.startsWith('ws://');
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
    verifiedIdentities: store.verifiedIdentities,
    attestations: store.attestations,
    followedPubkeys: store.followedPubkeys,
    events: store.events,
    quotedEvents: store.quotedEvents,
  };
}

function requestQuotedEvent(quotedId) {
  if (store.quotedEvents.has(quotedId)) return;
  if (store.events.some(e => e.id === quotedId)) return;
  if (pendingQuoteIds.has(quotedId)) return;
  pendingQuoteIds.add(quotedId);
  clearTimeout(quoteFetchDebounceTimer);
  quoteFetchDebounceTimer = setTimeout(flushPendingQuotes, 200);
}

function flushPendingQuotes() {
  if (pendingQuoteIds.size === 0 || !isAnyConnected()) return;
  const ids = [...pendingQuoteIds];
  pendingQuoteIds.clear();
  if (quoteFetchSubId) unsubscribeAll(quoteFetchSubId);
  quoteFetchSubId = crypto.randomUUID();
  subIdHandlers.set(quoteFetchSubId, (event) => {
    if (ids.includes(event.id)) store.addQuotedEvent(event);
  });
  subIdEOSEHandlers.set(quoteFetchSubId, () => {
    if (quoteFetchSubId) unsubscribeAll(quoteFetchSubId);
    quoteFetchSubId = null;
  });
  subIdClosedHandlers.set(quoteFetchSubId, (url, msg) => showSubClosedNotice(url, 'quotes', msg));
  subscribeAll(quoteFetchSubId, [{ ids }]);
}

function makeRenderCallbacks() {
  return {
    onFollow: async (pubkey) => {
      store.addFollow({ pubkey, relay: '', petname: '' });
      rerenderFeed();
      try { await publishFollowList(); } catch { /* ignore relay error */ }
    },
    onReply: async (parentEvent, content) => {
      if (!store.signer) throw new Error('Generate or import a keypair first.');
      if (!isAnyConnected()) throw new Error('Connect to a relay first.');
      const replyTags = buildReplyTags(parentEvent, store.signer.pubkeyHex);
      const { content: transformedContent, tags: mentionTags } = buildMentionEvent(content, replyTags.length);
      const event = await createOwnEvent({
        kind: 1,
        tags: [...replyTags, ...mentionTags],
        content: transformedContent,
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
              renderReply(replyEvent, { profiles: store.profiles, verifiedIdentities: store.verifiedIdentities })
            );
          }
        });
        subIdEOSEHandlers.set(subId, () => {
          if (repliesContainer.querySelector('.replies-loading')) {
            repliesContainer.querySelector('.replies-loading').remove();
            const empty = document.createElement('div');
            empty.className = 'replies-empty';
            empty.textContent = 'No replies yet.';
            repliesContainer.appendChild(empty);
          }
        });
        subIdClosedHandlers.set(subId, (url, msg) => showSubClosedNotice(url, 'replies', msg));
        subscribeAll(subId, [{ kinds: [1], '#e': [event.id], limit: 20 }]);
      }
    },
    onDelete: handleDeleteEvent,
    onQuoteSeen: requestQuotedEvent,
    onScrollToParent: (eventId) => {
      const card = eventsList.querySelector(`[data-event-id="${eventId}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlight');
      setTimeout(() => card.classList.remove('highlight'), 1500);
    },
    onQuote: async (quotedEvent, comment) => {
      if (!store.signer) throw new Error('Generate or import a keypair first.');
      if (!isAnyConnected()) throw new Error('Connect to a relay first.');
      const qTag = buildQuoteTag(quotedEvent);
      const pTag = ['p', quotedEvent.pubkey];
      const { content: transformedContent, tags: mentionTags } = buildMentionEvent(comment, 2);
      const event = await createOwnEvent({
        kind: 1,
        tags: [qTag, pTag, ...mentionTags],
        content: transformedContent,
      });
      await publishToAll(event);
      store.addEvent(event);
    },
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
