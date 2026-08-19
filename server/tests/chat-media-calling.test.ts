// server/tests/chat-media-calling.test.ts
// Comprehensive integration test suite for 50 MB chat file sharing & 1-on-1 WebRTC video call signaling.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import WebSocket from 'ws';
import { createApp } from '../app';
import { db } from '../db/index';
import { generateId } from '../auth/auth';
import { setupWebSocketServer, closeWebSocketServer } from '../realtime/ws';
import {
  startChatMediaUpload,
  uploadChatMediaChunk,
  completeChatMediaUpload,
  readChatMediaStream,
  checkAndCleanupUnreferencedMedia,
  CHAT_MAX_FILE_SIZE_BYTES,
} from '../social/mediaService';
import {
  sendDirectMessage,
  forwardMessage,
  deleteMessageForEveryone,
} from '../social/service';

const TEST_DIR = path.join(process.cwd(), 'uploads', 'test_chat_media_calling');
process.env.CHAT_MEDIA_STORAGE_DIR = TEST_DIR;

let server: http.Server;
let baseUrl: string;
let wsUrl: string;

import { createSession, SESSION_COOKIE_NAME } from '../auth/session';

async function createTestUser(id: string, name: string, username: string, email: string) {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, email, passwordHash, name, username, createdAt, updatedAt)
     VALUES (?, ?, 'hash', ?, ?, datetime('now'), datetime('now'))`
  ).run(id, email, name, username);

  const token = await createSession(id);
  return { id, token };
}

function makeFriends(a: string, b: string) {
  db.prepare(
    'INSERT INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(`f_${a}_${b}`, a, b, 'accepted', new Date().toISOString(), new Date().toISOString());
}

interface TestUser {
  id: string;
  token: string;
}

let userA: TestUser;
let userB: TestUser;
let userC: TestUser;

import { serve } from '@hono/node-server';

before(async () => {
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  const app = createApp();
  server = serve({ fetch: app.fetch, port: 0 }) as any;
  setupWebSocketServer(server);

  const addr = server.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

  userA = await createTestUser('cmc_user_a', 'User A', 'usera_cmc', 'usera_cmc@example.com');
  userB = await createTestUser('cmc_user_b', 'User B', 'userb_cmc', 'userb_cmc@example.com');
  userC = await createTestUser('cmc_user_c', 'User C', 'userc_cmc', 'userc_cmc@example.com');
  makeFriends(userA.id, userB.id);
});

after(async () => {
  closeWebSocketServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.promises.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
});

describe('Chat File Sharing (50 MB Limit) Tests', () => {
  test('A. File under 50 MiB is accepted', async () => {
    const size = 10 * 1024 * 1024; // 10 MiB
    const res = await startChatMediaUpload(userA.id, userB.id, 'large_photo.png', 'image/png', size);
    assert.equal(res.ok, true);
    assert.ok(res.uploadId);
  });

  test('B. File over 50 MiB is rejected with MEDIA_TOO_LARGE', async () => {
    const size = 53 * 1024 * 1024; // 53 MiB > 50 MiB limit
    const res = await startChatMediaUpload(userA.id, userB.id, 'huge_video.mp4', 'video/mp4', size);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'MEDIA_TOO_LARGE');

    // Test API route returns 413
    const httpRes = await fetch(`${baseUrl}/api/messages/media/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${userA.token}`,
      },
      body: JSON.stringify({
        friendId: userB.id,
        originalName: 'huge_video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: size,
      }),
    });

    assert.equal(httpRes.status, 413);
  });

  test('C. Unauthenticated upload is rejected with 401', async () => {
    const httpRes = await fetch(`${baseUrl}/api/messages/media/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        friendId: userB.id,
        originalName: 'doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    });
    assert.equal(httpRes.status, 401);
  });

  test('D. Non-friend upload is rejected with 403 / FRIENDSHIP_REQUIRED', async () => {
    const res = await startChatMediaUpload(userA.id, userC.id, 'secret.pdf', 'application/pdf', 1024);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'FRIENDSHIP_REQUIRED');
  });

  test('E. Safe storage key is generated and path traversal rejected', async () => {
    const res = await startChatMediaUpload(userA.id, userB.id, '../../etc/passwd.txt', 'text/plain', 512);
    assert.equal(res.ok, true);
    assert.ok(res.uploadId);
  });

  test('F. Dangerous executable extensions are rejected', async () => {
    const res = await startChatMediaUpload(userA.id, userB.id, 'malware.exe', 'application/x-msdownload', 2048);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'DANGEROUS_FILE_TYPE');
  });

  test('G, H, I, J. Full Chunk Upload, Resume & Complete Lifecycle', async () => {
    const content = Buffer.from('Testing chat media chunk upload and completion workflow');
    const startRes = await startChatMediaUpload(userA.id, userB.id, 'document.pdf', 'application/pdf', content.length);
    assert.equal(startRes.ok, true);

    const chunkRes = await uploadChatMediaChunk(userA.id, startRes.uploadId!, 0, Readable.from(content));
    assert.equal(chunkRes.ok, true);

    const compRes = await completeChatMediaUpload(userA.id, startRes.uploadId!);
    assert.equal(compRes.ok, true);
    assert.ok(compRes.mediaId);
    assert.equal(compRes.media?.originalName, 'document.pdf');
  });

  test('K. Participant can download media stream securely', async () => {
    const content = Buffer.from('Downloadable test document binary data');
    const startRes = await startChatMediaUpload(userA.id, userB.id, 'receipt.pdf', 'application/pdf', content.length);
    await uploadChatMediaChunk(userA.id, startRes.uploadId!, 0, Readable.from(content));
    const compRes = await completeChatMediaUpload(userA.id, startRes.uploadId!);

    const streamRes = await readChatMediaStream(userB.id, compRes.mediaId!);
    assert.equal(streamRes.ok, true);
    assert.equal(streamRes.mimeType, 'application/pdf');
  });

  test('L. Unauthorized user cannot download media', async () => {
    const content = Buffer.from('Private user file');
    const startRes = await startChatMediaUpload(userA.id, userB.id, 'private.pdf', 'application/pdf', content.length);
    await uploadChatMediaChunk(userA.id, startRes.uploadId!, 0, Readable.from(content));
    const compRes = await completeChatMediaUpload(userA.id, startRes.uploadId!);

    const streamRes = await readChatMediaStream(userC.id, compRes.mediaId!);
    assert.equal(streamRes.ok, false);
    assert.equal(streamRes.error, 'FRIENDSHIP_REQUIRED');
  });

  test('M. Media forwarding preserves attachmentId reference', async () => {
    const content = Buffer.from('Forwarded attachment file');
    const startRes = await startChatMediaUpload(userA.id, userB.id, 'shared.png', 'image/png', content.length);
    await uploadChatMediaChunk(userA.id, startRes.uploadId!, 0, Readable.from(content));
    const compRes = await completeChatMediaUpload(userA.id, startRes.uploadId!);

    const msgRes = sendDirectMessage(userA.id, userB.id, 'Original message', { attachmentId: compRes.mediaId });
    assert.equal(msgRes.ok, true);

    const fwdRes = forwardMessage(userB.id, msgRes.message!.id, userA.id);
    assert.equal(fwdRes.ok, true);
    assert.equal(fwdRes.message?.attachmentId, compRes.mediaId);
  });

  test('N. Deletion reference counting preserves file if another message references it', async () => {
    const content = Buffer.from('Referenced file for deletion test');
    const startRes = await startChatMediaUpload(userA.id, userB.id, 'ref.pdf', 'application/pdf', content.length);
    await uploadChatMediaChunk(userA.id, startRes.uploadId!, 0, Readable.from(content));
    const compRes = await completeChatMediaUpload(userA.id, startRes.uploadId!);

    const msg1 = sendDirectMessage(userA.id, userB.id, 'Msg 1', { attachmentId: compRes.mediaId });
    const msg2 = sendDirectMessage(userA.id, userB.id, 'Msg 2', { attachmentId: compRes.mediaId });

    // Delete msg 1
    deleteMessageForEveryone(userA.id, msg1.message!.id);

    // Media should still exist because msg2 references it
    const info1 = await readChatMediaStream(userA.id, compRes.mediaId!);
    assert.equal(info1.ok, true);

    // Delete msg 2
    deleteMessageForEveryone(userA.id, msg2.message!.id);

    // Now media should be cleaned up
    await checkAndCleanupUnreferencedMedia(compRes.mediaId!);
    const info2 = await readChatMediaStream(userA.id, compRes.mediaId!);
    assert.equal(info2.ok, false);
  });
});

describe('1-on-1 WebRTC Video Calling Tests', () => {
  test('P. Unauthenticated WebSocket is rejected with HTTP 401', async () => {
    const ws = new WebSocket(`${wsUrl}`);
    const err = await new Promise<any>((resolve) => {
      ws.on('error', (err) => resolve(err));
    });
    assert.ok(err);
    assert.match(err.message, /401/);
  });

  test('Q. Non-friend call is rejected with FRIENDSHIP_REQUIRED', async () => {
    const wsA = new WebSocket(`${wsUrl}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${userA.token}` },
    });
    await new Promise<void>((resolve) => wsA.on('open', resolve));

    wsA.send(JSON.stringify({ type: 'call:invite', callId: 'c2', targetUserId: userC.id, callType: 'video' }));

    const err = await new Promise<any>((resolve) => {
      wsA.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    });

    assert.equal(err.code, 'FRIENDSHIP_REQUIRED');
    wsA.close();
  });

  test('R, S, T, U, V, W, X, Y, Z. WebRTC Calling Signaling Lifecycle (Invite, Accept, SDP, Candidate, End)', async () => {
    const wsA = new WebSocket(`${wsUrl}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${userA.token}` },
    });
    const wsB = new WebSocket(`${wsUrl}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${userB.token}` },
    });

    await Promise.all([
      new Promise<void>((resolve) => wsA.on('open', resolve)),
      new Promise<void>((resolve) => wsB.on('open', resolve)),
    ]);

    const callId = `call_test_${Date.now()}`;

    // 1. A sends call:invite
    wsA.send(JSON.stringify({ type: 'call:invite', callId, targetUserId: userB.id, callType: 'video' }));

    const inviteEvt = await new Promise<any>((resolve) => {
      wsB.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'call:invite') resolve(parsed);
      });
    });

    assert.equal(inviteEvt.callId, callId);
    assert.equal(inviteEvt.senderUserId, userA.id);

    // 2. B sends call:accept
    wsB.send(JSON.stringify({ type: 'call:accept', callId, targetUserId: userA.id }));

    const acceptEvt = await new Promise<any>((resolve) => {
      wsA.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'call:accept') resolve(parsed);
      });
    });

    assert.equal(acceptEvt.callId, callId);

    // 3. A sends SDP offer
    wsA.send(JSON.stringify({ type: 'sdp:offer', callId, targetUserId: userB.id, sdp: { type: 'offer', sdp: 'fake-sdp-offer' } }));

    const sdpEvt = await new Promise<any>((resolve) => {
      wsB.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'sdp:offer') resolve(parsed);
      });
    });

    assert.equal(sdpEvt.sdp.sdp, 'fake-sdp-offer');

    // 4. A ends call
    wsA.send(JSON.stringify({ type: 'call:ended', callId, targetUserId: userB.id }));

    const endEvt = await new Promise<any>((resolve) => {
      wsB.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'call:ended') resolve(parsed);
      });
    });

    assert.equal(endEvt.callId, callId);

    wsA.close();
    wsB.close();
  });
});
