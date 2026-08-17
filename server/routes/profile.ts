// server/routes/profile.ts
// Phase 6.11: authenticated profile statistics, computed server-side from the
// durable roomHistory / roomHistoryMembers tables. A user can only ever read
// their own statistics — the userId comes from the verified session.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth } from '../middleware/auth';
import { db } from '../db/index';
import { getUserRoomStats } from '../rooms/history';

const profile = new Hono();
profile.use('*', requireAuth);

profile.get('/stats', (c: Context) => {
  const userId = c.get('userId');
  const stats = getUserRoomStats(userId);

  // Attach the host display name for each recent entry (join users for the
  // room history rows) — cheap, and only ever for the requester's own rooms.
  const hostIds = [...new Set(stats.recentRooms.map((r) => r.hostUserId))];
  const names = new Map<string, { name: string }>();
  if (hostIds.length > 0) {
    const placeholders = hostIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`)
      .all(...hostIds) as { id: string; name: string }[];
    for (const r of rows) names.set(r.id, { name: r.name });
  }

  return c.json({
    stats: {
      hostedRooms: stats.hostedRooms,
      joinedRooms: stats.joinedRooms,
      totalWatchSeconds: stats.totalWatchSeconds,
      recentRooms: stats.recentRooms.map((r) => ({
        ...r,
        hostName: names.get(r.hostUserId)?.name ?? 'Unknown',
      })),
    },
  });
});

export { profile };