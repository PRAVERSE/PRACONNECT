/**
 * PraConnect Performance Measurement Script
 * 
 * Uses a TEMPORARY isolated database (never touches praconnect.db).
 * Measures key API endpoints with realistic test data.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ─── Isolated temp DB ──────────────────────────────────────────────────────────
const tmpDb = path.join(os.tmpdir(), `praconnect-perf-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.NODE_ENV = 'test';

// Dynamically import after setting env
const { db } = await import('../server/db/index.js');

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function time<T>(label: string, fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { result, ms };
}

async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  return { result, ms };
}

function report(label: string, ms: number): void {
  const status = ms < 5 ? '🟢' : ms < 20 ? '🟡' : '🔴';
  console.log(`  ${status} ${label.padEnd(45)} ${ms.toFixed(3)} ms`);
}

// ─── Seed test data ────────────────────────────────────────────────────────────
console.log('\n📦 Seeding isolated test database...');

const USER_COUNT = 20;
const FRIEND_COUNT = 5;
const MESSAGE_COUNT = 50;

const userIds: string[] = [];
for (let i = 0; i < USER_COUNT; i++) {
  const id = generateId();
  userIds.push(id);
  const now = nowIso();
  db.prepare(`
    INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, NULL, NULL, 1, 'user', ?, ?)
  `).run(id, `Test User ${i}`, `testuser${i}`, `test${i}@perf.example`, now, now);
}

const meId = userIds[0];
const friendIds = userIds.slice(1, FRIEND_COUNT + 1);
const now = nowIso();

// Create accepted friendships
for (const friendId of friendIds) {
  const [a, b] = meId < friendId ? [meId, friendId] : [friendId, meId];
  db.prepare(`
    INSERT INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt, acceptedAt)
    VALUES (?, ?, ?, 'accepted', ?, ?, ?)
  `).run(generateId(), a, b, now, now, now);
}

// Create DM messages
const convId = `${meId < friendIds[0] ? meId : friendIds[0]}:${meId < friendIds[0] ? friendIds[0] : meId}`;
db.prepare('INSERT OR IGNORE INTO dmConversationSequences (conversationId, lastSequence) VALUES (?, 0)').run(convId);

for (let i = 0; i < MESSAGE_COUNT; i++) {
  const senderId = i % 2 === 0 ? meId : friendIds[0];
  const recipientId = i % 2 === 0 ? friendIds[0] : meId;
  const seq = i + 1;
  db.prepare(`UPDATE dmConversationSequences SET lastSequence = ? WHERE conversationId = ?`).run(seq, convId);
  db.prepare(`
    INSERT INTO directMessages (id, senderId, recipientId, text, createdAt, conversationId, sequenceId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(generateId(), senderId, recipientId, `Test message ${i}`, now, convId, seq);
}

// Create a room
const roomId = generateId();
const roomCode = 'PERFTEST';
db.prepare(`
  INSERT INTO rooms (id, name, code, hostUserId, category, privacy, maxParticipants, status, createdAt, lastActivityAt)
  VALUES (?, ?, ?, ?, 'Movie', 'public', 8, 'LIVE', ?, ?)
`).run(roomId, 'Perf Test Room', roomCode, meId, now, now);

db.prepare(`
  INSERT INTO roomMembers (id, roomId, userId, role, micOn, cameraOn, screenShareOn, joinedAt)
  VALUES (?, ?, ?, 'host', 0, 0, 0, ?)
`).run(generateId(), roomId, meId, now);

// ─── Import service functions ──────────────────────────────────────────────────
const { listConversations, listDirectMessages, isAcceptedFriendship, searchUsers } = await import('../server/social/service.js');
const { listRoomPayloads, roomPayload } = await import('../server/rooms/service.js');

// ─── Media library entry ──────────────────────────────────────────────────────
const mediaId = generateId();
db.prepare(`
  INSERT INTO media (id, title, description, status, published, downloadAllowed, createdByUserId, createdAt, updatedAt, sizeBytes, playableKey)
  VALUES (?, 'Perf Test Video', '', 'ready', 1, 1, ?, ?, ?, 1073741824, 'test-key')
`).run(mediaId, meId, now, now);

console.log(`  ✓ ${USER_COUNT} users, ${FRIEND_COUNT} friendships, ${MESSAGE_COUNT} messages, 1 room, 1 media item\n`);

// ─── Measurements ──────────────────────────────────────────────────────────────
console.log('⏱  Performance measurements (isolated test DB):');
console.log('─'.repeat(60));

// GET /api/auth/me — session lookup (single JOIN query)
{
  const { ms } = time('GET /api/auth/me (session lookup)', () => {
    return db.prepare(`
      SELECT s.id AS s_id, s.userId AS s_userId, u.id AS u_id, u.name AS u_name, u.role AS u_role
      FROM sessions s JOIN users u ON u.id = s.userId
      WHERE s.tokenHash = ? AND s.expiresAt > ?
    `).get('nonexistent', nowIso());
  });
  report('GET /api/auth/me (session+user JOIN)', ms);
}

// GET /api/friends — list friends with presence
{
  const { ms } = time('GET /api/friends', () => {
    return db.prepare(`
      SELECT f.id AS friendshipId, f.requesterId, f.recipientId,
             u.id AS uid, u.name, u.username, u.avatarUrl,
             r.code AS currentRoomCode, r.name AS currentRoomName
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requesterId = ? THEN f.recipientId ELSE f.requesterId END
      LEFT JOIN roomMembers m ON m.userId = u.id AND m.leftAt IS NULL
      LEFT JOIN rooms r ON r.id = m.roomId AND r.emptySince IS NULL
      WHERE f.status = 'accepted' AND (f.requesterId = ? OR f.recipientId = ?)
    `).all(meId, meId, meId);
  });
  report('GET /api/friends (joined with presence)', ms);
}

// GET /api/users/search
{
  const { ms } = time('GET /api/users/search', () => {
    return searchUsers(meId, 'test', 20, 0);
  });
  report('GET /api/users/search (paginated)', ms);
}

// GET /api/messages/conversations
{
  const { ms } = time('GET /api/messages/conversations', () => {
    return listConversations(meId);
  });
  report('GET /api/messages/conversations', ms);
}

// GET /api/messages/:friendId (message history)
{
  const { ms } = time('GET /api/messages/:friendId (50 messages)', () => {
    return listDirectMessages(meId, friendIds[0], 50);
  });
  report('GET /api/messages/history (50 msg)', ms);
}

// isAcceptedFriendship (hot path)
{
  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    isAcceptedFriendship(meId, friendIds[0]);
  }
  const ms = (performance.now() - start) / iterations;
  report('isAcceptedFriendship() per call (×1000)', ms);
}

// GET /api/rooms — list rooms
{
  const { ms } = time('GET /api/rooms (list)', () => {
    return listRoomPayloads(meId);
  });
  report('GET /api/rooms (list)', ms);
}

// POST /api/rooms (join)
{
  const { ms } = time('roomPayload() single room', () => {
    return roomPayload(roomId, meId);
  });
  report('roomPayload() single room lookup', ms);
}

// GET /api/media — media list
{
  const { ms } = time('GET /api/media (list published)', () => {
    return db.prepare(`
      SELECT m.id, m.title, m.description, m.status, m.published, m.sizeBytes, m.durationSeconds, m.createdAt
      FROM media m WHERE m.status = 'ready' AND m.published = 1
      ORDER BY m.createdAt DESC LIMIT 20
    `).all();
  });
  report('GET /api/media (published list)', ms);
}

// Media Range request simulation (stat + range calculation)
{
  const { ms } = time('Media Range request prep (stat + range calc)', () => {
    // Simulate: look up upload, check membership, prepare range response headers
    const upload = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (!upload) return null;
    const fileSize = 1073741824; // 1 GB
    const start = 0;
    const end = Math.min(start + 1024 * 1024, fileSize - 1); // 1 MB chunk
    const chunksize = end - start + 1;
    return { fileSize, start, end, chunksize };
  });
  report('Media Range request (header prep)', ms);
}

// EXPLAIN QUERY PLAN checks
console.log('\n🔍 EXPLAIN QUERY PLAN analysis:');
console.log('─'.repeat(60));

function explainPlan(label: string, sql: string, params: unknown[]): void {
  try {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
    const usesIndex = plan.some(row => 
      row.detail.includes('SEARCH') || row.detail.includes('INDEX')
    );
    const fullScan = plan.some(row => row.detail.includes('SCAN TABLE') || row.detail.includes('SCAN '));
    const status = !fullScan ? '🟢' : fullScan && usesIndex ? '🟡' : '🔴';
    const detail = plan.map(r => r.detail).join(' | ');
    console.log(`  ${status} ${label}`);
    if (fullScan) {
      console.log(`     ⚠  ${detail}`);
    } else {
      console.log(`     ✓  ${detail.substring(0, 100)}`);
    }
  } catch (err) {
    console.log(`  ❓ ${label}: ${(err as Error).message}`);
  }
}

explainPlan('sessions lookup by tokenHash', 
  'SELECT * FROM sessions WHERE tokenHash = ? AND expiresAt > ?',
  ['hash', nowIso()]);

explainPlan('friendships pair lookup',
  'SELECT * FROM friendships WHERE status = ? AND (requesterId = ? OR recipientId = ?)',
  ['accepted', meId, meId]);

explainPlan('directMessages by conversationId + sequenceId',
  'SELECT * FROM directMessages WHERE conversationId = ? ORDER BY sequenceId DESC LIMIT 50',
  [convId]);

explainPlan('conversations last message lookup',
  'SELECT * FROM directMessages WHERE conversationId = ? ORDER BY COALESCE(sequenceId, 0) DESC, createdAt DESC LIMIT 1',
  [convId]);

explainPlan('rooms list by privacy + activity',
  'SELECT * FROM rooms WHERE privacy = ? AND emptySince IS NULL ORDER BY lastActivityAt DESC LIMIT 20',
  ['public']);

explainPlan('roomMembers by roomId (active members)',
  'SELECT * FROM roomMembers WHERE roomId = ? AND leftAt IS NULL',
  [roomId]);

explainPlan('media published list',
  "SELECT * FROM media WHERE status = 'ready' AND published = 1 ORDER BY createdAt DESC LIMIT 20",
  []);

explainPlan('isAcceptedFriendship hot path',
  "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((requesterId = ? AND recipientId = ?) OR (requesterId = ? AND recipientId = ?)) LIMIT 1",
  [meId, friendIds[0], friendIds[0], meId]);

// ─── Memory / resource summary ─────────────────────────────────────────────────
console.log('\n📊 Runtime memory snapshot:');
console.log('─'.repeat(60));
const mem = process.memoryUsage();
console.log(`  RSS:        ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
console.log(`  Heap used:  ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`);
console.log(`  Heap total: ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`);
console.log(`  External:   ${(mem.external / 1024 / 1024).toFixed(1)} MB`);

// ─── Cleanup ───────────────────────────────────────────────────────────────────
db.close();
try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
try { fs.unlinkSync(tmpDb + '-shm'); } catch { /* ignore */ }
try { fs.unlinkSync(tmpDb + '-wal'); } catch { /* ignore */ }

console.log('\n✅ Temp database cleaned up. Real praconnect.db was never touched.\n');
