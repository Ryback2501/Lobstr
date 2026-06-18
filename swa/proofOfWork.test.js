import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEvent, getEventId } from './nostr.js';
import { countLeadingZeroBits, getEventDifficulty, mineProofOfWork } from './proofOfWork.js';

// Known test keypair (from NIP-06 test vectors)
const ALICE_PUB = '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917';

// ── countLeadingZeroBits ──────────────────────────────────────────────────────

test('countLeadingZeroBits: returns 0 when the first nibble is non-zero', () => {
  assert.equal(countLeadingZeroBits('f'.repeat(64)), 0);
});

test('countLeadingZeroBits: counts a single leading zero nibble as 4 bits', () => {
  assert.equal(countLeadingZeroBits('0fffffff'), 4);
});

test('countLeadingZeroBits: counts a leading zero byte as 8 bits', () => {
  assert.equal(countLeadingZeroBits('00ffffff'), 8);
});

test('countLeadingZeroBits: matches the NIP-13 worked example (36 bits)', () => {
  assert.equal(countLeadingZeroBits('000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d'), 36);
});

test('countLeadingZeroBits: counts within a partially-zero nibble', () => {
  // 0x1 = 0b0001 → 3 leading zero bits
  assert.equal(countLeadingZeroBits('1fffffff'), 3);
});

test('countLeadingZeroBits: an all-zero id has every bit zero', () => {
  assert.equal(countLeadingZeroBits('0'.repeat(64)), 256);
});

// ── getEventDifficulty ────────────────────────────────────────────────────────

test('getEventDifficulty: derives difficulty from the event id', () => {
  assert.equal(getEventDifficulty({ id: '00ff' + 'a'.repeat(60) }), 8);
});

// ── mineProofOfWork ───────────────────────────────────────────────────────────

test('mineProofOfWork: produces tags whose id meets the target difficulty', () => {
  const difficulty = 8;
  const tags = mineProofOfWork({
    pubkeyHex: ALICE_PUB, createdAt: 1700000000, kind: 1, tags: [], content: 'hi', difficulty,
  });
  const id = getEventId(serializeEvent(ALICE_PUB, 1700000000, 1, tags, 'hi'));
  assert.ok(countLeadingZeroBits(id) >= difficulty);
});

test('mineProofOfWork: appends a nonce tag committing the target difficulty', () => {
  const tags = mineProofOfWork({
    pubkeyHex: ALICE_PUB, createdAt: 1700000000, kind: 1, tags: [], content: 'hi', difficulty: 8,
  });
  const nonceTag = tags.find(t => t[0] === 'nonce');
  assert.ok(nonceTag, 'expected a nonce tag');
  assert.equal(nonceTag[2], '8');
  assert.match(nonceTag[1], /^\d+$/);
});

test('mineProofOfWork: preserves the base tags', () => {
  const tags = mineProofOfWork({
    pubkeyHex: ALICE_PUB, createdAt: 1700000000, kind: 1, tags: [['t', 'x']], content: 'hi', difficulty: 4,
  });
  assert.deepEqual(tags[0], ['t', 'x']);
});

test('mineProofOfWork: does not mutate the supplied base tags', () => {
  const base = [['t', 'x']];
  mineProofOfWork({ pubkeyHex: ALICE_PUB, createdAt: 1700000000, kind: 1, tags: base, content: 'hi', difficulty: 4 });
  assert.deepEqual(base, [['t', 'x']]);
});

test('mineProofOfWork: difficulty 0 returns immediately with a nonce tag', () => {
  const tags = mineProofOfWork({
    pubkeyHex: ALICE_PUB, createdAt: 1700000000, kind: 1, tags: [], content: 'hi', difficulty: 0,
  });
  const nonceTag = tags.find(t => t[0] === 'nonce');
  assert.ok(nonceTag);
  assert.equal(nonceTag[2], '0');
});
