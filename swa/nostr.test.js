import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToBytes, generateKeypair, importPrivkey,
  serializeEvent, getEventId,
  createEvent, verifyEvent, classifyEvent,
  encryptDm, decryptDm,
} from './nostr.js';

// Known test keypairs (from NIP-06 test vectors)
const ALICE_PRIV = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const ALICE_PUB  = '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917';
const BOB_PUB    = 'd61f3bc5b3eb4400efdae6169a5c17cabf3246b514361de939ce4a1a0da6ef4a';

// ── NIP-01: hexToBytes ────────────────────────────────────────────────────────

test('hexToBytes: converts hex string to Uint8Array', () => {
  const result = hexToBytes('deadbeef');
  assert.ok(result instanceof Uint8Array);
  assert.deepEqual(result, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

test('hexToBytes: throws on odd-length hex string', () => {
  assert.throws(() => hexToBytes('abc'), /Invalid hex/);
});

test('hexToBytes: throws on non-hex characters', () => {
  assert.throws(() => hexToBytes('zz'), /Invalid hex/);
});

// ── NIP-01: importPrivkey ─────────────────────────────────────────────────────

test('importPrivkey: accepts 64-char hex and derives pubkey', () => {
  const keys = importPrivkey(ALICE_PRIV);
  assert.equal(keys.privkeyHex, ALICE_PRIV);
  assert.equal(keys.pubkeyHex, ALICE_PUB);
  assert.ok(keys.privkey instanceof Uint8Array);
  assert.ok(keys.pubkey instanceof Uint8Array);
});

test('importPrivkey: throws on key shorter than 64 chars', () => {
  assert.throws(() => importPrivkey('deadbeef'), /64 hex/);
});

test('importPrivkey: throws on non-hex characters', () => {
  assert.throws(() => importPrivkey('z'.repeat(64)), /64 hex/);
});

test('importPrivkey: normalises privkeyHex to lowercase', () => {
  const keys = importPrivkey(ALICE_PRIV.toUpperCase());
  assert.equal(keys.privkeyHex, ALICE_PRIV.toLowerCase());
});

// ── NIP-01: generateKeypair ───────────────────────────────────────────────────

test('generateKeypair: returns object with correct shape', () => {
  const kp = generateKeypair();
  assert.ok('privkeyHex' in kp && 'pubkeyHex' in kp && 'privkey' in kp && 'pubkey' in kp);
});

test('generateKeypair: privkeyHex is 64 lowercase hex chars', () => {
  const { privkeyHex } = generateKeypair();
  assert.match(privkeyHex, /^[0-9a-f]{64}$/);
});

test('generateKeypair: pubkeyHex is 64 lowercase hex chars', () => {
  const { pubkeyHex } = generateKeypair();
  assert.match(pubkeyHex, /^[0-9a-f]{64}$/);
});

test('generateKeypair: two calls produce different keypairs', () => {
  const a = generateKeypair();
  const b = generateKeypair();
  assert.notEqual(a.privkeyHex, b.privkeyHex);
  assert.notEqual(a.pubkeyHex, b.pubkeyHex);
});

// ── NIP-01: serializeEvent ────────────────────────────────────────────────────

test('serializeEvent: produces the canonical JSON array', () => {
  const s = serializeEvent('pubkey', 1700000000, 1, [['e', 'abc']], 'hello');
  assert.equal(s, JSON.stringify([0, 'pubkey', 1700000000, 1, [['e', 'abc']], 'hello']));
});

test('serializeEvent: escapes newline in content', () => {
  const s = serializeEvent('pk', 0, 1, [], 'line1\nline2');
  assert.ok(s.includes('\\n'));
  assert.equal(JSON.parse(s)[5], 'line1\nline2');
});

test('serializeEvent: escapes double quote in content', () => {
  const s = serializeEvent('pk', 0, 1, [], 'say "hello"');
  assert.ok(s.includes('\\"'));
  assert.equal(JSON.parse(s)[5], 'say "hello"');
});

test('serializeEvent: escapes backslash in content', () => {
  const s = serializeEvent('pk', 0, 1, [], 'path\\to\\file');
  assert.ok(s.includes('\\\\'));
  assert.equal(JSON.parse(s)[5], 'path\\to\\file');
});

test('serializeEvent: escapes tab and carriage-return in content', () => {
  const s = serializeEvent('pk', 0, 1, [], 'col1\tcol2\rend');
  assert.ok(s.includes('\\t'));
  assert.ok(s.includes('\\r'));
  assert.equal(JSON.parse(s)[5], 'col1\tcol2\rend');
});

test('getEventId: is stable for content with special characters', () => {
  const s = serializeEvent('pk', 0, 1, [], 'line1\nline2\t"quoted"\\back');
  assert.equal(getEventId(s), getEventId(s));
});

// ── NIP-01: getEventId ────────────────────────────────────────────────────────

test('getEventId: returns a 64-char hex string', () => {
  const id = getEventId(serializeEvent(ALICE_PUB, 1700000000, 1, [], 'hello'));
  assert.match(id, /^[0-9a-f]{64}$/);
});

test('getEventId: is deterministic', () => {
  const s = serializeEvent(ALICE_PUB, 1700000000, 1, [], 'hi');
  assert.equal(getEventId(s), getEventId(s));
});

// ── NIP-01: createEvent ───────────────────────────────────────────────────────

test('createEvent: produces an event that passes verifyEvent', () => {
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [], content: 'hello' });
  assert.equal(verifyEvent(event), true);
});

test('createEvent: event fields match the supplied values', () => {
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [['t', 'test']], content: 'hi' });
  assert.equal(event.pubkey, ALICE_PUB);
  assert.equal(event.kind, 1);
  assert.equal(event.content, 'hi');
  assert.deepEqual(event.tags, [['t', 'test']]);
});

test('createEvent: created_at is within 5 seconds of now', () => {
  const now = Math.floor(Date.now() / 1000);
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [], content: '' });
  assert.ok(Math.abs(event.created_at - now) <= 5);
});

test('createEvent: id and sig are 64-char hex strings', () => {
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [], content: '' });
  assert.match(event.id, /^[0-9a-f]{64}$/);
  assert.match(event.sig, /^[0-9a-f]{128}$/);
});

// ── NIP-01: verifyEvent ───────────────────────────────────────────────────────

test('verifyEvent: returns true for a valid event', () => {
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [], content: 'test' });
  assert.equal(verifyEvent(event), true);
});

test('verifyEvent: returns false when id is tampered', () => {
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [], content: 'test' });
  assert.equal(verifyEvent({ ...event, id: 'a'.repeat(64) }), false);
});

test('verifyEvent: returns false when sig is tampered', () => {
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [], content: 'test' });
  assert.equal(verifyEvent({ ...event, sig: 'b'.repeat(128) }), false);
});

test('verifyEvent: returns false when content is tampered', () => {
  const event = createEvent({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB, kind: 1, tags: [], content: 'original' });
  assert.equal(verifyEvent({ ...event, content: 'tampered' }), false);
});

test('verifyEvent: returns false for missing field', () => {
  assert.equal(verifyEvent({ pubkey: ALICE_PUB, kind: 1, tags: [], content: '' }), false);
});

// ── NIP-01/02/03/04/09: classifyEvent ────────────────────────────────────────

test('classifyEvent: kind 0 (profile metadata) → replaceable', () => {
  assert.equal(classifyEvent({ kind: 0 }), 'replaceable');
});

test('classifyEvent: kind 1 (text note) → regular', () => {
  assert.equal(classifyEvent({ kind: 1 }), 'regular');
});

test('classifyEvent: kind 2 (obsolete recommend-server) → regular', () => {
  assert.equal(classifyEvent({ kind: 2 }), 'regular');
});

test('classifyEvent: kind 3 (follow list, NIP-02) → replaceable', () => {
  assert.equal(classifyEvent({ kind: 3 }), 'replaceable');
});

test('classifyEvent: kind 4 (encrypted DM, NIP-04) → regular', () => {
  assert.equal(classifyEvent({ kind: 4 }), 'regular');
});

test('classifyEvent: kind 5 (deletion request, NIP-09) → regular', () => {
  assert.equal(classifyEvent({ kind: 5 }), 'regular');
});

test('classifyEvent: kind 1040 (attestation, NIP-03) → regular', () => {
  assert.equal(classifyEvent({ kind: 1040 }), 'regular');
});

test('classifyEvent: kind 10000 → replaceable', () => {
  assert.equal(classifyEvent({ kind: 10000 }), 'replaceable');
});

test('classifyEvent: kind 19999 → replaceable', () => {
  assert.equal(classifyEvent({ kind: 19999 }), 'replaceable');
});

test('classifyEvent: kind 20000 → ephemeral', () => {
  assert.equal(classifyEvent({ kind: 20000 }), 'ephemeral');
});

test('classifyEvent: kind 29999 → ephemeral', () => {
  assert.equal(classifyEvent({ kind: 29999 }), 'ephemeral');
});

test('classifyEvent: kind 30000 → addressable', () => {
  assert.equal(classifyEvent({ kind: 30000 }), 'addressable');
});

test('classifyEvent: kind 39999 → addressable', () => {
  assert.equal(classifyEvent({ kind: 39999 }), 'addressable');
});

// ── NIP-09: deletion event structure ─────────────────────────────────────────

test('createEvent: kind 5 deletion event has correct tags and passes verification', () => {
  const targetId = 'a'.repeat(64);
  const event = createEvent({
    privkeyHex: ALICE_PRIV,
    pubkeyHex: ALICE_PUB,
    kind: 5,
    tags: [['e', targetId], ['k', '1']],
    content: '',
  });
  assert.equal(event.kind, 5);
  assert.deepEqual(event.tags, [['e', targetId], ['k', '1']]);
  assert.equal(verifyEvent(event), true);
});

// ── NIP-04: encryptDm / decryptDm ────────────────────────────────────────────

test('encryptDm/decryptDm: round-trip restores plaintext', async () => {
  const plaintext = 'hello, nostr!';
  const ciphertext = await encryptDm(ALICE_PRIV, BOB_PUB, plaintext);
  const result = await decryptDm(ALICE_PRIV, BOB_PUB, ciphertext);
  assert.equal(result, plaintext);
});

test('encryptDm: output contains the ?iv= separator', async () => {
  const out = await encryptDm(ALICE_PRIV, BOB_PUB, 'test');
  assert.ok(out.includes('?iv='));
});

test('decryptDm: throws on content missing ?iv= separator', async () => {
  await assert.rejects(() => decryptDm(ALICE_PRIV, BOB_PUB, 'bm9pdg=='), /Invalid DM/);
});

test('encryptDm/decryptDm: ECDH is symmetric (Alice encrypts, Bob decrypts with own key)', async () => {
  const alice = generateKeypair();
  const bob = generateKeypair();
  const plaintext = 'symmetric secret';
  const ciphertext = await encryptDm(alice.privkeyHex, bob.pubkeyHex, plaintext);
  const result = await decryptDm(bob.privkeyHex, alice.pubkeyHex, ciphertext);
  assert.equal(result, plaintext);
});
