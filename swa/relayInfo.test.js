import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRelayInfo } from './relayInfo.js';

function makeFetcher(body, { status = 200, ok = true } = {}) {
  return async () => ({
    ok,
    status,
    json: async () => JSON.parse(body),
  });
}

// ── URL conversion ────────────────────────────────────────────────────────────

test('fetchRelayInfo: converts wss:// to https://', async () => {
  let calledUrl;
  const fetcher = async (url) => {
    calledUrl = url;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await fetchRelayInfo('wss://relay.example.com', fetcher);
  assert.equal(calledUrl, 'https://relay.example.com');
});

test('fetchRelayInfo: converts ws:// to http://', async () => {
  let calledUrl;
  const fetcher = async (url) => {
    calledUrl = url;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await fetchRelayInfo('ws://relay.example.com', fetcher);
  assert.equal(calledUrl, 'http://relay.example.com');
});

// ── Accept header ─────────────────────────────────────────────────────────────

test('fetchRelayInfo: sends Accept: application/nostr+json header', async () => {
  let calledHeaders;
  const fetcher = async (_url, opts) => {
    calledHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await fetchRelayInfo('wss://relay.example.com', fetcher);
  assert.equal(calledHeaders['Accept'], 'application/nostr+json');
});

// ── Successful responses ──────────────────────────────────────────────────────

test('fetchRelayInfo: returns parsed JSON object on success', async () => {
  const doc = { name: 'Test Relay', description: 'A test relay', supported_nips: [1, 11] };
  const info = await fetchRelayInfo('wss://relay.example.com', makeFetcher(JSON.stringify(doc)));
  assert.deepEqual(info, doc);
});

test('fetchRelayInfo: returns empty object when relay sends no fields', async () => {
  const info = await fetchRelayInfo('wss://relay.example.com', makeFetcher('{}'));
  assert.deepEqual(info, {});
});

test('fetchRelayInfo: passes through unknown extra fields without modification', async () => {
  const doc = { name: 'Relay', future_field: 'value', nested: { a: 1 } };
  const info = await fetchRelayInfo('wss://relay.example.com', makeFetcher(JSON.stringify(doc)));
  assert.equal(info.future_field, 'value');
  assert.deepEqual(info.nested, { a: 1 });
});

// ── Error handling ────────────────────────────────────────────────────────────

test('fetchRelayInfo: throws when relay returns non-200 status', async () => {
  await assert.rejects(
    () => fetchRelayInfo('wss://relay.example.com', makeFetcher('', { status: 404, ok: false })),
    /404/,
  );
});

test('fetchRelayInfo: throws when fetch rejects (network error)', async () => {
  const fetcher = async () => { throw new Error('Network error'); };
  await assert.rejects(() => fetchRelayInfo('wss://relay.example.com', fetcher), /Network error/);
});

test('fetchRelayInfo: throws when response body is not a JSON object (array)', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => [1, 2, 3] });
  await assert.rejects(
    () => fetchRelayInfo('wss://relay.example.com', fetcher),
    /not a JSON object/,
  );
});

test('fetchRelayInfo: throws when response body is not a JSON object (string)', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => 'bad' });
  await assert.rejects(
    () => fetchRelayInfo('wss://relay.example.com', fetcher),
    /not a JSON object/,
  );
});

test('fetchRelayInfo: throws when fetch times out (AbortError)', async () => {
  const abortFetcher = async () => { throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(() => fetchRelayInfo('wss://relay.example.com', abortFetcher), /Aborted/);
});
