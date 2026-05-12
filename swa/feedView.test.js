import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, pubkeyColor, getDisplayName, isOwnEvent, getReplyLabel } from './feedView.js';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

// ── formatTime ────────────────────────────────────────────────────────────────

test('formatTime: shows seconds for timestamps under 1 minute ago', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.match(formatTime(now - 30), /^\d+s ago$/);
});

test('formatTime: shows minutes for timestamps 1–59 minutes ago', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.match(formatTime(now - 120), /^\d+m ago$/);
});

test('formatTime: shows hours for timestamps 1–23 hours ago', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.match(formatTime(now - 7200), /^\d+h ago$/);
});

test('formatTime: shows a date string for timestamps older than 24 hours', () => {
  const now = Math.floor(Date.now() / 1000);
  const result = formatTime(now - 90000);
  assert.ok(typeof result === 'string' && result.length > 0);
  assert.ok(!result.includes('ago'));
});

test('formatTime: 0 seconds ago shows 0s ago', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.match(formatTime(now), /^0s ago$/);
});

// ── pubkeyColor ───────────────────────────────────────────────────────────────

test('pubkeyColor: returns a hex color string', () => {
  assert.match(pubkeyColor(HEX_A), /^#[0-9a-f]{6}$/i);
});

test('pubkeyColor: same pubkey always returns same color', () => {
  assert.equal(pubkeyColor(HEX_A), pubkeyColor(HEX_A));
});

test('pubkeyColor: different pubkeys may return different colors', () => {
  const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', '0', '1'].map(c => pubkeyColor(c.repeat(64))));
  assert.ok(colors.size > 1);
});

// ── getDisplayName ────────────────────────────────────────────────────────────

test('getDisplayName: returns profile.name when set', () => {
  assert.equal(getDisplayName({ name: 'Alice' }, 'fallback'), 'Alice');
});

test('getDisplayName: returns profile.display_name when name is absent', () => {
  assert.equal(getDisplayName({ display_name: 'Alice D' }, 'fallback'), 'Alice D');
});

test('getDisplayName: prefers name over display_name', () => {
  assert.equal(getDisplayName({ name: 'Alice', display_name: 'Alice D' }, 'fallback'), 'Alice');
});

test('getDisplayName: returns fallback when profile is null', () => {
  assert.equal(getDisplayName(null, 'fallback'), 'fallback');
});

test('getDisplayName: returns fallback when profile has no name fields', () => {
  assert.equal(getDisplayName({ about: 'x' }, 'fallback'), 'fallback');
});

// ── isOwnEvent ────────────────────────────────────────────────────────────────

test('isOwnEvent: true when pubkey matches', () => {
  assert.equal(isOwnEvent({ pubkey: HEX_A }, HEX_A), true);
});

test('isOwnEvent: false when pubkey differs', () => {
  assert.equal(isOwnEvent({ pubkey: HEX_A }, HEX_B), false);
});

test('isOwnEvent: false when pubkeyHex is null', () => {
  assert.equal(isOwnEvent({ pubkey: HEX_A }, null), false);
});

test('isOwnEvent: false when pubkeyHex is undefined', () => {
  assert.equal(isOwnEvent({ pubkey: HEX_A }, undefined), false);
});

// ── getReplyLabel ─────────────────────────────────────────────────────────────

test('getReplyLabel: returns null for event with no e or a tags', () => {
  const event = { tags: [] };
  assert.equal(getReplyLabel(event, { events: [], profiles: new Map() }), null);
});

test('getReplyLabel: returns truncated event id when ref event not found', () => {
  const refId = 'f'.repeat(64);
  const event = { tags: [['e', refId, '', 'reply']] };
  const label = getReplyLabel(event, { events: [], profiles: new Map() });
  assert.ok(label.startsWith(refId.slice(0, 12)));
});

test('getReplyLabel: returns profile name when ref event author has a profile', () => {
  const refEvent = { id: 'e'.repeat(64), pubkey: HEX_A, kind: 1, tags: [], content: '' };
  const event = { tags: [['e', refEvent.id, '', 'reply']] };
  const profiles = new Map([[HEX_A, { name: 'Alice' }]]);
  const label = getReplyLabel(event, { events: [refEvent], profiles });
  assert.equal(label, 'Alice');
});

test('getReplyLabel: returns truncated pubkey when ref event found but no profile', () => {
  const refEvent = { id: 'e'.repeat(64), pubkey: HEX_A, kind: 1, tags: [], content: '' };
  const event = { tags: [['e', refEvent.id]] };
  const label = getReplyLabel(event, { events: [refEvent], profiles: new Map() });
  assert.ok(label.startsWith(HEX_A.slice(0, 12)));
});

test('getReplyLabel: uses a tag when no e tags present', () => {
  const event = { tags: [['a', `30000:${HEX_A}:identifier`]] };
  const label = getReplyLabel(event, { events: [], profiles: new Map() });
  assert.ok(typeof label === 'string' && label.length > 0);
});

test('getReplyLabel: uses profile name from a tag pubkey', () => {
  const event = { tags: [['a', `30000:${HEX_A}:identifier`]] };
  const profiles = new Map([[HEX_A, { name: 'Bob' }]]);
  const label = getReplyLabel(event, { events: [], profiles });
  assert.equal(label, 'Bob');
});
