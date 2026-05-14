export function getDmContact(event, myPubkey) {
  if (!myPubkey) return null;
  return event.pubkey === myPubkey
    ? (event.tags.find(t => t[0] === 'p')?.[1] ?? null)
    : event.pubkey;
}

export function aggregateDmContacts(dms, myPubkey) {
  const contacts = new Map();
  for (const event of dms) {
    const contact = getDmContact(event, myPubkey);
    if (!contact) continue;
    const existing = contacts.get(contact);
    if (!existing || event.created_at > existing.created_at) contacts.set(contact, event);
  }
  return [...contacts.entries()].sort((a, b) => b[1].created_at - a[1].created_at);
}
