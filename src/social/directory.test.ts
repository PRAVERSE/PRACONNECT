// src/social/directory.test.ts
// Pure unit tests for the Find Friends directory helpers: response mapping,
// relationship state, and empty-query behavior.
//
// Run: npx tsx --test src/social/directory.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapSearchUser,
  mapSearchResponse,
  directoryRelationship,
  relationshipActions,
  relationshipLabel,
  directoryEmptyCopy,
  FRIENDS_TABS,
  directorySearchRequest,
} from './directory';

test('A: server payload row maps to SocialUser', () => {
  const user = mapSearchUser({ id: 'u1', name: 'User B', username: 'userb', avatarUrl: 'https://x/a.png' });
  assert.deepEqual(user, { id: 'u1', name: 'User B', username: 'userb', avatarUrl: 'https://x/a.png' });
});

test('B: null avatar is preserved and never drops the user', () => {
  const user = mapSearchUser({ id: 'u2', name: 'User A', username: 'usera', avatarUrl: null });
  assert.equal(user?.avatarUrl, null);
  assert.equal(user?.name, 'User A');
});

test('C: field mismatch (avatar / displayName) is tolerated', () => {
  const user = mapSearchUser({ id: 'u3', displayName: 'Samantha', username: 'sam', avatar: 'https://x/b.png' });
  assert.deepEqual(user, { id: 'u3', name: 'Samantha', username: 'sam', avatarUrl: 'https://x/b.png' });
});

test('D: malformed rows are skipped, valid rows survive', () => {
  const page = mapSearchResponse({
    users: [{ id: 'u1', name: 'A', username: 'a', avatarUrl: null }, { name: 'no id' }, null],
    total: 2,
    nextOffset: 1,
  });
  assert.equal(page.users.length, 1);
  assert.equal(page.users[0].id, 'u1');
  assert.equal(page.total, 2);
  assert.equal(page.nextOffset, 1);
});

test('E: empty search response maps to an empty page', () => {
  const page = mapSearchResponse({ users: [], total: 0, nextOffset: 0 });
  assert.deepEqual(page, { users: [], total: 0, nextOffset: 0 });
});

test('F: relationship is friends for accepted friendships', () => {
  const friends = [{ id: 'u1' }];
  assert.equal(directoryRelationship('u1', friends, [], []), 'friends');
});

test('G: relationship is incoming_pending when the other user requested us', () => {
  const incoming = [{ id: 'r1', direction: 'incoming' as const, user: { id: 'u2', name: 'B', username: 'b', avatarUrl: null }, createdAt: 'x' }];
  assert.equal(directoryRelationship('u2', [], incoming, []), 'incoming_pending');
});

test('H: relationship is outgoing_pending when we requested them', () => {
  const outgoing = [{ id: 'r1', direction: 'outgoing' as const, user: { id: 'u3', name: 'C', username: 'c', avatarUrl: null }, createdAt: 'x' }];
  assert.equal(directoryRelationship('u3', [], [], outgoing), 'outgoing_pending');
});

test('I: unrelated users are "none" and get the Add Friend button', () => {
  assert.equal(directoryRelationship('u9', [], [], []), 'none');
});

// ─── Relationship → actions mapping (friendship-gated DM UX) ────────────────

test('N: none shows Add Friend and hides Message/Accept/Requested', () => {
  const a = relationshipActions('none');
  assert.equal(a.showAddFriend, true);
  assert.equal(a.showRequested, false);
  assert.equal(a.showAccept, false);
  assert.equal(a.showMessage, false);
});

test('O: outgoing_pending shows Requested and hides Message', () => {
  const a = relationshipActions('outgoing_pending');
  assert.equal(a.showRequested, true);
  assert.equal(a.showAddFriend, false);
  assert.equal(a.showAccept, false);
  assert.equal(a.showMessage, false);
});

test('P: incoming_pending shows Accept and hides Message', () => {
  const a = relationshipActions('incoming_pending');
  assert.equal(a.showAccept, true);
  assert.equal(a.showAddFriend, false);
  assert.equal(a.showRequested, false);
  assert.equal(a.showMessage, false);
});

test('Q: friends shows Message and hides every other action', () => {
  const a = relationshipActions('friends');
  assert.equal(a.showMessage, true);
  assert.equal(a.showAddFriend, false);
  assert.equal(a.showRequested, false);
  assert.equal(a.showAccept, false);
});

test('R: Message is never exposed for non-accepted states', () => {
  for (const state of ['none', 'incoming_pending', 'outgoing_pending'] as const) {
    assert.equal(relationshipActions(state).showMessage, false, `${state} must hide Message`);
  }
});

test('S: relationship labels mirror the action states', () => {
  assert.equal(relationshipLabel('none'), 'People on PraConnect');
  assert.equal(relationshipLabel('outgoing_pending'), 'Request sent — awaiting response');
  assert.equal(relationshipLabel('incoming_pending'), 'Sent you a request');
  assert.equal(relationshipLabel('friends'), 'Friends');
});

test('J: empty query with no results says no other users exist', () => {
  assert.equal(directoryEmptyCopy('', false), 'No other PraConnect users found.');
});

test('K: empty query with results renders normally (no empty state)', () => {
  assert.equal(directoryEmptyCopy('', true), null);
});

test('L: non-empty query empty result shows a match-specific message', () => {
  assert.equal(directoryEmptyCopy('sam', false), 'No people found for "sam"');
});

test('M: non-empty query with results renders normally', () => {
  assert.equal(directoryEmptyCopy('sam', true), null);
});

// ─── Two-tab Friends structure (final minimal experience) ────────────────────
// The Friends UI has exactly two sections: Friends and Find Friends. No Online,
// Offline, Requests, or Suggestions tabs exist anywhere in the structure.

test('T1: Friends UI exposes exactly two tabs: Friends and Find Friends', () => {
  assert.deepEqual(
    FRIENDS_TABS.map((t) => t.id),
    ['friends', 'find-friends']
  );
  assert.deepEqual(
    FRIENDS_TABS.map((t) => t.label),
    ['Friends', 'Find Friends']
  );
});

test('T2: no Online / Offline / Requests / Suggestions tabs exist', () => {
  const ids: string[] = FRIENDS_TABS.map((t) => t.id);
  for (const banned of ['Online', 'Offline', 'Requests', 'Suggestions']) {
    assert.ok(!ids.includes(banned), `${banned} tab must not exist`);
  }
});

test('T3: Find Friends empty query loads page 1 of registered users immediately', () => {
  const plan = directorySearchRequest('find-friends', '');
  assert.deepEqual(plan, { query: '', offset: 0, delayMs: 0 });
});

test('T4: Find Friends typed queries debounce and reset to page 1', () => {
  const plan = directorySearchRequest('find-friends', '   sam   ');
  assert.deepEqual(plan, { query: '   sam   ', offset: 0, delayMs: 300 });
});

test('T5: the Friends tab never issues a directory search', () => {
  assert.equal(directorySearchRequest('friends', ''), null);
  assert.equal(directorySearchRequest('friends', 'sam'), null);
});