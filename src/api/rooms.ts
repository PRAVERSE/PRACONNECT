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
  url: string;
  poster?: string;
  duration?: number;
  type?: string;
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

/** Host only: upload a video file for the room */
export async function uploadRoomMediaApi(
  roomId: string,
  file: File
): Promise<RoomApiResponse<{ room: ServerRoom; media: MediaTrack }>> {
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
  text: string,
  reaction?: string
): Promise<RoomApiResponse<{ message: unknown }>> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, reaction }),
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

/** Connect to the room Server-Sent Events stream with automatic reconnection */
export function connectRoomEvents(
  roomId: string,
  onEvent: (type: string, payload: any) => void,
  onError?: (err: unknown) => void
): () => void {
  let eventSource: EventSource | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    try {
      eventSource = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`, {
        withCredentials: true,
      });

      const eventTypes = [
        'room:update',
        'member:join',
        'member:leave',
        'member:removed',
        'member:state',
        'host:changed',
        'chat:message',
        'signal',
      ];

      for (const type of eventTypes) {
        eventSource.addEventListener(type, (e: MessageEvent) => {
          if (closed) return;
          try {
            const data = JSON.parse(e.data);
            onEvent(type, data);
          } catch (err) {
            console.warn(`[SSE] Failed to parse event ${type}:`, err);
          }
        });
      }

      eventSource.onerror = (err) => {
        if (closed) return;
        onError?.(err);
        eventSource?.close();
        // Retry connection after 2 seconds
        retryTimer = setTimeout(connect, 2000);
      };
    } catch (err) {
      onError?.(err);
      if (!closed) {
        retryTimer = setTimeout(connect, 2000);
      }
    }
  }

  connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}
