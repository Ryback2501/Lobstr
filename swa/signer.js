import { createEvent, encryptDm, decryptDm, verifyEvent } from './nostr.js';

export class LocalSigner {
  constructor({ privkeyHex, pubkeyHex }) {
    this.privkeyHex = privkeyHex;
    this.pubkeyHex = pubkeyHex;
  }

  async init() { return this; }

  async signEvent(draft) {
    return createEvent({
      privkeyHex: this.privkeyHex,
      pubkeyHex: this.pubkeyHex,
      kind: draft.kind,
      tags: draft.tags,
      content: draft.content,
      createdAt: draft.created_at,
    });
  }

  async encrypt(recipientPubkeyHex, plaintext) {
    return encryptDm(this.privkeyHex, recipientPubkeyHex, plaintext);
  }

  async decrypt(senderPubkeyHex, ciphertext) {
    return decryptDm(this.privkeyHex, senderPubkeyHex, ciphertext);
  }

  async nip44Encrypt() {
    throw new Error('NIP-44 encryption is not available without a signing extension.');
  }

  async nip44Decrypt() {
    throw new Error('NIP-44 encryption is not available without a signing extension.');
  }
}

export class ExtensionSigner {
  constructor(nostr) {
    this._nostr = nostr;
    this.pubkeyHex = null; // set after getPublicKey() resolves
  }

  async init() {
    const pubkeyHex = await this._nostr.getPublicKey();
    if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) throw new Error('Extension returned an invalid public key.');
    this.pubkeyHex = pubkeyHex;
    return this;
  }

  async signEvent(draft) {
    const signed = await this._nostr.signEvent(draft);
    if (signed.pubkey !== this.pubkeyHex) throw new Error('Extension signed with a different key.');
    if (!verifyEvent(signed)) throw new Error('Extension returned an invalid signature.');
    return signed;
  }

  async encrypt(recipientPubkeyHex, plaintext) {
    if (!this._nostr.nip04) throw new Error('Encrypted messaging is not supported by the connected extension.');
    return this._nostr.nip04.encrypt(recipientPubkeyHex, plaintext);
  }

  async decrypt(senderPubkeyHex, ciphertext) {
    if (!this._nostr.nip04) throw new Error('Encrypted messaging is not supported by the connected extension.');
    return this._nostr.nip04.decrypt(senderPubkeyHex, ciphertext);
  }

  async nip44Encrypt(recipientPubkeyHex, plaintext) {
    if (!this._nostr.nip44) throw new Error('NIP-44 encryption is not supported by the connected extension.');
    return this._nostr.nip44.encrypt(recipientPubkeyHex, plaintext);
  }

  async nip44Decrypt(senderPubkeyHex, ciphertext) {
    if (!this._nostr.nip44) throw new Error('NIP-44 encryption is not supported by the connected extension.');
    return this._nostr.nip44.decrypt(senderPubkeyHex, ciphertext);
  }
}
