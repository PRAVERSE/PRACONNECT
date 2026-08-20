// server/tests/messaging-features.test.ts
// Tests for typing indicator, delivered/read receipts, reactions, and media pipeline.
//
// Run: npx tsx --test server/tests/messaging-features.test.ts

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-msgfeat-${process.pid}-${Date.now()}.db`);
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-msgfeat-uploads-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { users } = await import('../routes/users');
const { friends } = await import('../routes/friends');
const { messages } = await import('../routes/messages');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const {
  toggleMessageReaction,
  getMessageReactions,
  sendDirectMessage,
  listDirectMessages,
  updateDeliveryWatermark,
  updateReadWatermark,
} = await import('../social/service');

const app = new Hono();
app.route('/api/users', users);
app.route('/api/friends', friends);
app.route('/api/messages', messages);

function seedUser(id: string, name: string, username: string, email: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)`
  ).run(id, name, username, email, now, now);
}

function makeFriends(a: string, b: string): void {
  const now = new Date().toISOString();
  const id = `f-${a}-${b}`;
  db.prepare(
    `INSERT INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt, acceptedAt)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?)`
  ).run(id, a, b, now, now, now);
}

async function call(
  token: string | null,
  method: string,
  url: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = `${SESSION_COOKIE_NAME}=${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let t1 = '';
let t2 = '';
let t3 = '';

before(async () => {
  fs.mkdirSync(process.env.UPLOADS_DIR!, { recursive: true });
  seedUser('u1', 'Alice User', 'alice', 'alice@test.local');
  seedUser('u2', 'Bob User', 'bob', 'bob@test.local');
  seedUser('u3', 'Charlie Stranger', 'charlie', 'charlie@test.local');
  makeFriends('u1', 'u2');

  t1 = await createSession('u1');
  t2 = await createSession('u2');
  t3 = await createSession('u3');
});

after(() => {
  try {
    db.close();
    fs.rmSync(process.env.DATABASE_PATH!, { force: true });
    fs.rmSync(process.env.UPLOADS_DIR!, { recursive: true, force: true });
  } catch {}
});

test('FEATURE: Message Reactions — add, stack, toggle off, and list', async () => {
  // 1. Alice sends a message to Bob
  const sent = sendDirectMessage('u1', 'u2', 'Hello Bob with reactions!');
  assert.equal(sent.ok, true);
  const msgId = sent.message!.id;

  // 2. Alice adds a heart reaction ❤️ via REST API
  const r1 = await call(t1, 'POST', `/api/messages/${msgId}/reactions`, { emoji: '❤️' });
  assert.equal(r1.status, 200);
  const data1 = (await r1.json()) as any;
  assert.equal(data1.ok, true);
  assert.equal(data1.action, 'added');
  assert.equal(data1.reactions.length, 1);
  assert.equal(data1.reactions[0].emoji, '❤️');
  assert.equal(data1.reactions[0].count, 1);
  assert.deepEqual(data1.reactions[0].userIds, ['u1']);

  // 3. Bob also reacts with ❤️ via service function
  const resBobHeart = toggleMessageReaction('u2', msgId, '❤️');
  assert.equal(resBobHeart.ok, true);
  assert.equal(resBobHeart.action, 'added');
  assert.equal(resBobHeart.reactions!.find((r) => r.emoji === '❤️')?.count, 2);

  // 4. Bob also reacts with 😂
  const resBobLaugh = toggleMessageReaction('u2', msgId, '😂');
  assert.equal(resBobLaugh.ok, true);
  assert.equal(resBobLaugh.action, 'added');

  // 5. Query reactions via GET endpoint
  const rGet = await call(t1, 'GET', `/api/messages/${msgId}/reactions`);
  assert.equal(rGet.status, 200);
  const dataGet = (await rGet.json()) as any;
  assert.equal(dataGet.ok, true);
  assert.equal(dataGet.reactions.length, 2);

  // 6. Check listDirectMessages includes reactions
  const list = listDirectMessages('u1', 'u2', 10);
  assert.equal(list.ok, true);
  const found = list.messages?.find((m) => m.id === msgId);
  assert.ok(found);
  assert.equal(found.reactions?.length, 2);

  // 7. Toggle reaction: Alice taps ❤️ again -> removed
  const rToggle = await call(t1, 'POST', `/api/messages/${msgId}/reactions`, { emoji: '❤️' });
  assert.equal(rToggle.status, 200);
  const dataToggle = (await rToggle.json()) as any;
  assert.equal(dataToggle.action, 'removed');
  const heartGroup = dataToggle.reactions.find((r: any) => r.emoji === '❤️');
  assert.equal(heartGroup?.count, 1);
  assert.deepEqual(heartGroup?.userIds, ['u2']);

  // 8. Stranger cannot react to Alice & Bob message
  const rStranger = await call(t3, 'POST', `/api/messages/${msgId}/reactions`, { emoji: '👍' });
  assert.equal(rStranger.status, 404);
});

test('FEATURE: Delivered vs Read Watermarks & Two-State Ticks', async () => {
  // Alice sends two messages to Bob
  const m1 = sendDirectMessage('u1', 'u2', 'Message 1');
  const m2 = sendDirectMessage('u1', 'u2', 'Message 2');
  assert.equal(m1.ok, true);
  assert.equal(m2.ok, true);

  const seq1 = m1.sequenceId!;
  const seq2 = m2.sequenceId!;

  // Initially, Bob has delivered/read at 0
  const initList = listDirectMessages('u1', 'u2', 10);
  assert.equal(initList.peerDeliveredThroughSequenceId ?? 0, 0);
  assert.equal(initList.peerReadThroughSequenceId ?? 0, 0);

  // Bob receives messages (Delivery Ack up to seq2)
  updateDeliveryWatermark('u2', 'u1', seq2);
  const deliveredList = listDirectMessages('u1', 'u2', 10);
  assert.equal(deliveredList.peerDeliveredThroughSequenceId, seq2);
  assert.equal(deliveredList.peerReadThroughSequenceId ?? 0, 0);

  // Bob views message 1 (Read Ack up to seq1)
  updateReadWatermark('u2', 'u1', seq1);
  const readList1 = listDirectMessages('u1', 'u2', 10);
  assert.equal(readList1.peerDeliveredThroughSequenceId, seq2);
  assert.equal(readList1.peerReadThroughSequenceId, seq1);

  // Bob views message 2 (Read Ack up to seq2)
  updateReadWatermark('u2', 'u1', seq2);
  const readList2 = listDirectMessages('u1', 'u2', 10);
  assert.equal(readList2.peerReadThroughSequenceId, seq2);
});
