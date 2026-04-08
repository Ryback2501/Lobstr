import { schnorr, secp256k1 } from './vendor/secp256k1.mjs';
import { sha256 } from './vendor/sha256.mjs';
import { bytesToHex, utf8ToBytes } from './vendor/utils.mjs';

export function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function generateKeypair() {
  const privkey = schnorr.utils.randomPrivateKey();
  const pubkey = schnorr.getPublicKey(privkey);
  return {
    privkey,
    pubkey,
    privkeyHex: bytesToHex(privkey),
    pubkeyHex: bytesToHex(pubkey),
  };
}

export function importPrivkey(hexString) {
  if (!/^[0-9a-fA-F]{64}$/.test(hexString)) {
    throw new Error('Private key must be 64 hex characters');
  }
  const privkey = hexToBytes(hexString);
  const pubkey = schnorr.getPublicKey(privkey);
  return {
    privkey,
    pubkey,
    privkeyHex: hexString.toLowerCase(),
    pubkeyHex: bytesToHex(pubkey),
  };
}

export function serializeEvent(pubkeyHex, createdAt, kind, tags, content) {
  return JSON.stringify([0, pubkeyHex, createdAt, kind, tags, content]);
}

export function getEventId(serialized) {
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

export function signEvent(eventIdHex, privkey) {
  return bytesToHex(schnorr.sign(hexToBytes(eventIdHex), privkey));
}

export function createEvent({ privkeyHex, pubkeyHex, kind = 1, tags = [], content }) {
  const privkey = hexToBytes(privkeyHex);
  const createdAt = Math.floor(Date.now() / 1000);
  const serialized = serializeEvent(pubkeyHex, createdAt, kind, tags, content);
  const id = getEventId(serialized);
  const sig = signEvent(id, privkey);
  return { id, pubkey: pubkeyHex, created_at: createdAt, kind, tags, content, sig };
}

export async function encryptDm(privkeyHex, recipientPubkeyHex, plaintext) {
  const sharedPoint = secp256k1.getSharedSecret(hexToBytes(privkeyHex), '02' + recipientPubkeyHex);
  const sharedKey = sharedPoint.slice(1, 33);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', sharedKey, 'AES-CBC', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(plaintext));
  const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  const ivB64 = btoa(String.fromCharCode(...iv));
  return `${cipherB64}?iv=${ivB64}`;
}

export async function decryptDm(privkeyHex, contactPubkeyHex, content) {
  const sep = content.indexOf('?iv=');
  if (sep === -1) throw new Error('Invalid encrypted message format');
  const ciphertext = Uint8Array.from(atob(content.slice(0, sep)), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(content.slice(sep + 4)), c => c.charCodeAt(0));
  const sharedPoint = secp256k1.getSharedSecret(hexToBytes(privkeyHex), '02' + contactPubkeyHex);
  const sharedKey = sharedPoint.slice(1, 33);
  const key = await crypto.subtle.importKey('raw', sharedKey, 'AES-CBC', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export function verifyEvent(event) {
  try {
    const serialized = serializeEvent(event.pubkey, event.created_at, event.kind, event.tags, event.content);
    const expectedId = getEventId(serialized);
    if (expectedId !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}
