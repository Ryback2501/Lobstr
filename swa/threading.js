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

// Identify the root post of the thread an event belongs to. A post with no
// referenced events roots its own thread. Otherwise prefer the explicit root
// marker; fall back to the first referenced event for deprecated positional
// tags, where the earliest reference is the thread root.
export function threadRootId(event) {
  const eTags = event.tags.filter(t => t[0] === 'e');
  if (eTags.length === 0) return event.id;
  const rootTag = eTags.find(t => t[3] === 'root');
  return rootTag ? rootTag[1] : eTags[0][1];
}

// Whether an event belongs to the thread rooted at rootId — either it is the
// root itself or it descends from it.
export function isInThread(event, rootId) {
  return event.id === rootId || threadRootId(event) === rootId;
}

export function buildQuoteTag(quotedEvent, relayHint = '') {
  return ['q', quotedEvent.id, relayHint, quotedEvent.pubkey];
}

export function getSubject(event) {
  return event.tags.find(t => t[0] === 'subject')?.[1] || '';
}

export function adornReplySubject(subject) {
  if (!subject) return '';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
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
