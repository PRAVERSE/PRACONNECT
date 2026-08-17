// src/utils/roomCountdown.test.ts
// Client-side tests for the Explore rejoin-window countdown helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, isRejoinWindowClosed } from './roomCountdown';

test('formatCountdown renders MM:SS for a future expiry', () => {
  const now = Date.parse('2026-08-17T10:00:00Z');
  assert.equal(formatCountdown('2026-08-17T10:05:00Z', now), '05:00');
  assert.equal(formatCountdown('2026-08-17T10:04:52Z', now), '04:52');
  assert.equal(formatCountdown('2026-08-17T10:00:59Z', now), '00:59');
  assert.equal(formatCountdown('2026-08-17T10:00:01Z', now), '00:01');
});

test('formatCountdown clamps to 00:00 at and after expiry', () => {
  const now = Date.parse('2026-08-17T10:00:00Z');
  assert.equal(formatCountdown('2026-08-17T10:00:00Z', now), '00:00');
  assert.equal(formatCountdown('2026-08-17T09:59:59Z', now), '00:00');
});

test('formatCountdown pads minutes and seconds with leading zeros', () => {
  const now = Date.parse('2026-08-17T10:00:00Z');
  assert.equal(formatCountdown('2026-08-17T10:05:05Z', now), '05:05');
  assert.equal(formatCountdown('2026-08-17T10:59:00Z', now), '59:00');
});

test('isRejoinWindowClosed is false for active rooms and true for expired ones', () => {
  const now = Date.parse('2026-08-17T10:00:00Z');
  assert.equal(isRejoinWindowClosed(null, now), false);
  assert.equal(isRejoinWindowClosed(undefined, now), false);
  assert.equal(isRejoinWindowClosed('2026-08-17T10:05:00Z', now), false);
  assert.equal(isRejoinWindowClosed('2026-08-17T10:00:00Z', now), true);
  assert.equal(isRejoinWindowClosed('2026-08-17T09:59:00Z', now), true);
});
