// Pure helpers for the logged-in section navigation.
//
// The sidebar exposes a fixed set of section keys. Each key maps to one group
// of content panels. This module owns only the key logic — choosing which
// section is active — and stays free of any DOM access so it can be tested.

export const SECTION_KEYS = ['user', 'relays', 'chats', 'feeds'];

export const DEFAULT_SECTION = 'user';

// Return a valid section key: the requested one when it is known, otherwise the
// fallback. Guards against stale or missing keys (e.g. on logout or a typo'd
// data attribute) so callers always get a section that exists.
export function resolveSection(requested, fallback = DEFAULT_SECTION) {
  return SECTION_KEYS.includes(requested) ? requested : fallback;
}
