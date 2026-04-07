const METHOD_LABELS = {
  getPublicKey:   'wants to read your public key',
  signEvent:      'wants to sign an event',
  'nip04.encrypt': 'wants to encrypt a direct message',
  'nip04.decrypt': 'wants to decrypt a direct message',
};

(async () => {
  const requestId = new URLSearchParams(location.search).get('id');
  if (!requestId) { window.close(); return; }

  const stored = await chrome.storage.session.get(requestId);
  const request = stored[requestId];
  if (!request) {
    // Session data gone (service worker restarted) — close silently.
    window.close();
    return;
  }

  // ── Populate UI ─────────────────────────────────────────────────────────────

  document.getElementById('origin-display').textContent = request.origin;
  document.getElementById('method-display').textContent = METHOD_LABELS[request.method] ?? request.method;

  const detailEl = document.getElementById('detail-display');
  const dp = request.displayParams ?? {};

  if (request.method === 'signEvent' && dp.kind !== undefined) {
    const row = document.createElement('div');
    row.className = 'detail';
    const strong = document.createElement('strong');
    strong.textContent = `Kind ${dp.kind}`;
    row.appendChild(strong);
    if (dp.content) {
      const preview = document.createElement('span');
      preview.textContent = ` — "${dp.content}"`;
      row.appendChild(preview);
    }
    detailEl.appendChild(row);
  } else if (dp.recipient || dp.sender) {
    const row = document.createElement('div');
    row.className = 'detail';
    const label = dp.recipient ? 'Recipient' : 'Sender';
    const key   = dp.recipient ?? dp.sender;
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    row.appendChild(strong);
    row.append(`${key.slice(0, 16)}…${key.slice(-8)}`);
    detailEl.appendChild(row);
  }

  // ── Action handlers ────────────────────────────────────────────────────────

  async function respond(approved) {
    const remember = document.getElementById('remember').checked;
    await chrome.runtime.sendMessage({ type: 'CONFIRM_RESPONSE', requestId, approved, remember });
    window.close();
  }

  document.getElementById('approve-btn').addEventListener('click', () => respond(true));
  document.getElementById('deny-btn').addEventListener('click',   () => respond(false));
})();
