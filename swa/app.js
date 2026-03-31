import { generateKeypair, importPrivkey, createEvent } from './nostr.js';
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

const relayUrlInput = document.getElementById('relay-url');
const connectBtn = document.getElementById('connect-btn');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
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

const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalVersion = document.getElementById('modal-version');
const modalNipsList = document.getElementById('modal-nips-list');

// ── State ─────────────────────────────────────────────────────────────────────

let relay = null;
let followsSubId = null;
let feedSubId = null;

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

relayUrlInput.value = store.relayUrl;
followsStatus.textContent = 'Connect with an identity to load your follow list.';

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

// ── Store subscriptions ───────────────────────────────────────────────────────

store.on('keys', (keys) => {
  pubkeyDisplay.value = keys ? keys.pubkeyHex : '';
});

store.on('relayStatus', (status) => {
  statusDot.className = 'dot ' + status;
  statusLabel.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  if (status === 'connected') {
    connectBtn.textContent = 'Disconnect';
    store.clearEvents();
    store.setFollows([]);

    if (store.keys) {
      // Load follow list first; feed subscription happens after EOSE
      followsSubId = crypto.randomUUID();
      followsStatus.textContent = 'Loading follow list…';
      relay.subscribe(followsSubId, [{ kinds: [3], authors: [store.keys.pubkeyHex], limit: 1 }]);
    } else {
      followsStatus.textContent = 'Connect with an identity to load your follow list.';
      subscribeToFeed();
    }
  } else {
    connectBtn.textContent = 'Connect';
    followsSubId = null;
    feedSubId = null;
    if (status === 'disconnected') {
      feedStatus.textContent = 'Connect to a relay to see events.';
      followsStatus.textContent = 'Connect with an identity to load your follow list.';
    }
  }
});

store.on('follows', (follows) => {
  followsStatus.textContent = follows.length === 0 ? 'Not following anyone yet.' : '';
  renderFollows(follows);
});

store.on('events', (events) => {
  if (events.length === 0) return;
  feedStatus.textContent = '';
  eventsList.innerHTML = '';
  for (const event of events) {
    eventsList.appendChild(renderEvent(event));
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

// ── Relay ─────────────────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  if (store.relayStatus === 'connected') {
    relay?.disconnect();
    relay = null;
    return;
  }

  const url = relayUrlInput.value.trim();
  if (!url) return;

  store.setRelayUrl(url);
  relayNotice.hidden = true;

  relay = new RelayConnection(url, {
    onEvent: (subId, event) => {
      if (subId === followsSubId && event.kind === 3) {
        handleFollowListEvent(event);
      } else if (subId === feedSubId) {
        store.addEvent(event);
      }
    },
    onEOSE: (subId) => {
      if (subId === followsSubId) {
        if (store.follows.length === 0) {
          followsStatus.textContent = 'Not following anyone yet.';
        }
        subscribeToFeed();
      } else if (subId === feedSubId) {
        if (store.events.length === 0) {
          feedStatus.textContent = 'No events found.';
        }
      }
    },
    onNotice: (msg) => {
      relayNotice.textContent = msg;
      relayNotice.hidden = false;
    },
    onStatus: (status) => store.setRelayStatus(status),
  });

  try {
    await relay.connect();
  } catch {
    // onStatus('error') already called
  }
});

// ── Following ─────────────────────────────────────────────────────────────────

followBtn.addEventListener('click', async () => {
  if (!store.keys) {
    showFollowError('Generate or import a keypair first.');
    return;
  }
  if (store.relayStatus !== 'connected') {
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
    subscribeToFeed();
  } catch (err) {
    showFollowError(`Saved locally — relay error: ${err.message}`);
  }
});

async function handleUnfollow(pubkey) {
  store.removeFollow(pubkey);
  try {
    await publishFollowList();
    subscribeToFeed();
  } catch {
    // Ignore relay error for unfollow
  }
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
  if (store.relayStatus !== 'connected') {
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
    await relay.publish(event);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function subscribeToFeed() {
  if (feedSubId) relay.unsubscribe(feedSubId);
  feedSubId = crypto.randomUUID();
  store.clearEvents();
  feedStatus.textContent = 'Loading events…';

  const hasFollows = store.follows.length > 0 && store.keys;
  const filter = hasFollows
    ? { kinds: [1], authors: store.follows.map(f => f.pubkey), limit: 20 }
    : { kinds: [1], limit: 20 };

  relay.subscribe(feedSubId, [filter]);
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
  return relay.publish(event);
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

  const info = document.createElement('div');
  info.className = 'follow-info';

  const pubkeyEl = document.createElement('span');
  pubkeyEl.className = 'follow-pubkey';
  pubkeyEl.textContent = f.pubkey.slice(0, 12) + '…';
  pubkeyEl.title = f.pubkey;
  info.appendChild(pubkeyEl);

  if (f.petname) {
    const petnameEl = document.createElement('span');
    petnameEl.className = 'follow-petname';
    petnameEl.textContent = f.petname; // safe — textContent
    info.appendChild(petnameEl);
  }

  const unfollowBtn = document.createElement('button');
  unfollowBtn.className = 'btn-unfollow';
  unfollowBtn.textContent = 'Unfollow';
  unfollowBtn.addEventListener('click', () => handleUnfollow(f.pubkey));

  item.append(info, unfollowBtn);
  return item;
}

function setPostResult(msg, cls) {
  postResult.textContent = msg;
  postResult.className = 'result-msg ' + cls;
}

function showFollowError(msg) {
  followError.textContent = msg;
  followError.hidden = false;
}

function renderEvent(event) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const meta = document.createElement('div');
  meta.className = 'event-meta';

  const pubkey = document.createElement('span');
  pubkey.className = 'event-pubkey';
  pubkey.textContent = event.pubkey.slice(0, 12) + '…';
  pubkey.title = event.pubkey;

  // Show petname if we follow this author
  const follow = store.follows.find(f => f.pubkey === event.pubkey);
  if (follow?.petname) {
    pubkey.textContent = follow.petname;
  }

  const time = document.createElement('span');
  time.className = 'event-time';
  time.textContent = formatTime(event.created_at);

  meta.append(pubkey, time);

  const content = document.createElement('div');
  content.className = 'event-content';
  content.textContent = event.content; // safe — never innerHTML

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
