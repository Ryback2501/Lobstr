import { generateKeypair, importPrivkey, createEvent, verifyEvent } from './nostr.js';
import { RelayConnection } from './relay.js';
import { store } from './store.js';

const VERSION = '0.0.2';
const SUPPORTED_NIPS = ['01', '02'];

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

const profileNameInput = document.getElementById('profile-name');
const profileAboutInput = document.getElementById('profile-about');
const profilePictureInput = document.getElementById('profile-picture');
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

const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalVersion = document.getElementById('modal-version');
const modalNipsList = document.getElementById('modal-nips-list');

// ── State ─────────────────────────────────────────────────────────────────────

const relays = new Map(); // url → { conn: RelayConnection|null, status: string }
const activeSubs = new Map(); // subId → filters (all live REQs, for re-subscribing new relays)

let ownProfileSubId = null;
let followsSubId = null;
let feedSubId = null;
let metadataSubId = null;
let idSearchSubId = null;
let mentionsSubId = null;
let feedRetryTimer = null;
let sinceFilter = 0; // seconds offset from now; 0 = no filter
let untilFilter = 0; // seconds offset from now; 0 = no filter
let feedActiveTab = 'feed'; // 'feed' | 'following' | 'mentions'
const replySubscriptions = new Map(); // eventId → { subId, container }
const replySubIdToContainer = new Map(); // subId → container element
const replyEventIds = new Map(); // subId → Set<eventId> (dedup across relays)

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
    store.keys = keys;
    pubkeyDisplay.value = keys.pubkeyHex;
  } catch {
    sessionStorage.removeItem('privkeyHex');
  }
}

// Populate relay Map from store and auto-connect previously connected relays
for (const url of store.relayUrls) {
  relays.set(url, { conn: null, status: 'disconnected' });
}
rerenderRelayList();

for (const url of store.connectedRelayUrls) {
  if (relays.has(url)) connectRelay(url);
}

// ── Store subscriptions ───────────────────────────────────────────────────────

store.on('keys', (keys) => {
  pubkeyDisplay.value = keys ? keys.pubkeyHex : '';
  if (keys && isAnyConnected() && !mentionsSubId) {
    mentionsSubId = crypto.randomUUID();
    store.clearMentions();
    subscribeAll(mentionsSubId, [{ kinds: [1], '#p': [keys.pubkeyHex], limit: 20 }]);
    updateFeedTabs();
  }
});

store.on('follows', (follows) => {
  followsStatus.textContent = follows.length === 0 ? 'Not following anyone yet.' : '';
  renderFollows(follows);
  updateFeedTabs();
  if (feedActiveTab === 'following') {
    subscribeToFeed();
  }
});

store.on('events', (events) => {
  if (events.length === 0) return;
  feedStatus.textContent = '';
  eventsList.innerHTML = '';
  for (const event of events) {
    eventsList.appendChild(renderEvent(event));
  }
});

store.on('profiles', () => {
  rerenderFeed();
  renderFollows(store.follows);
});

store.on('mentions', (events) => {
  mentionsStatus.hidden = events.length > 0;
  mentionsList.innerHTML = '';
  for (const event of events) {
    mentionsList.appendChild(renderEvent(event));
  }
});

// ── Key management ────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', () => {
  const keys = generateKeypair();
  store.setKeys(keys);
  privkeyDisplay.value = keys.privkeyHex;
  privkeyDisplayWrapper.hidden = false;
  importError.hidden = true;
  document.getElementById('privkey-section').open = true;
});

importBtn.addEventListener('click', () => {
  const hex = privkeyImport.value.trim();
  try {
    const keys = importPrivkey(hex);
    store.setKeys(keys);
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

// ── Profile ───────────────────────────────────────────────────────────────────

profileSaveBtn.addEventListener('click', async () => {
  if (!store.keys) {
    setProfileResult('Generate or import a keypair first.', 'err');
    return;
  }
  if (!isAnyConnected()) {
    setProfileResult('Connect to a relay first.', 'err');
    return;
  }

  const metadata = {
    name: profileNameInput.value.trim(),
    about: profileAboutInput.value.trim(),
    picture: profilePictureInput.value.trim(),
  };

  profileSaveBtn.disabled = true;
  setProfileResult('Saving…', '');

  try {
    const event = createEvent({
      privkeyHex: store.keys.privkeyHex,
      pubkeyHex: store.keys.pubkeyHex,
      kind: 0,
      tags: [],
      content: JSON.stringify(metadata),
    });
    await publishToAll(event);
    store.setProfile(store.keys.pubkeyHex, { ...metadata, _created_at: event.created_at });
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
  feedStatus.textContent = 'Searching…';
  subscribeAll(idSearchSubId, [{ ids: [id], limit: 1 }]);
});

// ── Relay management ──────────────────────────────────────────────────────────

relayAddBtn.addEventListener('click', addRelay);
relayAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addRelay(); });

function addRelay() {
  const url = relayAddInput.value.trim();
  if (!url) return;
  if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
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
  const connected = store.connectedRelayUrls;
  connected.delete(url);
  store.setConnectedRelayUrls(connected);
  rerenderRelayList();
}

// ── Following ─────────────────────────────────────────────────────────────────

followBtn.addEventListener('click', async () => {
  if (!store.keys) {
    showFollowError('Generate or import a keypair first.');
    return;
  }
  if (!isAnyConnected()) {
    showFollowError('Connect to a relay first.');
    return;
  }

  const pubkey = followPubkeyInput.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    showFollowError('Must be a 64-character hex public key.');
    return;
  }
  if (store.follows.find(f => f.pubkey === pubkey)) {
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
  const tags = store.follows.map(f => ['p', f.pubkey, f.relay, f.petname]);
  const event = createEvent({
    privkeyHex: store.keys.privkeyHex,
    pubkeyHex: store.keys.pubkeyHex,
    kind: 3,
    tags,
    content: '',
  });
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
    followsList.appendChild(renderFollowItem(f));
  }
}

function renderFollowItem(f) {
  const item = document.createElement('div');
  item.className = 'follow-item';

  const profile = store.profiles.get(f.pubkey);
  const displayName = profile?.name || profile?.display_name || f.petname || (f.pubkey.slice(0, 12) + '…');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (profile?.picture) {
    const img = document.createElement('img');
    img.src = profile.picture;
    img.alt = displayName;
    img.onerror = () => { img.remove(); avatar.textContent = displayName[0].toUpperCase(); };
    avatar.appendChild(img);
  } else {
    avatar.textContent = displayName[0].toUpperCase();
    avatar.style.background = pubkeyColor(f.pubkey);
  }

  const info = document.createElement('div');
  info.className = 'follow-info';

  const nameEl = document.createElement('span');
  nameEl.className = 'follow-pubkey';
  nameEl.textContent = displayName;
  nameEl.title = f.pubkey;
  info.appendChild(nameEl);

  const petnameInput = document.createElement('input');
  petnameInput.type = 'text';
  petnameInput.className = 'petname-input';
  petnameInput.value = f.petname || '';
  petnameInput.placeholder = 'Add petname…';

  async function savePetname() {
    const newPetname = petnameInput.value.trim();
    if (newPetname === (f.petname || '')) return;
    f.petname = newPetname;
    try { await publishFollowList(); } catch { /* ignore */ }
  }

  petnameInput.addEventListener('blur', savePetname);
  petnameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') petnameInput.blur(); });

  const relayInput = document.createElement('input');
  relayInput.type = 'text';
  relayInput.className = 'petname-input';
  relayInput.value = f.relay || '';
  relayInput.placeholder = 'Relay hint (wss://…)';

  async function saveRelay() {
    const newRelay = relayInput.value.trim();
    if (newRelay === (f.relay || '')) return;
    f.relay = newRelay;
    try { await publishFollowList(); } catch { /* ignore */ }
  }

  relayInput.addEventListener('blur', saveRelay);
  relayInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') relayInput.blur(); });

  const inputRow = document.createElement('div');
  inputRow.className = 'input-row';
  inputRow.append(petnameInput, relayInput);
  info.appendChild(inputRow); 

  const unfollowBtn = document.createElement('button');
  unfollowBtn.className = 'btn-unfollow';
  unfollowBtn.textContent = 'Unfollow';
  unfollowBtn.addEventListener('click', () => handleUnfollow(f.pubkey));

  item.append(avatar, info, unfollowBtn);
  return item;
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
  if (!store.keys) {
    setPostResult('Generate or import a keypair first.', 'err');
    return;
  }
  if (!isAnyConnected()) {
    setPostResult('Connect to a relay first.', 'err');
    return;
  }
  const content = postContent.value.trim();
  if (!content) return;

  postBtn.disabled = true;
  setPostResult('Publishing…', '');

  try {
    const event = createEvent({
      privkeyHex: store.keys.privkeyHex,
      pubkeyHex: store.keys.pubkeyHex,
      kind: 1,
      tags: [],
      content,
    });
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
  if (event.kind === 0) {
    handleMetadataEvent(event);
    if (subId === ownProfileSubId) populateProfileForm(event.pubkey);
  } else if (subId === followsSubId && event.kind === 3) {
    handleFollowListEvent(event);
  } else if (subId === feedSubId || subId === idSearchSubId) {
    store.addEvent(event);
  } else if (subId === mentionsSubId) {
    store.addMention(event);
  } else if (replySubIdToContainer.has(subId)) {
    const seen = replyEventIds.get(subId);
    if (seen && !seen.has(event.id)) {
      seen.add(event.id);
      const container = replySubIdToContainer.get(subId);
      container.querySelector('.replies-loading')?.remove();
      container.querySelector('.replies-empty')?.remove();
      container.appendChild(renderReply(event));
    }
  }
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
  } else if (subId === idSearchSubId) {
    if (store.events.length === 0) feedStatus.textContent = 'Event not found.';
    else fetchMissingMetadata();
  } else if (subId === mentionsSubId) {
    if (store.mentions.length === 0) mentionsStatus.textContent = 'No mentions yet.';
    fetchMissingMetadata();
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

function handleClosed(url, subId, message) {
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* */ }

  const label = subId === feedSubId ? 'feed'
    : subId === followsSubId ? 'follows'
    : subId === ownProfileSubId ? 'profile'
    : subId === metadataSubId ? 'metadata'
    : subId === idSearchSubId ? 'search'
    : subId === mentionsSubId ? 'mentions'
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
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* */ }
  relayNotice.textContent = `[${hostname}] ${message}`;
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
    idSearchSubId = null;
    mentionsSubId = null;
    activeSubs.clear();
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
  ownProfileSubId = null;
  followsSubId = null;
  feedSubId = null;
  metadataSubId = null;
  mentionsSubId = null;
  idSearchSubId = null;

  if (store.keys) {
    ownProfileSubId = crypto.randomUUID();
    subscribeAll(ownProfileSubId, [{ kinds: [0], authors: [store.keys.pubkeyHex], limit: 1 }]);

    followsSubId = crypto.randomUUID();
    followsStatus.textContent = 'Loading follow list…';
    subscribeAll(followsSubId, [{ kinds: [3], authors: [store.keys.pubkeyHex], limit: 1 }]);

    mentionsSubId = crypto.randomUUID();
    subscribeAll(mentionsSubId, [{ kinds: [1], '#p': [store.keys.pubkeyHex], limit: 20 }]);
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
  store.clearEvents();
  feedStatus.textContent = 'Loading events…';
  subscribeAll(feedSubId, [buildFeedFilter()]);
}

function buildFeedFilter() {
  const filter = { kinds: [1], limit: 20 };
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
    }
  } catch {
    // Ignore invalid JSON in kind-0 content
  }
}

function populateProfileForm(pubkey) {
  const profile = store.profiles.get(pubkey);
  if (!profile) return;
  profileNameInput.value = profile.name || profile.display_name || '';
  profileAboutInput.value = profile.about || '';
  profilePictureInput.value = profile.picture || '';
}

function fetchMissingMetadata() {
  const allPubkeys = [
    ...store.events.map(e => e.pubkey),
    ...store.mentions.map(e => e.pubkey),
    ...store.follows.map(f => f.pubkey),
  ];
  const unknown = [...new Set(allPubkeys)].filter(pk => !store.profiles.has(pk));
  if (!unknown.length) return;
  if (metadataSubId) unsubscribeAll(metadataSubId);
  metadataSubId = crypto.randomUUID();
  subscribeAll(metadataSubId, [{ kinds: [0], authors: unknown }]);
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
    eventsList.appendChild(renderEvent(event));
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
  tabFollowing.hidden = store.follows.length === 0;
  tabMentions.hidden = !store.keys;

  // If current tab is no longer valid, fall back to feed tab
  if (feedActiveTab === 'following' && store.follows.length === 0) {
    switchTab('feed');
  }
  if (feedActiveTab === 'mentions' && !store.keys) {
    switchTab('feed');
  }
}

function pubkeyColor(pubkey) {
  const colors = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#6366f1'];
  return colors[parseInt(pubkey.slice(0, 2), 16) % colors.length];
}

function setPostResult(msg, cls) {
  postResult.textContent = msg;
  postResult.className = 'result-msg ' + cls;
}

function setProfileResult(msg, cls) {
  profileResult.textContent = msg;
  profileResult.className = 'result-msg ' + cls;
}

function renderEvent(event) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const meta = document.createElement('div');
  meta.className = 'event-meta';

  const profile = store.profiles.get(event.pubkey);
  const displayName = profile?.name || profile?.display_name || (event.pubkey.slice(0, 12) + '…');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (profile?.picture) {
    const img = document.createElement('img');
    img.src = profile.picture;
    img.alt = displayName;
    img.onerror = () => { img.remove(); avatar.textContent = displayName[0].toUpperCase(); };
    avatar.appendChild(img);
  } else {
    avatar.textContent = displayName[0].toUpperCase();
    avatar.style.background = pubkeyColor(event.pubkey);
  }

  const authorEl = document.createElement('span');
  authorEl.className = 'event-pubkey';
  authorEl.textContent = displayName;
  authorEl.title = event.pubkey;

  const time = document.createElement('span');
  time.className = 'event-time';
  time.textContent = formatTime(event.created_at);

  const metaLeft = document.createElement('div');
  metaLeft.className = 'event-meta-left';
  metaLeft.append(avatar, authorEl, time);
  meta.appendChild(metaLeft);

  const isOwnPost = store.keys?.pubkeyHex === event.pubkey;
  if (!isOwnPost) {
    const alreadyFollowing = !!store.follows.find(f => f.pubkey === event.pubkey);
    const followEventBtn = document.createElement('button');
    followEventBtn.className = 'btn-follow-feed';
    followEventBtn.textContent = alreadyFollowing ? 'Following' : 'Follow';
    followEventBtn.disabled = alreadyFollowing;

    followEventBtn.addEventListener('click', async () => {
      store.addFollow({ pubkey: event.pubkey, relay: '', petname: '' });
      rerenderFeed();
      try {
        await publishFollowList();
      } catch { /* ignore relay error */ }
    });

    meta.appendChild(followEventBtn);
  }

  // Reply indicator — shown when this event references another event via e or a tag
  const eTags = event.tags.filter(t => t[0] === 'e');
  const aTags = event.tags.filter(t => t[0] === 'a');
  let refLabel = null;

  if (eTags.length > 0) {
    const refId = eTags[eTags.length - 1][1];
    const refEvent = store.events.find(e => e.id === refId);
    const refProfile = refEvent ? store.profiles.get(refEvent.pubkey) : null;
    refLabel = refProfile?.name || refProfile?.display_name
      || (refEvent ? refEvent.pubkey.slice(0, 12) + '…' : refId.slice(0, 12) + '…');
  } else if (aTags.length > 0) {
    // a tag format: "<kind>:<pubkey>:<d-tag>"
    const parts = (aTags[aTags.length - 1][1] || '').split(':');
    const refPubkey = parts[1] || '';
    const refProfile = refPubkey ? store.profiles.get(refPubkey) : null;
    refLabel = refProfile?.name || refProfile?.display_name
      || (refPubkey ? refPubkey.slice(0, 12) + '…' : aTags[aTags.length - 1][1].slice(0, 16) + '…');
  }

  if (refLabel !== null) {
    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'reply-indicator';
    replyIndicator.textContent = `↩ ${refLabel}`;
    card.append(meta, replyIndicator);
  } else {
    card.appendChild(meta);
  }

  const content = document.createElement('div');
  content.className = 'event-content';
  content.textContent = event.content; // safe — never innerHTML

  const actions = document.createElement('div');
  actions.className = 'event-actions';

  const replyBtn = document.createElement('button');
  replyBtn.className = 'btn-reply';
  replyBtn.textContent = 'Reply';

  const showRepliesBtn = document.createElement('button');
  showRepliesBtn.className = 'btn-reply';
  showRepliesBtn.textContent = 'Replies';

  actions.append(replyBtn, showRepliesBtn);
  card.append(content, actions);

  const replyForm = createReplyForm(event);
  card.appendChild(replyForm);

  const repliesContainer = document.createElement('div');
  repliesContainer.className = 'replies-container';
  repliesContainer.hidden = true;
  card.appendChild(repliesContainer);

  replyBtn.addEventListener('click', () => {
    replyForm.hidden = !replyForm.hidden;
    if (!replyForm.hidden) replyForm.querySelector('textarea').focus();
  });

  showRepliesBtn.addEventListener('click', () => {
    const existing = replySubscriptions.get(event.id);
    if (existing) {
      repliesContainer.hidden = !repliesContainer.hidden;
    } else {
      if (!isAnyConnected()) return;
      repliesContainer.hidden = false;
      const loadingEl = document.createElement('div');
      loadingEl.className = 'replies-loading';
      loadingEl.textContent = 'Loading replies…';
      repliesContainer.appendChild(loadingEl);
      const subId = crypto.randomUUID();
      replySubscriptions.set(event.id, { subId, container: repliesContainer });
      replySubIdToContainer.set(subId, repliesContainer);
      replyEventIds.set(subId, new Set());
      subscribeAll(subId, [{ kinds: [1], '#e': [event.id], limit: 20 }]);
    }
  });

  return card;
}

function createReplyForm(parentEvent) {
  const form = document.createElement('div');
  form.className = 'reply-form';
  form.hidden = true;

  const profile = store.profiles.get(parentEvent.pubkey);
  const name = profile?.name || profile?.display_name || (parentEvent.pubkey.slice(0, 12) + '…');

  const label = document.createElement('div');
  label.className = 'reply-form-label';
  label.textContent = `Replying to ${name}`;

  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.placeholder = 'Write your reply…';

  const formActions = document.createElement('div');
  formActions.className = 'reply-form-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'primary';
  submitBtn.textContent = 'Reply';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';

  const resultMsg = document.createElement('span');
  resultMsg.className = 'result-msg';

  formActions.append(submitBtn, cancelBtn, resultMsg);
  form.append(label, textarea, formActions);

  cancelBtn.addEventListener('click', () => {
    form.hidden = true;
    textarea.value = '';
    resultMsg.textContent = '';
  });

  submitBtn.addEventListener('click', async () => {
    if (!store.keys) {
      resultMsg.textContent = 'No identity.';
      resultMsg.className = 'result-msg err';
      return;
    }
    if (!isAnyConnected()) {
      resultMsg.textContent = 'Not connected.';
      resultMsg.className = 'result-msg err';
      return;
    }
    const content = textarea.value.trim();
    if (!content) return;

    submitBtn.disabled = true;
    resultMsg.textContent = 'Posting…';
    resultMsg.className = 'result-msg';

    try {
      const event = createEvent({
        privkeyHex: store.keys.privkeyHex,
        pubkeyHex: store.keys.pubkeyHex,
        kind: 1,
        tags: [['e', parentEvent.id], ['p', parentEvent.pubkey]],
        content,
      });
      await publishToAll(event);
      store.addEvent(event);
      textarea.value = '';
      form.hidden = true;
    } catch (err) {
      resultMsg.textContent = err.message;
      resultMsg.className = 'result-msg err';
    } finally {
      submitBtn.disabled = false;
    }
  });

  return form;
}

function renderReply(event) {
  const card = document.createElement('div');
  card.className = 'reply-card';

  const meta = document.createElement('div');
  meta.className = 'event-meta';

  const profile = store.profiles.get(event.pubkey);
  const displayName = profile?.name || profile?.display_name || (event.pubkey.slice(0, 12) + '…');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (profile?.picture) {
    const img = document.createElement('img');
    img.src = profile.picture;
    img.alt = displayName;
    img.onerror = () => { img.remove(); avatar.textContent = displayName[0].toUpperCase(); };
    avatar.appendChild(img);
  } else {
    avatar.textContent = displayName[0].toUpperCase();
    avatar.style.background = pubkeyColor(event.pubkey);
  }

  const authorEl = document.createElement('span');
  authorEl.className = 'event-pubkey';
  authorEl.textContent = displayName;
  authorEl.title = event.pubkey;

  const time = document.createElement('span');
  time.className = 'event-time';
  time.textContent = formatTime(event.created_at);

  meta.append(avatar, authorEl, time);

  const content = document.createElement('div');
  content.className = 'event-content';
  content.textContent = event.content;

  card.append(meta, content);
  return card;
}

function formatTime(unixSec) {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

async function copyToClipboard(text, btn) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    // Clipboard API not available (non-HTTPS dev environment, etc.)
  }
}
