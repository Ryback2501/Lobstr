export function extractDeletionTargetIds(deletionEvent) {
  return deletionEvent.tags
    .filter(t => t[0] === 'e' && typeof t[1] === 'string' && t[1])
    .map(t => t[1]);
}

export function findAuthorizedDeletions(deletionEvent, candidateEvents) {
  const ids = new Set(extractDeletionTargetIds(deletionEvent));
  if (ids.size === 0) return [];
  const result = [];
  const seen = new Set();
  for (const event of candidateEvents) {
    if (!ids.has(event.id) || seen.has(event.id)) continue;
    if (event.pubkey === deletionEvent.pubkey) {
      result.push(event.id);
      seen.add(event.id);
    }
  }
  return result;
}
