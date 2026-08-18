// server/rooms/cleanup.ts
// Periodic maintenance worker. Runs a bounded interval (default 30s) and
// sweeps:
//   1. empty rooms (emptySince older than the TTL; transactional, files too),
//   2. old room events (per-room cap + age-based retention),
//   3. expired authentication data (sessions, OTPs, reset tokens, pending
//      signups, login activity),
//   4. orphaned upload files (no DB record, older than the grace period),
//   5. Phase C media: expired upload sessions, orphaned library files, and
//      leftover FFmpeg temp outputs.
// A single shared timer — no per-room timers, so no resource leaks. The timer
// is unref()'d (it never keeps the process alive on its own) and stopped
// during graceful shutdown. Only aggregate counts are logged — never tokens,
// hashes, emails, or credentials.

import { cleanupEmptyRooms, ROOM_EMPTY_TTL_MS } from './service';
import { cleanupRoomEvents, ROOM_EVENTS_MAX_PER_ROOM, ROOM_EVENTS_RETENTION_MS } from './realtime';
import { cleanupAuthData, LOGIN_ACTIVITY_RETENTION_MS } from '../auth/cleanup';
import { sweepOrphanUploads, ORPHAN_UPLOAD_RETENTION_MS } from '../uploads/lifecycle';
import { cleanupSocialData, WATCH_INVITE_TTL_MS } from '../social/service';
import { runMediaCleanup } from '../media/cleanup';
import { ORPHAN_MEDIA_RETENTION_MS } from '../media/config';

let worker: ReturnType<typeof setInterval> | null = null;

export function startRoomCleanupWorker(intervalMs = 30000): void {
  if (worker) return;
  console.log(
    `[cleanup] Maintenance worker started (sweep every ${intervalMs}ms; ` +
      `empty room TTL ${ROOM_EMPTY_TTL_MS}ms, room events max ${ROOM_EVENTS_MAX_PER_ROOM}/room ` +
      `retention ${ROOM_EVENTS_RETENTION_MS}ms, login activity retention ` +
      `${LOGIN_ACTIVITY_RETENTION_MS}ms, orphan upload grace ${ORPHAN_UPLOAD_RETENTION_MS}ms, ` +
      `watch invite TTL ${WATCH_INVITE_TTL_MS}ms, media orphan grace ${ORPHAN_MEDIA_RETENTION_MS}ms)`
  );
  worker = setInterval(() => {
    try {
      const deletedRooms = cleanupEmptyRooms();
      if (deletedRooms.length > 0) {
        console.log(`[cleanup] Removed ${deletedRooms.length} empty room(s)`);
      }

      const events = cleanupRoomEvents();
      if (events.deleted > 0) {
        console.log(`[cleanup] Trimmed ${events.deleted} old room event(s) across ${events.roomsProcessed} room(s)`);
      }

      const auth = cleanupAuthData();
      if (auth.total > 0) {
        console.log(
          `[cleanup] Auth data: ${auth.deletedSessions} session(s), ${auth.deletedOtps} OTP(s), ` +
            `${auth.deletedResetTokens} reset token(s), ${auth.deletedPendingSignups} pending signup(s), ` +
            `${auth.deletedLoginActivity} login activity row(s)`
        );
      }

      const orphans = sweepOrphanUploads();
      if (orphans > 0) {
        console.log(`[cleanup] Removed ${orphans} orphaned upload file(s)`);
      }

      const social = cleanupSocialData();
      if (social.expiredInvites > 0 || social.purgedRejected > 0) {
        console.log(
          `[cleanup] Social: expired ${social.expiredInvites} watch invite(s), ` +
            `purged ${social.purgedRejected} rejected friendship(s)`
        );
      }

      const media = runMediaCleanup();
      void media.then((result) => {
        if (result.expiredSessions > 0 || result.orphanFiles > 0 || result.tempFiles > 0) {
          console.log(
            `[cleanup] Media: expired ${result.expiredSessions} upload session(s), ` +
              `removed ${result.orphanFiles} orphaned library file(s), ` +
              `removed ${result.tempFiles} stale conversion temp file(s)`
          );
        }
      });
    } catch (err) {
      console.error('[cleanup] Maintenance sweep failed:', (err as Error).message);
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
