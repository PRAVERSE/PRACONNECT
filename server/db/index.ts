// server/db/index.ts
// Opens the SQLite database and runs the schema (idempotent).

import Database from 'better-sqlite3';
import path from 'path';
import { schema } from './schema';

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'praconnect.db');

export const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Helper to check existing table columns safely
function getTableColumns(tableName: string): string[] {
  try {
    return (db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((r) => r.name);
  } catch {
    return [];
  }
}

// Pre-alter existing tables if they exist before running schema index statements
const existingUsersCols = getTableColumns('users');
if (existingUsersCols.length > 0) {
  if (!existingUsersCols.includes('role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!existingUsersCols.includes('lastSeenAt')) {
    db.exec('ALTER TABLE users ADD COLUMN lastSeenAt TEXT');
  }
}

const existingDmCols = getTableColumns('directMessages');
if (existingDmCols.length > 0) {
  if (!existingDmCols.includes('replyToMessageId')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN replyToMessageId TEXT');
  }
  if (!existingDmCols.includes('forwardedFromMessageId')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN forwardedFromMessageId TEXT');
  }
  if (!existingDmCols.includes('deletedForEveryone')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN deletedForEveryone INTEGER NOT NULL DEFAULT 0');
  }
  if (!existingDmCols.includes('deletedAt')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN deletedAt TEXT');
  }
  if (!existingDmCols.includes('deletedByUserId')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN deletedByUserId TEXT');
  }
  if (!existingDmCols.includes('conversationId')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN conversationId TEXT');
  }
  if (!existingDmCols.includes('sequenceId')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN sequenceId INTEGER');
  }
  if (!existingDmCols.includes('attachmentId')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN attachmentId TEXT');
  }
  if (!existingDmCols.includes('editedAt')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN editedAt TEXT');
  }
  if (!existingDmCols.includes('expiresAt')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN expiresAt TEXT');
  }
  if (!existingDmCols.includes('vanish')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN vanish INTEGER NOT NULL DEFAULT 0');
  }
  if (!existingDmCols.includes('contentType')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN contentType TEXT');
  }
  if (!existingDmCols.includes('encryptionVersion')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN encryptionVersion TEXT');
  }
  if (!existingDmCols.includes('ciphertext')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN ciphertext TEXT');
  }
  if (!existingDmCols.includes('keyVersion')) {
    db.exec('ALTER TABLE directMessages ADD COLUMN keyVersion TEXT');
  }
}

const existingCusCols = getTableColumns('conversationUserSettings');
if (existingCusCols.length > 0) {
  if (!existingCusCols.includes('deliveredThroughSequenceId')) {
    db.exec('ALTER TABLE conversationUserSettings ADD COLUMN deliveredThroughSequenceId INTEGER NOT NULL DEFAULT 0');
  }
  if (!existingCusCols.includes('readThroughSequenceId')) {
    db.exec('ALTER TABLE conversationUserSettings ADD COLUMN readThroughSequenceId INTEGER NOT NULL DEFAULT 0');
  }
  if (!existingCusCols.includes('disappearingDuration')) {
    db.exec('ALTER TABLE conversationUserSettings ADD COLUMN disappearingDuration INTEGER NOT NULL DEFAULT 0');
  }
}

// Run schema statements one by one
// better-sqlite3's exec() handles multiple statements but we split to be safe
for (const statement of schema
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)) {
  db.exec(statement + ';');
}

// Phase 6.5: add removedAt to roomMembers on databases created before this
// column existed. Fresh databases get it from the CREATE TABLE above.
const memberCols = getTableColumns('roomMembers');
if (memberCols.length > 0 && !memberCols.includes('removedAt')) {
  db.exec('ALTER TABLE roomMembers ADD COLUMN removedAt TEXT');
}

// Phase C: media.playableKey (browser-ready MP4 produced by the FFmpeg
// pipeline) — pre-existing Phase B databases get it via ALTER. storageKey
// remains the retained original (only present when MEDIA_RETAIN_ORIGINAL=1).
const mediaCols = getTableColumns('media');
if (mediaCols.length > 0 && !mediaCols.includes('playableKey')) {
  db.exec('ALTER TABLE media ADD COLUMN playableKey TEXT');
}

// Phase 6.9: conversion metadata columns on uploads (MKV -> playable MP4).
const uploadCols = getTableColumns('uploads');
if (uploadCols.length > 0) {
  if (!uploadCols.includes('sourceFilename')) {
    db.exec('ALTER TABLE uploads ADD COLUMN sourceFilename TEXT');
  }
  if (!uploadCols.includes('playableFilename')) {
    db.exec('ALTER TABLE uploads ADD COLUMN playableFilename TEXT');
  }
  if (!uploadCols.includes('conversionStatus')) {
    db.exec("ALTER TABLE uploads ADD COLUMN conversionStatus TEXT NOT NULL DEFAULT 'uploaded'");
  }
}

const realtimeSequenceBackfill = db.transaction(() => {
  const missingConversation = (
    db.prepare('SELECT COUNT(*) AS n FROM directMessages WHERE conversationId IS NULL').get() as { n: number }
  ).n;
  if (missingConversation > 0) {
    db.exec(
      `UPDATE directMessages
       SET conversationId = min(senderId, recipientId) || ':' || max(senderId, recipientId)
       WHERE conversationId IS NULL`
    );
  }
  const missingSequence = (
    db.prepare('SELECT COUNT(*) AS n FROM directMessages WHERE sequenceId IS NULL').get() as { n: number }
  ).n;
  if (missingSequence > 0) {
    db.exec(
      `UPDATE directMessages
       SET sequenceId = (
         SELECT COUNT(*) FROM directMessages AS m2
         WHERE m2.conversationId = directMessages.conversationId
           AND (m2.createdAt < directMessages.createdAt
                OR (m2.createdAt = directMessages.createdAt AND m2.id <= directMessages.id))
       )
       WHERE sequenceId IS NULL`
    );
  }
  // Prime counters so the next insert continues where the backfill stopped.
  db.exec(
    `INSERT OR IGNORE INTO dmConversationSequences (conversationId, lastSequence)
     SELECT conversationId, MAX(sequenceId) FROM directMessages GROUP BY conversationId`
  );
});
realtimeSequenceBackfill();

// Phase 6.11: backfill persistent room history from rooms that were created
// before the history tables existed. Every active room row becomes one
// roomHistory row and every member row becomes one historical participation,
// so pre-existing rooms start counting toward hosted/joined/watch statistics
// immediately. Idempotent: INSERT OR IGNORE + the UNIQUE roomId index mean a
// second startup never duplicates history.
interface BackfillRoomRow {
  id: string;
  name: string;
  code: string;
  hostUserId: string;
  category: string;
  maxParticipants: number;
  currentMediaJson: string | null;
  createdAt: string;
  emptySince: string | null;
}
interface BackfillMemberRow {
  id: string;
  roomId: string;
  userId: string;
  role: string;
  joinedAt: string;
  leftAt: string | null;
}

function floorSeconds(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const diff = Date.parse(endIso) - Date.parse(startIso);
  return diff > 0 ? Math.floor(diff / 1000) : 0;
}

const backfillRoomHistory = db.transaction(() => {
  const rooms = db.prepare('SELECT * FROM rooms').all() as unknown as BackfillRoomRow[];
  for (const room of rooms) {
    const historyId = (
      db
        .prepare('SELECT id FROM roomHistory WHERE roomId = ?')
        .get(room.id) as { id: string } | undefined
    )?.id;
    if (historyId) {
      // Row already exists from a previous startup — only top up member rows.
      const members = db.prepare('SELECT * FROM roomMembers WHERE roomId = ?').all(room.id) as unknown as BackfillMemberRow[];
      for (const m of members) {
        db.prepare(
          `INSERT OR IGNORE INTO roomHistoryMembers (id, historyId, roomId, userId, role, joinedAt, leftAt, durationSeconds)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(room.id + '-' + m.userId, historyId, room.id, m.userId, m.role, m.joinedAt, m.leftAt, floorSeconds(m.joinedAt, m.leftAt));
      }
      continue;
    }
    const media = room.currentMediaJson ? (() => { try { return JSON.parse(room.currentMediaJson); } catch { return null; } })() : null;
    const members = db.prepare('SELECT * FROM roomMembers WHERE roomId = ?').all(room.id) as unknown as BackfillMemberRow[];
    db.prepare(
      `INSERT OR IGNORE INTO roomHistory (id, roomId, roomCode, roomName, hostUserId, category, createdAt, emptySince, endedAt, durationSeconds, participantCount, maxParticipants, createdMediaTitle, createdMediaType)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      room.id,
      room.id,
      room.code,
      room.name,
      room.hostUserId,
      room.category,
      room.createdAt,
      room.emptySince,
      room.emptySince ?? null,
      room.emptySince ? floorSeconds(room.createdAt, room.emptySince) : 0,
      members.length,
      room.maxParticipants,
      typeof media?.title === 'string' ? media.title : null,
      typeof media?.mediaType === 'string' ? media.mediaType : null
    );
    for (const m of members) {
      db.prepare(
        `INSERT OR IGNORE INTO roomHistoryMembers (id, historyId, roomId, userId, role, joinedAt, leftAt, durationSeconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(room.id + '-' + m.userId, room.id, room.id, m.userId, m.role, m.joinedAt, m.leftAt, floorSeconds(m.joinedAt, m.leftAt));
    }
  }
  return rooms.length;
});

const backfilled = backfillRoomHistory();
if (backfilled > 0) {
  console.log(`[db] Backfilled ${backfilled} pre-existing room(s) into roomHistory`);
}

// ─── Phase A/D: admin role bootstrap ──────────────────────────────────────────
// Designated administrator accounts are promoted server-side. ADMIN_EMAILS (or
// fallback ADMIN_EMAIL) names the accounts — never passwords. Comma-separated,
// whitespace-trimmed, case-insensitive, deduplicated. If an admin already exists,
// it is preserved and reused; an unknown email is ignored (the account can be
// promoted once registered). This runs at startup and is exported for auth/tests.

export function parseAdminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const rawList = env.ADMIN_EMAILS;
  let candidates: string[] = [];

  if (typeof rawList === 'string' && rawList.trim() !== '') {
    candidates = rawList.split(',');
  } else if (typeof env.ADMIN_EMAIL === 'string' && env.ADMIN_EMAIL.trim() !== '') {
    candidates = env.ADMIN_EMAIL.split(',');
  }

  const emails = new Set<string>();
  for (const entry of candidates) {
    const trimmed = entry.trim().toLowerCase();
    if (trimmed.length > 0) {
      emails.add(trimmed);
    }
  }

  return Array.from(emails);
}

export function bootstrapAdminRole(env: NodeJS.ProcessEnv = process.env): string[] {
  const adminEmails = parseAdminEmails(env);
  if (adminEmails.length === 0) return [];

  const promotedIds: string[] = [];
  const now = new Date().toISOString();

  for (const email of adminEmails) {
    const row = db
      .prepare('SELECT id, role FROM users WHERE email = ?')
      .get(email) as { id: string; role: string } | undefined;

    if (!row) continue;

    if (row.role === 'admin') {
      promotedIds.push(row.id);
      continue;
    }

    db.prepare("UPDATE users SET role = 'admin', updatedAt = ? WHERE id = ?").run(
      now,
      row.id
    );
    console.log(`[db] Promoted account to admin role (${email})`);
    promotedIds.push(row.id);
  }

  return promotedIds;
}

bootstrapAdminRole();

console.log(`[db] SQLite database opened at: ${dbPath}`);

/** Close the database (idempotent) — used by the graceful shutdown path. */
export function closeDatabase(): void {
  if (db.open) {
    db.close();
  }
}
