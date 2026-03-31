const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
}

function emit(event, data) {
  listeners.get(event)?.forEach(fn => fn(data));
}

export const store = {
  keys: null,
  relayUrl: localStorage.getItem('relayUrl') || 'wss://relay.damus.io',
  relayStatus: 'disconnected',
  events: [],
  subscriptionId: null,

  on,

  setKeys(keys) {
    this.keys = keys;
    if (keys) {
      sessionStorage.setItem('privkeyHex', keys.privkeyHex);
    } else {
      sessionStorage.removeItem('privkeyHex');
    }
    emit('keys', keys);
  },

  setRelayUrl(url) {
    this.relayUrl = url;
    localStorage.setItem('relayUrl', url);
  },

  setRelayStatus(status) {
    this.relayStatus = status;
    emit('relayStatus', status);
  },

  addEvent(event) {
    if (this.events.find(e => e.id === event.id)) return;
    // Insert sorted by created_at descending
    const idx = this.events.findIndex(e => e.created_at < event.created_at);
    if (idx === -1) {
      this.events.push(event);
    } else {
      this.events.splice(idx, 0, event);
    }
    emit('events', this.events);
  },

  clearEvents() {
    this.events = [];
    emit('events', this.events);
  },
};
