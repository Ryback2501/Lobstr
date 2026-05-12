import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalSigner, ExtensionSigner } from './signer.js';
import { verifyEvent, generateKeypair } from './nostr.js';

// Known keypairs (NIP-06 test vectors)
const ALICE_PRIV = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const ALICE_PUB  = '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917';
const BOB_PUB    = 'd61f3bc5b3eb4400efdae6169a5c17cabf3246b514361de939ce4a1a0da6ef4a';

function draft(overrides = {}) {
  return { created_at: Math.floor(Date.now() / 1000), kind: 1, tags: [], content: 'hello', ...overrides };
}

// ── NIP-07: LocalSigner ───────────────────────────────────────────────────────

test('LocalSigner: init() returns the same instance', async () => {
  const signer = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const result = await signer.init();
  assert.equal(result, signer);
});

test('LocalSigner: pubkeyHex is set from constructor', () => {
  const signer = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  assert.equal(signer.pubkeyHex, ALICE_PUB);
});

test('LocalSigner: signEvent produces a valid event', async () => {
  const signer = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const event = await signer.signEvent(draft());
  assert.equal(verifyEvent(event), true);
});

test('LocalSigner: signEvent sets pubkey to own pubkeyHex', async () => {
  const signer = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const event = await signer.signEvent(draft());
  assert.equal(event.pubkey, ALICE_PUB);
});

test('LocalSigner: signEvent preserves kind, tags, and content from draft', async () => {
  const signer = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const event = await signer.signEvent(draft({ kind: 3, tags: [['p', BOB_PUB]], content: 'follow' }));
  assert.equal(event.kind, 3);
  assert.deepEqual(event.tags, [['p', BOB_PUB]]);
  assert.equal(event.content, 'follow');
});

test('LocalSigner: encrypt then decrypt round-trips plaintext', async () => {
  const alice = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const ciphertext = await alice.encrypt(BOB_PUB, 'secret message');
  const plaintext = await alice.decrypt(BOB_PUB, ciphertext);
  assert.equal(plaintext, 'secret message');
});

test('LocalSigner: encrypt output is decryptable by the other party', async () => {
  const { privkeyHex: aPriv, pubkeyHex: aPub } = generateKeypair();
  const { privkeyHex: bPriv, pubkeyHex: bPub } = generateKeypair();
  const alice = new LocalSigner({ privkeyHex: aPriv, pubkeyHex: aPub });
  const bob   = new LocalSigner({ privkeyHex: bPriv, pubkeyHex: bPub });
  const ciphertext = await alice.encrypt(bPub, 'hello bob');
  const plaintext  = await bob.decrypt(aPub, ciphertext);
  assert.equal(plaintext, 'hello bob');
});

test('LocalSigner and ExtensionSigner both expose init() returning self', async () => {
  const local = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const mockNostr = { getPublicKey: async () => ALICE_PUB };
  const ext = new ExtensionSigner(mockNostr);
  assert.equal(await local.init(), local);
  assert.equal(await ext.init(), ext);
});

// ── NIP-07: ExtensionSigner ───────────────────────────────────────────────────

test('ExtensionSigner: init() calls getPublicKey and sets pubkeyHex', async () => {
  const mockNostr = { getPublicKey: async () => ALICE_PUB };
  const signer = new ExtensionSigner(mockNostr);
  assert.equal(signer.pubkeyHex, null);
  await signer.init();
  assert.equal(signer.pubkeyHex, ALICE_PUB);
});

test('ExtensionSigner: init() throws when extension returns invalid pubkey', async () => {
  const mockNostr = { getPublicKey: async () => 'not-a-valid-hex-key' };
  const signer = new ExtensionSigner(mockNostr);
  await assert.rejects(() => signer.init(), /invalid public key/i);
});

test('ExtensionSigner: signEvent returns the event from the extension', async () => {
  // Use LocalSigner to produce a real signed event for the mock to return
  const local = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const signed = await local.signEvent(draft());

  const mockNostr = {
    getPublicKey: async () => ALICE_PUB,
    signEvent: async () => signed,
  };
  const ext = new ExtensionSigner(mockNostr);
  await ext.init();
  const result = await ext.signEvent(draft());
  assert.equal(result.id, signed.id);
  assert.equal(result.sig, signed.sig);
});

test('ExtensionSigner: signEvent throws when extension returns a different pubkey', async () => {
  const local = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const signed = await local.signEvent(draft());

  const mockNostr = {
    getPublicKey: async () => BOB_PUB,  // init with Bob's key
    signEvent: async () => signed,       // but returns event signed by Alice
  };
  const ext = new ExtensionSigner(mockNostr);
  await ext.init();
  await assert.rejects(() => ext.signEvent(draft()), /different key/i);
});

test('ExtensionSigner: signEvent throws when extension returns invalid signature', async () => {
  const local = new LocalSigner({ privkeyHex: ALICE_PRIV, pubkeyHex: ALICE_PUB });
  const signed = await local.signEvent(draft());
  const tampered = { ...signed, sig: 'f'.repeat(128) };

  const mockNostr = {
    getPublicKey: async () => ALICE_PUB,
    signEvent: async () => tampered,
  };
  const ext = new ExtensionSigner(mockNostr);
  await ext.init();
  await assert.rejects(() => ext.signEvent(draft()), /invalid signature/i);
});

test('ExtensionSigner: encrypt delegates to nostr.nip04.encrypt', async () => {
  const calls = [];
  const mockNostr = {
    getPublicKey: async () => ALICE_PUB,
    nip04: { encrypt: async (pub, pt) => { calls.push({ pub, pt }); return 'ciphertext'; } },
  };
  const ext = new ExtensionSigner(mockNostr);
  await ext.init();
  const result = await ext.encrypt(BOB_PUB, 'hello');
  assert.equal(result, 'ciphertext');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pub, BOB_PUB);
  assert.equal(calls[0].pt, 'hello');
});

test('ExtensionSigner: decrypt delegates to nostr.nip04.decrypt', async () => {
  const calls = [];
  const mockNostr = {
    getPublicKey: async () => ALICE_PUB,
    nip04: { decrypt: async (pub, ct) => { calls.push({ pub, ct }); return 'plaintext'; } },
  };
  const ext = new ExtensionSigner(mockNostr);
  await ext.init();
  const result = await ext.decrypt(BOB_PUB, 'ciphertext');
  assert.equal(result, 'plaintext');
  assert.equal(calls[0].pub, BOB_PUB);
  assert.equal(calls[0].ct, 'ciphertext');
});

test('ExtensionSigner: encrypt throws when nip04 is not available', async () => {
  const mockNostr = { getPublicKey: async () => ALICE_PUB };
  const ext = new ExtensionSigner(mockNostr);
  await ext.init();
  await assert.rejects(() => ext.encrypt(BOB_PUB, 'hello'), /not supported/i);
});

test('ExtensionSigner: decrypt throws when nip04 is not available', async () => {
  const mockNostr = { getPublicKey: async () => ALICE_PUB };
  const ext = new ExtensionSigner(mockNostr);
  await ext.init();
  await assert.rejects(() => ext.decrypt(BOB_PUB, 'ct'), /not supported/i);
});
