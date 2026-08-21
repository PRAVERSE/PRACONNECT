// server/routes/profile.ts
// Phase 6.11: authenticated profile statistics, computed server-side from the
// durable roomHistory / roomHistoryMembers tables. A user can only ever read
// their own statistics — the userId comes from the verified session.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth } from '../middleware/auth';
import { db } from '../db/index';
import { getUserRoomStats } from '../rooms/history';
import { validateName, validateUsername, sanitizeUser, apiError } from '../auth/auth';
import { nowIso } from '../rooms/time';

const RESTRICTED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support',
  'praconnect', 'api', 'bot', 'mod', 'moderator', 'null', 'undefined'
]);

const profile = new Hono();
profile.use('*', requireAuth);

profile.get('/', async (c: Context) => {
  const userId = c.get('userId');
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get<Record<string, unknown>>(userId);
  if (!row) return c.json(apiError('USER_NOT_FOUND', 'User not found.'), 404);
  const safeUser = sanitizeUser(row);
  return c.json({
    user: safeUser,
    profile: {
      name: safeUser.name,
      username: safeUser.username,
      avatar: safeUser.avatarUrl || safeUser.name.charAt(0).toUpperCase() || 'U',
      bio: (row.bio as string) ?? '',
      email: safeUser.email,
    },
  });
});

profile.patch('/', async (c: Context) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);
  }

  const existingRow = await db.prepare('SELECT * FROM users WHERE id = ?').get<Record<string, unknown>>(userId);
  if (!existingRow) return c.json(apiError('USER_NOT_FOUND', 'User not found.'), 404);

  let newName = existingRow.name as string;
  let newUsername = existingRow.username as string;
  let newAvatarUrl = (existingRow.avatarUrl as string | null) ?? null;
  let newBio = (existingRow.bio as string | null) ?? null;

  if (typeof body.name === 'string') {
    const trimmedName = body.name.trim();
    const nameErr = validateName(trimmedName);
    if (nameErr) return c.json(apiError('VALIDATION_ERROR', nameErr), 400);
    newName = trimmedName;
  }

  if (typeof body.username === 'string') {
    const trimmedUsername = body.username.trim();
    const usernameErr = validateUsername(trimmedUsername);
    if (usernameErr) return c.json(apiError('VALIDATION_ERROR', usernameErr), 400);

    if (RESTRICTED_USERNAMES.has(trimmedUsername.toLowerCase())) {
      return c.json(apiError('VALIDATION_ERROR', 'This username is reserved and cannot be used.'), 400);
    }

    const duplicate = await db
      .prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?')
      .get(trimmedUsername, userId);
    if (duplicate) {
      return c.json(apiError('USERNAME_TAKEN', 'An account with this username already exists.'), 409);
    }
    newUsername = trimmedUsername;
  }

  if (typeof body.avatarUrl === 'string') {
    const trimmed = body.avatarUrl.trim();
    newAvatarUrl = trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
  } else if (typeof body.avatar === 'string') {
    const trimmed = body.avatar.trim();
    newAvatarUrl = trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
  }

  if (typeof body.bio === 'string') {
    const trimmed = body.bio.trim();
    newBio = trimmed.length > 0 ? trimmed.slice(0, 500) : null;
  }

  const now = nowIso();
  await db.prepare(
    'UPDATE users SET name = ?, username = ?, avatarUrl = ?, bio = ?, updatedAt = ? WHERE id = ?'
  ).run(newName, newUsername, newAvatarUrl, newBio, now, userId);

  const updatedRow = await db.prepare('SELECT * FROM users WHERE id = ?').get<Record<string, unknown>>(userId);
  if (!updatedRow) return c.json(apiError('USER_NOT_FOUND', 'User not found after update.'), 404);
  const safeUser = sanitizeUser(updatedRow);

  return c.json({
    ok: true,
    user: safeUser,
    profile: {
      name: safeUser.name,
      username: safeUser.username,
      avatar: safeUser.avatarUrl || safeUser.name.charAt(0).toUpperCase() || 'U',
      bio: (updatedRow.bio as string) ?? '',
      email: safeUser.email,
    },
  });
});

profile.get('/stats', async (c: Context) => {
  const userId = c.get('userId');
  const stats = await getUserRoomStats(userId);

  // Attach the host display name for each recent entry (join users for the
  // room history rows) — cheap, and only ever for the requester's own rooms.
  const hostIds = [...new Set(stats.recentRooms.map((r) => r.hostUserId))];
  const names = new Map<string, { name: string }>();
  if (hostIds.length > 0) {
    const placeholders = hostIds.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`)
      .all<{ id: string; name: string }>(...hostIds);
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