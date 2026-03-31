import { generateKeypair, importPrivkey, createEvent } from './nostr.js';
import { RelayConnection } from './relay.js';
import { store } from './store.js';

const VERSION = '0.0.1';
const SUPPORTED_NIPS = ['01'];

// DOM refs
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

let relay = null;

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

const savedPrivkey = sessionStorage.getItem('privkeyHex');
if (savedPrivkey) {
  try {
    const keys = importPrivkey(savedPrivkey);
    store.keys = keys; // restore quietly, no emit needed yet
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
    feedStatus.textContent = 'Loading events…';
    store.clearEvents();
    const subId = crypto.randomUUID();
    store.subscriptionId = subId;
    relay.subscribe(subId, [{ kinds: [1], limit: 20 }]);
  } else {
    connectBtn.textContent = 'Connect';
    if (status === 'disconnected') {
      feedStatus.textContent = 'Connect to a relay to see events.';
    }
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
    onEvent: (_subId, event) => store.addEvent(event),
    onEOSE: (_subId) => {
      if (store.events.length === 0) {
        feedStatus.textContent = 'No events found.';
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

function setPostResult(msg, cls) {
  postResult.textContent = msg;
  postResult.className = 'result-msg ' + cls;
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
