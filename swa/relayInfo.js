/**
 * Fetches a NIP-11 relay information document.
 * The relay is queried via HTTP GET to its WebSocket URL with the
 * Accept: application/nostr+json header. Any field may be absent;
 * callers must treat all fields as optional.
 *
 * @param {string} relayUrl - WebSocket URL (wss:// or ws://)
 * @param {Function} [fetcher=fetch]
 * @returns {Promise<object>} Parsed relay info document
 */
export async function fetchRelayInfo(relayUrl, fetcher = fetch) {
  const httpUrl = relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let res;
  try {
    res = await fetcher(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Relay info request failed: ${res.status}`);
  const info = await res.json();
  if (typeof info !== 'object' || info === null || Array.isArray(info)) {
    throw new Error('Relay info response is not a JSON object');
  }
  return info;
}
