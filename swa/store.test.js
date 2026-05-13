import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';

function makeStorage() {
  const data = new Map();
  return {
    getItem:    (k)    => data.get(k) ?? null,
    setItem:    (k, v) => data.set(k, v),
    removeItem: (k)    => data.delete(k),
    _data: data,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1000,
    kind: 1,
    tags: [],
    content: 'hello',
    ...overrides,
  };
}

// ── addEvent: regular kind ────────────────────────────────────────────────────

test('addEvent: adds a regular event and emits eventAdded', () => {
  const store = createStore(makeStorage(), makeStorage());
  const events = [];
  store.on('eventAdded', (d) => events.push(d));
  const e = makeEvent();
  store.addEvent(e);
  assert.equal(store.events.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].event.id, e.id);
});

test('addEvent: deduplicates regular events by id', () => {
  const store = createStore(makeStorage(), makeStorage());
  const e = makeEvent();
  store.addEvent(e);
  store.addEvent(e);
  assert.equal(store.events.length, 1);
});

test('addEvent: inserts events newest-first', () => {
  const store = createStore(makeStorage(), makeStorage());
  const old = makeEvent({ id: '1'.repeat(64), created_at: 100 });
  const newer = makeEvent({ id: '2'.repeat(64), created_at: 200 });
  store.addEvent(old);
  store.addEvent(newer);
  assert.equal(store.events[0].id, newer.id);
  assert.equal(store.events[1].id, old.id);
});

test('addEvent: emits correct insertIdx', () => {
  const store = createStore(makeStorage(), makeStorage());
  const idxs = [];
  store.on('eventAdded', ({ insertIdx }) => idxs.push(insertIdx));
  store.addEvent(makeEvent({ id: '1'.repeat(64), created_at: 100 }));
  store.addEvent(makeEvent({ id: '2'.repeat(64), created_at: 200 }));
  assert.equal(idxs[0], 0);
  assert.equal(idxs[1], 0); // newer prepended
});

test('addEvent: drops ephemeral events silently', () => {
  const store = createStore(makeStorage(), makeStorage());
  const called = [];
  store.on('eventAdded', () => called.push(1));
  store.addEvent(makeEvent({ kind: 20000 }));
  assert.equal(store.events.length, 0);
  assert.equal(called.length, 0);
});

test('addEvent: caps events at 200', () => {
  const store = createStore(makeStorage(), makeStorage());
  for (let i = 0; i < 201; i++) {
    store.addEvent(makeEvent({ id: String(i).padStart(64, '0'), created_at: i }));
  }
  assert.equal(store.events.length, 200);
});

// ── addEvent: replaceable kind ────────────────────────────────────────────────

test('addEvent: replaces older replaceable event from same pubkey+kind', () => {
  const store = createStore(makeStorage(), makeStorage());
  const old = makeEvent({ id: '1'.repeat(64), kind: 0, created_at: 100 });
  const newer = makeEvent({ id: '2'.repeat(64), kind: 0, created_at: 200 });
  store.addEvent(old);
  store.addEvent(newer);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, newer.id);
});

test('addEvent: ignores newer-or-equal replaceable when older already stored', () => {
  const store = createStore(makeStorage(), makeStorage());
  const a = makeEvent({ id: '1'.repeat(64), kind: 0, created_at: 200 });
  const b = makeEvent({ id: '2'.repeat(64), kind: 0, created_at: 100 });
  store.addEvent(a);
  store.addEvent(b);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, a.id);
});

test('addEvent: kind 3 (follow list) is replaceable', () => {
  const store = createStore(makeStorage(), makeStorage());
  const a = makeEvent({ id: '1'.repeat(64), kind: 3, created_at: 100 });
  const b = makeEvent({ id: '2'.repeat(64), kind: 3, created_at: 200 });
  store.addEvent(a);
  store.addEvent(b);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, b.id);
});

test('addEvent: kind 10000 is replaceable', () => {
  const store = createStore(makeStorage(), makeStorage());
  const a = makeEvent({ id: '1'.repeat(64), kind: 10000, created_at: 100 });
  const b = makeEvent({ id: '2'.repeat(64), kind: 10000, created_at: 200 });
  store.addEvent(a);
  store.addEvent(b);
  assert.equal(store.events.length, 1);
});

test('addEvent: replaces replaceable event when timestamps tie and incoming id is lexically lower', () => {
  const store = createStore(makeStorage(), makeStorage());
  const stored  = makeEvent({ id: 'b'.repeat(64), kind: 0, created_at: 100 });
  const incoming = makeEvent({ id: 'a'.repeat(64), kind: 0, created_at: 100 });
  store.addEvent(stored);
  store.addEvent(incoming);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, 'a'.repeat(64));
});

test('addEvent: keeps stored replaceable event when timestamps tie and stored id is lexically lower', () => {
  const store = createStore(makeStorage(), makeStorage());
  const stored  = makeEvent({ id: 'a'.repeat(64), kind: 0, created_at: 100 });
  const incoming = makeEvent({ id: 'b'.repeat(64), kind: 0, created_at: 100 });
  store.addEvent(stored);
  store.addEvent(incoming);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, 'a'.repeat(64));
});

// ── addEvent: addressable kind ────────────────────────────────────────────────

test('addEvent: replaces addressable event with same pubkey+kind+d-tag', () => {
  const store = createStore(makeStorage(), makeStorage());
  const a = makeEvent({ id: '1'.repeat(64), kind: 30000, tags: [['d', 'x']], created_at: 100 });
  const b = makeEvent({ id: '2'.repeat(64), kind: 30000, tags: [['d', 'x']], created_at: 200 });
  store.addEvent(a);
  store.addEvent(b);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, b.id);
});

test('addEvent: keeps distinct addressable events with different d-tags', () => {
  const store = createStore(makeStorage(), makeStorage());
  const a = makeEvent({ id: '1'.repeat(64), kind: 30000, tags: [['d', 'x']], created_at: 100 });
  const b = makeEvent({ id: '2'.repeat(64), kind: 30000, tags: [['d', 'y']], created_at: 100 });
  store.addEvent(a);
  store.addEvent(b);
  assert.equal(store.events.length, 2);
});

test('addEvent: replaces addressable event when timestamps tie and incoming id is lexically lower', () => {
  const store = createStore(makeStorage(), makeStorage());
  const stored   = makeEvent({ id: 'b'.repeat(64), kind: 30000, tags: [['d', 'x']], created_at: 100 });
  const incoming = makeEvent({ id: 'a'.repeat(64), kind: 30000, tags: [['d', 'x']], created_at: 100 });
  store.addEvent(stored);
  store.addEvent(incoming);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, 'a'.repeat(64));
});

test('addEvent: keeps stored addressable event when timestamps tie and stored id is lexically lower', () => {
  const store = createStore(makeStorage(), makeStorage());
  const stored   = makeEvent({ id: 'a'.repeat(64), kind: 30000, tags: [['d', 'x']], created_at: 100 });
  const incoming = makeEvent({ id: 'b'.repeat(64), kind: 30000, tags: [['d', 'x']], created_at: 100 });
  store.addEvent(stored);
  store.addEvent(incoming);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].id, 'a'.repeat(64));
});

// ── removeEvent ───────────────────────────────────────────────────────────────

test('removeEvent: removes by id and emits eventRemoved', () => {
  const store = createStore(makeStorage(), makeStorage());
  const removed = [];
  store.on('eventRemoved', (id) => removed.push(id));
  const e = makeEvent();
  store.addEvent(e);
  store.removeEvent(e.id);
  assert.equal(store.events.length, 0);
  assert.equal(removed[0], e.id);
});

test('removeEvent: noop for unknown id', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.on('eventRemoved', () => { throw new Error('should not fire'); });
  store.removeEvent('z'.repeat(64));
});

// ── removeAddressableEvent ────────────────────────────────────────────────────

test('removeAddressableEvent: removes matching addressable event and emits eventRemoved', () => {
  const store = createStore(makeStorage(), makeStorage());
  const removed = [];
  store.on('eventRemoved', (id) => removed.push(id));
  const e = makeEvent({ kind: 30023, tags: [['d', 'my-article']] });
  store.addEvent(e);
  store.removeAddressableEvent(30023, e.pubkey, 'my-article');
  assert.equal(store.events.length, 0);
  assert.equal(removed[0], e.id);
});

test('removeAddressableEvent: noop when kind does not match', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.on('eventRemoved', () => { throw new Error('should not fire'); });
  const e = makeEvent({ kind: 30023, tags: [['d', 'slug']] });
  store.addEvent(e);
  store.removeAddressableEvent(30024, e.pubkey, 'slug');
  assert.equal(store.events.length, 1);
});

test('removeAddressableEvent: noop when pubkey does not match', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.on('eventRemoved', () => { throw new Error('should not fire'); });
  const e = makeEvent({ kind: 30023, pubkey: 'a'.repeat(64), tags: [['d', 'slug']] });
  store.addEvent(e);
  store.removeAddressableEvent(30023, 'b'.repeat(64), 'slug');
  assert.equal(store.events.length, 1);
});

test('removeAddressableEvent: noop when d-tag value does not match', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.on('eventRemoved', () => { throw new Error('should not fire'); });
  const e = makeEvent({ kind: 30023, tags: [['d', 'slug-a']] });
  store.addEvent(e);
  store.removeAddressableEvent(30023, e.pubkey, 'slug-b');
  assert.equal(store.events.length, 1);
});

test('removeAddressableEvent: matches event with empty d-tag when called with empty string', () => {
  const store = createStore(makeStorage(), makeStorage());
  const removed = [];
  store.on('eventRemoved', (id) => removed.push(id));
  const e = makeEvent({ kind: 30000, tags: [] });
  store.addEvent(e);
  store.removeAddressableEvent(30000, e.pubkey, '');
  assert.equal(store.events.length, 0);
  assert.equal(removed[0], e.id);
});

// ── clearEvents ───────────────────────────────────────────────────────────────

test('clearEvents: empties events array and emits', () => {
  const store = createStore(makeStorage(), makeStorage());
  const called = [];
  store.on('events', () => called.push(1));
  store.addEvent(makeEvent());
  store.clearEvents();
  assert.equal(store.events.length, 0);
  assert.equal(called.length, 1);
});

// ── setAttestation ────────────────────────────────────────────────────────────

test('setAttestation: stores and emits on first write', () => {
  const store = createStore(makeStorage(), makeStorage());
  const fired = [];
  store.on('attestation', (id) => fired.push(id));
  store.setAttestation('event1', 'rawdata');
  assert.ok(store.attestations.has('event1'));
  assert.equal(fired.length, 1);
});

test('setAttestation: first write wins, subsequent ignored', () => {
  const store = createStore(makeStorage(), makeStorage());
  const fired = [];
  store.on('attestation', () => fired.push(1));
  store.setAttestation('event1', 'first');
  store.setAttestation('event1', 'second');
  assert.equal(store.attestations.get('event1').raw, 'first');
  assert.equal(fired.length, 1);
});

// ── follows ───────────────────────────────────────────────────────────────────

test('setFollows: replaces follow list and updates followedPubkeys', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.setFollows([{ pubkey: 'a'.repeat(64), relay: '', petname: '' }]);
  assert.equal(store.follows.length, 1);
  assert.ok(store.followedPubkeys.has('a'.repeat(64)));
});

test('addFollow: adds entry and prevents duplicate', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.addFollow({ pubkey: 'a'.repeat(64), relay: '', petname: '' });
  store.addFollow({ pubkey: 'a'.repeat(64), relay: '', petname: '' });
  assert.equal(store.follows.length, 1);
});

test('removeFollow: removes by pubkey and updates followedPubkeys', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.addFollow({ pubkey: 'a'.repeat(64), relay: '', petname: '' });
  store.removeFollow('a'.repeat(64));
  assert.equal(store.follows.length, 0);
  assert.equal(store.followedPubkeys.has('a'.repeat(64)), false);
});

// ── setSigner + storage ───────────────────────────────────────────────────────

test('setSigner: persists privkeyHex to session storage', () => {
  const ss = makeStorage();
  const store = createStore(makeStorage(), ss);
  store.setSigner({ privkeyHex: 'aa'.repeat(32), pubkeyHex: 'bb'.repeat(32) });
  assert.equal(ss.getItem('privkeyHex'), 'aa'.repeat(32));
});

test('setSigner: removes privkeyHex from session storage on null', () => {
  const ss = makeStorage();
  const store = createStore(makeStorage(), ss);
  store.setSigner({ privkeyHex: 'aa'.repeat(32), pubkeyHex: 'bb'.repeat(32) });
  store.setSigner(null);
  assert.equal(ss.getItem('privkeyHex'), null);
});

test('setSigner: resets dms and dmDecrypted', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.setSigner({ privkeyHex: 'aa'.repeat(32), pubkeyHex: 'bb'.repeat(32) });
  store.dms.push(makeEvent({ kind: 4 }));
  store.setSigner({ privkeyHex: 'cc'.repeat(32), pubkeyHex: 'dd'.repeat(32) });
  assert.equal(store.dms.length, 0);
});

// ── setRelayUrls + localStorage ───────────────────────────────────────────────

test('setRelayUrls: persists to local storage', () => {
  const ls = makeStorage();
  const store = createStore(ls, makeStorage());
  store.setRelayUrls(['wss://example.com']);
  assert.equal(ls.getItem('relayUrls'), JSON.stringify(['wss://example.com']));
});

test('createStore: reads relayUrls from local storage on init', () => {
  const ls = makeStorage();
  ls.setItem('relayUrls', JSON.stringify(['wss://preloaded.com']));
  const store = createStore(ls, makeStorage());
  assert.deepEqual(store.relayUrls, ['wss://preloaded.com']);
});

// ── mentions ──────────────────────────────────────────────────────────────────

test('addMention: deduplicates by id', () => {
  const store = createStore(makeStorage(), makeStorage());
  const e = makeEvent({ kind: 1 });
  store.addMention(e);
  store.addMention(e);
  assert.equal(store.mentions.length, 1);
});

test('clearMentions: empties and emits', () => {
  const store = createStore(makeStorage(), makeStorage());
  const called = [];
  store.on('mentions', () => called.push(1));
  store.addMention(makeEvent());
  store.clearMentions();
  assert.equal(store.mentions.length, 0);
  assert.equal(called.length, 2); // one from addMention, one from clear
});

// ── DMs ───────────────────────────────────────────────────────────────────────

test('addDm: deduplicates by id', () => {
  const store = createStore(makeStorage(), makeStorage());
  store.setSigner({ privkeyHex: 'aa'.repeat(32), pubkeyHex: 'bb'.repeat(32) });
  const e = makeEvent({ kind: 4 });
  store.addDm(e);
  store.addDm(e);
  assert.equal(store.dms.length, 1);
});

test('setDmDecrypted: stores plaintext and emits', () => {
  const store = createStore(makeStorage(), makeStorage());
  const fired = [];
  store.on('dmDecrypted', (id) => fired.push(id));
  store.setDmDecrypted('event1', 'hello');
  assert.equal(store.dmDecrypted.get('event1'), 'hello');
  assert.equal(fired[0], 'event1');
});
