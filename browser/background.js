import {
  hexToBytes,
  serializeEvent,
  getEventId,
  signEvent as rawSign,
  encryptDm,
  decryptDm,
} from './nostr.js';

// Pending permission dialogs: requestId → { resolve, reject, windowId }
const pendingRequests = new Map();

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

// ── NIP-07 request handler ────────────────────────────────────────────────────

async function handleNostrRequest({ method, params = [] }, sender) {
  const origin = senderOrigin(sender);
  if (!origin) throw new Error('Cannot determine request origin.');

  const { keys } = await chrome.storage.local.get({ keys: null });
  if (!keys) throw new Error('No identity configured. Open the Lobstr extension to set up your keys.');

  // getRelays does not require per-site permission (relay list is not sensitive)
  if (method !== 'getRelays') {
    await checkPermission(origin, method, params);
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

async function checkPermission(origin, method, params) {
  const { permissions } = await chrome.storage.local.get({ permissions: {} });
  const status = permissions[origin];
  if (status === 'allowed') return;
  if (status === 'denied') throw new Error(`Permission denied for ${origin}.`);
  // Unknown origin — open approval dialog
  return openConfirmDialog(origin, method, params);
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

function openConfirmDialog(origin, method, params) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();

    chrome.storage.session.set({
      [requestId]: { origin, method, displayParams: sanitizeParamsForDisplay(method, params) },
    }).then(() => {
      chrome.windows.create({
        url:     chrome.runtime.getURL(`confirm.html?id=${requestId}`),
        type:    'popup',
        width:   440,
        height:  320,
        focused: true,
      }, (win) => {
        if (chrome.runtime.lastError || !win) {
          // windows API unavailable (e.g. Firefox for Android) — deny for safety
          chrome.storage.session.remove(requestId);
          reject(new Error('Cannot open permission dialog. Manage permissions from the extension popup.'));
          return;
        }
        pendingRequests.set(requestId, { resolve, reject, windowId: win.id });
      });
    }).catch(err => {
      reject(new Error(`Failed to store permission request: ${err.message}`));
    });
  });
}

async function handleConfirmResponse({ requestId, approved, remember }) {
  const pending = pendingRequests.get(requestId);
  pendingRequests.delete(requestId);

  if (remember) {
    const stored = await chrome.storage.session.get(requestId);
    const data = stored[requestId];
    if (data) {
      const { permissions } = await chrome.storage.local.get({ permissions: {} });
      permissions[data.origin] = approved ? 'allowed' : 'denied';
      await chrome.storage.local.set({ permissions });
    }
  }

  await chrome.storage.session.remove(requestId);

  if (!pending) return; // service worker was restarted while dialog was open

  if (approved) pending.resolve();
  else pending.reject(new Error('Permission denied by user.'));
}

// Reject pending requests when the confirm window is closed without responding
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [requestId, req] of pendingRequests) {
    if (req.windowId === windowId) {
      pendingRequests.delete(requestId);
      chrome.storage.session.remove(requestId);
      req.reject(new Error('Permission dialog was closed.'));
    }
  }
});
