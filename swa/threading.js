export function resolveReplyTag(eTags) {
  if (!eTags.length) return null;
  return eTags.find(t => t[3] === 'reply')
    || eTags.find(t => t[3] === 'root')
    || eTags[eTags.length - 1];
}

export function buildReplyTags(parentEvent, myPubkey) {
  const parentETags = parentEvent.tags.filter(t => t[0] === 'e');
  const tags = [];

  if (parentETags.length === 0) {
    tags.push(['e', parentEvent.id, '', 'root', parentEvent.pubkey]);
  } else {
    const rootETag = parentETags.find(t => t[3] === 'root') || parentETags[0];
    tags.push(['e', rootETag[1], rootETag[2] || '', 'root', rootETag[4] || '']);
    tags.push(['e', parentEvent.id, '', 'reply', parentEvent.pubkey]);
  }

  const participants = new Set([parentEvent.pubkey]);
  for (const t of parentEvent.tags) {
    if (t[0] === 'p' && t[1]) participants.add(t[1]);
  }
  if (myPubkey) participants.delete(myPubkey);
  for (const pk of participants) tags.push(['p', pk]);

  return tags;
}

export function buildQuoteTag(quotedEvent, relayHint = '') {
  return ['q', quotedEvent.id, relayHint, quotedEvent.pubkey];
}

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
