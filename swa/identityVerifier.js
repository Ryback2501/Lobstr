export async function verifyIdentity(pubkey, identifier, onVerified, fetcher = fetch) {
  const at = identifier.indexOf('@');
  if (at < 1) return;
  const local = identifier.slice(0, at).toLowerCase();
  const domain = identifier.slice(at + 1).toLowerCase();
  if (!local || !domain) return;
  if (!/^[a-z0-9_-]+$/.test(local)) return;
  try {
    const url = new URL(`https://${domain}/.well-known/nostr.json`);
    url.searchParams.set('name', local);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res;
    try {
      res = await fetcher(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.names?.[local] === 'string' && data.names[local].toLowerCase() === pubkey.toLowerCase()) {
      onVerified(pubkey, identifier);
    }
  } catch {
    // transient failure — caller may retry on next profile update
  }
}
