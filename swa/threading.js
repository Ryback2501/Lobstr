// Tag composition and interpretation for Nostr text-note threading (kind 1).
// All functions are pure — no store, no DOM, no network.

/**
 * Finds the most-specific reply reference in an array of 'e' tags.
 * Prefers the 'reply' marker, falls back to 'root', then to the last positional tag.
 * @param {Array[]} eTags
 * @returns {Array|null}
 */
export function resolveReplyTag(eTags) {
  if (!eTags.length) return null;
  return eTags.find(t => t[3] === 'reply')
    || eTags.find(t => t[3] === 'root')
    || eTags[eTags.length - 1];
}

/**
 * Builds NIP-10 e and p tags for an outgoing reply event.
 * - Direct reply to a root event: single ["e", id, "", "root"] tag.
 * - Reply to a reply: ["e", rootId, "", "root"] + ["e", parentId, "", "reply"].
 * Thread participant p tags are collected from the parent and deduplicated;
 * myPubkey is excluded so we don't tag ourselves.
 * @param {object} parentEvent
 * @param {string} [myPubkey]
 * @returns {Array[]}
 */
export function buildReplyTags(parentEvent, myPubkey) {
  const parentETags = parentEvent.tags.filter(t => t[0] === 'e');
  const tags = [];

  if (parentETags.length === 0) {
    tags.push(['e', parentEvent.id, '', 'root']);
  } else {
    const rootETag = parentETags.find(t => t[3] === 'root') || parentETags[0];
    tags.push(['e', rootETag[1], rootETag[2] || '', 'root']);
    tags.push(['e', parentEvent.id, '', 'reply']);
  }

  const participants = new Set([parentEvent.pubkey]);
  for (const t of parentEvent.tags) {
    if (t[0] === 'p' && t[1]) participants.add(t[1]);
  }
  if (myPubkey) participants.delete(myPubkey);
  for (const pk of participants) tags.push(['p', pk]);

  return tags;
}

/**
 * Scans content for @<64-hex-char> patterns, replaces each with a NIP-08 #[n]
 * reference, and returns the corresponding p/e tags.
 * tagOffset accounts for any tags that will precede these in the final tag array
 * (e.g. reply e/p tags). Hex values present in eventIds produce ["e", …] tags;
 * all others produce ["p", …] tags.
 * @param {string} content
 * @param {number} [tagOffset=0]
 * @param {Set<string>} [eventIds]
 * @returns {{ content: string, tags: Array[] }}
 */
export function buildMentionEvent(content, tagOffset = 0, eventIds = new Set()) {
  const mentionTags = [];
  const seen = new Map();
  const transformed = content.replace(/@([0-9a-f]{64})/gi, (_, raw) => {
    const hex = raw.toLowerCase();
    if (!seen.has(hex)) {
      seen.set(hex, tagOffset + mentionTags.length);
      mentionTags.push([eventIds.has(hex) ? 'e' : 'p', hex]);
    }
    return `#[${seen.get(hex)}]`;
  });
  return { content: transformed, tags: mentionTags };
}
