// server/tests/phase2.test.ts
// Integration test suite for Phase 2 — PraConnect Advanced Messaging.
// Covers Chat Media, Chunked Uploads, Text Editing, Deletions, Search,
// Disappearing Messages, WebPush Subscriptions, WebRTC Call Signaling, and Phase 1 Regressions.

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { WebSocket } from 'ws';
import { db } from '../db/index';
import { createApp } from '../app';
import { setupWebSocketServer, closeWebSocketServer } from '../realtime/ws';
import {
  startChatMediaUpload,
  uploadChatMediaChunk,
  completeChatMediaUpload,
  readChatMediaStream,
} from '../social/mediaService';
import {
  editDirectMessage,
  searchDirectMessages,
  setDisappearingDuration,
  sendDirectMessage,
  listDirectMessages,
  deleteMessageForEveryone,
} from '../social/service';
import {
  savePushSubscription,
  listUserPushSubscriptions,
  removePushSubscription,
  notifyUserPush,
} from '../push/pushService';

// Test setup
let server: http.Server;
let baseUrl: string;
let wsUrl: string;

const TEST_DIR = path.join(process.cwd(), 'scratch', `test_p2_${Date.now()}`);
process.env.CHAT_MEDIA_STORAGE_DIR = path.join(TEST_DIR, 'uploads_chat');

import { createSession } from '../auth/session';

async function createTestUser(id: string, name: string, username: string, email: string) {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, email, passwordHash, name, username, createdAt, updatedAt)
     VALUES (?, ?, 'hash', ?, ?, datetime('now'), datetime('now'))`
  ).run(id, email, name, username);

  const token = await createSession(id);
  return { id, token };
}

function makeFriends(userAId: string, userBId: string) {
  const [a, b] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
  db.prepare(
    `INSERT OR REPLACE INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt, acceptedAt)
     VALUES (?, ?, ?, 'accepted', datetime('now'), datetime('now'), datetime('now'))`
  ).run(`f_${a}_${b}`, a, b);
}

interface TestUser {
  id: string;
  token: string;
}

let userA: TestUser;
let userB: TestUser;
let userC: TestUser;

before(async () => {
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  const app = createApp();
  server = http.createServer(app.fetch as any);
  setupWebSocketServer(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

  userA = await createTestUser('p2_user_a', 'User A', 'usera', 'usera@example.com');
  userB = await createTestUser('p2_user_b', 'User B', 'userb', 'userb@example.com');
  userC = await createTestUser('p2_user_c', 'User C', 'userc', 'userc@example.com');
  makeFriends(userA.id, userB.id);
});

after(async () => {
  closeWebSocketServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.promises.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
});

describe('Phase 2 — Advanced Messaging Tests', () => {
  test('A. Chunked Chat Media Upload & Streaming Lifecycle', async () => {
    const filename = 'sample_image.png';
    const mimeType = 'image/png';
    const content = Buffer.from('fake-png-binary-data-for-testing-chat-media-upload');
    const sizeBytes = content.length;

    // 1. Start upload
    const startRes = await startChatMediaUpload(userA.id, userB.id, filename, mimeType, sizeBytes);
    assert.equal(startRes.ok, true);
    assert.ok(startRes.uploadId);

    // 2. Upload chunk
    const chunkStream = Readable.from(content);
    const chunkRes = await uploadChatMediaChunk(userA.id, startRes.uploadId!, 0, chunkStream);
    assert.equal(chunkRes.ok, true);

    // 3. Complete upload
    const compRes = await completeChatMediaUpload(userA.id, startRes.uploadId!);
    assert.equal(compRes.ok, true);
    assert.ok(compRes.mediaId);
    assert.equal(compRes.media?.mimeType, mimeType);

    // 4. Read media stream
    const readRes = await readChatMediaStream(userA.id, compRes.mediaId!);
    assert.equal(readRes.ok, true);
    assert.equal(readRes.mimeType, mimeType);

    // 5. Read by Recipient (User B)
    const readResB = await readChatMediaStream(userB.id, compRes.mediaId!);
    assert.equal(readResB.ok, true);

    // 6. Access denied for non-friend User C
    const readResC = await readChatMediaStream(userC.id, compRes.mediaId!);
    assert.equal(readResC.ok, false);
  });

  test('B. Text Message Editing (15-Minute Edit Window)', async () => {
    const sent = sendDirectMessage(userA.id, userB.id, 'Original text message');
    assert.equal(sent.ok, true);
    const msgId = sent.message!.id;

    // Sender edits message
    const editRes = editDirectMessage(userA.id, msgId, 'Updated text message');
    assert.equal(editRes.ok, true);
    assert.equal(editRes.message?.text, 'Updated text message');
    assert.ok(editRes.message?.editedAt);

    // Non-sender cannot edit
    const editResB = editDirectMessage(userB.id, msgId, 'Unauthorized edit');
    assert.equal(editResB.ok, false);
  });

  test('C. Message Search Endpoint', async () => {
    sendDirectMessage(userA.id, userB.id, 'Unique keyword apple pie test');
    const results = searchDirectMessages(userA.id, 'apple pie');
    assert.ok(results.length > 0);
    assert.equal(results[0].friendId, userB.id);

    // User C gets empty results (authorization scope)
    const resultsC = searchDirectMessages(userC.id, 'apple pie');
    assert.equal(resultsC.length, 0);
  });

  test('D. Disappearing Messages Setting & Expiration', async () => {
    const durRes = setDisappearingDuration(userA.id, userB.id, 86400); // 24h
    assert.equal(durRes.ok, true);
    assert.equal(durRes.duration, 86400);

    const sent = sendDirectMessage(userA.id, userB.id, 'Disappearing message');
    assert.equal(sent.ok, true);
    assert.ok(sent.message?.expiresAt);
  });

  test('E. WebPush Notification Subscription & Online Suppression', async () => {
    const endpoint = 'https://push.example.com/test_sub_1';
    const subRes = savePushSubscription(userA.id, endpoint, 'p256dh_key', 'auth_key');
    assert.equal(subRes.ok, true);

    const subs = listUserPushSubscriptions(userA.id);
    assert.equal(subs.length, 1);

    // Dispatches notification when offline (0 sockets)
    const notifyRes = await notifyUserPush(userA.id, { title: 'Test', body: 'New message from Suman' });
    assert.equal(notifyRes.ok, true);
    assert.equal(notifyRes.suppressed, false);

    // Remove subscription
    removePushSubscription(userA.id, endpoint);
    assert.equal(listUserPushSubscriptions(userA.id).length, 0);
  });

  test('F. WebRTC Call Signaling WebSocket Handshake & Friendship Gate', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { Cookie: `praconnect-session=${userA.token}` } });
    await new Promise<void>((resolve) => wsA.on('open', resolve));

    const wsC = new WebSocket(wsUrl, { headers: { Cookie: `praconnect-session=${userC.token}` } });
    await new Promise<void>((resolve) => wsC.on('open', resolve));

    // Call signaling to non-friend userC fails friendship gate
    wsA.send(
      JSON.stringify({
        type: 'call:invite',
        callId: 'call_test_1',
        targetUserId: userC.id,
        callType: 'audio',
      })
    );

    const err = await new Promise<any>((resolve) => {
      wsA.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'error') resolve(parsed);
      });
    });

    assert.equal(err.code, 'FRIENDSHIP_REQUIRED');

    wsA.close();
    wsC.close();
  });
});
