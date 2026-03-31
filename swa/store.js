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
    if (event.kind >= 20000 && event.kind < 30000) return;

    const isReplaceable = event.kind === 0 || event.kind === 3
      || (event.kind >= 10000 && event.kind < 20000);
    const isAddressable = event.kind >= 30000 && event.kind < 40000;

    if (isReplaceable) {
      const idx = this.events.findIndex(
        e => e.pubkey === event.pubkey && e.kind === event.kind
      );
      if (idx !== -1) {
        if (event.created_at <= this.events[idx].created_at) return;
        this.events.splice(idx, 1);
      }
    } else if (isAddressable) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? '';
      const idx = this.events.findIndex(e => {
        const existingD = e.tags.find(t => t[0] === 'd')?.[1] ?? '';
        return e.pubkey === event.pubkey && e.kind === event.kind && existingD === dTag;
      });
      if (idx !== -1) {
        if (event.created_at <= this.events[idx].created_at) return;
        this.events.splice(idx, 1);
      }
    } else {
      if (this.events.find(e => e.id === event.id)) return;
    }

    // Insert sorted by created_at descending
    const insertIdx = this.events.findIndex(e => e.created_at < event.created_at);
    if (insertIdx === -1) {
      this.events.push(event);
    } else {
      this.events.splice(insertIdx, 0, event);
    }
    emit('events', this.events);
  },

  clearEvents() {
    this.events = [];
    emit('events', this.events);
  },

  profiles: new Map(), // pubkey → { name, about, picture, _created_at }

  setProfile(pubkey, metadata) {
    this.profiles.set(pubkey, metadata);
    emit('profiles', pubkey);
  },

  mentions: [],

  addMention(event) {
    if (this.mentions.find(e => e.id === event.id)) return;
    const insertIdx = this.mentions.findIndex(e => e.created_at < event.created_at);
    if (insertIdx === -1) {
      this.mentions.push(event);
    } else {
      this.mentions.splice(insertIdx, 0, event);
    }
    emit('mentions', this.mentions);
  },

  clearMentions() {
    this.mentions = [];
    emit('mentions', this.mentions);
  },
};
