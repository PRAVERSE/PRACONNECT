import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const testDbPath = path.join(os.tmpdir(), `praconnect-perf-${process.pid}-${Date.now()}.db`);
const testUploadsDir = path.join(os.tmpdir(), `praconnect-perf-uploads-${process.pid}-${Date.now()}`);
fs.mkdirSync(testUploadsDir, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.MEDIA_STORAGE_DIR = testUploadsDir;

async function runBenchmark() {
  const { db } = await import('../server/db/index');
  const { createApp } = await import('../server/app');
  const { createSession } = await import('../server/auth/session');
  const { createRoom, joinRoom } = await import('../server/rooms/service');
  const { sendFriendRequest, acceptFriendRequest, sendDirectMessage } = await import('../server/social/service');
  const { createMediaRecord, applyConversionResult, setMediaPublished } = await import('../server/media/service');
  const { getMediaStorage } = await import('../server/storage/mediaStorage');

  const app = createApp();

  // Seed test users
  const now = new Date().toISOString();
  const user1Id = 'u_perf_1';
  const user2Id = 'u_perf_2';
  const adminId = 'u_perf_admin';

  db.prepare(`INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?)`).run(
    user1Id, 'Perf User 1', 'perfuser1', 'perf1@example.com', 'user', now, now
  );
  db.prepare(`INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?)`).run(
    user2Id, 'Perf User 2', 'perfuser2', 'perf2@example.com', 'user', now, now
  );
  db.prepare(`INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?)`).run(
    adminId, 'Perf Admin', 'perfadmin', 'perfadmin@example.com', 'admin', now, now
  );

  // Establish friendship & messages
  const req = sendFriendRequest(user1Id, user2Id);
  if (req.ok && req.request) {
    acceptFriendRequest(req.request.id, user2Id);
  }

  for (let i = 1; i <= 20; i++) {
    sendDirectMessage(user1Id, user2Id, `Perf test direct message ${i}`);
  }

  // Seed multiple rooms
  for (let i = 1; i <= 10; i++) {
    createRoom(user1Id, {
      name: `Perf Room ${i}`,
      category: 'Movie',
      privacy: 'public',
      maxParticipants: 8
    });
  }

  // Seed media items & fake file for Range requests
  const storage = getMediaStorage();
  const dummyVideoKey = 'playable-perf-media-1.mp4';
  const dummyVideoPath = path.join(testUploadsDir, dummyVideoKey);
  const dummySize = 10 * 1024 * 1024; // 10MB test video
  const chunk1MB = Buffer.alloc(1024 * 1024, 0x55);
  const ws = fs.createWriteStream(dummyVideoPath);
  for (let i = 0; i < 10; i++) {
    ws.write(chunk1MB);
  }
  await new Promise<void>((resolve) => ws.end(resolve));

  const mediaRec = createMediaRecord(adminId, {
    title: 'Perf Benchmark Movie',
    description: 'Test movie for perf',
    mimeType: 'video/mp4',
    downloadAllowed: true
  });
  applyConversionResult(mediaRec.id, {
    playableKey: dummyVideoKey,
    storageKey: null,
    posterKey: null,
    sizeBytes: dummySize,
    mimeType: 'video/mp4',
    durationSeconds: 120
  });
  setMediaPublished(mediaRec.id, true);

  const token1 = await createSession(user1Id);
  const authCookie = `praconnect-session=${token1}`;

  console.log('--- RUNNING BENCHMARK (50 iterations per endpoint) ---');

  const N = 50;

  // Helper to measure
  async function measure(name: string, fn: () => Promise<Response> | Response) {
    // Warmup
    await fn();
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      const res = await fn();
      if (res.status >= 400) {
        throw new Error(`${name} failed with status ${res.status}: ${await res.text()}`);
      }
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / N;
    console.log(`${name.padEnd(35)}: avg ${avgMs.toFixed(3)} ms/req (${(1000 / avgMs).toFixed(1)} req/s)`);
    return avgMs;
  }

  const results: Record<string, number> = {};

  results['/api/auth/me'] = await measure('GET /api/auth/me', () =>
    app.request('/api/auth/me', { headers: { Cookie: authCookie } })
  );

  results['/api/friends'] = await measure('GET /api/friends', () =>
    app.request('/api/friends', { headers: { Cookie: authCookie } })
  );

  results['/api/messages/conversations'] = await measure('GET /api/messages/conversations', () =>
    app.request('/api/messages/conversations', { headers: { Cookie: authCookie } })
  );

  results['/api/rooms'] = await measure('GET /api/rooms', () =>
    app.request('/api/rooms', { headers: { Cookie: authCookie } })
  );

  let joinRoomCounter = 0;
  const { resetRateLimits } = await import('../server/rate-limit');
  results['room join/create'] = await measure('POST /api/rooms & join', async () => {
    resetRateLimits();
    joinRoomCounter++;
    const createRes = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ name: `Bench Room ${joinRoomCounter}` })
    });
    const data = (await createRes.json()) as any;
    const rId = data.room.id;
    return app.request(`/api/rooms/${rId}/join`, {
      method: 'POST',
      headers: { Cookie: `praconnect-session=${await createSession(user2Id)}` }
    });
  });

  results['/api/media'] = await measure('GET /api/media', () =>
    app.request('/api/media', { headers: { Cookie: authCookie } })
  );

  results['media Range request'] = await measure('GET /api/media/:id/download (Range)', () =>
    app.request(`/api/media/${mediaRec.id}/download`, {
      headers: { Cookie: authCookie, Range: 'bytes=1048576-2097151' }
    })
  );

  console.log('--- BENCHMARK FINISHED ---');
  console.log(JSON.stringify(results, null, 2));

  // Cleanup temporary db & files
  try {
    db.close();
    fs.rmSync(testDbPath, { force: true });
    fs.rmSync(testUploadsDir, { recursive: true, force: true });
  } catch {}
}

runBenchmark().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
