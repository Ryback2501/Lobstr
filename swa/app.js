import { generateKeypair, importPrivkey, createEvent, verifyEvent } from './nostr.js';
import { RelayConnection } from './relay.js';
import { store } from './store.js';

const VERSION = '0.0.1';
const SUPPORTED_NIPS = ['01'];

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
const feedSinceSelect = document.getElementById('feed-since');
const feedUntilInput = document.getElementById('feed-until');
const feedIdSearch = document.getElementById('feed-id-search');
const feedIdSearchBtn = document.getElementById('feed-id-search-btn');
const feedHeader = document.getElementById('feed-header');
const feedFilters = document.getElementById('feed-filters');
const tabFeed = document.getElementById('tab-feed');
const tabMentions = document.getElementById('tab-mentions');
const mentionsList = document.getElementById('mentions-list');
const mentionsStatus = document.getElementById('mentions-status');

const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalVersion = document.getElementById('modal-version');
const modalNipsList = document.getElementById('modal-nips-list');

// ── State ─────────────────────────────────────────────────────────────────────

let relay = null;
let ownProfileSubId = null;
let feedSubId = null;
let metadataSubId = null;
let idSearchSubId = null;
let mentionsSubId = null;
let sinceFilter = 0; // seconds offset from now; 0 = no filter
let untilFilter = 0; // unix timestamp; 0 = no filter
let feedActiveTab = 'feed'; // 'feed' | 'mentions'
const replySubscriptions = new Map(); // eventId → { subId, container }
const replySubIdToContainer = new Map(); // subId → container element

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
    store.keys = keys;
    pubkeyDisplay.value = keys.pubkeyHex;
  } catch {
    sessionStorage.removeItem('privkeyHex');
  }
}

// ── Store subscriptions ───────────────────────────────────────────────────────

store.on('keys', (keys) => {
  pubkeyDisplay.value = keys ? keys.pubkeyHex : '';
  if (keys && store.relayStatus === 'connected' && relay && !mentionsSubId) {
    mentionsSubId = crypto.randomUUID();
    store.clearMentions();
    relay.subscribe(mentionsSubId, [{ kinds: [1], '#p': [keys.pubkeyHex], limit: 20 }]);
    updateFeedTabs();
  }
});

store.on('relayStatus', (status) => {
  statusDot.className = 'dot ' + status;
  statusLabel.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  if (status === 'connected') {
    connectBtn.textContent = 'Disconnect';
    store.clearEvents();
    store.clearMentions();

    if (store.keys) {
      ownProfileSubId = crypto.randomUUID();
      relay.subscribe(ownProfileSubId, [{ kinds: [0], authors: [store.keys.pubkeyHex], limit: 1 }]);
      mentionsSubId = crypto.randomUUID();
      relay.subscribe(mentionsSubId, [{ kinds: [1], '#p': [store.keys.pubkeyHex], limit: 20 }]);
    }

    subscribeToFeed();
    updateFeedTabs();
  } else {
    connectBtn.textContent = 'Connect';
    ownProfileSubId = null;
    feedSubId = null;
    metadataSubId = null;
    idSearchSubId = null;
    mentionsSubId = null;
    replySubscriptions.clear();
    replySubIdToContainer.clear();
    if (status === 'disconnected') {
      feedStatus.textContent = 'Connect to a relay to see events.';
    }
    updateFeedTabs();
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
  if (store.relayStatus !== 'connected') {
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
    await relay.publish(event);
    store.setProfile(store.keys.pubkeyHex, { ...metadata, _created_at: event.created_at });
    setProfileResult('Saved.', 'ok');
  } catch (err) {
    setProfileResult(err.message, 'err');
  } finally {
    profileSaveBtn.disabled = false;
  }
});

// ── Feed filters ─────────────────────────────────────────────────────────────

feedSinceSelect.addEventListener('change', () => {
  sinceFilter = parseInt(feedSinceSelect.value) || 0;
  if (store.relayStatus === 'connected') subscribeToFeed();
});

feedUntilInput.addEventListener('change', () => {
  untilFilter = parseInt(feedUntilInput.value) || 0;
  if (store.relayStatus === 'connected') subscribeToFeed();
});

tabFeed.addEventListener('click', () => switchTab('feed'));
tabMentions.addEventListener('click', () => switchTab('mentions'));

feedIdSearchBtn.addEventListener('click', () => {
  const id = feedIdSearch.value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) {
    feedStatus.textContent = 'Event ID must be 64 hex characters.';
    return;
  }
  if (store.relayStatus !== 'connected') {
    feedStatus.textContent = 'Connect to a relay first.';
    return;
  }
  if (idSearchSubId) relay.unsubscribe(idSearchSubId);
  idSearchSubId = crypto.randomUUID();
  feedStatus.textContent = 'Searching…';
  relay.subscribe(idSearchSubId, [{ ids: [id], limit: 1 }]);
});

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
      if (!verifyEvent(event)) return;
      if (event.kind === 0) {
        handleMetadataEvent(event);
        if (subId === ownProfileSubId) populateProfileForm(event.pubkey);
      } else if (subId === feedSubId || subId === idSearchSubId) {
        store.addEvent(event);
      } else if (subId === mentionsSubId) {
        store.addMention(event);
      } else if (replySubIdToContainer.has(subId)) {
        const container = replySubIdToContainer.get(subId);
        container.querySelector('.replies-loading')?.remove();
        container.querySelector('.replies-empty')?.remove();
        container.appendChild(renderReply(event));
      }
    },
    onEOSE: (subId) => {
      if (subId === feedSubId) {
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
    },
    onClosed: (subId, message) => {
      const label = subId === feedSubId ? 'feed'
        : subId === ownProfileSubId ? 'profile'
        : subId === metadataSubId ? 'metadata'
        : subId === idSearchSubId ? 'search'
        : subId === mentionsSubId ? 'mentions'
        : replySubIdToContainer.has(subId) ? 'replies'
        : 'unknown';
      relayNotice.textContent = `Relay closed ${label} subscription: ${message || 'no reason given'}`;
      relayNotice.hidden = false;

      if (subId === feedSubId) {
        feedStatus.textContent = 'Feed closed by relay. Retrying in 5s…';
        setTimeout(() => {
          if (store.relayStatus === 'connected') subscribeToFeed();
        }, 5000);
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

function subscribeToFeed() {
  if (feedSubId) relay.unsubscribe(feedSubId);
  feedSubId = crypto.randomUUID();
  store.clearEvents();
  feedStatus.textContent = 'Loading events…';

  const filter = { kinds: [1], limit: 20 };
  if (sinceFilter > 0) filter.since = Math.floor(Date.now() / 1000) - sinceFilter;
  if (untilFilter > 0) filter.until = Math.floor(Date.now() / 1000) - untilFilter;

  relay.subscribe(feedSubId, [filter]);
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
  ];
  const unknown = [...new Set(allPubkeys)].filter(pk => !store.profiles.has(pk));
  if (!unknown.length || !relay) return;

  if (metadataSubId) relay.unsubscribe(metadataSubId);
  metadataSubId = crypto.randomUUID();
  relay.subscribe(metadataSubId, [{ kinds: [0], authors: unknown }]);
}

function rerenderFeed() {
  if (!store.events.length) return;
  eventsList.innerHTML = '';
  for (const event of store.events) {
    eventsList.appendChild(renderEvent(event));
  }
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

  meta.append(avatar, authorEl, time);

  // Reply indicator — shown when this event references another event via e tag
  const eTags = event.tags.filter(t => t[0] === 'e');
  if (eTags.length > 0) {
    const refId = eTags[eTags.length - 1][1];
    const refEvent = store.events.find(e => e.id === refId);
    const refProfile = refEvent ? store.profiles.get(refEvent.pubkey) : null;
    const refLabel = refProfile?.name || refProfile?.display_name
      || (refEvent ? refEvent.pubkey.slice(0, 12) + '…' : refId.slice(0, 12) + '…');

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
      if (store.relayStatus !== 'connected' || !relay) return;
      repliesContainer.hidden = false;
      const loadingEl = document.createElement('div');
      loadingEl.className = 'replies-loading';
      loadingEl.textContent = 'Loading replies…';
      repliesContainer.appendChild(loadingEl);
      const subId = crypto.randomUUID();
      replySubscriptions.set(event.id, { subId, container: repliesContainer });
      replySubIdToContainer.set(subId, repliesContainer);
      relay.subscribe(subId, [{ kinds: [1], '#e': [event.id], limit: 20 }]);
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
    if (store.relayStatus !== 'connected') {
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
      await relay.publish(event);
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

function switchTab(tab) {
  feedActiveTab = tab;
  tabFeed.classList.toggle('active', tab === 'feed');
  tabMentions.classList.toggle('active', tab === 'mentions');
  feedFilters.hidden = tab !== 'feed';
  feedStatus.hidden = tab !== 'feed';
  eventsList.hidden = tab !== 'feed';
  mentionsStatus.hidden = tab !== 'mentions';
  mentionsList.hidden = tab !== 'mentions';
}

function updateFeedTabs() {
  const showTabs = !!(store.keys && store.relayStatus === 'connected');
  feedHeader.hidden = !showTabs;
  if (!showTabs) {
    switchTab('feed');
    feedStatus.hidden = false;
  }
}

function pubkeyColor(pubkey) {
  const colors = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#6366f1'];
  return colors[parseInt(pubkey.slice(0, 2), 16) % colors.length];
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
