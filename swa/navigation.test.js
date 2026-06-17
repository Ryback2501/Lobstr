import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_KEYS, DEFAULT_SECTION, resolveSection } from './navigation.js';

test('DEFAULT_SECTION is one of the known section keys', () => {
  assert.ok(SECTION_KEYS.includes(DEFAULT_SECTION));
});

test('resolveSection: returns the requested key when it is known', () => {
  for (const key of SECTION_KEYS) {
    assert.equal(resolveSection(key), key);
  }
});

test('resolveSection: falls back to the default for an unknown key', () => {
  assert.equal(resolveSection('bogus'), DEFAULT_SECTION);
});

test('resolveSection: falls back to the default for null/undefined', () => {
  assert.equal(resolveSection(null), DEFAULT_SECTION);
  assert.equal(resolveSection(undefined), DEFAULT_SECTION);
});

test('resolveSection: honours an explicit fallback', () => {
  assert.equal(resolveSection('bogus', 'feeds'), 'feeds');
});
