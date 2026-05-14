import { RelayConnection } from './relay.js';

export class RelayPool {
  #relays = new Map();
  #activeSubs = new Map();
  #Connection;
  #onEvent;
  #onEOSE;
  #onClosed;
  #onNotice;
  #onStatus;

  constructor({ onEvent, onEOSE, onClosed, onNotice, onStatus, connectionClass = RelayConnection } = {}) {
    this.#onEvent = onEvent;
    this.#onEOSE = onEOSE;
    this.#onClosed = onClosed;
    this.#onNotice = onNotice;
    this.#onStatus = onStatus;
    this.#Connection = connectionClass;
  }

  add(url) {
    if (!this.#relays.has(url)) {
      this.#relays.set(url, { conn: null, status: 'disconnected' });
    }
  }

  remove(url) {
    const entry = this.#relays.get(url);
    if (entry?.conn) entry.conn.disconnect();
    this.#relays.delete(url);
  }

  connect(url) {
    const entry = this.#relays.get(url);
    if (!entry || entry.status === 'connected' || entry.status === 'connecting') return;
    const conn = new this.#Connection(url, {
      onEvent: this.#onEvent,
      onEOSE: this.#onEOSE,
      onClosed: (subId, msg) => this.#onClosed?.(url, subId, msg),
      onNotice: (msg) => this.#onNotice?.(url, msg),
      onStatus: (status) => {
        const wasAnyConnected = this.isAnyConnected();
        entry.status = status;
        if (status === 'connected' && wasAnyConnected) {
          for (const [subId, filters] of this.#activeSubs) {
            conn.subscribe(subId, filters);
          }
        }
        this.#onStatus?.(url, status, wasAnyConnected);
      },
    });
    entry.conn = conn;
    conn.connect().catch(() => {});
  }

  disconnect(url) {
    const entry = this.#relays.get(url);
    if (entry?.conn) {
      entry.conn.onStatus = () => {};
      entry.conn.disconnect();
      entry.conn = null;
      entry.status = 'disconnected';
    }
  }

  subscribe(subId, filters) {
    this.#activeSubs.set(subId, filters);
    for (const { conn, status } of this.#relays.values()) {
      if (status === 'connected' && conn) conn.subscribe(subId, filters);
    }
  }

  unsubscribe(subId) {
    this.#activeSubs.delete(subId);
    for (const { conn, status } of this.#relays.values()) {
      if (status === 'connected' && conn) conn.unsubscribe(subId);
    }
  }

  resubscribeFor(url, subId) {
    const entry = this.#relays.get(url);
    const filters = this.#activeSubs.get(subId);
    if (entry?.status === 'connected' && entry.conn && filters) {
      entry.conn.subscribe(subId, filters);
    }
  }

  async publish(event) {
    const connected = [...this.#relays.values()].filter(e => e.status === 'connected' && e.conn);
    if (!connected.length) throw new Error('Not connected to any relay.');
    const results = await Promise.allSettled(connected.map(e => e.conn.publish(event)));
    const accepted = results.filter(r => r.status === 'fulfilled');
    if (!accepted.length) {
      const err = results.find(r => r.status === 'rejected');
      throw new Error(err?.reason?.message || 'All relays rejected the event.');
    }
  }

  isAnyConnected() {
    return [...this.#relays.values()].some(e => e.status === 'connected');
  }

  clearActiveSubs() {
    this.#activeSubs.clear();
  }

  has(url) {
    return this.#relays.has(url);
  }

  get size() {
    return this.#relays.size;
  }

  urls() {
    return [...this.#relays.keys()];
  }

  entries() {
    return [...this.#relays.entries()];
  }
}
