// scripts/cleanup-test-data.ts
// Development-only safe cleanup script for PraConnect.
// Removes confirmed test users, test rooms, and test-generated state
// from the local development database while preserving real accounts,
// real media library items, and database schema integrity.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// ─── 1. Safety Gates ────────────────────────────────────────────────────────
const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
if (nodeEnv === 'production') {
  console.error('Safety gate triggered: cleanup-test-data is disabled in production.');
  process.exit(1);
}

if (process.env.ALLOW_LOCAL_TEST_CLEANUP !== 'true' && !process.argv.includes('--force')) {
  console.error(
    'Cleanup blocked. Set ALLOW_LOCAL_TEST_CLEANUP=true or pass --force to clean test data from local development DB.'
  );
  process.exit(1);
}

// ─── 2. Database Connection ──────────────────────────────────────────────────
const rawDbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'praconnect.db');
const dbPath = path.resolve(process.cwd(), rawDbPath);

console.log(`[cleanup] Target database: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.log(`[cleanup] Database file does not exist at ${dbPath}. Nothing to clean.`);
  process.exit(0);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── 3. Identify Real Accounts to NEVER Delete ──────────────────────────────
const PRESERVED_EMAILS = new Set([
  'sumansourabhj@gmail.com',
  'sumanj15122008@gmail.com',
  'praverse.auth@gmail.com',
]);

const PRESERVED_MEDIA_TITLES = new Set(['EP1', 'EP2', 'EP3', 'EP4']);

// ─── 4. Query All Users & Rooms Before Cleanup ───────────────────────────────
const allUsers = db.prepare('SELECT id, name, username, email, role, createdAt FROM users').all() as any[];
const allRooms = db.prepare('SELECT id, name, code, hostUserId, status, createdAt FROM rooms').all() as any[];

const testUsers = allUsers.filter((u) => {
  if (PRESERVED_EMAILS.has(u.email?.toLowerCase())) return false;
  const email = (u.email || '').toLowerCase();
  const name = u.name || '';
  const id = u.id || '';

  return (
    email.includes('example.com') ||
    email.includes('@praconnect.local') ||
    email.startsWith('admin-perf-') ||
    email.startsWith('member-perf-') ||
    name === 'Admin Tester' ||
    name === 'Normal Member' ||
    name === 'Alice Caller' ||
    name === 'Bob Callee' ||
    name === 'User A' ||
    name === 'User B' ||
    name === 'User C' ||
    name === 'PraConnect Test User' ||
    id.startsWith('cmc_') ||
    id.startsWith('p2_') ||
    id.startsWith('rel_') ||
    id === 'local-normal-user'
  );
});

const testUserIds = new Set(testUsers.map((u) => u.id));

const testRooms = allRooms.filter((r) => {
  const name = r.name || '';
  return (
    name === 'Performance Test Room' ||
    name === 'Live Reproduction Room' ||
    name === 'User Room' ||
    testUserIds.has(r.hostUserId)
  );
});

const testRoomIds = new Set(testRooms.map((r) => r.id));

console.log(`\n=== IDENTIFIED TEST DATA ===`);
console.log(`Total users in DB: ${allUsers.length}`);
console.log(`Preserved real users: ${allUsers.length - testUsers.length}`);
console.log(`Identified test users to remove: ${testUsers.length}`);
testUsers.forEach((u) => console.log(`  - [${u.id}] ${u.name} (${u.email})`));

console.log(`\nTotal rooms in DB: ${allRooms.length}`);
console.log(`Identified test rooms to remove: ${testRooms.length}`);
testRooms.forEach((r) => console.log(`  - [${r.id}] ${r.name} (${r.code})`));

// ─── 5. Transactional Cleanup ────────────────────────────────────────────────
const cleanupTx = db.transaction(() => {
  // A. Room-related cleanup for test rooms
  if (testRoomIds.size > 0) {
    const roomPlaceholders = Array.from(testRoomIds).map(() => '?').join(',');
    const roomIdsArray = Array.from(testRoomIds);

    db.prepare(`DELETE FROM roomHistoryMembers WHERE historyId IN (SELECT id FROM roomHistory WHERE roomId IN (${roomPlaceholders}))`).run(...roomIdsArray);
    db.prepare(`DELETE FROM roomHistory WHERE roomId IN (${roomPlaceholders})`).run(...roomIdsArray);
    db.prepare(`DELETE FROM roomMembers WHERE roomId IN (${roomPlaceholders})`).run(...roomIdsArray);
    db.prepare(`DELETE FROM roomEvents WHERE roomId IN (${roomPlaceholders})`).run(...roomIdsArray);
    db.prepare(`DELETE FROM rooms WHERE id IN (${roomPlaceholders})`).run(...roomIdsArray);
  }

  // Also clean any orphan roomHistory records with test room names
  db.prepare(`DELETE FROM roomHistoryMembers WHERE historyId IN (SELECT id FROM roomHistory WHERE roomName IN ('Performance Test Room', 'Live Reproduction Room', 'User Room'))`).run();
  db.prepare(`DELETE FROM roomHistory WHERE roomName IN ('Performance Test Room', 'Live Reproduction Room', 'User Room')`).run();

  // B. User-related cleanup for test users
  if (testUserIds.size > 0) {
    const userPlaceholders = Array.from(testUserIds).map(() => '?').join(',');
    const userIdsArray = Array.from(testUserIds);

    // Delete dependent tables first
    db.prepare(`DELETE FROM conversationListMembers WHERE listId IN (SELECT id FROM conversationLists WHERE userId IN (${userPlaceholders}))`).run(...userIdsArray);
    db.prepare(`DELETE FROM conversationLists WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM conversationDeletions WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM chatLocks WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM conversationUserSettings WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM userPrivacySettings WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM pushSubscriptions WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM chatMediaUploads WHERE uploaderUserId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM chatMedia WHERE uploaderUserId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM messagePins WHERE pinnedByUserId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM starredMessages WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM messageReactions WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM messageDeletions WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM directMessages WHERE senderId IN (${userPlaceholders}) OR recipientId IN (${userPlaceholders})`).run(...userIdsArray, ...userIdsArray);
    db.prepare(`DELETE FROM watchInvites WHERE senderUserId IN (${userPlaceholders}) OR recipientUserId IN (${userPlaceholders})`).run(...userIdsArray, ...userIdsArray);
    db.prepare(`DELETE FROM friendships WHERE requesterId IN (${userPlaceholders}) OR recipientId IN (${userPlaceholders})`).run(...userIdsArray, ...userIdsArray);
    db.prepare(`DELETE FROM roomHistoryMembers WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM roomMembers WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM sessions WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM loginActivity WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM passwordResetTokens WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);
    db.prepare(`DELETE FROM emailOtps WHERE userId IN (${userPlaceholders})`).run(...userIdsArray);

    // Clean test media (never clean EP1-EP4)
    db.prepare(`DELETE FROM media WHERE createdByUserId IN (${userPlaceholders}) AND title NOT IN ('EP1', 'EP2', 'EP3', 'EP4')`).run(...userIdsArray);

    // Finally delete the users
    db.prepare(`DELETE FROM users WHERE id IN (${userPlaceholders})`).run(...userIdsArray);
  }
});

console.log('\n[cleanup] Executing transactional deletion...');
cleanupTx();
console.log('[cleanup] Transaction committed successfully.');

// ─── 6. Verify Integrity & Remaining Records ─────────────────────────────────
const integrityResult = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
console.log(`\n[cleanup] PRAGMA integrity_check: ${integrityResult.integrity_check}`);

const remainingUsers = db.prepare('SELECT id, name, username, email, role, createdAt FROM users').all() as any[];
const remainingRooms = db.prepare('SELECT id, name, code, hostUserId, status, createdAt FROM rooms').all() as any[];
const remainingMedia = db.prepare('SELECT id, title, playableKey, sizeBytes, status, published FROM media').all() as any[];

console.log(`\n=== REMAINING REAL DATA ===`);
console.log(`Remaining users count: ${remainingUsers.length}`);
remainingUsers.forEach((u) => console.log(`  - [${u.id}] ${u.name} (@${u.username}) <${u.email}> [role: ${u.role}]`));

console.log(`\nRemaining rooms count: ${remainingRooms.length}`);
remainingRooms.forEach((r) => console.log(`  - [${r.id}] ${r.name} (${r.code})`));

console.log(`\nRemaining media library count: ${remainingMedia.length}`);
remainingMedia.forEach((m) => console.log(`  - [${m.id}] ${m.title} (${m.sizeBytes} bytes, status=${m.status}, published=${m.published})`));
