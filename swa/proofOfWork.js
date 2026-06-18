import { serializeEvent, getEventId } from './nostr.js';

// Proof of Work (NIP-13): difficulty is the number of leading zero bits in the
// event id. An event commits to a target difficulty via a nonce tag
// `["nonce", "<nonce>", "<target>"]`; mining increments the nonce and re-hashes
// until the id has at least <target> leading zero bits.

export function countLeadingZeroBits(idHex) {
  let count = 0;
  for (let i = 0; i < idHex.length; i++) {
    const nibble = parseInt(idHex[i], 16);
    if (nibble === 0) {
      count += 4;
      continue;
    }
    // Math.clz32 counts leading zeros in a 32-bit int; a 4-bit nibble's leading
    // zeros are clz32(nibble) - 28.
    count += Math.clz32(nibble) - 28;
    break;
  }
  return count;
}

export function getEventDifficulty(event) {
  return countLeadingZeroBits(event.id);
}

export function mineProofOfWork({ pubkeyHex, createdAt, kind, tags, content, difficulty }) {
  let nonce = 0;
  for (;;) {
    const candidate = [...tags, ['nonce', String(nonce), String(difficulty)]];
    const id = getEventId(serializeEvent(pubkeyHex, createdAt, kind, candidate, content));
    if (countLeadingZeroBits(id) >= difficulty) return candidate;
    nonce++;
  }
}
