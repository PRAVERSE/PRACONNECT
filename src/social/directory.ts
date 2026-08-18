// src/social/directory.ts
// Pure helpers for the Find Friends directory. Kept free of React/network so
// the response mapping, relationship state, and empty-query behavior can be
// unit-tested without a browser.

import { SocialUser, FriendRequestItem } from '../api/social';

export interface DirectoryPage {
  users: SocialUser[];
  total: number;
  nextOffset: number;
}

/**
 * Canonical relationship states relative to the current session. The UI action
 * mapping (relationshipActions) is the ONLY place that decides which buttons a
 * user card may render — every surface (Find Friends, Requests, friends list,
 * squad panel) must go through it so the friendship-gated DM rule holds
 * everywhere:
 *   - [Message] is shown ONLY for an accepted friendship ('friends').
 *   - none / incoming_pending / outgoing_pending NEVER show [Message].
 */
export type DirectoryRelationship = 'none' | 'incoming_pending' | 'outgoing_pending' | 'friends';

/**
 * Map one raw server payload row into a SocialUser. Defensive on purpose:
 * a missing avatar or a renamed field must never drop a user from the list.
 */
export function mapSearchUser(raw: unknown): SocialUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id) return null;

  const name =
    (typeof row.name === 'string' && row.name.trim()) ||
    (typeof row.displayName === 'string' && row.displayName.trim()) ||
    'Unknown';
  const username = typeof row.username === 'string' ? row.username : '';
  const avatarUrl =
    (typeof row.avatarUrl === 'string' && row.avatarUrl) ||
    (typeof row.avatar === 'string' && row.avatar) ||
    null;

  return { id: row.id, name, username, avatarUrl };
}

/**
 * Map a raw search response ({ users, total, nextOffset }) into a typed page.
 * Rows without a usable id are skipped, but a field mismatch never empties the
 * whole page.
 */
export function mapSearchResponse(data: unknown): DirectoryPage {
  const raw = (data ?? {}) as Record<string, unknown>;
  const users = (Array.isArray(raw.users) ? raw.users : [])
    .map((u) => mapSearchUser(u))
    .filter((u): u is SocialUser => u !== null);
  const total = typeof raw.total === 'number' ? raw.total : users.length;
  const nextOffset = typeof raw.nextOffset === 'number' ? raw.nextOffset : users.length;
  return { users, total, nextOffset };
}

/**
 * Relationship of a directory user relative to the current session.
 * Mirrors the server's canonical friendship model:
 *   accepted → 'friends', incoming pending → 'incoming_pending',
 *   outgoing pending → 'outgoing_pending', otherwise → 'none'.
 */
export function directoryRelationship(
  userId: string,
  friends: { id: string }[],
  incoming: FriendRequestItem[],
  outgoing: FriendRequestItem[]
): DirectoryRelationship {
  if (friends.some((f) => f.id === userId)) return 'friends';
  if (incoming.some((r) => r.user.id === userId)) return 'incoming_pending';
  if (outgoing.some((r) => r.user.id === userId)) return 'outgoing_pending';
  return 'none';
}

export interface RelationshipActions {
  showAddFriend: boolean;
  showRequested: boolean;
  showAccept: boolean;
  showMessage: boolean;
}

/**
 * Authoritative mapping of relationship state → allowed user-card actions.
 * [Message] is gated on an accepted friendship ONLY. The server re-enforces
 * this with FRIENDSHIP_REQUIRED (403) on every DM endpoint, so this mapping is
 * a UX guarantee, never the security boundary.
 */
export function relationshipActions(state: DirectoryRelationship): RelationshipActions {
  switch (state) {
    case 'friends':
      return { showAddFriend: false, showRequested: false, showAccept: false, showMessage: true };
    case 'incoming_pending':
      return { showAddFriend: false, showRequested: false, showAccept: true, showMessage: false };
    case 'outgoing_pending':
      return { showAddFriend: false, showRequested: true, showAccept: false, showMessage: false };
    default:
      return { showAddFriend: true, showRequested: false, showAccept: false, showMessage: false };
  }
}

/** Short status copy for a user card, mirroring the action states. */
export function relationshipLabel(state: DirectoryRelationship): string {
  switch (state) {
    case 'friends':
      return 'Friends';
    case 'incoming_pending':
      return 'Sent you a request';
    case 'outgoing_pending':
      return 'Request sent — awaiting response';
    default:
      return 'People on PraConnect';
  }
}

/**
 * Empty-state copy for the directory. An empty query with no results means
 * "no other users exist"; a non-empty query means "no match".
 */
export function directoryEmptyCopy(query: string, hasResults: boolean): string | null {
  if (query.trim()) {
    return hasResults ? null : `No people found for "${query.trim()}"`;
  }
  return hasResults ? null : 'No other PraConnect users found.';
}

// ─── Final minimal Friends UI: exactly two tabs ──────────────────────────────
// The Friends experience is a two-section surface ONLY. Any future tab must be
// added here so the structural tests keep the UI honest.

export const FRIENDS_TABS = [
  { id: 'friends', label: 'Friends' },
  { id: 'find-friends', label: 'Find Friends' },
] as const;

export type FriendsTab = (typeof FRIENDS_TABS)[number]['id'];

export interface DirectorySearchPlan {
  query: string;
  offset: number;
  delayMs: number;
}

/**
 * When should the directory search fire? The ONLY search surface is the Find
 * Friends tab. An empty query is a real request: the server treats q="" as
 * "first page of every registered user", so opening Find Friends immediately
 * loads people (no typing required). Typed queries debounce and reset to page
 * 1. The Friends tab never triggers a directory search.
 */
export function directorySearchRequest(tab: FriendsTab, query: string): DirectorySearchPlan | null {
  if (tab !== 'find-friends') return null;
  if (query.trim() === '') return { query: '', offset: 0, delayMs: 0 };
  return { query, offset: 0, delayMs: 300 };
}