import { WebSocket } from 'ws';
import { createApp } from '../server/app';
import { db } from '../server/db/index';
import { createSession, SESSION_COOKIE_NAME } from '../server/auth/session';
import { setupWebSocketServer } from '../server/realtime/ws';
import { serve } from '@hono/node-server';

async function main() {
  console.log('--- STARTING CALLING INTEGRATION TEST ---');
  
  // 1. Create app & server
  const app = createApp();
  const server = serve({ fetch: app.fetch, port: 0 }) as any;
  setupWebSocketServer(server);

  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

  // 2. Create two distinct test users in DB
  const userAId = `caller_${Date.now()}`;
  const userBId = `callee_${Date.now()}`;

  db.prepare(
    `INSERT INTO users (id, email, passwordHash, name, username, createdAt, updatedAt)
     VALUES (?, ?, 'hash', ?, ?, datetime('now'), datetime('now'))`
  ).run(userAId, `${userAId}@example.com`, 'Alice Caller', `alice_${Date.now()}`);

  db.prepare(
    `INSERT INTO users (id, email, passwordHash, name, username, createdAt, updatedAt)
     VALUES (?, ?, 'hash', ?, ?, datetime('now'), datetime('now'))`
  ).run(userBId, `${userBId}@example.com`, 'Bob Callee', `bob_${Date.now()}`);

  // Create accepted friendship between A and B
  db.prepare(
    `INSERT INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt, acceptedAt)
     VALUES (?, ?, ?, 'accepted', datetime('now'), datetime('now'), datetime('now'))`
  ).run(`f_${Date.now()}`, userAId, userBId);

  const tokenA = await createSession(userAId);
  const tokenB = await createSession(userBId);

  console.log(`[TEST] Users created: Caller=${userAId}, Callee=${userBId}`);

  // 3. Connect User A and User B over WebSocket
  const wsA = new WebSocket(wsUrl, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${tokenA}` },
  });
  const wsB = new WebSocket(wsUrl, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${tokenB}` },
  });

  const logsA: string[] = [];
  const logsB: string[] = [];

  await Promise.all([
    new Promise<void>((resolve) => {
      wsA.on('open', () => {
        logsA.push('[CALL_TRACE][CLIENT] WebSocket connected successfully: ' + wsUrl);
        resolve();
      });
    }),
    new Promise<void>((resolve) => {
      wsB.on('open', () => {
        logsB.push('[CALL_TRACE][CLIENT] WebSocket connected successfully: ' + wsUrl);
        resolve();
      });
    }),
  ]);

  wsA.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    logsA.push(`[CLIENT_CALLER_RECV] ${JSON.stringify(msg)}`);
  });

  wsB.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'call:invite') {
      logsB.push(`[CALL_TRACE][CLIENT_CALLEE] Received incoming call:invite event: ${JSON.stringify(msg)}`);
    } else {
      logsB.push(`[CLIENT_CALLEE_RECV] ${JSON.stringify(msg)}`);
    }
  });

  // Give 100ms for connection:ready
  await new Promise((r) => setTimeout(r, 100));

  const callId = `call_${Date.now()}_test`;

  // Caller A initiates call
  logsA.push(`[CALL_TRACE][CLIENT_CALLER] Emitting call:invite event: ${JSON.stringify({
    callId,
    targetUserId: userBId,
    recipientUserId: userBId,
    callType: 'video',
    wsReadyState: wsA.readyState === WebSocket.OPEN ? 'CONNECTED' : 'DISCONNECTED',
    hasLocalStream: true,
  })}`);

  wsA.send(
    JSON.stringify({
      type: 'call:invite',
      callId,
      targetUserId: userBId,
      recipientUserId: userBId,
      callType: 'video',
    })
  );

  // Wait 300ms for invite relay
  await new Promise((r) => setTimeout(r, 300));

  // Callee B accepts call
  logsB.push(`[CLIENT_CALLEE] Sending call:accept for callId: ${callId}`);
  wsB.send(
    JSON.stringify({
      type: 'call:accept',
      callId,
      targetUserId: userAId,
    })
  );

  // Wait 300ms for accept relay
  await new Promise((r) => setTimeout(r, 300));

  // Caller A sends SDP offer
  logsA.push(`[CLIENT_CALLER] Sending sdp:offer for callId: ${callId}`);
  wsA.send(
    JSON.stringify({
      type: 'sdp:offer',
      callId,
      targetUserId: userBId,
      sdp: { type: 'offer', sdp: 'v=0...' },
    })
  );

  // Wait 300ms for offer relay
  await new Promise((r) => setTimeout(r, 300));

  // Callee B sends SDP answer
  logsB.push(`[CLIENT_CALLEE] Sending sdp:answer for callId: ${callId}`);
  wsB.send(
    JSON.stringify({
      type: 'sdp:answer',
      callId,
      targetUserId: userAId,
      sdp: { type: 'answer', sdp: 'v=0...' },
    })
  );

  await new Promise((r) => setTimeout(r, 300));

  wsA.close();
  wsB.close();
  server.close();

  console.log('\n=== USER A (CALLER) LOGS ===');
  logsA.forEach((l) => console.log(l));

  console.log('\n=== USER B (CALLEE) LOGS ===');
  logsB.forEach((l) => console.log(l));

  console.log('\n--- CALLING TEST FINISHED ---');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
