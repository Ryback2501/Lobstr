import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDmContact, aggregateDmContacts } from './dms.js';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);

function dmEvent({ from, to, created_at, id }) {
  return { id, pubkey: from, created_at, kind: 4, tags: [['p', to]], content: '' };
}

test('getDmContact: returns null when myPubkey is missing', () => {
  assert.equal(getDmContact(dmEvent({ from: BOB, to: ME, created_at: 1, id: 'x' }), null), null);
});

test('getDmContact: incoming event returns sender', () => {
  const e = dmEvent({ from: BOB, to: ME, created_at: 1, id: 'x' });
  assert.equal(getDmContact(e, ME), BOB);
});

test('getDmContact: outgoing event returns first p-tag', () => {
  const e = dmEvent({ from: ME, to: BOB, created_at: 1, id: 'x' });
  assert.equal(getDmContact(e, ME), BOB);
});

test('getDmContact: outgoing event with no p-tag returns null', () => {
  const e = { id: 'x', pubkey: ME, created_at: 1, kind: 4, tags: [], content: '' };
  assert.equal(getDmContact(e, ME), null);
});

test('aggregateDmContacts: empty list returns empty array', () => {
  assert.deepEqual(aggregateDmContacts([], ME), []);
});

test('aggregateDmContacts: groups events by contact, keeps latest', () => {
  const dms = [
    dmEvent({ from: BOB, to: ME, created_at: 10, id: '1' }),
    dmEvent({ from: ME, to: BOB, created_at: 20, id: '2' }),
    dmEvent({ from: CAROL, to: ME, created_at: 15, id: '3' }),
  ];
  const result = aggregateDmContacts(dms, ME);
  assert.equal(result.length, 2);
  assert.equal(result[0][0], BOB);
  assert.equal(result[0][1].id, '2');
  assert.equal(result[1][0], CAROL);
});

test('aggregateDmContacts: sorted by latest created_at desc', () => {
  const dms = [
    dmEvent({ from: BOB, to: ME, created_at: 10, id: '1' }),
    dmEvent({ from: CAROL, to: ME, created_at: 100, id: '2' }),
  ];
  const result = aggregateDmContacts(dms, ME);
  assert.equal(result[0][0], CAROL);
  assert.equal(result[1][0], BOB);
});

test('aggregateDmContacts: skips events with no resolvable contact', () => {
  const dms = [
    { id: 'x', pubkey: ME, created_at: 1, kind: 4, tags: [], content: '' },
    dmEvent({ from: BOB, to: ME, created_at: 2, id: 'y' }),
  ];
  const result = aggregateDmContacts(dms, ME);
  assert.equal(result.length, 1);
  assert.equal(result[0][0], BOB);
});
