import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDeletionTargetIds, findAuthorizedDeletions } from './deletions.js';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function deletion(author, eTags) {
  return { id: 'd'.repeat(64), pubkey: author, kind: 5, tags: eTags.map(id => ['e', id]), content: '' };
}

function note(author, id) {
  return { id, pubkey: author, kind: 1, tags: [], content: 'hi' };
}

test('extractDeletionTargetIds: returns ids from e tags', () => {
  const ev = deletion(ALICE, ['1', '2', '3']);
  assert.deepEqual(extractDeletionTargetIds(ev), ['1', '2', '3']);
});

test('extractDeletionTargetIds: ignores non-e tags', () => {
  const ev = { id: 'x', pubkey: ALICE, kind: 5, tags: [['e', '1'], ['k', '1'], ['p', BOB]], content: '' };
  assert.deepEqual(extractDeletionTargetIds(ev), ['1']);
});

test('extractDeletionTargetIds: drops empty or missing target ids', () => {
  const ev = { id: 'x', pubkey: ALICE, kind: 5, tags: [['e'], ['e', ''], ['e', 'valid']], content: '' };
  assert.deepEqual(extractDeletionTargetIds(ev), ['valid']);
});

test('findAuthorizedDeletions: returns ids of matching same-author events', () => {
  const del = deletion(ALICE, ['note-1', 'note-2']);
  const candidates = [note(ALICE, 'note-1'), note(ALICE, 'note-2')];
  assert.deepEqual(findAuthorizedDeletions(del, candidates), ['note-1', 'note-2']);
});

test('findAuthorizedDeletions: drops target whose author differs from deletion author', () => {
  const del = deletion(ALICE, ['bob-note']);
  const candidates = [note(BOB, 'bob-note')];
  assert.deepEqual(findAuthorizedDeletions(del, candidates), []);
});

test('findAuthorizedDeletions: ignores unrelated events', () => {
  const del = deletion(ALICE, ['note-1']);
  const candidates = [note(ALICE, 'note-1'), note(ALICE, 'note-2')];
  assert.deepEqual(findAuthorizedDeletions(del, candidates), ['note-1']);
});

test('findAuthorizedDeletions: handles mixed authorship correctly', () => {
  const del = deletion(ALICE, ['alice-note', 'bob-note']);
  const candidates = [note(ALICE, 'alice-note'), note(BOB, 'bob-note')];
  assert.deepEqual(findAuthorizedDeletions(del, candidates), ['alice-note']);
});

test('findAuthorizedDeletions: deduplicates ids across candidate lists', () => {
  const del = deletion(ALICE, ['note-1']);
  const candidates = [note(ALICE, 'note-1'), note(ALICE, 'note-1')];
  assert.deepEqual(findAuthorizedDeletions(del, candidates), ['note-1']);
});

test('findAuthorizedDeletions: returns empty when no targets', () => {
  const del = { id: 'x', pubkey: ALICE, kind: 5, tags: [], content: '' };
  const candidates = [note(ALICE, 'note-1')];
  assert.deepEqual(findAuthorizedDeletions(del, candidates), []);
});
