/**
 * Runs in the page's MAIN world (declared in manifest content_scripts).
 * Provides window.nostr per NIP-07. Never has access to chrome.* APIs —
 * all requests are bridged through content.js via postMessage.
 */
(() => {
  if (window.nostr) return;

  // requestId → { resolve, reject }
  const pending = new Map();

  window.addEventListener('message', ({ source, data }) => {
    if (source !== window || data?.type !== 'LOBSTR_NIP07_RESPONSE') return;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
  });

  const TIMEOUT_MS = 30_000;

  function call(method, params = []) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          reject(new Error(`NIP-07 request timed out: ${method}`));
        }
      }, TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      window.postMessage({ type: 'LOBSTR_NIP07_REQUEST', id, method, params }, '*');
    });
  }

  window.nostr = {
    getPublicKey:  ()                      => call('getPublicKey'),
    signEvent:     (event)                 => call('signEvent',       [event]),
    getRelays:     ()                      => call('getRelays'),
    nip04: {
      encrypt: (pubkey, plaintext)         => call('nip04.encrypt',   [pubkey, plaintext]),
      decrypt: (pubkey, ciphertext)        => call('nip04.decrypt',   [pubkey, ciphertext]),
    },
  };
})();
