/**
 * Runs in the ISOLATED world. Bridges messages between inject.js (MAIN world)
 * and background.js (service worker). Never touches crypto or keys.
 */
window.addEventListener('message', ({ source, data }) => {
  if (source !== window || data?.type !== 'LOBSTR_NIP07_REQUEST') return;

  chrome.runtime.sendMessage(
    { type: 'NOSTR_REQUEST', id: data.id, method: data.method, params: data.params },
    (response) => {
      const msg = { type: 'LOBSTR_NIP07_RESPONSE', id: data.id };
      if (chrome.runtime.lastError) {
        msg.error = chrome.runtime.lastError.message;
      } else {
        Object.assign(msg, response);
      }
      window.postMessage(msg, '*');
    }
  );
});
