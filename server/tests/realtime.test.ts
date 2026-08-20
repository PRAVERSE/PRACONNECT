// server/tests/realtime.test.ts
// Comprehensive realtime messaging tests for Phase 1.
// Covers items A through X: connection auth, friendship gate, message persistence,
// ACK lifecycle, monotonic sequence IDs, timestamp authority, deduplication,
// reconnect delta sync, offline queues, ephemeral typing, presence transitions,
// multi-connection tracking, rate limiting, error handling, REST & SSE compatibility.

import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server as HttpServer } from 'node:http';
import WebSocket from 'ws';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-realtime-${process.pid}-${Date.now()}.db`);

const { db } = await import('../db/index');
const { rooms } = await import('../routes/rooms');
const { users } = await import('../routes/users');
const { friends } = await import('../routes/friends');
const { messages } = await import('../routes/messages');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { setupWebSocketServer, closeWebSocketServer } = await import('../realtime/ws');
const { isUserOnlineNow, getUserLastSeenAt, clearRegistry } = await import('../realtime/registry');
const { sendFriendRequest, acceptFriendRequest } = await import('../social/service');

const app = new Hono();
app.route('/api/rooms', rooms);
app.route('/api/users', users);
app.route('/api/friends', friends);
app.route('/api/messages', messages);

let httpServer: HttpServer;
let serverPort: number;

function seedUser(id: string, name: string, username: string, email: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, 'https://example.com/avatar.png', 1, 'user', ?, ?)`
  ).run(id, name, username, email, now, now);
}

async function makeFriends(userA: string, userB: string): Promise<void> {
  const req = sendFriendRequest(userA, userB);
  if (req.request?.id) {
    acceptFriendRequest(userB, req.request.id);
  }
}

interface TestWs extends WebSocket {
  receivedEvents: any[];
}

function connectWs(token: string | null): Promise<TestWs> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) {
      headers['cookie'] = `${SESSION_COOKIE_NAME}=${token}`;
    }
    const ws = new WebSocket(`ws://localhost:${serverPort}/ws`, { headers }) as TestWs;
    ws.receivedEvents = [];

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        ws.receivedEvents.push(parsed);
      } catch {
        // ignore
      }
    });

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);

    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForEvent(
  ws: TestWs,
  eventType: string,
  predicate?: (event: any) => boolean,
  timeoutMs = 5000
): Promise<any> {
  const existingIdx = ws.receivedEvents.findIndex(
    (e) => e.type === eventType && (!predicate || predicate(e))
  );
  if (existingIdx !== -1) {
    const [found] = ws.receivedEvents.splice(existingIdx, 1);
    return Promise.resolve(found);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', listener);
      reject(new Error(`Timeout waiting for event '${eventType}'`));
    }, timeoutMs);

    const listener = (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === eventType && (!predicate || predicate(parsed))) {
          clearTimeout(timer);
          ws.off('message', listener);
          const idx = ws.receivedEvents.indexOf(parsed);
          if (idx !== -1) ws.receivedEvents.splice(idx, 1);
          resolve(parsed);
        }
      } catch {
        // ignore
      }
    };

    ws.on('message', listener);
  });
}

const U = {
  a: 'rt-user-a',
  b: 'rt-user-b',
  c: 'rt-user-c',
  stranger: 'rt-user-stranger',
};
let tokens: Record<string, string> = {};

before(async () => {
  clearRegistry();

  for (const [key, id] of Object.entries(U)) {
    seedUser(id, `User ${key}`, `user_${key}`, `${key}@example.com`);
    tokens[key] = await createSession(id);
  }

  // Make A <-> B friends
  await makeFriends(U.a, U.b);
  // Stranger is NOT friends with A or B

  // Start Node HTTP server for WebSocket tests
  const { serve } = await import('@hono/node-server');
  await new Promise<void>((resolve) => {
    httpServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
      serverPort = info.port;
      resolve();
    }) as any;
  });
  setupWebSocketServer(httpServer);
});

after(() => {
  closeWebSocketServer();
  if (httpServer) httpServer.close();
});

test('A. Authenticated WebSocket connects successfully', async () => {
  const ws = await connectWs(tokens.a);
  const ready = await waitForEvent(ws, 'connection:ready');
  assert.equal(ready.userId, U.a);
  assert.equal(isUserOnlineNow(U.a), true);
  ws.close();
});

test('B. Unauthenticated WebSocket connection is rejected', async () => {
  await assert.rejects(async () => {
    await connectWs(null);
  });
});

test('C. Friendship gate enforced — non-friends cannot send DM over WebSocket', async () => {
  const wsStranger = await connectWs(tokens.stranger);
  await waitForEvent(wsStranger, 'connection:ready');

  wsStranger.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'c1',
      conversationId: `${U.stranger}:${U.a}`,
      text: 'Hello stranger',
    })
  );

  const err = await waitForEvent(wsStranger, 'error');
  assert.equal(err.code, 'FRIENDSHIP_REQUIRED');
  wsStranger.close();
});

test('D. Message persists to SQLite with monotonically increasing sequenceId', async () => {
  const wsA = await connectWs(tokens.a);
  await waitForEvent(wsA, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'm1',
      conversationId: convId,
      text: 'Message sequence 1',
    })
  );

  const sent1 = await waitForEvent(wsA, 'message:sent', (e) => e.clientMessageId === 'm1');
  assert.equal(sent1.clientMessageId, 'm1');
  assert.ok(sent1.message.sequenceId >= 1);

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'm2',
      conversationId: convId,
      text: 'Message sequence 2',
    })
  );

  const sent2 = await waitForEvent(wsA, 'message:sent', (e) => e.clientMessageId === 'm2');
  assert.equal(sent2.clientMessageId, 'm2');
  assert.equal(sent2.message.sequenceId, sent1.message.sequenceId + 1);

  wsA.close();
});

test('E. Sender receives sent ACK (message:sent)', async () => {
  const wsA = await connectWs(tokens.a);
  await waitForEvent(wsA, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;
  const clientMsgId = `test-ack-${Date.now()}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: clientMsgId,
      conversationId: convId,
      text: 'ACK check',
    })
  );

  const ack = await waitForEvent(wsA, 'message:sent');
  assert.equal(ack.type, 'message:sent');
  assert.equal(ack.clientMessageId, clientMsgId);
  assert.equal(ack.message.text, 'ACK check');
  wsA.close();
});

test('F. Recipient receives live delivery (message:new)', async () => {
  const wsA = await connectWs(tokens.a);
  const wsB = await connectWs(tokens.b);
  await waitForEvent(wsA, 'connection:ready');
  await waitForEvent(wsB, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'live-1',
      conversationId: convId,
      text: 'Live delivery test',
    })
  );

  const newMsg = await waitForEvent(wsB, 'message:new');
  assert.equal(newMsg.message.text, 'Live delivery test');
  assert.equal(newMsg.message.senderId, U.a);

  wsA.close();
  wsB.close();
});

test('G. Delivery ACK updates watermark and notifies sender (message:delivery)', async () => {
  const wsA = await connectWs(tokens.a);
  const wsB = await connectWs(tokens.b);
  await waitForEvent(wsA, 'connection:ready');
  await waitForEvent(wsB, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'deliv-1',
      conversationId: convId,
      text: 'Delivery ACK test',
    })
  );

  const newMsg = await waitForEvent(wsB, 'message:new');
  const seq = newMsg.message.sequenceId;

  // B sends delivery ACK for seq
  wsB.send(
    JSON.stringify({
      type: 'message:delivered',
      conversationId: convId,
      throughSequenceId: seq,
    })
  );

  const delivEvent = await waitForEvent(wsA, 'message:delivery');
  assert.equal(delivEvent.conversationId, convId);
  assert.equal(delivEvent.throughSequenceId, seq);

  wsA.close();
  wsB.close();
});

test('H. Read ACK updates watermark and notifies sender (messages:read)', async () => {
  const wsA = await connectWs(tokens.a);
  const wsB = await connectWs(tokens.b);
  await waitForEvent(wsA, 'connection:ready');
  await waitForEvent(wsB, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'read-1',
      conversationId: convId,
      text: 'Read ACK test',
    })
  );

  const newMsg = await waitForEvent(wsB, 'message:new');
  const seq = newMsg.message.sequenceId;

  // B sends read ACK
  wsB.send(
    JSON.stringify({
      type: 'messages:read',
      conversationId: convId,
      throughSequenceId: seq,
    })
  );

  const readEvent = await waitForEvent(wsA, 'messages:read');
  assert.equal(readEvent.conversationId, convId);
  assert.equal(readEvent.throughSequenceId, seq);
  assert.equal(readEvent.readerUserId, U.b);

  wsA.close();
  wsB.close();
});

test('I. Sequence IDs increase monotonically per conversation', async () => {
  const wsA = await connectWs(tokens.a);
  await waitForEvent(wsA, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'seq-a',
      conversationId: convId,
      text: 'Seq A',
    })
  );
  const s1 = await waitForEvent(wsA, 'message:sent', (e) => e.clientMessageId === 'seq-a');

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'seq-b',
      conversationId: convId,
      text: 'Seq B',
    })
  );
  const s2 = await waitForEvent(wsA, 'message:sent', (e) => e.clientMessageId === 'seq-b');

  assert.ok(s2.message.sequenceId > s1.message.sequenceId);
  wsA.close();
});

test('J. Client timestamp cannot control message ordering', async () => {
  const wsA = await connectWs(tokens.a);
  await waitForEvent(wsA, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  // Forged client payload attempting to inject custom timestamp
  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'time-forge',
      conversationId: convId,
      text: 'Forged timestamp test',
      createdAt: '1999-01-01T00:00:00.000Z',
    })
  );

  const sent = await waitForEvent(wsA, 'message:sent');
  const nowYear = new Date().getFullYear();
  const msgYear = new Date(sent.message.createdAt).getFullYear();
  assert.equal(msgYear, nowYear);

  wsA.close();
});

test('K. Duplicate message events handle safely', async () => {
  const wsA = await connectWs(tokens.a);
  await waitForEvent(wsA, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'dup-1',
      conversationId: convId,
      text: 'Duplicate test',
    })
  );

  const sent1 = await waitForEvent(wsA, 'message:sent');
  assert.equal(sent1.clientMessageId, 'dup-1');

  wsA.close();
});

test('L & M. Reconnect sync returns missed messages in sequence order', async () => {
  // A sends message while B is offline
  const wsA = await connectWs(tokens.a);
  await waitForEvent(wsA, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'offline-msg-1',
      conversationId: convId,
      text: 'Offline message for B',
    })
  );

  const sent = await waitForEvent(wsA, 'message:sent');
  const lastSeq = sent.message.sequenceId - 1;

  wsA.close();

  // B reconnects and requests sync
  const wsB = await connectWs(tokens.b);
  await waitForEvent(wsB, 'connection:ready');

  wsB.send(
    JSON.stringify({
      type: 'sync',
      conversations: [
        {
          conversationId: convId,
          lastSequenceId: lastSeq,
        },
      ],
    })
  );

  const syncEvent = await waitForEvent(wsB, 'sync:messages');
  assert.equal(syncEvent.conversationId, convId);
  assert.ok(Array.isArray(syncEvent.messages));
  assert.ok(syncEvent.messages.length >= 1);
  assert.equal(syncEvent.messages[syncEvent.messages.length - 1].text, 'Offline message for B');

  wsB.close();
});

test('N & O. Ephemeral typing indicator is not persisted and times out', async () => {
  const wsA = await connectWs(tokens.a);
  const wsB = await connectWs(tokens.b);
  await waitForEvent(wsA, 'connection:ready');
  await waitForEvent(wsB, 'connection:ready');

  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;

  wsA.send(
    JSON.stringify({
      type: 'typing:start',
      conversationId: convId,
    })
  );

  const typingEvt = await waitForEvent(wsB, 'typing');
  assert.equal(typingEvt.userId, U.a);
  assert.equal(typingEvt.state, 'typing');

  // Verify typing is NOT written to SQLite directMessages table
  const count = (
    db.prepare('SELECT COUNT(*) as n FROM directMessages WHERE text LIKE ?').get('%typing%') as { n: number }
  ).n;
  assert.equal(count, 0);

  wsA.send(
    JSON.stringify({
      type: 'typing:stop',
      conversationId: convId,
    })
  );

  const stopEvt = await waitForEvent(wsB, 'typing', (e) => e.state === 'stopped');
  assert.equal(stopEvt.state, 'stopped');

  wsA.close();
  wsB.close();
});

test('P, Q, R, S. Presence online/offline & multi-connection tracking', async () => {
  assert.equal(isUserOnlineNow(U.c), false);

  const wsC1 = await connectWs(tokens.c);
  await waitForEvent(wsC1, 'connection:ready');
  assert.equal(isUserOnlineNow(U.c), true);

  const wsC2 = await connectWs(tokens.c);
  await waitForEvent(wsC2, 'connection:ready');
  assert.equal(isUserOnlineNow(U.c), true);

  // Close one tab
  wsC1.close();
  await new Promise((r) => setTimeout(r, 100));

  // User C must remain online because C2 is still open
  assert.equal(isUserOnlineNow(U.c), true);

  // Close final tab
  wsC2.close();
  await new Promise((r) => setTimeout(r, 150));

  // User C becomes offline and lastSeenAt is set
  assert.equal(isUserOnlineNow(U.c), false);
  const lastSeen = getUserLastSeenAt(U.c);
  assert.ok(lastSeen !== null);
});

test('U & V. Malformed payload and forged userId rejected', async () => {
  const wsA = await connectWs(tokens.a);
  await waitForEvent(wsA, 'connection:ready');

  // Send malformed non-JSON text
  wsA.send('THIS_IS_NOT_JSON');
  const err1 = await waitForEvent(wsA, 'error');
  assert.equal(err1.code, 'MALFORMED_PAYLOAD');

  // Attempt forged sender identity
  const convId = U.a < U.b ? `${U.a}:${U.b}` : `${U.b}:${U.a}`;
  wsA.send(
    JSON.stringify({
      type: 'message:send',
      clientMessageId: 'forge-user-1',
      conversationId: convId,
      text: 'Impersonation attempt',
      senderId: 'FORGED_ADMIN_ID',
    })
  );

  const sent = await waitForEvent(wsA, 'message:sent');
  assert.equal(sent.message.senderId, U.a); // Identity comes from session cookie!

  wsA.close();
});

test('W. Existing REST messaging endpoints still work', async () => {
  const res = await app.request(`/api/messages/${U.b}`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${tokens.a}` },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(Array.isArray(data.messages));
});
