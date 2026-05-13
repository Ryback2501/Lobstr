import {
  hexToBytes,
  serializeEvent,
  getEventId,
  signEvent as rawSign,
  encryptDm,
  decryptDm,
} from './nostr.js';

// Pending permission dialogs: requestId → { resolve, reject, tabId, timer }
const pendingRequests = new Map();

const PERMISSION_TIMEOUT_MS = 35_000;

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NOSTR_REQUEST') {
    handleNostrRequest(msg, sender)
      .then(result => sendResponse({ result }))
      .catch(err  => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'CONFIRM_RESPONSE') {
    handleConfirmResponse(msg).then(() => sendResponse({}));
    return true;
  }
});

// ── Extension signing request handler ────────────────────────────────────────

async function handleNostrRequest({ method, params = [] }, sender) {
  const origin = senderOrigin(sender);
  if (!origin) throw new Error('Cannot determine request origin.');

  const tabId = sender.tab?.id;
  if (tabId == null) throw new Error('Cannot determine sender tab.');

  const { keys } = await chrome.storage.local.get({ keys: null });
  if (!keys) throw new Error('No identity configured. Open the Lobstr extension to set up your keys.');

  // getRelays does not require per-site permission (relay list is not sensitive)
  if (method !== 'getRelays') {
    await checkPermission(origin, method, params, tabId);
  }

  switch (method) {
    case 'getPublicKey':
      return keys.pubkeyHex;

    case 'signEvent': {
      const draft = params[0];
      if (!draft || typeof draft.kind !== 'number') throw new Error('Invalid event draft.');
      return buildSignedEvent(keys, draft);
    }

    case 'getRelays': {
      const { relays } = await chrome.storage.local.get({ relays: {} });
      return relays;
    }

    case 'nip04.encrypt': {
      const [recipientPubkey, plaintext] = params;
      if (!/^[0-9a-fA-F]{64}$/.test(recipientPubkey)) throw new Error('Invalid recipient public key.');
      if (typeof plaintext !== 'string') throw new Error('Plaintext must be a string.');
      return encryptDm(keys.privkeyHex, recipientPubkey, plaintext);
    }

    case 'nip04.decrypt': {
      const [senderPubkey, ciphertext] = params;
      if (!/^[0-9a-fA-F]{64}$/.test(senderPubkey)) throw new Error('Invalid sender public key.');
      if (typeof ciphertext !== 'string') throw new Error('Ciphertext must be a string.');
      return decryptDm(keys.privkeyHex, senderPubkey, ciphertext);
    }

    case 'nip44.encrypt':
    case 'nip44.decrypt':
      throw new Error('NIP-44 encryption is not yet supported for local keys. Use a NIP-44 compatible extension.');

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

function senderOrigin(sender) {
  if (!sender.url) return null;
  try { return new URL(sender.url).origin; } catch { return null; }
}

function buildSignedEvent(keys, draft) {
  const created_at = Number.isInteger(draft.created_at)
    ? draft.created_at
    : Math.floor(Date.now() / 1000);
  const kind    = draft.kind;
  const tags    = Array.isArray(draft.tags) ? draft.tags : [];
  const content = typeof draft.content === 'string' ? draft.content : '';
  const privkey = hexToBytes(keys.privkeyHex);
  const id      = getEventId(serializeEvent(keys.pubkeyHex, created_at, kind, tags, content));
  const sig     = rawSign(id, privkey);
  return { id, pubkey: keys.pubkeyHex, created_at, kind, tags, content, sig };
}

// ── Permission management ─────────────────────────────────────────────────────

async function checkPermission(origin, method, params, tabId) {
  const { permissions } = await chrome.storage.local.get({ permissions: {} });
  const status = permissions[origin];
  if (status === 'allowed') return;
  if (status === 'denied') throw new Error(`Permission denied for ${origin}.`);
  return openConfirmDialog(origin, method, params, tabId);
}

function sanitizeParamsForDisplay(method, params) {
  if (method === 'signEvent') {
    const d = params[0] ?? {};
    return { kind: d.kind, content: String(d.content ?? '').slice(0, 120) };
  }
  if (method === 'nip04.encrypt') return { recipient: params[0] };
  if (method === 'nip04.decrypt') return { sender: params[0] };
  return {};
}

function openConfirmDialog(origin, method, params, tabId) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();

    const timer = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Permission request timed out.'));
      }
    }, PERMISSION_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, {
      type:         'SHOW_PERMISSION_MODAL',
      requestId,
      origin,
      method,
      displayParams: sanitizeParamsForDisplay(method, params),
    }, () => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer);
        reject(new Error('Cannot show permission dialog in this page.'));
        return;
      }
      pendingRequests.set(requestId, { resolve, reject, tabId, timer });
    });
  });
}

async function handleConfirmResponse({ requestId, approved, remember, origin }) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return; // timed out or tab closed before response

  clearTimeout(pending.timer);
  pendingRequests.delete(requestId);

  if (remember) {
    const { permissions } = await chrome.storage.local.get({ permissions: {} });
    permissions[origin] = approved ? 'allowed' : 'denied';
    await chrome.storage.local.set({ permissions });
  }

  if (approved) pending.resolve();
  else pending.reject(new Error('Permission denied by user.'));
}

// Clean up pending requests when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [requestId, req] of pendingRequests) {
    if (req.tabId === tabId) {
      clearTimeout(req.timer);
      pendingRequests.delete(requestId);
      req.reject(new Error('Tab was closed.'));
    }
  }
});
