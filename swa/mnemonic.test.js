import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMnemonic, validateMnemonic, deriveNostrKeypair } from './mnemonic.js';

// ── NIP-06: generateMnemonic ──────────────────────────────────────────────────

test('generateMnemonic: default (128-bit) produces 12 words', () => {
  const m = generateMnemonic();
  assert.equal(m.trim().split(/\s+/).length, 12);
});

test('generateMnemonic: 256-bit produces 24 words', () => {
  const m = generateMnemonic(256);
  assert.equal(m.trim().split(/\s+/).length, 24);
});

test('generateMnemonic: throws on invalid strength', () => {
  assert.throws(() => generateMnemonic(100), /strength/);
});

test('generateMnemonic: output passes validateMnemonic', () => {
  assert.equal(validateMnemonic(generateMnemonic()), true);
  assert.equal(validateMnemonic(generateMnemonic(256)), true);
});

test('generateMnemonic: two calls produce different mnemonics', () => {
  assert.notEqual(generateMnemonic(), generateMnemonic());
});

// ── NIP-06: validateMnemonic ──────────────────────────────────────────────────

test('validateMnemonic: returns true for a known valid 12-word mnemonic', () => {
  assert.equal(
    validateMnemonic('leader monkey parrot ring guide accident before fence cannon height naive bean'),
    true,
  );
});

test('validateMnemonic: returns true for a generated 24-word mnemonic', () => {
  assert.equal(validateMnemonic(generateMnemonic(256)), true);
});

test('validateMnemonic: returns false for wrong word count (11 words)', () => {
  assert.equal(
    validateMnemonic('leader monkey parrot ring guide accident before fence cannon height naive'),
    false,
  );
});

test('validateMnemonic: returns false for unknown word', () => {
  assert.equal(
    validateMnemonic('leader monkey parrot ring guide accident before fence cannon height naive zzzzz'),
    false,
  );
});

test('validateMnemonic: returns false when last word carries wrong checksum', () => {
  // Replace the checksum-bearing last word with a different valid word
  assert.equal(
    validateMnemonic('leader monkey parrot ring guide accident before fence cannon height naive ability'),
    false,
  );
});

test('validateMnemonic: is case-insensitive', () => {
  assert.equal(
    validateMnemonic('Leader Monkey Parrot Ring Guide Accident Before Fence Cannon Height Naive Bean'),
    true,
  );
});

test('validateMnemonic: tolerates extra whitespace', () => {
  assert.equal(
    validateMnemonic('  leader  monkey parrot ring guide accident before fence cannon height naive bean  '),
    true,
  );
});

// ── NIP-06: deriveNostrKeypair (BIP-39 + BIP-32, path m/44'/1237'/0'/0/0) ───

test('deriveNostrKeypair: test vector 1 — privkey', async () => {
  const { privkeyHex } = await deriveNostrKeypair(
    'leader monkey parrot ring guide accident before fence cannon height naive bean',
  );
  assert.equal(privkeyHex, '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a');
});

test('deriveNostrKeypair: test vector 1 — pubkey', async () => {
  const { pubkeyHex } = await deriveNostrKeypair(
    'leader monkey parrot ring guide accident before fence cannon height naive bean',
  );
  assert.equal(pubkeyHex, '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917');
});

test('deriveNostrKeypair: test vector 2 — privkey', async () => {
  const { privkeyHex } = await deriveNostrKeypair(
    'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid',
  );
  assert.equal(privkeyHex, 'b16b703e0f1128fabf2020b01f42792ca40f7313738615d0c7c6ce4107e68d55');
});

test('deriveNostrKeypair: test vector 2 — pubkey', async () => {
  const { pubkeyHex } = await deriveNostrKeypair(
    'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid',
  );
  assert.equal(pubkeyHex, '31abe8e044ed3ba6d411a3ad97e944069483dc938351ab0761dd754e83168683');
});

test('deriveNostrKeypair: same mnemonic always derives same keypair', async () => {
  const mnemonic = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
  const a = await deriveNostrKeypair(mnemonic);
  const b = await deriveNostrKeypair(mnemonic);
  assert.equal(a.privkeyHex, b.privkeyHex);
  assert.equal(a.pubkeyHex, b.pubkeyHex);
});

test('deriveNostrKeypair: different mnemonic produces different keypair', async () => {
  const a = await deriveNostrKeypair('leader monkey parrot ring guide accident before fence cannon height naive bean');
  const b = await deriveNostrKeypair('what bleak badge arrange retreat wolf trade produce cricket blur garlic valid');
  assert.notEqual(a.privkeyHex, b.privkeyHex);
});

test('deriveNostrKeypair: passphrase changes the derived keypair', async () => {
  const mnemonic = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
  const without = await deriveNostrKeypair(mnemonic);
  const withPass = await deriveNostrKeypair(mnemonic, 'passphrase');
  assert.notEqual(without.privkeyHex, withPass.privkeyHex);
});

// ── NIP-06: official test vector 2 (24-word mnemonic) ────────────────────────

const NIP06_V2_MNEMONIC = 'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';
const NIP06_V2_PRIV = 'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add';
const NIP06_V2_PUB  = 'd41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573';

test('deriveNostrKeypair: NIP-06 official 24-word vector — privkey', async () => {
  const { privkeyHex } = await deriveNostrKeypair(NIP06_V2_MNEMONIC);
  assert.equal(privkeyHex, NIP06_V2_PRIV);
});

test('deriveNostrKeypair: NIP-06 official 24-word vector — pubkey', async () => {
  const { pubkeyHex } = await deriveNostrKeypair(NIP06_V2_MNEMONIC);
  assert.equal(pubkeyHex, NIP06_V2_PUB);
});

test('deriveNostrKeypair: result has correct hex format', async () => {
  const { privkeyHex, pubkeyHex } = await deriveNostrKeypair(
    'leader monkey parrot ring guide accident before fence cannon height naive bean',
  );
  assert.match(privkeyHex, /^[0-9a-f]{64}$/);
  assert.match(pubkeyHex, /^[0-9a-f]{64}$/);
});
