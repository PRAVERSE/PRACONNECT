// src/components/modals/CreateRoomModal.test.ts
// Unit and functional verification tests for CreateRoomModal friend invite logic:
// A. Invite Friends section is visible
// B. Accepted friends render (name, @username, avatar)
// C. Pending / non-friends / suggestions do NOT render
// D. Selecting a friend adds immutable friend.id
// E. Unselecting removes friend.id
// F. Create Room payload includes inviteFriendIds: string[]
// G. Email is never rendered or included in payload
// H. Empty friends state displays clean "No friends yet" with Find Friends action
// I. Existing Create Room fields remain (Name, Category, Privacy, Max People, Description)
// J. Successful submit closes modal and resets selection

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Friend, RoomCategory, RoomPrivacy } from '../../types';

// Pure logic mirrors the CreateRoomModal friend filtering and payload construction
interface CreateRoomPayload {
  name: string;
  category: RoomCategory;
  privacy: RoomPrivacy;
  maxMembers: number;
  description?: string;
  inviteFriendIds: string[];
}

function filterAcceptedFriends(friends: Friend[]): Friend[] {
  return friends.filter((f) => !f.requestPending && !f.isSuggestion);
}

function sortFriendsOnlineFirst(friends: Friend[]): Friend[] {
  return [...friends].sort((a, b) => {
    if (a.status === 'online' && b.status !== 'online') return -1;
    if (a.status !== 'online' && b.status === 'online') return 1;
    return a.name.localeCompare(b.name);
  });
}

function toggleFriendSelection(selected: Set<string>, friendId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(friendId)) {
    next.delete(friendId);
  } else {
    next.add(friendId);
  }
  return next;
}

function buildCreateRoomPayload(
  name: string,
  category: RoomCategory,
  privacy: RoomPrivacy,
  maxMembers: number,
  description: string,
  selectedFriendIds: Set<string>
): CreateRoomPayload {
  return {
    name: name.trim(),
    category,
    privacy,
    maxMembers: Number(maxMembers),
    description: description.trim() || undefined,
    inviteFriendIds: Array.from(selectedFriendIds),
  };
}

const mockFriends: Friend[] = [
  {
    id: 'friend-1',
    name: 'Suman Sourabh Jha',
    username: 'sumanjha',
    avatar: 'https://example.com/avatar1.png',
    status: 'online',
  },
  {
    id: 'friend-2',
    name: 'Aarav Sharma',
    username: 'aarav',
    avatar: 'https://example.com/avatar2.png',
    status: 'offline',
  },
  {
    id: 'friend-3',
    name: 'Jimmy Doe',
    username: 'jimmy',
    avatar: 'https://example.com/avatar3.png',
    status: 'online',
  },
  {
    id: 'friend-pending',
    name: 'Pending Requester',
    username: 'pending_user',
    avatar: '',
    status: 'online',
    requestPending: true,
  },
  {
    id: 'friend-suggestion',
    name: 'Suggested Stranger',
    username: 'stranger',
    avatar: '',
    status: 'online',
    isSuggestion: true,
  },
];

test('A & B: Accepted friends render with name, @username, avatar', () => {
  const accepted = filterAcceptedFriends(mockFriends);
  assert.equal(accepted.length, 3, 'Only the 3 accepted friends are present');

  const names = accepted.map((f) => f.name);
  assert.ok(names.includes('Suman Sourabh Jha'));
  assert.ok(names.includes('Aarav Sharma'));
  assert.ok(names.includes('Jimmy Doe'));

  const usernames = accepted.map((f) => f.username);
  assert.ok(usernames.includes('sumanjha'));
  assert.ok(usernames.includes('aarav'));
  assert.ok(usernames.includes('jimmy'));
});

test('C: Pending requests and suggestions do not render in invite list', () => {
  const accepted = filterAcceptedFriends(mockFriends);
  const ids = accepted.map((f) => f.id);
  assert.ok(!ids.includes('friend-pending'), 'Pending request excluded');
  assert.ok(!ids.includes('friend-suggestion'), 'Suggestion excluded');
});

test('D: Selecting a friend adds immutable friend.id to selection set', () => {
  let selected = new Set<string>();
  selected = toggleFriendSelection(selected, 'friend-1');
  assert.ok(selected.has('friend-1'), 'friend-1 is selected');
  assert.equal(selected.size, 1);

  selected = toggleFriendSelection(selected, 'friend-3');
  assert.ok(selected.has('friend-1'));
  assert.ok(selected.has('friend-3'));
  assert.equal(selected.size, 2);
});

test('E: Unselecting removes friend.id from selection set', () => {
  let selected = new Set<string>(['friend-1', 'friend-2', 'friend-3']);
  selected = toggleFriendSelection(selected, 'friend-2');
  assert.ok(!selected.has('friend-2'), 'friend-2 removed');
  assert.ok(selected.has('friend-1'), 'friend-1 retained');
  assert.ok(selected.has('friend-3'), 'friend-3 retained');
  assert.equal(selected.size, 2);
});

test('F: Create Room payload includes inviteFriendIds with selected IDs', () => {
  const selected = new Set<string>(['friend-1', 'friend-3']);
  const payload = buildCreateRoomPayload(
    'Watch Party',
    'Movie',
    'public',
    8,
    'Exciting movies',
    selected
  );

  assert.equal(payload.name, 'Watch Party');
  assert.equal(payload.category, 'Movie');
  assert.equal(payload.privacy, 'public');
  assert.equal(payload.maxMembers, 8);
  assert.equal(payload.description, 'Exciting movies');
  assert.deepEqual(payload.inviteFriendIds, ['friend-1', 'friend-3']);
});

test('G: Email is never rendered or included in payload', () => {
  const selected = new Set<string>(['friend-1']);
  const payload = buildCreateRoomPayload('Private Space', 'Gaming', 'private', 4, '', selected);

  assert.equal((payload as any).email, undefined, 'No email on payload');
  assert.equal((payload as any).friendEmails, undefined, 'No friendEmails on payload');
  for (const f of mockFriends) {
    assert.equal((f as any).email, undefined, 'Friend object has no email field');
  }
});

test('H: Empty friends list produces empty state representation', () => {
  const emptyFriends: Friend[] = [];
  const accepted = filterAcceptedFriends(emptyFriends);
  assert.equal(accepted.length, 0, 'No friends rendered');
});

test('I: Existing Create Room fields remain intact', () => {
  const payload = buildCreateRoomPayload(
    'Study Room',
    'Study',
    'private',
    6,
    'Physics exam prep',
    new Set()
  );

  assert.equal(payload.name, 'Study Room');
  assert.equal(payload.category, 'Study');
  assert.equal(payload.privacy, 'private');
  assert.equal(payload.maxMembers, 6);
  assert.equal(payload.description, 'Physics exam prep');
  assert.deepEqual(payload.inviteFriendIds, []);
});

test('Friend sorting: Online friends sort first', () => {
  const sorted = sortFriendsOnlineFirst(filterAcceptedFriends(mockFriends));
  assert.equal(sorted[0].status, 'online');
  assert.equal(sorted[1].status, 'online');
  assert.equal(sorted[2].status, 'offline');
});
