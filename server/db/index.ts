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

console.log(`[db] SQLite database opened at: ${dbPath}`);
