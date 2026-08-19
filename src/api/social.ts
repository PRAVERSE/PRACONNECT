// src/api/social.ts
// Frontend API client for PraConnect social features: user directory, friend
// requests, direct messages, watch invitations, and the user-scoped live
// event stream. Mirrors the /api/rooms client conventions (credentials:
// 'include', { ok, data|error } responses).

export interface SocialUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface FriendListItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
  online: boolean;
  currentRoomCode: string | null;
  currentRoomName: string | null;
}

export interface FriendRequestItem {
  id: string;
  direction: 'incoming' | 'outgoing';
  user: SocialUser;
  createdAt: string;
}

export interface DirectMessageItem {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
  conversationId?: string;
  sequenceId?: number;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  clientMessageId?: string;
  /** Peer receiving the message (present on live `dm:new` events). */
  recipientId?: string;
  replyToMessageId?: string | null;
  forwardedFromMessageId?: string | null;
  deletedForEveryone?: boolean;
  replyTo?: { text: string; senderId: string; createdAt: string; deleted: boolean } | null;
  forwardedFrom?: { text: string; senderId: string; createdAt: string; deleted: boolean } | null;
}

export interface ConversationSummary {
  friendId: string;
  name: string;
  username: string;
  avatar: string;
  online: boolean;
  lastMessage: { text: string; senderId: string; createdAt: string } | null;
  lastSequenceId?: number;
  archived?: boolean;
  pinned?: boolean;
  favourite?: boolean;
  locked?: boolean;
  unreadCount?: number;
}

/** Per-user conversation preferences (archive/pin/favourite/read state and
 *  whether the user has set a chat lock PIN). */
export interface ConversationSettings {
  friendId: string;
  conversationId: string;
  archived: boolean;
  pinned: boolean;
  favourite: boolean;
  locked: boolean;
  lastReadAt: string | null;
  lastReadMessageId: string | null;
  hasLock: boolean;
}

/** Private user-owned conversation list. `conversationIds` are canonical
 *  pair keys (sorted user ids joined with ':'), same as the server. */
export interface ConversationList {
  id: string;
  name: string;
  createdAt: string;
  conversationIds: string[];
}

export interface StarredMessageItem {
  message: DirectMessageItem;
  friendId: string;
  peerName: string;
  peerUsername: string;
  starredAt: string;
}

export interface WatchInviteItem {
  id: string;
  direction: 'incoming' | 'outgoing';
  sender: SocialUser;
  recipient: SocialUser;
  roomId: string;
  roomCode: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
  roomAlive: boolean;
}

export interface SocialApiError {
  code: string;
  message: string;
}

export interface SocialApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: SocialApiError;
}

async function request<T>(
  url: string,
  init?: RequestInit
): Promise<SocialApiResponse<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || { code: 'REQUEST_FAILED', message: 'Request failed.' },
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

// ─── User directory ──────────────────────────────────────────────────────────

export interface UserSearchResult {
  users: SocialUser[];
  total: number;
  nextOffset: number;
}

export function searchUsersApi(q: string, limit = 20, offset = 0): Promise<SocialApiResponse<UserSearchResult>> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  console.log('[FRIENDS DEBUG] search request', { query: q, limit, offset });
  return request<UserSearchResult>(`/api/users/search?${params.toString()}`).then((res) => {
    console.log('[FRIENDS DEBUG] search response', {
      ok: res.ok,
      userCount: res.data?.users.length ?? 0,
      total: res.data?.total ?? 0,
      nextOffset: res.data?.nextOffset ?? 0,
      error: res.error ?? null,
    });
    return res;
  });
}

// ─── Friend requests & friendships ───────────────────────────────────────────

export function sendFriendRequestApi(userId: string): Promise<SocialApiResponse<{ request: unknown }>> {
  return request<{ request: unknown }>(`/api/users/${encodeURIComponent(userId)}/friend-request`, {
    method: 'POST',
  });
}

export function fetchFriendsApi(): Promise<SocialApiResponse<{ friends: FriendListItem[] }>> {
  return request<{ friends: FriendListItem[] }>('/api/friends');
}

export function fetchFriendRequestsApi(): Promise<
  SocialApiResponse<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }>
> {
  return request<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }>('/api/friends/requests');
}

export function acceptFriendRequestApi(requestId: string): Promise<SocialApiResponse<{ friend: SocialUser }>> {
  return request<{ friend: SocialUser }>(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`, {
    method: 'POST',
  });
}

export function rejectFriendRequestApi(requestId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/friends/requests/${encodeURIComponent(requestId)}/reject`, {
    method: 'POST',
  });
}

// ─── Direct messages ─────────────────────────────────────────────────────────

export function fetchConversationsApi(): Promise<SocialApiResponse<{ conversations: ConversationSummary[] }>> {
  return request<{ conversations: ConversationSummary[] }>('/api/messages/conversations');
}

export function fetchMessagesApi(friendId: string, limit = 50): Promise<SocialApiResponse<{ messages: DirectMessageItem[] }>> {
  return request<{ messages: DirectMessageItem[] }>(
    `/api/messages/${encodeURIComponent(friendId)}?limit=${limit}`
  );
}

export function sendDirectMessageApi(friendId: string, text: string, opts?: { replyToMessageId?: string; forwardedFromMessageId?: string }): Promise<SocialApiResponse<{ message: DirectMessageItem }>> {
  return request<{ message: DirectMessageItem }>(`/api/messages/${encodeURIComponent(friendId)}`, {
    method: 'POST',
    body: JSON.stringify({ text, ...(opts?.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}), ...(opts?.forwardedFromMessageId ? { forwardedFromMessageId: opts.forwardedFromMessageId } : {}) }),
  });
}

// ─── Message context actions ─────────────────────────────────────────────────

export function forwardMessageApi(messageId: string, toFriendId: string): Promise<SocialApiResponse<{ message: DirectMessageItem }>> {
  return request<{ message: DirectMessageItem }>(`/api/messages/${encodeURIComponent(messageId)}/forward`, {
    method: 'POST',
    body: JSON.stringify({ toFriendId }),
  });
}

export function pinMessageApi(messageId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/${encodeURIComponent(messageId)}/pin`, { method: 'POST' });
}

export function unpinMessageApi(messageId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/${encodeURIComponent(messageId)}/pin`, { method: 'DELETE' });
}

export function starMessageApi(messageId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/${encodeURIComponent(messageId)}/star`, { method: 'POST' });
}

export function unstarMessageApi(messageId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/${encodeURIComponent(messageId)}/star`, { method: 'DELETE' });
}

export function fetchStarredMessagesApi(): Promise<SocialApiResponse<{ starred: StarredMessageItem[] }>> {
  return request<{ starred: StarredMessageItem[] }>('/api/messages/starred');
}

export function fetchPinnedMessagesApi(friendId: string): Promise<SocialApiResponse<{ messages: DirectMessageItem[] }>> {
  return request<{ messages: DirectMessageItem[] }>(`/api/messages/conversations/${encodeURIComponent(friendId)}/pinned`);
}

export function deleteMessageForMeApi(messageId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/${encodeURIComponent(messageId)}/delete-for-me`, { method: 'POST' });
}

export function deleteMessageForEveryoneApi(messageId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/${encodeURIComponent(messageId)}/delete-for-everyone`, { method: 'POST' });
}

// ─── Conversation settings & actions ─────────────────────────────────────────

export function fetchConversationSettingsApi(friendId: string): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return request<{ settings: ConversationSettings }>(`/api/messages/conversations/${encodeURIComponent(friendId)}/settings`);
}

function conversationAction<T>(friendId: string, action: string, method: 'POST' | 'DELETE'): Promise<SocialApiResponse<T>> {
  return request<T>(`/api/messages/conversations/${encodeURIComponent(friendId)}/${action}`, { method });
}

export function setConversationArchivedApi(friendId: string, archived: boolean): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return conversationAction(friendId, archived ? 'archive' : 'unarchive', 'POST');
}

export function setConversationPinnedApi(friendId: string, pinned: boolean): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return conversationAction(friendId, 'pin', pinned ? 'POST' : 'DELETE');
}

export function setConversationFavouriteApi(friendId: string, favourite: boolean): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return conversationAction(friendId, 'favourite', favourite ? 'POST' : 'DELETE');
}

export function markConversationReadApi(friendId: string): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return conversationAction(friendId, 'read', 'POST');
}

export function markConversationUnreadApi(friendId: string): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return conversationAction(friendId, 'unread', 'POST');
}

export function clearChatApi(friendId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return conversationAction(friendId, 'clear', 'POST');
}

export function deleteChatApi(friendId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/conversations/${encodeURIComponent(friendId)}`, { method: 'DELETE' });
}

export function setChatLockPinApi(friendId: string, pin: string): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return request<{ settings: ConversationSettings }>(`/api/messages/conversations/${encodeURIComponent(friendId)}/lock`, {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export function unlockChatApi(friendId: string, pin: string): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return request<{ settings: ConversationSettings }>(`/api/messages/conversations/${encodeURIComponent(friendId)}/unlock`, {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export function verifyChatLockApi(friendId: string, pin: string): Promise<SocialApiResponse<{ settings: ConversationSettings }>> {
  return request<{ settings: ConversationSettings }>(`/api/messages/conversations/${encodeURIComponent(friendId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

// ─── Private conversation lists ──────────────────────────────────────────────

export function fetchConversationListsApi(): Promise<SocialApiResponse<{ lists: ConversationList[] }>> {
  return request<{ lists: ConversationList[] }>('/api/messages/lists');
}

export function createConversationListApi(name: string): Promise<SocialApiResponse<{ list: ConversationList }>> {
  return request<{ list: ConversationList }>('/api/messages/lists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameConversationListApi(listId: string, name: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/lists/${encodeURIComponent(listId)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteConversationListApi(listId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
}

export function addConversationToListApi(listId: string, friendId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/lists/${encodeURIComponent(listId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ friendId }),
  });
}

export function removeConversationFromListApi(listId: string, friendId: string): Promise<SocialApiResponse<{ ok: true }>> {
  return request<{ ok: true }>(`/api/messages/lists/${encodeURIComponent(listId)}/members/${encodeURIComponent(friendId)}`, {
    method: 'DELETE',
  });
}

// ─── Watch invitations ───────────────────────────────────────────────────────

export function fetchWatchInvitesApi(): Promise<SocialApiResponse<{ invites: WatchInviteItem[] }>> {
  return request<{ invites: WatchInviteItem[] }>('/api/watch-invites');
}

export function sendWatchInviteApi(
  recipientUserId: string,
  roomId: string
): Promise<SocialApiResponse<{ invite: WatchInviteItem }>> {
  return request<{ invite: WatchInviteItem }>('/api/watch-invites', {
    method: 'POST',
    body: JSON.stringify({ recipientUserId, roomId }),
  });
}

export function acceptWatchInviteApi(inviteId: string): Promise<SocialApiResponse<{ invite: WatchInviteItem; roomCode: string }>> {
  return request<{ invite: WatchInviteItem; roomCode: string }>(
    `/api/watch-invites/${encodeURIComponent(inviteId)}/accept`,
    { method: 'POST' }
  );
}

export function declineWatchInviteApi(inviteId: string): Promise<SocialApiResponse<{ invite: WatchInviteItem }>> {
  return request<{ invite: WatchInviteItem }>(`/api/watch-invites/${encodeURIComponent(inviteId)}/decline`, {
    method: 'POST',
  });
}

// ─── User-scoped live event stream (SSE, fetch-based) ───────────────────────
// Simpler than the room stream: events are ephemeral notifications (the
// client refreshes authoritative state on delivery), so there is no cursor,
// no replay, and no membership recovery. 401 stops the stream; transient
// errors reconnect with exponential backoff.

export type UserSseState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'CLOSED';

export interface ConnectUserEventsOptions {
  onEvent: (type: string, payload: unknown) => void;
  onStateChange?: (state: UserSseState) => void;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

const USER_EVENT_TERMINAL_CODES = ['UNAUTHENTICATED'];

/** Connect to the current user's social event stream with reconnection. */
export function connectUserEvents(options: ConnectUserEventsOptions): () => void {
  const onEvent = options.onEvent;
  const onStateChange = options.onStateChange;
  const baseDelay = options.reconnectBaseDelayMs ?? 2000;
  const maxDelay = options.reconnectMaxDelayMs ?? 15000;

  let closed = false;
  let attempt = 0;
  let abortController: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: UserSseState): void {
    if (closed && next !== 'CLOSED') return;
    console.log(`[USER SSE] ${next} attempt=${attempt}`);
    onStateChange?.(next);
  }

  function clearRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (closed) return;
    clearRetry();
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    attempt += 1;
    setState('DISCONNECTED');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  }

  function handleFrame(frame: string): void {
    if (!frame.trim()) return;
    let eventType = 'message';
    const dataLines: string[] = [];
    for (const rawLine of frame.split(/\r?\n/)) {
      if (rawLine.startsWith(':')) continue; // comment / heartbeat ping
      if (rawLine.startsWith('event:')) {
        eventType = rawLine.slice(6).trim();
      } else if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }
    onEvent(eventType, payload);
  }

  async function readStream(res: Response): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const sep = /\r?\n\r?\n/;
        let match = buffer.match(sep);
        while (match && match.index !== undefined) {
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          handleFrame(frame);
          match = buffer.match(sep);
        }
      }
    } catch {
      // aborted or network failure — handled by the caller
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
  }

  async function connect(): Promise<void> {
    if (closed) return;
    clearRetry();
    abortController?.abort();
    abortController = new AbortController();
    setState('CONNECTING');

    let res: Response;
    try {
      res = await fetch('/api/users/events', {
        credentials: 'include',
        signal: abortController.signal,
      });
    } catch (err) {
      if (closed) return;
      if ((err as Error)?.name === 'AbortError') return;
      scheduleReconnect();
      return;
    }

    if (closed) return;
    if (!res.ok) {
      if (res.status === 401) {
        setState('CLOSED');
        return;
      }
      scheduleReconnect();
      return;
    }

    attempt = 0;
    setState('CONNECTED');
    await readStream(res);
    if (closed) return;
    scheduleReconnect();
  }

  void connect();

  return () => {
    if (closed) return;
    closed = true;
    clearRetry();
    abortController?.abort();
    console.log('[USER SSE] closed');
    setState('CLOSED');
  };
}
