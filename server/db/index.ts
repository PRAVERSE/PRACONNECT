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
const memberCols = (db.prepare('PRAGMA table_info(roomMembers)').all() as { name: string }[]).map((r) => r.name);
if (!memberCols.includes('removedAt')) {
  db.exec('ALTER TABLE roomMembers ADD COLUMN removedAt TEXT');
}

// Phase 6.9: conversion metadata columns on uploads (MKV -> playable MP4).
const uploadCols = (db.prepare('PRAGMA table_info(uploads)').all() as { name: string }[]).map((r) => r.name);
if (!uploadCols.includes('sourceFilename')) {
  db.exec('ALTER TABLE uploads ADD COLUMN sourceFilename TEXT');
}
if (!uploadCols.includes('playableFilename')) {
  db.exec('ALTER TABLE uploads ADD COLUMN playableFilename TEXT');
}
if (!uploadCols.includes('conversionStatus')) {
  db.exec("ALTER TABLE uploads ADD COLUMN conversionStatus TEXT NOT NULL DEFAULT 'uploaded'");
}

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

console.log(`[db] SQLite database opened at: ${dbPath}`);

/** Close the database (idempotent) — used by the graceful shutdown path. */
export function closeDatabase(): void {
  if (db.open) {
    db.close();
  }
}
