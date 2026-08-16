// server/rooms/cleanup.ts
// Phase 3: periodic empty-room cleanup worker.
// Runs a bounded interval (default 30s) and deletes only rooms whose
// emptySince is older than the configured TTL. A single shared timer —
// no per-room timers, so no resource leaks.

import { cleanupEmptyRooms, ROOM_EMPTY_TTL_MS } from './service';

let worker: ReturnType<typeof setInterval> | null = null;

export function startRoomCleanupWorker(intervalMs = 30000): void {
  if (worker) return;
  console.log(`[rooms] Cleanup worker started (empty TTL ${ROOM_EMPTY_TTL_MS}ms, sweep every ${intervalMs}ms)`);
  worker = setInterval(() => {
    try {
      const deleted = cleanupEmptyRooms();
      if (deleted.length > 0) {
        console.log(`[rooms] Cleanup removed ${deleted.length} empty room(s):`, deleted.join(', '));
      }
    } catch (err) {
      console.error('[rooms] Cleanup sweep failed:', (err as Error).message);
    }
  }, intervalMs);
  // Do not keep the process alive solely for the worker.
  worker.unref?.();
}

export function stopRoomCleanupWorker(): void {
  if (worker) {
    clearInterval(worker);
    worker = null;
  }
}