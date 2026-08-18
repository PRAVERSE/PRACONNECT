// src/api/rooms.ts
// Frontend API client for PraConnect real-time rooms.
// Communicates with /api/rooms backend routes with credentials: 'include'.

import { MediaTrack } from '../types';

export interface ServerRoomMember {
  id: string;
  userId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  role: 'host' | 'member';
  micOn: boolean;
  cameraOn: boolean;
  screenShareOn: boolean;
  joinedAt: string;
}

export interface ServerRoomMedia {
  title: string;
  url?: string;
  poster?: string;
  duration?: number;
  type?: string;
  /** 'local-movie' = shared peer-to-peer via WebRTC (url is always absent); 'library' = admin media library (mediaId set, streamed from the server); 'url' = direct URL; 'hosted' = server upload. */
  mediaType?: 'local-movie' | 'library' | 'url' | 'hosted' | string;
  /** Admin library reference — present when mediaType === 'library'. */
  mediaId?: string;
  sourceUserId?: string;
  mimeType?: string;
}

export interface ServerRoomPlayback {
  isPlaying: boolean;
  position: number;
  updatedAt: string;
}

export interface ServerRoom {
  id: string;
  name: string;
  code: string;
  hostUserId: string;
  host: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  };
  category: string;
  privacy: string;
  maxParticipants: number;
  /** Number of members currently active in the room (never counts left/removed). */
  activeMemberCount: number;
  /** True when no member is currently active in the room. */
  isEmpty: boolean;
  /** True when the room is empty but still inside its 5-minute rejoin window. */
  isRejoinable: boolean;
  /** ISO timestamp (emptySince + 5 min) when the rejoin window closes; null when the room is active. */
  rejoinExpiresAt: string | null;
  memberCount: number;
  status: string;
  currentMedia: ServerRoomMedia | null;
  playback: ServerRoomPlayback;
  screenShareActive: boolean;
  description: string | null;
  createdAt: string;
  lastActivityAt: string;
  emptySince: string | null;
  members: ServerRoomMember[];
  isHost: boolean;
}

export interface RoomApiError {
  code: string;
  message: string;
}

export interface RoomApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: RoomApiError;
}

/** List active rooms accessible to the authenticated user */
export async function fetchRoomsApi(): Promise<ServerRoom[]> {
  try {
    const res = await fetch('/api/rooms', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ rooms: [] }));
    return data.rooms || [];
  } catch {
    return [];
  }
}

/** Fetch room details by id or code */
export async function fetchRoomApi(roomIdOrCode: string): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomIdOrCode)}`, {
      method: 'GET',
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'FETCH_FAILED', message: 'Failed to fetch room.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Create a new room (creator becomes host) */
export async function createRoomApi(params: {
  name: string;
  category?: string;
  privacy?: string;
  maxParticipants?: number;
  description?: string;
}): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'CREATE_FAILED', message: 'Failed to create room.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Join an existing room */
export async function joinRoomApi(roomIdOrCode: string): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomIdOrCode)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'JOIN_FAILED', message: 'Failed to join room.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Leave a room */
export async function leaveRoomApi(roomId: string): Promise<RoomApiResponse<ServerRoom | null>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'LEAVE_FAILED', message: 'Failed to leave room.' } };
    }
    return { ok: true, data: data.room ?? null };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: set room media stream/video */
export async function setRoomMediaApi(
  roomId: string,
  media: ServerRoomMedia | null
): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(media || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'MEDIA_FAILED', message: 'Failed to update media.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: select a published Media Library item for the room. The room
 *  stores a mediaId reference — every participant streams the playable MP4
 *  from the library; video never travels over WebRTC. */
export async function setRoomLibraryMediaApi(
  roomId: string,
  mediaId: string
): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/media/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mediaId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'MEDIA_FAILED', message: 'Failed to select media.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: upload a video file for the room */
export async function uploadRoomMediaApi(
  roomId: string,
  file: File
): Promise<
  RoomApiResponse<{
    room: ServerRoom;
    media: MediaTrack | null;
    conversion?: { status: 'processing' | 'ready' | 'failed' | string; title?: string; sourceFilename?: string };
  }>
> {
  try {
    console.log('[Diagnostics] [Before FormData Append]:', {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });

    if (file.size === 0) {
      return { ok: false, error: { code: 'EMPTY_FILE', message: 'Selected file appears to be empty (0 bytes) — try selecting it again.' } };
    }

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/media/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    console.log('[Diagnostics] [Upload response status]:', res.status);
    console.log('[Diagnostics] [Upload response JSON]:', data);
    console.log('[Diagnostics] [Returned media URL]:', data?.media?.url);

    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'UPLOAD_FAILED', message: data.error?.message || 'Failed to upload media file.' } };
    }
    return { ok: true, data: { room: data.room, media: data.media } };
  } catch (err) {
    console.warn('[Upload] Network failure during upload:', err);
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: control playback position and play/pause state */
export async function setPlaybackApi(
  roomId: string,
  input: { isPlaying: boolean; position?: number }
): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'PLAYBACK_FAILED', message: 'Failed to update playback.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: toggle room screen share */
export async function setScreenShareApi(roomId: string, active: boolean): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/screen-share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'SCREEN_SHARE_FAILED', message: 'Failed to update screen share.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Update own mic or camera device state */
export async function setSelfDeviceStateApi(
  roomId: string,
  patch: { micOn?: boolean; cameraOn?: boolean }
): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/self`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'DEVICE_STATE_FAILED', message: 'Failed to update device state.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Send a room chat message */
export async function sendRoomChatApi(
  roomId: string,
  text: string
): Promise<RoomApiResponse<{ message: unknown }>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'CHAT_FAILED', message: 'Failed to send message.' } };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/**
 * Send a transient room reaction. Reactions are broadcast ephemerally over
 * SSE — they are never persisted to chat history / room events.
 */
export async function sendRoomReactionApi(roomId: string, emoji: string): Promise<RoomApiResponse<{ ok: boolean }>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ emoji }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'REACTION_FAILED', message: 'Failed to send reaction.' } };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: remove a participant from the room */
export async function removeMemberApi(roomId: string, targetUserId: string): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(targetUserId)}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'MODERATION_FAILED', message: 'Failed to remove member.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: mute a participant */
export async function muteMemberApi(
  roomId: string,
  targetUserId: string,
  muted: boolean
): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(targetUserId)}/mute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ muted }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'MODERATION_FAILED', message: 'Failed to mute member.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Host only: set participant camera state */
export async function setMemberCameraApi(
  roomId: string,
  targetUserId: string,
  enabled: boolean
): Promise<RoomApiResponse<ServerRoom>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(targetUserId)}/camera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'MODERATION_FAILED', message: 'Failed to update member camera.' } };
    }
    return { ok: true, data: data.room };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

/** Send WebRTC signaling payload to target peer (or room broadcast) */
export async function sendSignalApi(
  roomId: string,
  params: { targetUserId?: string; signal: unknown }
): Promise<RoomApiResponse<{ ok: boolean }>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || { code: 'SIGNAL_FAILED', message: 'Failed to send signal.' } };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}

// ─── Room SSE: reconnect manager ──────────────────────────────────────────────
//
// Lifecycle: CONNECTING -> CONNECTED <-> DISCONNECTED, with
// RECOVERING_MEMBERSHIP in between when the server no longer considers the
// user an active member, and CLOSED once the stream is intentionally torn
// down (room left, removed, destroyed, terminal error).
//
// - Last-Event-ID is preserved across reconnects and only advanced after an
//   event has been processed, so a reconnect resumes from the last consumed
//   persisted event.
// - Persisted events carry an `id:`; frames with an id <= the cursor are
//   duplicate/replayed and skipped. Ephemeral signaling frames carry no id
//   and are never deduplicated by the cursor.
// - A fetch stream (instead of EventSource) is used so the cursor can be sent
//   as a header and so HTTP error responses (401/403/404/409/429) can be
//   distinguished instead of being retried blindly.
// - Membership recovery re-joins via the existing join API and, on success,
//   hands the authoritative room state to onRoomRecovered before resuming the
//   event stream with the preserved cursor.

export type RoomSseState =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECOVERING_MEMBERSHIP'
  | 'CLOSED';

export interface ConnectRoomEventsOptions {
  roomId: string;
  onEvent: (type: string, payload: unknown) => void;
  /** Fired on every state transition with the current persisted-event cursor. */
  onStateChange?: (state: RoomSseState, info?: { lastEventId?: number; reason?: string }) => void;
  /** Fired with authoritative room state after membership recovery succeeds. */
  onRoomRecovered?: (room: ServerRoom) => void;
  /** Fired when recovery is abandoned (401/403/404/409) so the UI can surface it. */
  onRecoveryFailure?: (code: string) => void;
  /** Prevents auto-rejoin (e.g. user intentionally left or was removed). Default: true. */
  canAutoRejoin?: () => boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

const RECOVERY_TERMINAL_CODES = [
  'UNAUTHENTICATED',
  'REMOVED_FROM_ROOM',
  'ROOM_MEMBERSHIP_REQUIRED',
  'ROOM_NOT_FOUND',
  'ROOM_GONE',
  'ROOM_FULL',
];

/** Connect to the room Server-Sent Events stream with automatic reconnection. */
export function connectRoomEvents(options: ConnectRoomEventsOptions): () => void {
  const {
    roomId,
    onEvent,
    onStateChange,
    onRoomRecovered,
    onRecoveryFailure,
  } = options;
  const canAutoRejoin = options.canAutoRejoin ?? (() => true);
  const baseDelay = options.reconnectBaseDelayMs ?? 2000;
  const maxDelay = options.reconnectMaxDelayMs ?? 15000;

  let closed = false;
  let lastEventId = 0;
  let attempt = 0;
  let recovering = false;
  let abortController: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: RoomSseState, reason?: string): void {
    if (closed && next !== 'CLOSED') return;
    console.log(
      `[ROOM SSE] ${next} room=${roomId} lastEventId=${lastEventId}${reason ? ` reason=${reason}` : ''}`
    );
    onStateChange?.(next, { lastEventId: lastEventId || undefined, reason });
  }

  function clearRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function stop(reason: string): void {
    if (closed) return;
    closed = true;
    clearRetry();
    abortController?.abort();
    setState('CLOSED', reason);
  }

  function scheduleReconnect(reason: string): void {
    if (closed) return;
    clearRetry();
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    attempt += 1;
    setState('DISCONNECTED', reason);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  }

  /** Re-establish server-side membership (grace period expired / private room 403). */
  async function recoverMembership(): Promise<void> {
    if (closed || recovering) return;
    recovering = true;
    setState('RECOVERING_MEMBERSHIP', 'membership-lost');
    try {
      if (!canAutoRejoin()) {
        stop('leave');
        return;
      }
      const res = await joinRoomApi(roomId);
      if (!res.ok || !res.data) {
        const code = res.error?.code ?? 'UNKNOWN';
        const terminal = RECOVERY_TERMINAL_CODES.includes(code);
        console.log(`[ROOM SSE] membership recovery failed room=${roomId} code=${code} terminal=${terminal}`);
        if (terminal) {
          onRecoveryFailure?.(code);
          stop(code);
        } else {
          // Transient (network / rate limit / 5xx): keep retrying with backoff.
          scheduleReconnect(`recovery-retry:${code}`);
        }
        return;
      }
      console.log(`[ROOM SSE] membership recovered room=${roomId} lastEventId=${lastEventId}`);
      onRoomRecovered?.(res.data);
      attempt = 0;
      void connect();
    } finally {
      recovering = false;
    }
  }

  /** Dispatch one complete SSE frame; skip duplicates and advance the cursor. */
  function handleFrame(frame: string): void {
    if (!frame.trim()) return;
    let eventType = 'message';
    let eventId: number | null = null;
    const dataLines: string[] = [];
    for (const rawLine of frame.split(/\r?\n/)) {
      if (rawLine.startsWith(':')) continue; // comment / heartbeat ping
      if (rawLine.startsWith('id:')) {
        eventId = Number(rawLine.slice(3).trim());
      } else if (rawLine.startsWith('event:')) {
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

    if (eventId !== null) {
      if (eventId <= lastEventId) return; // duplicate / replayed — already processed
      onEvent(eventType, payload);
      lastEventId = eventId; // advance only after processing succeeded
    } else {
      // Ephemeral frame (WebRTC signals) — never deduplicated by the cursor.
      onEvent(eventType, payload);
    }
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
      // Stream aborted or network failure — handled by the caller.
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
      res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/events`, {
        headers: lastEventId > 0 ? { 'Last-Event-ID': String(lastEventId) } : undefined,
        credentials: 'include',
        signal: abortController.signal,
      });
    } catch (err) {
      if (closed) return;
      if ((err as Error)?.name === 'AbortError') return;
      scheduleReconnect('fetch-failed');
      return;
    }

    if (closed) return;
    if (!res.ok) {
      if (res.status === 401) {
        onRecoveryFailure?.('UNAUTHENTICATED');
        stop('auth');
        return;
      }
      if (res.status === 404) {
        onRecoveryFailure?.('ROOM_GONE');
        stop('room-gone');
        return;
      }
      if (res.status === 403) {
        // Membership lost (private room) or never authorized: attempt recovery.
        void recoverMembership();
        return;
      }
      // 429 (rate limited) and 5xx are transient.
      scheduleReconnect(`http-${res.status}`);
      return;
    }

    attempt = 0;
    setState('CONNECTED');
    await readStream(res);
    if (closed) return;
    scheduleReconnect('stream-ended');
  }

  void connect();

  return () => {
    if (closed) return;
    closed = true;
    clearRetry();
    abortController?.abort();
    console.log(`[ROOM SSE] closed room=${roomId} lastEventId=${lastEventId}`);
    onStateChange?.('CLOSED', { lastEventId: lastEventId || undefined, reason: 'closed' });
  };
}
