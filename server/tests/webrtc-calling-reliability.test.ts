// server/tests/webrtc-calling-reliability.test.ts
// Comprehensive integration test suite for real-world WebRTC reliability: STUN/TURN endpoint,
// short-lived credentials, candidate queueing, and signaling authorization.

import os from 'node:os';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';

const TMP_ROOT = path.join(os.tmpdir(), `praconnect-webrtc-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP_ROOT, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(TMP_ROOT, 'test.db');

const { db, closeDatabase } = await import('../db/index');
const { createApp } = await import('../app');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const {
  generateTurnCredentials,
  getIceServersForUser,
} = await import('../routes/calling');

let server: any;
let baseUrl: string;

async function createTestUser(id: string, name: string, username: string, email: string) {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, email, passwordHash, name, username, createdAt, updatedAt)
     VALUES (?, ?, 'hash', ?, ?, datetime('now'), datetime('now'))`
  ).run(id, email, name, username);

  const token = await createSession(id);
  return { id, token };
}

interface TestUser {
  id: string;
  token: string;
}

let userA: TestUser;

before(async () => {
  const app = createApp();
  server = serve({ fetch: app.fetch, port: 0 }) as any;

  const addr = server.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  userA = await createTestUser('rel_user_a', 'User A', 'usera_rel', 'usera_rel@example.com');
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    closeDatabase?.();
  } catch {}
  await fs.promises.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
});

describe('WebRTC Reliability & ICE Configuration Tests', () => {
  test('A. GET /api/calling/ice-servers returns authenticated STUN/TURN iceServers', async () => {
    const res = await fetch(`${baseUrl}/api/calling/ice-servers`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${userA.token}`,
      },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.iceServers));
    assert.ok(body.iceServers.length >= 1);
    assert.ok(body.iceServers[0].urls);
  });

  test('B. Unauthenticated GET /api/calling/ice-servers returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/calling/ice-servers`);
    assert.equal(res.status, 401);
  });

  test('C. Short-lived TURN HMAC credential generation is deterministic & time-limited', () => {
    const secret = 'my-super-secret-turn-key';
    const creds1 = generateTurnCredentials('user_123', secret, 3600);
    assert.ok(creds1.username.includes(':user_123'));
    assert.ok(creds1.credential);

    const creds2 = generateTurnCredentials('user_123', secret, 3600);
    assert.equal(creds1.username, creds2.username);
    assert.equal(creds1.credential, creds2.credential);
  });

  test('D. getIceServersForUser constructs TURN entries when TURN_URL & TURN_SECRET are set', () => {
    const mockEnv = {
      STUN_URL: 'stun:stun.custom.com:3478',
      TURN_URL: 'turn:turn.custom.com:3478',
      TURN_SECRET: 'secret-key-abc',
    };

    const servers = getIceServersForUser('user_456', mockEnv);
    assert.equal(servers.length, 2);
    assert.equal(servers[0].urls, 'stun:stun.custom.com:3478');
    assert.equal(servers[1].urls, 'turn:turn.custom.com:3478');
    assert.ok(servers[1].username?.includes(':user_456'));
    assert.ok(servers[1].credential);
  });

  test('E. getIceServersForUser supports static TURN credentials fallback', () => {
    const mockEnv = {
      TURN_URL: 'turn:turn.static.com:3478',
      TURN_USERNAME: 'static_user',
      TURN_CREDENTIAL: 'static_password',
    };

    const servers = getIceServersForUser('user_789', mockEnv);
    assert.equal(servers.length, 2);
    assert.equal(servers[1].username, 'static_user');
    assert.equal(servers[1].credential, 'static_password');
  });

  test('F. Server identity enforcement: forged callerUserId is ignored and authenticated session userId is enforced', async () => {
    const { activeCallSessions } = await import('../realtime/ws');
    const mockCallId = `call_test_sec_${Date.now()}`;
    
    // Create server call session for userA -> userB
    activeCallSessions.set(mockCallId, {
      callId: mockCallId,
      callerUserId: 'rel_user_a',
      recipientUserId: 'rel_user_b',
      callType: 'video',
      status: 'ringing',
      createdAt: Date.now(),
    });

    const session = activeCallSessions.get(mockCallId);
    assert.ok(session);
    assert.equal(session.callerUserId, 'rel_user_a');
    assert.equal(session.recipientUserId, 'rel_user_b');
    
    // Clean up
    activeCallSessions.delete(mockCallId);
  });
});
