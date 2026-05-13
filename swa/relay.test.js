import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelayConnection } from './relay.js';

// Minimal mock WebSocket
function makeWS(url) {
  const ws = {
    url,
    readyState: 1, // OPEN
    sent: [],
    closeCalled: false,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send(data) { this.sent.push(data); },
    close() { this.closeCalled = true; },
    fireOpen()    { this.onopen?.(); },
    fireClose()   { this.onclose?.(); },
    fireError(e)  { this.onerror?.(e); },
    fireMessage(data) { this.onmessage?.({ data }); },
  };
  return ws;
}

function makeConn(callbacks = {}) {
  let ws;
  const conn = new RelayConnection('wss://test.example', callbacks);
  // Patch WebSocket constructor to capture instance
  const OrigWS = globalThis.WebSocket;
  globalThis.WebSocket = function(url) {
    ws = makeWS(url);
    ws.OPEN = 1;
    return ws;
  };
  globalThis.WebSocket.OPEN = 1;
  const promise = conn.connect();
  globalThis.WebSocket = OrigWS;
  return { conn, ws, promise };
}

// ── connect ───────────────────────────────────────────────────────────────────

test('connect: emits connecting then connected on open', async () => {
  const statuses = [];
  const { ws, promise } = makeConn({ onStatus: (s) => statuses.push(s) });
  ws.fireOpen();
  await promise;
  assert.deepEqual(statuses, ['connecting', 'connected']);
});

test('connect: resolves on open', async () => {
  const { ws, promise } = makeConn();
  ws.fireOpen();
  await assert.doesNotReject(promise);
});

test('connect: rejects on error', async () => {
  const { ws, promise } = makeConn();
  ws.fireError(new Error('net fail'));
  await assert.rejects(promise);
});

test('connect: emits disconnected on close', async () => {
  const statuses = [];
  const { ws, promise } = makeConn({ onStatus: (s) => statuses.push(s) });
  ws.fireOpen();
  await promise;
  ws.fireClose();
  assert.ok(statuses.includes('disconnected'));
});

test('connect: does not emit error status on onerror (only rejects)', async () => {
  const statuses = [];
  const { ws, promise } = makeConn({ onStatus: (s) => statuses.push(s) });
  ws.fireError(new Error('x'));
  await promise.catch(() => {});
  assert.ok(!statuses.includes('error'));
});

// ── disconnect ────────────────────────────────────────────────────────────────

test('disconnect: closes the WebSocket', async () => {
  const { conn, ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  conn.disconnect();
  assert.equal(ws.closeCalled, true);
});

// ── subscribe / unsubscribe ───────────────────────────────────────────────────

test('subscribe: sends REQ message over the socket', async () => {
  const { conn, ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  conn.subscribe('sub1', [{ kinds: [1] }]);
  const msg = JSON.parse(ws.sent.at(-1));
  assert.equal(msg[0], 'REQ');
  assert.equal(msg[1], 'sub1');
  assert.deepEqual(msg[2], { kinds: [1] });
});

test('unsubscribe: sends CLOSE message', async () => {
  const { conn, ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  conn.unsubscribe('sub1');
  const msg = JSON.parse(ws.sent.at(-1));
  assert.equal(msg[0], 'CLOSE');
  assert.equal(msg[1], 'sub1');
});

test('_send: silently drops message when socket not open', async () => {
  const { conn, ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  ws.readyState = 3; // CLOSED
  assert.doesNotThrow(() => conn.subscribe('sub1', [{}]));
});

// ── _handleMessage: EVENT ─────────────────────────────────────────────────────

test('_handleMessage: EVENT dispatches to onEvent', async () => {
  const received = [];
  const { ws, promise } = makeConn({ onEvent: (subId, e) => received.push({ subId, e }) });
  ws.fireOpen();
  await promise;
  ws.fireMessage(JSON.stringify(['EVENT', 'sub1', { id: 'abc', kind: 1 }]));
  assert.equal(received.length, 1);
  assert.equal(received[0].subId, 'sub1');
  assert.equal(received[0].e.id, 'abc');
});

// ── _handleMessage: OK ────────────────────────────────────────────────────────

test('publish: resolves on accepted OK', async () => {
  const { conn, ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  const pubPromise = conn.publish({ id: 'evt1', kind: 1, pubkey: 'a', created_at: 1, tags: [], content: '', sig: 'x' });
  ws.fireMessage(JSON.stringify(['OK', 'evt1', true, '']));
  await assert.doesNotReject(pubPromise);
});

test('publish: rejects on rejected OK', async () => {
  const { conn, ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  const pubPromise = conn.publish({ id: 'evt2', kind: 1, pubkey: 'a', created_at: 1, tags: [], content: '', sig: 'x' });
  ws.fireMessage(JSON.stringify(['OK', 'evt2', false, 'blocked: spam']));
  await assert.rejects(pubPromise, /blocked: spam/);
});

test('publish: rejects on connection close before OK', async () => {
  const { conn, ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  const pubPromise = conn.publish({ id: 'evt3', kind: 1, pubkey: 'a', created_at: 1, tags: [], content: '', sig: 'x' });
  ws.fireClose();
  await assert.rejects(pubPromise, /closed/i);
});

// ── _handleMessage: EOSE ──────────────────────────────────────────────────────

test('_handleMessage: EOSE dispatches to onEOSE', async () => {
  const eoses = [];
  const { ws, promise } = makeConn({ onEOSE: (subId) => eoses.push(subId) });
  ws.fireOpen();
  await promise;
  ws.fireMessage(JSON.stringify(['EOSE', 'sub1']));
  assert.equal(eoses[0], 'sub1');
});

// ── _handleMessage: CLOSED ────────────────────────────────────────────────────

test('_handleMessage: CLOSED dispatches to onClosed', async () => {
  const closed = [];
  const { ws, promise } = makeConn({ onClosed: (subId, msg) => closed.push({ subId, msg }) });
  ws.fireOpen();
  await promise;
  ws.fireMessage(JSON.stringify(['CLOSED', 'sub1', 'auth-required: please auth']));
  assert.equal(closed[0].subId, 'sub1');
  assert.equal(closed[0].msg, 'auth-required: please auth');
});

// ── _handleMessage: NOTICE ────────────────────────────────────────────────────

test('_handleMessage: NOTICE dispatches to onNotice', async () => {
  const notices = [];
  const { ws, promise } = makeConn({ onNotice: (msg) => notices.push(msg) });
  ws.fireOpen();
  await promise;
  ws.fireMessage(JSON.stringify(['NOTICE', 'hello from relay']));
  assert.equal(notices[0], 'hello from relay');
});

// ── _handleMessage: malformed input ──────────────────────────────────────────

test('_handleMessage: silently ignores invalid JSON', async () => {
  const { ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  assert.doesNotThrow(() => ws.fireMessage('not json'));
});

test('_handleMessage: silently ignores non-array messages', async () => {
  const { ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  assert.doesNotThrow(() => ws.fireMessage(JSON.stringify({ type: 'EVENT' })));
});

test('_handleMessage: silently ignores arrays shorter than 2', async () => {
  const { ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  assert.doesNotThrow(() => ws.fireMessage(JSON.stringify(['ONLY_ONE'])));
});

test('_handleMessage: silently ignores unknown message types', async () => {
  const { ws, promise } = makeConn();
  ws.fireOpen();
  await promise;
  assert.doesNotThrow(() => ws.fireMessage(JSON.stringify(['UNKNOWN', 'data'])));
});
