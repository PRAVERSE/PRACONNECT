// scripts/reset-local-db.ts
// Development-only local database reset script for PraConnect.
// Deletes all users and dependent user-owned data within a single transaction.
// Preserves the database schema (tables, columns, indexes, triggers).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// ─── 1. Safety Check ─────────────────────────────────────────────────────────
const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
if (nodeEnv === 'production') {
  console.error('Database reset blocked: NODE_ENV is production.');
  process.exit(1);
}

if (process.env.ALLOW_LOCAL_DB_RESET !== 'true') {
  console.error('Database reset blocked. Set ALLOW_LOCAL_DB_RESET=true for local development.');
  process.exit(1);
}

// ─── 2. Identify Database Path ───────────────────────────────────────────────
const rawDbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'praconnect.db');
const dbPath = path.resolve(process.cwd(), rawDbPath);

// Print ONLY the database path without any secret values
console.log(`DATABASE_PATH = ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.log(`[db:reset-local] Database file does not exist at ${dbPath}. Nothing to reset.`);
  process.exit(0);
}

// ─── 3. Open SQLite Database ────────────────────────────────────────────────
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── 4. Tables in safe deletion order (children first, parents last) ─────────
export const TABLES_TO_RESET = [
  'mediaUploadSessions',
  'media',
  'conversationListMembers',
  'conversationLists',
  'conversationDeletions',
  'chatLocks',
  'conversationUserSettings',
  'messagePins',
  'starredMessages',
  'messageDeletions',
  'directMessages',
  'watchInvites',
  'friendships',
  'roomHistoryMembers',
  'roomHistory',
  'uploads',
  'roomEvents',
  'roomMembers',
  'rooms',
  'pendingSignups',
  'loginActivity',
  'passwordResetTokens',
  'emailOtps',
  'sessions',
  'users',
] as const;

function getTableCount(table: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

// Pre-reset counts
console.log('\n--- Pre-Reset Table Counts ---');
const beforeCounts: Record<string, number> = {};
for (const table of TABLES_TO_RESET) {
  const count = getTableCount(table);
  beforeCounts[table] = count;
  console.log(`  ${table}: ${count}`);
}

// ─── 5. Transactional Deletion ──────────────────────────────────────────────
console.log('\n--- Starting Transactional Reset ---');
const resetTx = db.transaction(() => {
  for (const table of TABLES_TO_RESET) {
    try {
      db.prepare(`DELETE FROM ${table}`).run();
    } catch (err) {
      console.error(`Failed to delete from ${table}:`, (err as Error).message);
      throw err;
    }
  }
});

try {
  resetTx();
  console.log('[db:reset-local] Transaction committed successfully.');
} catch (err) {
  console.error('[db:reset-local] Transaction rolled back due to error:', (err as Error).message);
  db.close();
  process.exit(1);
}

// ─── 6. Local Storage / Upload Cleanup ──────────────────────────────────────
const uploadsDir = path.resolve(process.cwd(), process.env.UPLOADS_DIR ?? 'uploads');
if (fs.existsSync(uploadsDir) && path.basename(uploadsDir).toLowerCase() === 'uploads') {
  try {
    const entries = fs.readdirSync(uploadsDir);
    let deletedFiles = 0;
    for (const entry of entries) {
      const fullPath = path.join(uploadsDir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        fs.rmSync(fullPath, { force: true });
        deletedFiles++;
      } else if (stat.isDirectory() && entry === 'library') {
        const libEntries = fs.readdirSync(fullPath);
        for (const libEntry of libEntries) {
          const libFilePath = path.join(fullPath, libEntry);
          if (fs.statSync(libFilePath).isFile()) {
            fs.rmSync(libFilePath, { force: true });
            deletedFiles++;
          }
        }
      }
    }
    if (deletedFiles > 0) {
      console.log(`[db:reset-local] Cleaned ${deletedFiles} user/media file(s) from ${uploadsDir}`);
    }
  } catch (err) {
    console.warn(`[db:reset-local] Notice on cleaning uploads directory: ${(err as Error).message}`);
  }
}

// ─── 7. Post-Reset Verification ─────────────────────────────────────────────
console.log('\n--- Post-Reset Verification Table Counts ---');
let hasErrors = false;
const afterCounts: Record<string, number> = {};
for (const table of TABLES_TO_RESET) {
  const count = getTableCount(table);
  afterCounts[table] = count;
  console.log(`  ${table}: ${count}`);
  if (count !== 0) {
    console.error(`ERROR: Table ${table} is not empty (count: ${count})`);
    hasErrors = true;
  }
}

// ─── 8. Schema Integrity Check ──────────────────────────────────────────────
const remainingTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all() as { name: string }[];
console.log(`\nVerified schema preservation: ${remainingTables.length} tables intact.`);

db.close();

if (hasErrors) {
  console.error('\nDatabase reset completed with verification failures.');
  process.exit(1);
} else {
  console.log('\nDatabase reset completed successfully. All user accounts and dependent data deleted.');
}
