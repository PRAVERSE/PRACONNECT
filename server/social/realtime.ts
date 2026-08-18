// server/social/realtime.ts
// User-scoped Server-Sent Events hub for social events (friend requests,
// acceptances, watch invitations, new direct messages). Unlike the room hub,
// these events are strictly EPHEMERAL — nothing is persisted here; the
// authoritative state lives in the DB and clients refresh on delivery. If a
// user has no live stream, the event is simply dropped (the client's next
// refresh re-syncs), so there is no replay machinery.

import type { StreamSink } from '../rooms/realtime';

// userId -> Set of all sinks currently listening for that user's events
const userClients = new Map<string, Set<StreamSink>>();

function encodeFrame(type: string, payload: unknown): Uint8Array {
  const text = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  return new TextEncoder().encode(text);
}

/** Broadcast an ephemeral social event to all live streams of a user. */
export function emitUserEvent(userId: string, type: string, payload: unknown): void {
  const set = userClients.get(userId);
  if (!set || set.size === 0) return;
  const frame = encodeFrame(type, payload);
  for (const sink of Array.from(set)) {
    try {
      sink.enqueue(frame);
    } catch {
      // Broken connection — stream cancel() will deregister it
    }
  }
}

/**
 * Register a sink for a user's live social event stream.
 * Returns the cleanup function (also invoked on abort).
 */
export function openUserEventStream(
  userId: string,
  signal: AbortSignal,
  sink: StreamSink,
  onClose?: () => void
): () => void {
  let streamClosed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const set = userClients.get(userId) ?? new Set<StreamSink>();
  set.add(sink);
  userClients.set(userId, set);

  const cleanup = () => {
    if (streamClosed) return;
    streamClosed = true;
    if (heartbeat) clearInterval(heartbeat);

    const current = userClients.get(userId);
    if (current) {
      current.delete(sink);
      if (current.size === 0) userClients.delete(userId);
    }

    try {
      sink.close();
    } catch {
      // already closed
    }
    onClose?.();
  };

  // Heartbeat every 25s to keep the connection alive (mirrors the room hub).
  heartbeat = setInterval(() => {
    try {
      sink.enqueue(new TextEncoder().encode(`: ping\n\n`));
    } catch {
      cleanup();
    }
  }, 25000);

  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}

/** Number of live streams currently open for a user (test/inspection helper). */
export function userStreamCount(userId: string): number {
  return userClients.get(userId)?.size ?? 0;
}
