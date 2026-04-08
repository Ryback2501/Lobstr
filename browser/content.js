/**
 * Runs in the ISOLATED world. Two responsibilities:
 * 1. Bridge postMessages from inject.js (MAIN world) to background.js.
 * 2. Inject the permission modal into the page when background requests it.
 */

// ── Bridge: page → background ─────────────────────────────────────────────────

window.addEventListener('message', ({ source, data }) => {
  if (source !== window || data?.type !== 'LOBSTR_SIGNER_REQUEST') return;

  chrome.runtime.sendMessage(
    { type: 'NOSTR_REQUEST', id: data.id, method: data.method, params: data.params },
    (response) => {
      const msg = { type: 'LOBSTR_SIGNER_RESPONSE', id: data.id };
      if (chrome.runtime.lastError) {
        msg.error = chrome.runtime.lastError.message;
      } else {
        Object.assign(msg, response);
      }
      window.postMessage(msg, '*');
    }
  );
});

// ── Permission modal ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'SHOW_PERMISSION_MODAL') return;
  showPermissionModal(msg);
  sendResponse({});
});

const METHOD_LABELS = {
  getPublicKey:    'wants to read your public key',
  signEvent:       'wants to sign an event',
  'nip04.encrypt': 'wants to encrypt a direct message',
  'nip04.decrypt': 'wants to decrypt a direct message',
};

function showPermissionModal({ requestId, origin, method, displayParams }) {
  // Remove any stale modal from a previous request
  document.getElementById('lobstr-permission-host')?.remove();

  const host = document.createElement('div');
  host.id = 'lobstr-permission-host';
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      .overlay {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.75);
        z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px; line-height: 1.5;
      }
      .modal {
        background: #1a1a1a;
        border: 1px solid #2e2e2e;
        border-radius: 10px;
        padding: 1.5rem;
        width: 400px;
        max-width: calc(100vw - 2rem);
        color: #e8e8e8;
        display: flex; flex-direction: column; gap: 0.85rem;
        position: relative;
      }
      .tag {
        font-size: 0.68rem; font-weight: 600;
        letter-spacing: 0.07em; text-transform: uppercase; color: #888;
      }
      .site  { font-size: 1rem; font-weight: 600; color: #7c3aed; word-break: break-all; }
      .action { font-size: 0.875rem; }
      .detail { font-size: 0.78rem; color: #888; word-break: break-all; }
      .detail strong { color: #e8e8e8; }
      .remember {
        display: flex; align-items: center; gap: 0.4rem;
        font-size: 0.78rem; color: #888; cursor: pointer;
      }
      .btn-row { display: flex; gap: 0.5rem; }
      button {
        background: #242424; border: 1px solid #2e2e2e; border-radius: 6px;
        color: #e8e8e8; cursor: pointer; font-family: inherit;
        font-size: 0.875rem; padding: 0.5rem 0.9rem;
        transition: background 0.15s, border-color 0.15s;
      }
      button:hover { background: #2e2e2e; }
      .approve { background: #7c3aed; border-color: #7c3aed; color: #fff; font-weight: 500; }
      .approve:hover { background: #6d28d9; border-color: #6d28d9; }
      .deny { color: #ef4444; border-color: #ef4444; }
      .deny:hover { background: rgba(239,68,68,0.1); }
    </style>
    <div class="overlay" id="overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-site">
        <p class="tag">Permission request</p>
        <p class="site" id="modal-site"></p>
        <p class="action" id="modal-action"></p>
        <div id="modal-detail"></div>
        <label class="remember">
          <input type="checkbox" id="remember"> Remember this decision for this site
        </label>
        <div class="btn-row">
          <button class="approve" id="approve">Approve</button>
          <button class="deny"    id="deny">Deny</button>
        </div>
      </div>
    </div>`;

  // Populate dynamic content safely via textContent
  shadow.getElementById('modal-site').textContent   = origin;
  shadow.getElementById('modal-action').textContent = METHOD_LABELS[method] ?? method;

  const detailEl = shadow.getElementById('modal-detail');
  const dp = displayParams ?? {};

  if (method === 'signEvent' && dp.kind !== undefined) {
    const p = document.createElement('p');
    p.className = 'detail';
    const strong = document.createElement('strong');
    strong.textContent = `Kind ${dp.kind}`;
    p.appendChild(strong);
    if (dp.content) {
      p.append(` — "${dp.content}"`);
    }
    detailEl.appendChild(p);
  } else if (dp.recipient || dp.sender) {
    const p = document.createElement('p');
    p.className = 'detail';
    const key   = dp.recipient ?? dp.sender;
    const label = dp.recipient ? 'Recipient' : 'Sender';
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.appendChild(strong);
    p.append(`${key.slice(0, 16)}…${key.slice(-8)}`);
    detailEl.appendChild(p);
  }

  document.documentElement.appendChild(host);
  shadow.getElementById('approve').focus();

  // ── Respond helpers ────────────────────────────────────────────────────────

  function respond(approved) {
    host.remove();
    const remember = shadow.getElementById('remember').checked;
    chrome.runtime.sendMessage({ type: 'CONFIRM_RESPONSE', requestId, approved, remember, origin });
  }

  shadow.getElementById('approve').addEventListener('click', () => respond(true));
  shadow.getElementById('deny').addEventListener('click',   () => respond(false));

  // Click on the backdrop denies
  shadow.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target === shadow.getElementById('overlay')) respond(false);
  });

  // Escape key denies
  function onKeyDown(e) {
    if (e.key === 'Escape') { document.removeEventListener('keydown', onKeyDown); respond(false); }
  }
  document.addEventListener('keydown', onKeyDown);
}
