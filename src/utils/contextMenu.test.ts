// src/utils/contextMenu.test.ts
// Client-side tests for the pure context-menu helpers (positioning, item
// builders, delete eligibility, selection, long-press tracking).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampMenuPosition,
  conversationKeyFor,
  canDeleteForEveryone,
  deleteOptionsFor,
  pinMessageToggleLabel,
  starToggleLabel,
  archiveToggleLabel,
  chatPinToggleLabel,
  favouriteToggleLabel,
  readToggleLabel,
  lockToggleLabel,
  buildMessageMenuItems,
  buildConversationMenuItems,
  toggleSelection,
  selectionCount,
  createLongPressTracker,
} from './contextMenu';

const t0 = Date.parse('2026-08-17T10:00:00Z');

// ─── positioning ─────────────────────────────────────────────────────────────

test('clampMenuPosition keeps the menu inside the viewport', () => {
  const vw = 1280;
  const vh = 800;
  assert.deepEqual(clampMenuPosition(10, 10, 220, 300, vw, vh), { x: 10, y: 10 });
  assert.deepEqual(clampMenuPosition(1200, 700, 220, 300, vw, vh), { x: 1052, y: 400 });
});

test('clampMenuPosition flips above when there is no room below', () => {
  const vw = 1280;
  const vh = 800;
  const pos = clampMenuPosition(100, 750, 220, 300, vw, vh);
  assert.equal(pos.x, 100);
  assert.equal(pos.y, 450);
});

test('clampMenuPosition clamps into margin on every edge', () => {
  const pos = clampMenuPosition(-40, -40, 220, 300, 800, 600);
  assert.equal(pos.x, 8);
  assert.equal(pos.y, 8);
  const over = clampMenuPosition(790, 590, 220, 300, 800, 600);
  assert.equal(over.x, 572);
  assert.equal(over.y, 290);
});

test('clampMenuPosition handles menus taller than the viewport', () => {
  const pos = clampMenuPosition(100, 100, 220, 900, 400, 300);
  assert.equal(pos.x, 100);
  assert.equal(pos.y, 8);
});

test('conversationKeyFor mirrors the server pair id', () => {
  assert.equal(conversationKeyFor('b', 'a'), 'a:b');
  assert.equal(conversationKeyFor('a', 'b'), 'a:b');
  assert.equal(conversationKeyFor('x', 'x'), 'x:x');
});

// ─── delete eligibility ──────────────────────────────────────────────────────

const ownFresh = { id: 'm1', senderId: 'me', text: 'hi', createdAt: new Date(t0 + 60_000).toISOString(), deletedForEveryone: false };
const ownOld = { id: 'm2', senderId: 'me', text: 'old', createdAt: new Date(t0 - 16 * 60_000).toISOString(), deletedForEveryone: false };
const theirs = { id: 'm3', senderId: 'them', text: 'yo', createdAt: new Date(t0 + 60_000).toISOString(), deletedForEveryone: false };
const deleted = { id: 'm4', senderId: 'me', text: '', createdAt: new Date(t0 + 60_000).toISOString(), deletedForEveryone: true };

test('delete-for-everyone is limited to own messages within 15 minutes', () => {
  assert.equal(canDeleteForEveryone(ownFresh, 'me', t0 + 120_000), true);
  assert.equal(canDeleteForEveryone(ownFresh, 'me', t0 + 16 * 60_000 + 1), false);
  assert.equal(canDeleteForEveryone(ownOld, 'me', t0), false);
  assert.equal(canDeleteForEveryone(theirs, 'me', t0 + 120_000), false);
  assert.equal(canDeleteForEveryone(deleted, 'me', t0 + 120_000), false);
});

test('deleteOptionsFor offers delete-for-me for every visible message', () => {
  assert.deepEqual(deleteOptionsFor(ownFresh, 'me', t0 + 120_000), { canDeleteForMe: true, canDeleteForEveryone: true });
  assert.deepEqual(deleteOptionsFor(theirs, 'me', t0 + 120_000), { canDeleteForMe: true, canDeleteForEveryone: false });
  assert.deepEqual(deleteOptionsFor(ownOld, 'me', t0), { canDeleteForMe: true, canDeleteForEveryone: false });
  assert.deepEqual(deleteOptionsFor(deleted, 'me', t0 + 120_000), { canDeleteForMe: false, canDeleteForEveryone: false });
});

// ─── toggle labels ───────────────────────────────────────────────────────────

test('toggle labels flip with state', () => {
  assert.equal(pinMessageToggleLabel(false), 'Pin message');
  assert.equal(pinMessageToggleLabel(true), 'Unpin message');
  assert.equal(starToggleLabel(false), 'Star');
  assert.equal(starToggleLabel(true), 'Unstar');
  assert.equal(archiveToggleLabel(false), 'Archive');
  assert.equal(archiveToggleLabel(true), 'Unarchive');
  assert.equal(chatPinToggleLabel(false), 'Pin chat');
  assert.equal(chatPinToggleLabel(true), 'Unpin chat');
  assert.equal(favouriteToggleLabel(false), 'Add to favourites');
  assert.equal(favouriteToggleLabel(true), 'Remove from favourites');
  assert.equal(readToggleLabel(0), 'Mark as unread');
  assert.equal(readToggleLabel(2), 'Mark as read');
  assert.equal(lockToggleLabel(false), 'Lock chat');
  assert.equal(lockToggleLabel(true), 'Unlock chat');
});

// ─── message menu items ──────────────────────────────────────────────────────

test('buildMessageMenuItems covers the WhatsApp-style actions', () => {
  const items = buildMessageMenuItems(ownFresh, { myId: 'me', nowMs: t0 + 120_000, isPinned: false, isStarred: true });
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ['info', 'reply', 'copy', 'forward', 'edit', 'pin', 'star', 'select', 'delete']);
  assert.equal(items.find((i) => i.id === 'pin')!.label, 'Pin message');
  assert.equal(items.find((i) => i.id === 'star')!.label, 'Unstar');
  const del = items.find((i) => i.id === 'delete')!;
  assert.equal(del.danger, true);
  assert.equal(del.separatorBefore, true);
  assert.deepEqual(del.submenu!.map((s) => s.id), ['delete-for-me', 'delete-for-everyone']);
});

test('buildMessageMenuItems hides reply/copy/forward for deleted messages', () => {
  const items = buildMessageMenuItems(deleted, { myId: 'me', nowMs: t0 + 120_000, isPinned: true, isStarred: false });
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ['info', 'select', 'delete']);
  const del = items.find((i) => i.id === 'delete')!;
  assert.deepEqual(del.submenu!.map((s) => s.id), ['delete-for-me']);
});

test('buildMessageMenuItems drops delete-for-everyone outside the window', () => {
  const items = buildMessageMenuItems(ownOld, { myId: 'me', nowMs: t0, isPinned: false, isStarred: false });
  const del = items.find((i) => i.id === 'delete')!;
  assert.deepEqual(del.submenu!.map((s) => s.id), ['delete-for-me']);
});

// ─── conversation menu items ─────────────────────────────────────────────────

test('buildConversationMenuItems reflects per-user state', () => {
  const items = buildConversationMenuItems(
    { friendId: 'b', name: 'B', archived: true, pinned: false, favourite: true, locked: false, unreadCount: 0 },
    { conversationKey: 'a:b', lists: [] }
  );
  assert.deepEqual(items.map((i) => i.id), ['archive', 'lock', 'pin', 'read', 'favourite', 'lists', 'clear', 'delete']);
  assert.equal(items.find((i) => i.id === 'archive')!.label, 'Unarchive');
  assert.equal(items.find((i) => i.id === 'pin')!.label, 'Pin chat');
  assert.equal(items.find((i) => i.id === 'read')!.label, 'Mark as unread');
  assert.equal(items.find((i) => i.id === 'favourite')!.label, 'Remove from favourites');
  assert.equal(items.find((i) => i.id === 'lock')!.label, 'Lock chat');
  assert.equal(items.find((i) => i.id === 'clear')!.danger, true);
  assert.equal(items.find((i) => i.id === 'delete')!.danger, true);
  assert.equal(items.find((i) => i.id === 'clear')!.separatorBefore, true);
});

test('buildConversationMenuItems lists membership toggles per list', () => {
  const items = buildConversationMenuItems(
    { friendId: 'b', name: 'B', archived: false, pinned: false, favourite: false, locked: true, unreadCount: 3 },
    {
      conversationKey: 'a:b',
      lists: [
        { id: 'l1', name: 'Work', conversationIds: ['a:b'] },
        { id: 'l2', name: 'Friends', conversationIds: ['x:y'] },
      ],
    }
  );
  const sub = items.find((i) => i.id === 'lists')!.submenu!;
  assert.equal(sub.length, 3);
  assert.equal(sub[0].id, 'list:l1');
  assert.equal(sub[0].label, 'Remove from Work');
  assert.equal(sub[1].id, 'list:l2');
  assert.equal(sub[1].label, 'Add to Friends');
  assert.equal(sub[2].id, 'list:new');
  assert.equal(sub[2].label, 'New list');
  assert.equal(items.find((i) => i.id === 'read')!.label, 'Mark as read');
});

// ─── selection helpers ───────────────────────────────────────────────────────

test('toggleSelection adds, removes, and counts ids', () => {
  assert.deepEqual(toggleSelection('m1', []), ['m1']);
  assert.deepEqual(toggleSelection('m1', ['m1']), []);
  assert.deepEqual(toggleSelection('m2', ['m1']), ['m1', 'm2']);
  assert.equal(selectionCount(['m1', 'm2']), 2);
  assert.equal(selectionCount([]), 0);
});

// ─── long-press tracker (injected timers) ────────────────────────────────────

function makeFakeTimers() {
  let nowMs = 0;
  let pending: { fn: () => void; at: number } | null = null;
  const now = () => nowMs;
  const advance = (ms: number) => {
    nowMs += ms;
    if (pending && nowMs >= pending.at) {
      const fn = pending.fn;
      pending = null;
      fn();
    }
  };
  const schedule = (fn: () => void, ms: number) => {
    pending = { fn, at: nowMs + ms };
    return fn as unknown as ReturnType<typeof setTimeout>;
  };
  const clear = () => {
    pending = null;
  };
  return { now, advance, schedule, clear };
}

test('long press fires after the hold and reports the final position', () => {
  const timers = makeFakeTimers();
  let fired: { x: number; y: number } | null = null;
  const tracker = createLongPressTracker({ delay: 600, now: timers.now, schedule: timers.schedule, clear: timers.clear, onTrigger: (x, y) => (fired = { x, y }) });
  tracker.onStart(10, 20);
  tracker.onMove(12, 22);
  timers.advance(600);
  assert.deepEqual(fired, { x: 12, y: 22 });
  const end = tracker.onEnd();
  assert.equal(end.triggered, true);
  assert.deepEqual({ x: end.x, y: end.y }, { x: 12, y: 22 });
});

test('long press is cancelled by movement beyond the tolerance', () => {
  const timers = makeFakeTimers();
  let fired = false;
  const tracker = createLongPressTracker({ delay: 600, tolerance: 10, now: timers.now, schedule: timers.schedule, clear: timers.clear, onTrigger: () => (fired = true) });
  tracker.onStart(10, 20);
  tracker.onMove(30, 20);
  timers.advance(600);
  assert.equal(fired, false);
  assert.equal(tracker.onEnd().triggered, false);
});

test('long press does not fire after early release or cancel', () => {
  const timers = makeFakeTimers();
  let fired = false;
  const tracker = createLongPressTracker({ delay: 600, now: timers.now, schedule: timers.schedule, clear: timers.clear, onTrigger: () => (fired = true) });
  tracker.onStart(0, 0);
  assert.equal(tracker.onEnd().triggered, false);
  timers.advance(600);
  assert.equal(fired, false);

  tracker.onStart(0, 0);
  tracker.onCancel();
  timers.advance(600);
  assert.equal(fired, false);
});