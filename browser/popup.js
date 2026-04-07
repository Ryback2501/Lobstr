import { generateKeypair, importPrivkey } from './nostr.js';
import { generateMnemonic, validateMnemonic, deriveNostrKeypair } from './nip06.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const pubkeyDisplay       = document.getElementById('pubkey-display');
const copyPubkeyBtn       = document.getElementById('copy-pubkey-btn');
const privkeyDisplayWrapper = document.getElementById('privkey-display-wrapper');
const privkeyDisplay      = document.getElementById('privkey-display');
const copyPrivkeyBtn      = document.getElementById('copy-privkey-btn');
const privkeyImport       = document.getElementById('privkey-import');
const importBtn           = document.getElementById('import-btn');
const importError         = document.getElementById('import-error');
const mnemonicDisplayWrapper = document.getElementById('mnemonic-display-wrapper');
const mnemonicDisplay     = document.getElementById('mnemonic-display');
const copyMnemonicBtn     = document.getElementById('copy-mnemonic-btn');
const mnemonicImport      = document.getElementById('mnemonic-import');
const mnemonicError       = document.getElementById('mnemonic-error');
const mnemonicImportBtn   = document.getElementById('mnemonic-import-btn');
const generateBtn         = document.getElementById('generate-btn');
const generateMnemonicBtn = document.getElementById('generate-mnemonic-btn');
const mnemonicStrength    = document.getElementById('mnemonic-strength');
const logoutBtn           = document.getElementById('logout-btn');
const relayInput          = document.getElementById('relay-input');
const relayAddBtn         = document.getElementById('relay-add-btn');
const relayError          = document.getElementById('relay-error');
const relayList           = document.getElementById('relay-list');
const permissionsEmpty    = document.getElementById('permissions-empty');
const permissionsList     = document.getElementById('permissions-list');

// ── Tab switching ─────────────────────────────────────────────────────────────

const TABS = ['identity', 'relays', 'permissions'];

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    TABS.forEach(t => {
      document.getElementById(`tab-${t}`).hidden = (t !== tab);
      document.querySelector(`[data-tab="${t}"]`).classList.toggle('active', t === tab);
    });
  });
});

// ── State helpers ─────────────────────────────────────────────────────────────

const DEFAULT_RELAYS = { 'wss://relay.damus.io': { read: true, write: true } };

async function loadState() {
  const { keys, relays, permissions } = await chrome.storage.local.get({
    keys: null,
    relays: DEFAULT_RELAYS,
    permissions: {},
  });
  updateIdentityUI(keys);
  renderRelays(relays);
  renderPermissions(permissions);
}

function updateIdentityUI(keys) {
  pubkeyDisplay.value = keys?.pubkeyHex ?? '';
  logoutBtn.hidden = !keys;
}

// ── Identity: generate ────────────────────────────────────────────────────────

generateBtn.addEventListener('click', async () => {
  const keys = generateKeypair();
  await chrome.storage.local.set({ keys: { privkeyHex: keys.privkeyHex, pubkeyHex: keys.pubkeyHex } });
  updateIdentityUI(keys);
  privkeyDisplay.value = keys.privkeyHex;
  privkeyDisplayWrapper.hidden = false;
  importError.hidden = true;
  document.getElementById('privkey-section').open = true;
});

// ── Identity: import from hex ─────────────────────────────────────────────────

importBtn.addEventListener('click', async () => {
  const hex = privkeyImport.value.trim();
  try {
    const keys = importPrivkey(hex);
    await chrome.storage.local.set({ keys: { privkeyHex: keys.privkeyHex, pubkeyHex: keys.pubkeyHex } });
    updateIdentityUI(keys);
    privkeyImport.value = '';
    privkeyDisplayWrapper.hidden = true;
    importError.hidden = true;
  } catch (err) {
    importError.textContent = err.message;
    importError.hidden = false;
  }
});

// ── Identity: generate from mnemonic ─────────────────────────────────────────

generateMnemonicBtn.addEventListener('click', async () => {
  generateMnemonicBtn.disabled = true;
  mnemonicError.hidden = true;
  try {
    const strength = parseInt(mnemonicStrength.value);
    const mnemonic = generateMnemonic(strength);
    const { privkeyHex, pubkeyHex } = await deriveNostrKeypair(mnemonic);
    await chrome.storage.local.set({ keys: { privkeyHex, pubkeyHex } });
    updateIdentityUI({ pubkeyHex });
    privkeyDisplayWrapper.hidden = true;
    showMnemonic(mnemonic);
    document.getElementById('mnemonic-section').open = true;
  } catch (err) {
    mnemonicError.textContent = err.message;
    mnemonicError.hidden = false;
  } finally {
    generateMnemonicBtn.disabled = false;
  }
});

// ── Identity: import from mnemonic ────────────────────────────────────────────

mnemonicImportBtn.addEventListener('click', async () => {
  const mnemonic = mnemonicImport.value.trim().toLowerCase().replace(/\s+/g, ' ');
  mnemonicError.hidden = true;

  if (!validateMnemonic(mnemonic)) {
    mnemonicError.textContent = 'Invalid mnemonic — check word count and spelling.';
    mnemonicError.hidden = false;
    return;
  }

  mnemonicImportBtn.disabled = true;
  try {
    const { privkeyHex, pubkeyHex } = await deriveNostrKeypair(mnemonic);
    await chrome.storage.local.set({ keys: { privkeyHex, pubkeyHex } });
    updateIdentityUI({ pubkeyHex });
    mnemonicImport.value = '';
    mnemonicDisplayWrapper.hidden = true;
    importError.hidden = true;
    privkeyDisplayWrapper.hidden = true;
  } catch (err) {
    mnemonicError.textContent = err.message;
    mnemonicError.hidden = false;
  } finally {
    mnemonicImportBtn.disabled = false;
  }
});

function showMnemonic(mnemonic) {
  mnemonicDisplay.innerHTML = '';
  mnemonic.split(' ').forEach((word, i) => {
    const chip = document.createElement('div');
    chip.className = 'mnemonic-word';
    const num = document.createElement('span');
    num.className = 'mnemonic-word-num';
    num.textContent = i + 1;
    const text = document.createElement('span');
    text.textContent = word;
    chip.append(num, text);
    mnemonicDisplay.appendChild(chip);
  });
  mnemonicDisplayWrapper.hidden = false;
}

// ── Identity: logout ──────────────────────────────────────────────────────────

logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove('keys');
  updateIdentityUI(null);
  privkeyDisplay.value = '';
  privkeyDisplayWrapper.hidden = true;
  mnemonicDisplayWrapper.hidden = true;
});

// ── Identity: copy buttons ────────────────────────────────────────────────────

copyPubkeyBtn.addEventListener('click', () => copyToClipboard(pubkeyDisplay.value, copyPubkeyBtn));
copyPrivkeyBtn.addEventListener('click', () => copyToClipboard(privkeyDisplay.value, copyPrivkeyBtn));

copyMnemonicBtn.addEventListener('click', () => {
  const words = [...mnemonicDisplay.querySelectorAll('.mnemonic-word')]
    .map(el => el.lastChild?.textContent ?? '')
    .join(' ');
  copyToClipboard(words, copyMnemonicBtn);
});

// ── Relays ────────────────────────────────────────────────────────────────────

relayAddBtn.addEventListener('click', addRelay);
relayInput.addEventListener('keydown', e => { if (e.key === 'Enter') addRelay(); });

async function addRelay() {
  const url = relayInput.value.trim();
  if (!url) return;
  if (!/^wss?:\/\/.+/.test(url)) {
    showRelayError('URL must start with wss:// or ws://');
    return;
  }
  const { relays } = await chrome.storage.local.get({ relays: DEFAULT_RELAYS });
  if (relays[url]) {
    showRelayError('Relay already in list.');
    return;
  }
  relays[url] = { read: true, write: true };
  await chrome.storage.local.set({ relays });
  relayInput.value = '';
  relayError.hidden = true;
  renderRelays(relays);
}

function showRelayError(msg) {
  relayError.textContent = msg;
  relayError.hidden = false;
}

function renderRelays(relays) {
  relayList.innerHTML = '';
  for (const [url, { read, write }] of Object.entries(relays)) {
    const item = document.createElement('div');
    item.className = 'relay-item';

    const urlEl = document.createElement('span');
    urlEl.className = 'relay-url';
    urlEl.textContent = url;
    urlEl.title = url;

    const toggleGroup = document.createElement('div');
    toggleGroup.className = 'relay-toggle';

    for (const mode of ['read', 'write']) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = mode === 'read' ? read : write;
      checkbox.addEventListener('change', async () => {
        const { relays: current } = await chrome.storage.local.get({ relays: DEFAULT_RELAYS });
        current[url][mode] = checkbox.checked;
        await chrome.storage.local.set({ relays: current });
      });
      label.append(checkbox, mode);
      toggleGroup.appendChild(label);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.title = 'Remove relay';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', async () => {
      const { relays: current } = await chrome.storage.local.get({ relays: DEFAULT_RELAYS });
      delete current[url];
      await chrome.storage.local.set({ relays: current });
      renderRelays(current);
    });

    item.append(urlEl, toggleGroup, removeBtn);
    relayList.appendChild(item);
  }
}

// ── Permissions ───────────────────────────────────────────────────────────────

function renderPermissions(permissions) {
  permissionsList.innerHTML = '';
  const entries = Object.entries(permissions);
  permissionsEmpty.hidden = entries.length > 0;

  for (const [origin, status] of entries) {
    const item = document.createElement('div');
    item.className = 'permission-item';

    const originEl = document.createElement('span');
    originEl.className = 'permission-origin';
    originEl.textContent = origin;
    originEl.title = origin;

    const badge = document.createElement('span');
    badge.className = `badge ${status}`;
    badge.textContent = status;

    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'btn-remove';
    revokeBtn.title = 'Revoke permission';
    revokeBtn.textContent = '×';
    revokeBtn.addEventListener('click', async () => {
      const { permissions: current } = await chrome.storage.local.get({ permissions: {} });
      delete current[origin];
      await chrome.storage.local.set({ permissions: current });
      renderPermissions(current);
    });

    item.append(originEl, badge, revokeBtn);
    permissionsList.appendChild(item);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function copyToClipboard(text, btn) {
  if (!text) return;
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Failed';
  } finally {
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadState();
