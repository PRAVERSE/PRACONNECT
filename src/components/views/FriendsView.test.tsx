// src/components/views/FriendsView.test.tsx
// Source-level structure tests for the final minimal two-tab Friends UI.
//
// These follow the repo's no-browser-framework convention (see
// src/webrtc/localMovie.test.ts): UI structure invariants are asserted
// directly against the component source with exact anchor strings. The pure
// behavior tests live in src/social/directory.test.ts.
//
// Run: npx tsx --test src/components/views/FriendsView.test.tsx

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRIENDS_TABS, directorySearchRequest } from '../../social/directory';

const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), './FriendsView.tsx');
const source = readFileSync(sourcePath, 'utf8');

// ─── A/B. The two tabs are rendered ─────────────────────────────────────────

test('A+B: SlidingTabs renders exactly the two FRIENDS_TABS entries', () => {
  assert.match(source, /import\s*\{[^}]*FRIENDS_TABS/, 'component must consume the canonical tab list');
  assert.match(source, /<SlidingTabs/);
  const tabsBlock = source.slice(source.indexOf('items={FRIENDS_TABS'), source.indexOf('onChange'));
  assert.match(tabsBlock, /FRIENDS_TABS\.map/, 'tab items must come from FRIENDS_TABS');
  const activeGuard = source.slice(source.indexOf('<SlidingTabs'), source.indexOf('onChange'));
  assert.match(activeGuard, /activeId=\{activeTab\}/);
});

// ─── C/D/E/F. No banned tabs exist anywhere in the component ────────────────

test('C+D+E+F: no Online/Offline/Requests/Suggestions tab ids or sections', () => {
  for (const banned of ['Online', 'Offline', 'Requests', 'Suggestions']) {
    assert.ok(!FRIENDS_TABS.some((t) => t.id === banned), `${banned} must not be a tab id`);
  }
  assert.doesNotMatch(source, /'Online'/, 'Online section must not exist');
  assert.doesNotMatch(source, /'Offline'/, 'Offline section must not exist');
  assert.doesNotMatch(source, /'Requests'/, 'Requests tab section must not exist');
  assert.doesNotMatch(source, /Suggestions/, 'Suggestions section must not exist');
});

// ─── G. Add @handle is gone ─────────────────────────────────────────────────

test('G: Add @handle input/button/handler is gone', () => {
  assert.doesNotMatch(source, /Add @handle/);
  assert.doesNotMatch(source, /Friend handle to add/);
  assert.doesNotMatch(source, /addInput/, 'manual-handle state must not exist');
  assert.doesNotMatch(source, /addFriend\(/, 'no manual-handle submit path');
});

// ─── H. Copy Invite Link is gone ────────────────────────────────────────────

test('H: Copy Invite Link is gone from the Friends UI', () => {
  assert.doesNotMatch(source, /Copy Invite Link/);
  assert.doesNotMatch(source, /copiedLink/, 'invite-link copy state must not exist');
  assert.doesNotMatch(source, /handleCopyInviteLink/);
});

// ─── I/J. The only search input lives in the Find Friends tab ───────────────

test('I+J: the only <input> in FriendsView is the Find Friends search field', () => {
  const inputIdx = source.indexOf('<input');
  assert.ok(inputIdx >= 0, 'a search input must exist');
  assert.equal(source.indexOf('<input', inputIdx + 1), -1, 'no other inputs — Friends tab renders no search');
  const searchIdx = source.indexOf('placeholder="Search any PraConnect user..."');
  assert.ok(searchIdx > inputIdx && searchIdx < inputIdx + 400, 'the single input is the Find Friends search');
  assert.match(source, /aria-label="Search any PraConnect user"/);
});

test('I2: the friends branch renders the accepted-friends list, never a search field', () => {
  const friendsStart = source.indexOf('{activeTab === \'friends\' ? (');
  const friendsEnd = source.indexOf('{/* FIND FRIENDS TAB — search + directory */}');
  assert.ok(friendsStart >= 0 && friendsEnd > friendsStart, 'friends branch must exist before the find-friends branch');
  const friendsBranch = source.slice(friendsStart, friendsEnd);
  assert.match(friendsBranch, /friends\.map\(/, 'accepted friends must be listed');
  assert.match(friendsBranch, /startDm\(friend\.id\)/, 'each friend row gets a Message action');
  assert.doesNotMatch(friendsBranch, /<input/, 'Friends tab must not render any search input');
});

// ─── K. Find Friends empty query loads real registered users ────────────────

test('K: opening Find Friends with an empty query loads page 1 of the directory', () => {
  const plan = directorySearchRequest('find-friends', '');
  assert.equal(plan?.query, '');
  assert.equal(plan?.offset, 0);
  assert.equal(plan?.delayMs, 0, 'no typing required — the fetch fires immediately');
  assert.match(source, /searchUsers\(plan\.query, plan\.offset\)/, 'the component must execute the plan through searchUsers');
  assert.match(source, /if \(activeTab !== 'find-friends'\) return;/, 'search must be gated to the Find Friends tab');
});

// ─── L/M/N. Relationship-aware actions (friendship-gated Message) ───────────

test('L: directory rows route all buttons through directoryRelationship + relationshipActions', () => {
  const rowStart = source.indexOf('const renderDirectoryRow');
  const rowEnd = source.indexOf('const handleLoadMore');
  assert.ok(rowStart >= 0 && rowEnd > rowStart, 'renderDirectoryRow must be defined before the load-more handler');
  const row = source.slice(rowStart, rowEnd);
  assert.match(row, /directoryRelationship\(user\.id, friends, incomingRequests, outgoingRequests\)/);
  assert.match(row, /relationshipActions\(relationship\)/);
  assert.match(row, /actions\.showMessage/);
  assert.match(row, /actions\.showAccept/);
  assert.match(row, /actions\.showRequested/);
  assert.match(row, /actions\.showAddFriend/);
});

test('M: the friends-state branch wires Message to startDm only for accepted friends', () => {
  const rowStart = source.indexOf('const renderDirectoryRow');
  const rowEnd = source.indexOf('const handleLoadMore');
  const row = source.slice(rowStart, rowEnd);
  const showMessageIdx = row.indexOf('actions.showMessage');
  assert.ok(showMessageIdx >= 0);
  const messageBranch = row.slice(showMessageIdx, row.indexOf('actions.showAccept'));
  assert.match(messageBranch, /startDm\(user\.id\)/, 'Message must start a DM');
  const nonMessage = row.slice(row.indexOf('actions.showAccept'));
  assert.doesNotMatch(nonMessage, /startDm/, 'no startDm outside the friends-state branch');
});

test('N: non-friends never get a Message button in the directory', () => {
  const rowStart = source.indexOf('const renderDirectoryRow');
  const rowEnd = source.indexOf('const handleLoadMore');
  const row = source.slice(rowStart, rowEnd);
  const addIdx = row.indexOf('Add Friend');
  const addBlock = row.slice(addIdx, addIdx + 300);
  assert.doesNotMatch(addBlock, /startDm/, 'Add Friend must never start a DM');
  const requestedIdx = row.indexOf('Requested');
  const requestedBlock = row.slice(requestedIdx, requestedIdx + 200);
  assert.doesNotMatch(requestedBlock, /startDm/, 'Requested chip must never start a DM');
});

// ─── Requests entry point: small header bell, never a tab ───────────────────

test('requests: only a small header bell exposes pending requests (badge = incoming count)', () => {
  assert.match(source, /<Bell/, 'bell icon must exist in the header');
  assert.match(source, /pendingRequestCount/);
  assert.match(source, /aria-label=\{`Friend requests/);
  assert.match(source, /incomingRequests\.length/, 'badge must count pending incoming requests');
});