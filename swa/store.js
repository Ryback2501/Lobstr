import { classifyEvent } from './nostr.js';

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

export function createStore(ls, ss) {
  ls = ls ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  ss = ss ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);

  const safeLS = {
    getItem:    (k)    => ls?.getItem(k) ?? null,
    setItem:    (k, v) => ls?.setItem(k, v),
    removeItem: (k)    => ls?.removeItem(k),
  };
  const safeSS = {
    getItem:    (k)    => ss?.getItem(k) ?? null,
    setItem:    (k, v) => ss?.setItem(k, v),
    removeItem: (k)    => ss?.removeItem(k),
  };

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

  return {
    signer: null,
    relayUrls: JSON.parse(safeLS.getItem('relayUrls') || '["wss://relay.damus.io"]'),
    connectedRelayUrls: new Set(JSON.parse(safeLS.getItem('connectedRelayUrls') || '[]')),
    events: [],
    follows: [],
    followedPubkeys: new Set(),

    on,

    setSigner(signer) {
      this.signer = signer;
      this.dms = [];
      this.dmDecrypted = new Map();
      if (signer?.privkeyHex) {
        safeSS.setItem('privkeyHex', signer.privkeyHex);
      } else {
        safeSS.removeItem('privkeyHex');
      }
      emit('signer', signer);
    },

    setRelayUrls(urls) {
      this.relayUrls = urls;
      safeLS.setItem('relayUrls', JSON.stringify(urls));
    },

    setConnectedRelayUrls(urlSet) {
      this.connectedRelayUrls = urlSet;
      safeLS.setItem('connectedRelayUrls', JSON.stringify([...urlSet]));
    },

    addEvent(event) {
      const classification = classifyEvent(event);
      if (classification === 'ephemeral') return;

      if (classification === 'replaceable') {
        const idx = this.events.findIndex(
          e => e.pubkey === event.pubkey && e.kind === event.kind
        );
        if (idx !== -1) {
          const existing = this.events[idx];
          if (event.created_at < existing.created_at) return;
          if (event.created_at === existing.created_at && event.id >= existing.id) return;
          this.events.splice(idx, 1);
        }
      } else if (classification === 'addressable') {
        const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? '';
        const idx = this.events.findIndex(e => {
          const existingD = e.tags.find(t => t[0] === 'd')?.[1] ?? '';
          return e.pubkey === event.pubkey && e.kind === event.kind && existingD === dTag;
        });
        if (idx !== -1) {
          const existing = this.events[idx];
          if (event.created_at < existing.created_at) return;
          if (event.created_at === existing.created_at && event.id >= existing.id) return;
          this.events.splice(idx, 1);
        }
      } else {
        if (this.events.some(e => e.id === event.id)) return;
      }

      const insertIdx = sortedInsert(this.events, event);
      if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
      emit('eventAdded', { event, insertIdx });
    },

    removeEvent(eventId) {
      const idx = this.events.findIndex(e => e.id === eventId);
      if (idx === -1) return;
      this.events.splice(idx, 1);
      emit('eventRemoved', eventId);
    },

    removeAddressableEvent(kind, pubkey, dTagValue) {
      const idx = this.events.findIndex(e =>
        e.kind === kind &&
        e.pubkey === pubkey &&
        (e.tags.find(t => t[0] === 'd')?.[1] ?? '') === dTagValue,
      );
      if (idx === -1) return;
      const [removed] = this.events.splice(idx, 1);
      emit('eventRemoved', removed.id);
    },

    clearEvents() {
      this.events = [];
      emit('events', this.events);
    },

    relayInfos: new Map(),

    setRelayInfo(url, info) {
      this.relayInfos.set(url, info);
      emit('relayInfo', url);
    },

    attestations: new Map(),

    setAttestation(eventId, raw) {
      if (this.attestations.has(eventId)) return;
      this.attestations.set(eventId, { raw, received_at: Math.floor(Date.now() / 1000) });
      emit('attestation', eventId);
    },

    verifiedIdentities: new Map(),

    setVerifiedIdentity(pubkey, identifier) {
      this.verifiedIdentities.set(pubkey, identifier);
      emit('verifiedIdentity', pubkey);
    },

    profiles: new Map(),

    setProfile(pubkey, metadata) {
      this.profiles.set(pubkey, metadata);
      emit('profiles', pubkey);
    },

    mentions: [],

    addMention(event) {
      if (this.mentions.some(e => e.id === event.id)) return;
      sortedInsert(this.mentions, event);
      if (this.mentions.length > MAX_EVENTS) this.mentions.length = MAX_EVENTS;
      emit('mentions', this.mentions);
    },

    removeMention(eventId) {
      const idx = this.mentions.findIndex(e => e.id === eventId);
      if (idx === -1) return;
      this.mentions.splice(idx, 1);
      emit('mentions', this.mentions);
    },

    clearMentions() {
      this.mentions = [];
      emit('mentions', this.mentions);
    },

    dms: [],
    dmDecrypted: new Map(),

    addDm(event) {
      if (this.dms.some(e => e.id === event.id)) return;
      sortedInsert(this.dms, event);
      if (this.dms.length > MAX_EVENTS) this.dms.length = MAX_EVENTS;
      emit('dm', event);
    },

    setDmDecrypted(eventId, text) {
      this.dmDecrypted.set(eventId, text);
      emit('dmDecrypted', eventId);
    },

    setFollows(entries) {
      this.follows = entries;
      this.followedPubkeys = new Set(entries.map(f => f.pubkey));
      emit('follows', entries);
    },

    addFollow(entry) {
      if (this.followedPubkeys.has(entry.pubkey)) return;
      this.follows = [...this.follows, entry];
      this.followedPubkeys.add(entry.pubkey);
      emit('follows', this.follows);
    },

    removeFollow(pubkey) {
      this.follows = this.follows.filter(f => f.pubkey !== pubkey);
      this.followedPubkeys.delete(pubkey);
      emit('follows', this.follows);
    },
  };
}

export const store = createStore();
