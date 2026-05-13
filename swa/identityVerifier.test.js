import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdentity } from './identityVerifier.js';

const PUBKEY = '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917';

function makeFetcher(status, body) {
  return async (url) => ({
    ok: status >= 200 && status < 300,
    json: async () => body,
    _url: url,
  });
}

// ── NIP-05: verifyIdentity ────────────────────────────────────────────────────

test('verifyIdentity: calls onVerified when server returns matching pubkey', async () => {
  const called = [];
  const fetcher = makeFetcher(200, { names: { alice: PUBKEY } });
  await verifyIdentity(PUBKEY, 'alice@example.com', (...args) => called.push(args), fetcher);
  assert.equal(called.length, 1);
  assert.equal(called[0][0], PUBKEY);
  assert.equal(called[0][1], 'alice@example.com');
});

test('verifyIdentity: does not call onVerified when pubkey does not match', async () => {
  const called = [];
  const fetcher = makeFetcher(200, { names: { alice: 'a'.repeat(64) } });
  await verifyIdentity(PUBKEY, 'alice@example.com', () => called.push(1), fetcher);
  assert.equal(called.length, 0);
});

test('verifyIdentity: does not call onVerified on HTTP error', async () => {
  const called = [];
  const fetcher = makeFetcher(404, {});
  await verifyIdentity(PUBKEY, 'alice@example.com', () => called.push(1), fetcher);
  assert.equal(called.length, 0);
});

test('verifyIdentity: does not call onVerified when fetch throws', async () => {
  const called = [];
  const fetcher = async () => { throw new Error('network error'); };
  await verifyIdentity(PUBKEY, 'alice@example.com', () => called.push(1), fetcher);
  assert.equal(called.length, 0);
});

test('verifyIdentity: does not call onVerified when names key is absent', async () => {
  const called = [];
  const fetcher = makeFetcher(200, { names: {} });
  await verifyIdentity(PUBKEY, 'alice@example.com', () => called.push(1), fetcher);
  assert.equal(called.length, 0);
});

test('verifyIdentity: does not call onVerified when identifier has no @', async () => {
  const called = [];
  await verifyIdentity(PUBKEY, 'nodomain', () => called.push(1));
  assert.equal(called.length, 0);
});

test('verifyIdentity: does not call onVerified when @ is the first character', async () => {
  const called = [];
  await verifyIdentity(PUBKEY, '@example.com', () => called.push(1));
  assert.equal(called.length, 0);
});

test('verifyIdentity: constructs correct well-known URL with name param', async () => {
  let capturedUrl = null;
  const fetcher = async (url) => { capturedUrl = url; return { ok: false }; };
  await verifyIdentity(PUBKEY, 'alice@example.com', () => {}, fetcher);
  assert.ok(capturedUrl.startsWith('https://example.com/.well-known/nostr.json'));
  assert.ok(capturedUrl.includes('name=alice'));
});

test('verifyIdentity: is case-insensitive for pubkey comparison', async () => {
  const called = [];
  const fetcher = makeFetcher(200, { names: { alice: PUBKEY.toUpperCase() } });
  await verifyIdentity(PUBKEY, 'alice@example.com', () => called.push(1), fetcher);
  assert.equal(called.length, 1);
});

test('verifyIdentity: lowercases the local part when building the URL', async () => {
  let capturedUrl = null;
  const fetcher = async (url) => { capturedUrl = url; return { ok: false }; };
  await verifyIdentity(PUBKEY, 'Alice@Example.COM', () => {}, fetcher);
  assert.ok(capturedUrl.includes('name=alice'));
  assert.ok(capturedUrl.includes('example.com'));
});

// ── NIP-05: local-part character validation ───────────────────────────────────

test('verifyIdentity: does not call onVerified when local-part contains invalid characters', async () => {
  const called = [];
  await verifyIdentity(PUBKEY, 'alice+test@example.com', () => called.push(1));
  assert.equal(called.length, 0);
});

test('verifyIdentity: does not call onVerified when local-part contains a dot', async () => {
  const called = [];
  await verifyIdentity(PUBKEY, 'alice.bob@example.com', () => called.push(1));
  assert.equal(called.length, 0);
});

test('verifyIdentity: accepts local-part with allowed characters (letters, digits, _, -)', async () => {
  const called = [];
  const fetcher = makeFetcher(200, { names: { 'alice-test_1': PUBKEY } });
  await verifyIdentity(PUBKEY, 'alice-test_1@example.com', () => called.push(1), fetcher);
  assert.equal(called.length, 1);
});

// ── NIP-05: _ wildcard (root identifier) ─────────────────────────────────────

test('verifyIdentity: verifies _@domain root identifier', async () => {
  const called = [];
  const fetcher = makeFetcher(200, { names: { _: PUBKEY } });
  await verifyIdentity(PUBKEY, '_@example.com', (...args) => called.push(args), fetcher);
  assert.equal(called.length, 1);
  assert.equal(called[0][0], PUBKEY);
  assert.equal(called[0][1], '_@example.com');
});

test('verifyIdentity: uses _ as name query parameter for root identifier', async () => {
  let capturedUrl = null;
  const fetcher = async (url) => { capturedUrl = url; return { ok: false }; };
  await verifyIdentity(PUBKEY, '_@example.com', () => {}, fetcher);
  assert.ok(capturedUrl.includes('name=_'));
});
