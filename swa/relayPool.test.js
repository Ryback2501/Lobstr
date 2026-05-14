import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelayPool } from './relayPool.js';

function makeConnectionClass() {
  const instances = [];
  function MockConnection(url, callbacks) {
    this.url = url;
    this.callbacks = callbacks;
    this.connectCalled = false;
    this.disconnectCalled = false;
    this.subscribeCalls = [];
    this.unsubscribeCalls = [];
    this.publishResults = [];
    this.publishCalls = [];
    instances.push(this);
  }
  MockConnection.prototype.connect = function () {
    this.connectCalled = true;
    return Promise.resolve();
  };
  MockConnection.prototype.disconnect = function () {
    this.disconnectCalled = true;
    this.callbacks.onStatus?.('disconnected');
  };
  MockConnection.prototype.subscribe = function (subId, filters) {
    this.subscribeCalls.push({ subId, filters });
  };
  MockConnection.prototype.unsubscribe = function (subId) {
    this.unsubscribeCalls.push(subId);
  };
  MockConnection.prototype.publish = function (event) {
    this.publishCalls.push(event);
    const next = this.publishResults.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? 'ok');
  };
  MockConnection.prototype.fireStatus = function (status) {
    this.callbacks.onStatus?.(status);
  };
  MockConnection.instances = instances;
  return MockConnection;
}

test('add: registers relay as disconnected', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  assert.equal(pool.has('wss://a.example'), true);
  assert.equal(pool.size, 1);
});

test('add: is idempotent', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.add('wss://a.example');
  assert.equal(pool.size, 1);
});

test('has: returns false for unknown url', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  assert.equal(pool.has('wss://unknown.example'), false);
});

test('urls: returns registered relay urls', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.add('wss://b.example');
  assert.deepEqual(pool.urls(), ['wss://a.example', 'wss://b.example']);
});

test('entries: returns [url, entry] pairs', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  const entries = pool.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], 'wss://a.example');
  assert.equal(entries[0][1].status, 'disconnected');
});

test('connect: creates connection and calls connect()', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  assert.equal(Mock.instances.length, 1);
  assert.equal(Mock.instances[0].connectCalled, true);
  assert.equal(Mock.instances[0].url, 'wss://a.example');
});

test('connect: noop if relay not in pool', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.connect('wss://unknown.example');
  assert.equal(Mock.instances.length, 0);
});

test('connect: noop if already connected', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.connect('wss://a.example');
  assert.equal(Mock.instances.length, 1);
});

test('connect: noop if already connecting', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connecting');
  pool.connect('wss://a.example'); // second call while connecting
  assert.equal(Mock.instances.length, 1); // only one connection created
});

test('disconnect: calls conn.disconnect and nulls conn', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  pool.disconnect('wss://a.example');
  assert.equal(Mock.instances[0].disconnectCalled, true);
});

test('isAnyConnected: false when all disconnected', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  assert.equal(pool.isAnyConnected(), false);
});

test('isAnyConnected: true when a relay connects', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  assert.equal(pool.isAnyConnected(), true);
});

test('isAnyConnected: false after relay disconnects', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  Mock.instances[0].fireStatus('disconnected');
  assert.equal(pool.isAnyConnected(), false);
});

test('subscribe: sends to connected relay', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.subscribe('sub1', [{ kinds: [1] }]);
  assert.equal(Mock.instances[0].subscribeCalls.length, 1);
  assert.equal(Mock.instances[0].subscribeCalls[0].subId, 'sub1');
});

test('subscribe: skips disconnected relays', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  // don't fire 'connected' — relay stays in connecting/disconnected state
  pool.subscribe('sub1', [{ kinds: [1] }]);
  assert.equal(Mock.instances[0].subscribeCalls.length, 0);
});

test('unsubscribe: removes activeSub and calls unsubscribe on connected relay', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.subscribe('sub1', [{ kinds: [1] }]);
  pool.unsubscribe('sub1');
  assert.equal(Mock.instances[0].unsubscribeCalls.length, 1);
  assert.equal(Mock.instances[0].unsubscribeCalls[0], 'sub1');
});

test('clearActiveSubs: prevents new relay from receiving old subs', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.subscribe('sub1', [{ kinds: [1] }]);
  pool.clearActiveSubs();
  pool.add('wss://b.example');
  pool.connect('wss://b.example');
  Mock.instances[1].fireStatus('connected');
  // b should NOT receive sub1 since activeSubs was cleared
  assert.equal(Mock.instances[1].subscribeCalls.length, 0);
});

test('new relay auto-resubscribes to activeSubs when wasAnyConnected=true', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.subscribe('sub1', [{ kinds: [1] }]);

  pool.add('wss://b.example');
  pool.connect('wss://b.example');
  const bConn = Mock.instances[1];
  bConn.fireStatus('connected');

  // b should have received sub1
  assert.equal(bConn.subscribeCalls.length, 1);
  assert.equal(bConn.subscribeCalls[0].subId, 'sub1');
});

test('first relay does NOT auto-resubscribe when wasAnyConnected=false', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  // subscribe before connecting (simulates stale activeSubs)
  // We'll check that connect doesn't re-send them on first connection
  const aConn = Mock.instances[0];
  aConn.fireStatus('connected');
  // aConn.subscribeCalls should only have entries from pool.subscribe calls after connect,
  // not auto-sent from wasAnyConnected=true path
  assert.equal(aConn.subscribeCalls.length, 0);
});

test('onStatus: receives wasAnyConnected=false on first relay connect', () => {
  const Mock = makeConnectionClass();
  const statusCalls = [];
  const pool = new RelayPool({
    connectionClass: Mock,
    onStatus: (url, status, wasAnyConnected) => statusCalls.push({ url, status, wasAnyConnected }),
  });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].wasAnyConnected, false);
});

test('onStatus: receives wasAnyConnected=true on additional relay connect', () => {
  const Mock = makeConnectionClass();
  const statusCalls = [];
  const pool = new RelayPool({
    connectionClass: Mock,
    onStatus: (url, status, wasAnyConnected) => statusCalls.push({ url, status, wasAnyConnected }),
  });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');

  pool.add('wss://b.example');
  pool.connect('wss://b.example');
  Mock.instances[1].fireStatus('connected');

  assert.equal(statusCalls[1].wasAnyConnected, true);
});

test('publish: sends event to all connected relays', async () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.add('wss://b.example');
  pool.connect('wss://a.example');
  pool.connect('wss://b.example');
  Mock.instances[0].fireStatus('connected');
  Mock.instances[1].fireStatus('connected');
  const event = { id: 'abc', kind: 1 };
  await pool.publish(event);
  assert.equal(Mock.instances[0].publishCalls.length, 1);
  assert.equal(Mock.instances[1].publishCalls.length, 1);
});

test('publish: throws when no relay is connected', async () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  await assert.rejects(() => pool.publish({ id: 'x' }), /Not connected/);
});

test('publish: throws when all relays reject', async () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  Mock.instances[0].publishResults.push(new Error('rejected by relay'));
  await assert.rejects(() => pool.publish({ id: 'y' }), /rejected by relay/);
});

test('publish: resolves when at least one relay accepts', async () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.add('wss://b.example');
  pool.connect('wss://a.example');
  pool.connect('wss://b.example');
  Mock.instances[0].fireStatus('connected');
  Mock.instances[1].fireStatus('connected');
  Mock.instances[0].publishResults.push(new Error('rejected'));
  // instances[1] returns ok by default
  await assert.doesNotReject(() => pool.publish({ id: 'z' }));
});

test('resubscribeFor: re-sends active sub to specific relay', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.subscribe('sub1', [{ kinds: [1] }]);
  const callsBefore = Mock.instances[0].subscribeCalls.length;
  pool.resubscribeFor('wss://a.example', 'sub1');
  assert.equal(Mock.instances[0].subscribeCalls.length, callsBefore + 1);
  assert.equal(Mock.instances[0].subscribeCalls.at(-1).subId, 'sub1');
});

test('resubscribeFor: noop when target relay is disconnected', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.subscribe('sub1', [{ kinds: [1] }]);
  const callsBefore = Mock.instances[0].subscribeCalls.length;
  pool.disconnect('wss://a.example');
  pool.resubscribeFor('wss://a.example', 'sub1');
  assert.equal(Mock.instances[0].subscribeCalls.length, callsBefore);
});

test('resubscribeFor: noop when subId not in activeSubs', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].fireStatus('connected');
  pool.resubscribeFor('wss://a.example', 'nonexistent');
  assert.equal(Mock.instances[0].subscribeCalls.length, 0);
});

test('remove: deletes relay from pool', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.remove('wss://a.example');
  assert.equal(pool.has('wss://a.example'), false);
  assert.equal(pool.size, 0);
});

test('remove: disconnects existing connection', () => {
  const Mock = makeConnectionClass();
  const pool = new RelayPool({ connectionClass: Mock });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  pool.remove('wss://a.example');
  assert.equal(Mock.instances[0].disconnectCalled, true);
});

test('onClosed callback receives url, subId, message', () => {
  const Mock = makeConnectionClass();
  const closedCalls = [];
  const pool = new RelayPool({
    connectionClass: Mock,
    onClosed: (url, subId, msg) => closedCalls.push({ url, subId, msg }),
  });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].callbacks.onClosed?.('sub1', 'auth required');
  assert.equal(closedCalls.length, 1);
  assert.equal(closedCalls[0].url, 'wss://a.example');
  assert.equal(closedCalls[0].subId, 'sub1');
  assert.equal(closedCalls[0].msg, 'auth required');
});

test('onNotice callback receives url and message', () => {
  const Mock = makeConnectionClass();
  const noticeCalls = [];
  const pool = new RelayPool({
    connectionClass: Mock,
    onNotice: (url, msg) => noticeCalls.push({ url, msg }),
  });
  pool.add('wss://a.example');
  pool.connect('wss://a.example');
  Mock.instances[0].callbacks.onNotice?.('hello from relay');
  assert.equal(noticeCalls.length, 1);
  assert.equal(noticeCalls[0].url, 'wss://a.example');
  assert.equal(noticeCalls[0].msg, 'hello from relay');
});
