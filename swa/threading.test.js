import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReplyTag, buildReplyTags, buildMentionEvent } from './threading.js';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);

// ── resolveReplyTag ──────────────────────────────────────────────────────────

test('resolveReplyTag: returns null for empty array', () => {
  assert.equal(resolveReplyTag([]), null);
});

test('resolveReplyTag: prefers reply marker over root', () => {
  const eTags = [['e', 'root-id', '', 'root'], ['e', 'reply-id', '', 'reply']];
  assert.deepEqual(resolveReplyTag(eTags), ['e', 'reply-id', '', 'reply']);
});

test('resolveReplyTag: falls back to root marker when no reply marker', () => {
  const eTags = [['e', 'root-id', '', 'root']];
  assert.deepEqual(resolveReplyTag(eTags), ['e', 'root-id', '', 'root']);
});

test('resolveReplyTag: falls back to last positional tag when no markers', () => {
  const eTags = [['e', 'first-id'], ['e', 'last-id']];
  assert.deepEqual(resolveReplyTag(eTags), ['e', 'last-id']);
});

test('resolveReplyTag: single positional tag returns that tag', () => {
  const eTags = [['e', 'only-id']];
  assert.deepEqual(resolveReplyTag(eTags), ['e', 'only-id']);
});

// ── buildReplyTags ───────────────────────────────────────────────────────────

test('buildReplyTags: direct reply to root emits single root e tag', () => {
  const parent = { id: 'abc', pubkey: HEX_A, tags: [] };
  const tags = buildReplyTags(parent, HEX_C);
  assert.deepEqual(tags, [
    ['e', 'abc', '', 'root'],
    ['p', HEX_A],
  ]);
});

test('buildReplyTags: reply to reply emits root + reply e tags', () => {
  const parent = {
    id: 'reply-id',
    pubkey: HEX_B,
    tags: [['e', 'root-id', '', 'root'], ['p', HEX_A]],
  };
  const tags = buildReplyTags(parent, HEX_C);
  assert.deepEqual(tags, [
    ['e', 'root-id', '', 'root'],
    ['e', 'reply-id', '', 'reply'],
    ['p', HEX_B],
    ['p', HEX_A],
  ]);
});

test('buildReplyTags: preserves relay hint from parent root tag', () => {
  const parent = {
    id: 'reply-id',
    pubkey: HEX_B,
    tags: [['e', 'root-id', 'wss://relay.example.com', 'root']],
  };
  const tags = buildReplyTags(parent, HEX_C);
  assert.equal(tags[0][2], 'wss://relay.example.com');
});

test('buildReplyTags: positional parent tags use first e tag as root', () => {
  const parent = {
    id: 'reply-id',
    pubkey: HEX_B,
    tags: [['e', 'root-id'], ['e', 'other-id']],
  };
  const tags = buildReplyTags(parent, HEX_C);
  assert.deepEqual(tags.slice(0, 2), [
    ['e', 'root-id', '', 'root'],
    ['e', 'reply-id', '', 'reply'],
  ]);
});

test('buildReplyTags: excludes own pubkey from p tags', () => {
  const parent = { id: 'abc', pubkey: HEX_A, tags: [] };
  const tags = buildReplyTags(parent, HEX_A);
  assert.deepEqual(tags, [['e', 'abc', '', 'root']]);
});

test('buildReplyTags: no myPubkey keeps all participants', () => {
  const parent = { id: 'abc', pubkey: HEX_A, tags: [] };
  const tags = buildReplyTags(parent);
  assert.deepEqual(tags, [['e', 'abc', '', 'root'], ['p', HEX_A]]);
});

test('buildReplyTags: deduplicates participants already in parent p tags', () => {
  const parent = {
    id: 'reply-id',
    pubkey: HEX_A,
    tags: [['e', 'root-id', '', 'root'], ['p', HEX_A]],
  };
  const tags = buildReplyTags(parent, HEX_C);
  const pTags = tags.filter(t => t[0] === 'p');
  assert.equal(pTags.length, 1);
  assert.equal(pTags[0][1], HEX_A);
});

// ── buildMentionEvent ────────────────────────────────────────────────────────

test('buildMentionEvent: no mentions returns content unchanged with no tags', () => {
  const result = buildMentionEvent('hello world');
  assert.equal(result.content, 'hello world');
  assert.deepEqual(result.tags, []);
});

test('buildMentionEvent: single mention replaced with #[0]', () => {
  const result = buildMentionEvent(`hello @${HEX_A}`);
  assert.equal(result.content, 'hello #[0]');
  assert.deepEqual(result.tags, [['p', HEX_A]]);
});

test('buildMentionEvent: tagOffset shifts all indices', () => {
  const result = buildMentionEvent(`@${HEX_A} @${HEX_B}`, 2);
  assert.equal(result.content, '#[2] #[3]');
  assert.deepEqual(result.tags, [['p', HEX_A], ['p', HEX_B]]);
});

test('buildMentionEvent: duplicate mentions reuse same index', () => {
  const result = buildMentionEvent(`@${HEX_A} and @${HEX_A} again`);
  assert.equal(result.content, '#[0] and #[0] again');
  assert.deepEqual(result.tags, [['p', HEX_A]]);
});

test('buildMentionEvent: multiple distinct mentions get sequential indices', () => {
  const result = buildMentionEvent(`@${HEX_A} @${HEX_B}`);
  assert.equal(result.content, '#[0] #[1]');
  assert.deepEqual(result.tags, [['p', HEX_A], ['p', HEX_B]]);
});

test('buildMentionEvent: mention matching is case-insensitive, stored lowercase', () => {
  const result = buildMentionEvent(`@${HEX_A.toUpperCase()}`);
  assert.equal(result.content, '#[0]');
  assert.deepEqual(result.tags, [['p', HEX_A]]);
});

test('buildMentionEvent: non-hex or short patterns are not replaced', () => {
  const result = buildMentionEvent('@notahex @tooshort');
  assert.equal(result.content, '@notahex @tooshort');
  assert.deepEqual(result.tags, []);
});

test('buildMentionEvent: event-ID mention produces e tag when id is in eventIds set', () => {
  const result = buildMentionEvent(`quoting @${HEX_A}`, 0, new Set([HEX_A]));
  assert.equal(result.content, 'quoting #[0]');
  assert.deepEqual(result.tags, [['e', HEX_A]]);
});

test('buildMentionEvent: mixes p and e tags when some hexes are event IDs', () => {
  const result = buildMentionEvent(`@${HEX_A} @${HEX_B}`, 0, new Set([HEX_B]));
  assert.equal(result.content, '#[0] #[1]');
  assert.deepEqual(result.tags, [['p', HEX_A], ['e', HEX_B]]);
});

test('buildMentionEvent: duplicate event-ID mention reuses same index', () => {
  const result = buildMentionEvent(`@${HEX_A} and @${HEX_A}`, 0, new Set([HEX_A]));
  assert.equal(result.content, '#[0] and #[0]');
  assert.deepEqual(result.tags, [['e', HEX_A]]);
});
