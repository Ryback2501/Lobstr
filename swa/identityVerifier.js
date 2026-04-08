export async function verifyIdentity(pubkey, identifier, store, fetcher = fetch) {
  if (store.verifiedIdentities.has(pubkey)) return;
  const at = identifier.indexOf('@');
  if (at < 1) return;
  const local = identifier.slice(0, at).toLowerCase();
  const domain = identifier.slice(at + 1).toLowerCase();
  if (!local || !domain) return;
  try {
    const url = new URL(`https://${domain}/.well-known/nostr.json`);
    url.searchParams.set('name', local);
    const res = await fetcher(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.names?.[local] === 'string' && data.names[local].toLowerCase() === pubkey.toLowerCase()) {
      store.setVerifiedIdentity(pubkey, identifier);
    }
  } catch {
    // transient failure — caller may retry on next profile update
  }
}
