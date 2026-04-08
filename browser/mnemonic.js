/**
 * Mnemonic key derivation
 * BIP-39 mnemonic generation/validation + BIP-32 HD derivation
 * Derivation path: m/44'/1237'/0'/0/0  (Nostr coin type 1237)
 */

import { wordlist } from './vendor/bip39-wordlist.js';
import { sha256 } from './vendor/sha256.mjs';
import { bytesToHex } from './vendor/utils.mjs';
import { schnorr, secp256k1 } from './vendor/secp256k1.mjs';
import { hexToBytes } from './nostr.js';

function ser32(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

async function hmacSha512(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

// ── BIP-39 ────────────────────────────────────────────────────────────────────

const wordMap = new Map(wordlist.map((w, i) => [w, i]));

export function generateMnemonic(strength = 128) {
  if (![128, 160, 192, 224, 256].includes(strength)) {
    throw new Error('strength must be 128/160/192/224/256');
  }
  const entropy = crypto.getRandomValues(new Uint8Array(strength / 8));
  return entropyToMnemonic(entropy);
}

function entropyToMnemonic(entropy) {
  const checksumBits = entropy.length / 4;
  const hash = sha256(entropy);
  const checksumByte = hash[0] & (0xff << (8 - checksumBits));

  let bits = '';
  for (const b of entropy) bits += b.toString(2).padStart(8, '0');
  bits += checksumByte.toString(2).padStart(8, '0').slice(0, checksumBits);

  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    words.push(wordlist[parseInt(bits.slice(i, i + 11), 2)]);
  }
  return words.join(' ');
}

export function validateMnemonic(mnemonic) {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  for (const w of words) {
    if (!wordMap.has(w)) return false;
  }
  let bits = words.map(w => wordMap.get(w).toString(2).padStart(11, '0')).join('');
  const totalBits = words.length * 11;
  const checksumBits = totalBits % 32 || 32;
  const entropyBits = bits.slice(0, totalBits - checksumBits);
  const givenChecksum = parseInt(bits.slice(totalBits - checksumBits), 2);

  const entropy = new Uint8Array(entropyBits.length / 8);
  for (let i = 0; i < entropy.length; i++) {
    entropy[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  }
  const expectedChecksum = sha256(entropy)[0] >> (8 - checksumBits);
  return givenChecksum === expectedChecksum;
}

export async function mnemonicToSeed(mnemonic, passphrase = '') {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(mnemonic.normalize('NFKD')), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(('mnemonic' + passphrase).normalize('NFKD')), iterations: 2048, hash: 'SHA-512' },
    keyMaterial, 512
  );
  return new Uint8Array(bits);
}

// ── BIP-32 ────────────────────────────────────────────────────────────────────

async function masterKey(seed) {
  const I = await hmacSha512(new TextEncoder().encode('Bitcoin seed'), seed);
  return { priv: I.slice(0, 32), chain: I.slice(32) };
}

async function childKey({ priv, chain }, index) {
  const hardened = index >= 0x80000000;
  const data = new Uint8Array(37);
  if (hardened) {
    data[0] = 0x00;
    data.set(priv, 1);
  } else {
    const pub = secp256k1.getPublicKey(priv, true);
    data.set(pub, 0);
  }
  data.set(ser32(index), 33);

  const I = await hmacSha512(chain, data);
  const IL = BigInt('0x' + bytesToHex(I.slice(0, 32)));
  if (IL >= N) throw new Error('Invalid child key — IL >= N');

  const childPriv = (IL + BigInt('0x' + bytesToHex(priv))) % N;
  if (childPriv === 0n) throw new Error('Invalid child key — zero');

  return {
    priv: hexToBytes(childPriv.toString(16).padStart(64, '0')),
    chain: I.slice(32),
  };
}

const H = 0x80000000;

// m/44'/1237'/0'/0/0
export async function deriveNostrKeypair(mnemonic, passphrase = '') {
  const seed = await mnemonicToSeed(mnemonic, passphrase);
  let node = await masterKey(seed);
  node = await childKey(node, 44 + H);
  node = await childKey(node, 1237 + H);
  node = await childKey(node, 0 + H);
  node = await childKey(node, 0);
  node = await childKey(node, 0);
  const privkeyHex = bytesToHex(node.priv);
  const pubkeyHex = bytesToHex(schnorr.getPublicKey(node.priv));
  return { privkeyHex, pubkeyHex };
}
