const MAX_EVENTS = 200;

function sortedInsert(array, item) {
  const idx = array.findIndex(e => e.created_at < item.created_at);
  if (idx === -1) {
    array.push(item);
  } else {
    array.splice(idx, 0, item);
  }
  return idx === -1 ? array.length - 1 : idx;
}

const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
}

function emit(event, data) {
  listeners.get(event)?.forEach(fn => {
    try { fn(data); } catch (err) { console.error(`store listener error [${event}]:`, err); }
  });
}

export const store = {
  keys: null,
  relayUrls: JSON.parse(localStorage.getItem('relayUrls') || '["wss://relay.damus.io"]'),
  connectedRelayUrls: new Set(JSON.parse(localStorage.getItem('connectedRelayUrls') || '[]')),
  events: [],
  follows: [], // [{ pubkey, relay, petname }]

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

  setRelayUrls(urls) {
    this.relayUrls = urls;
    localStorage.setItem('relayUrls', JSON.stringify(urls));
  },

  setConnectedRelayUrls(urlSet) {
    this.connectedRelayUrls = urlSet;
    localStorage.setItem('connectedRelayUrls', JSON.stringify([...urlSet]));
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

    const insertIdx = sortedInsert(this.events, event);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    emit('eventAdded', { event, insertIdx });
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
    sortedInsert(this.mentions, event);
    emit('mentions', this.mentions);
  },

  clearMentions() {
    this.mentions = [];
    emit('mentions', this.mentions);
  },

  setFollows(entries) {
    this.follows = entries;
    emit('follows', entries);
  },

  addFollow(entry) {
    if (this.follows.find(f => f.pubkey === entry.pubkey)) return;
    this.follows = [...this.follows, entry];
    emit('follows', this.follows);
  },

  removeFollow(pubkey) {
    this.follows = this.follows.filter(f => f.pubkey !== pubkey);
    emit('follows', this.follows);
  },
};
