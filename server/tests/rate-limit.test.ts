// server/tests/rate-limit.test.ts
// Phase 6.3 server tests (node:test via tsx). Covers the shared rate limiter:
// auth endpoints, OTP attempt caps, room join/chat/signal flooding,
// Retry-After, window expiry, and trusted-proxy handling.
//
// Run: npx tsx --test server/tests/rate-limit.test.ts
//
// NOTE: env vars (including rate-limit overrides) must be set BEFORE the
// modules are imported — this file uses dynamic imports on purpose.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-rl-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-rl-uploads-${process.pid}-${Date.now()}`);
// Deterministic (tiny) limits so every limit can be tripped with real time.
for (const name of [
  'LOGIN', 'LOGINUSER', 'SIGNUP', 'SIGNUPEMAIL', 'VERIFYEMAIL', 'VERIFYEMAILEMAIL',
  'RESENDVERIFICATION', 'RESENDVERIFICATIONEMAIL', 'FORGOTPASSWORD', 'FORGOTPASSWORDEMAIL',
  'VERIFYPASSWORDRESET', 'VERIFYPASSWORDRESETEMAIL', 'RESETPASSWORD', 'RESETPASSWORDTOKEN',
  'JOIN', 'JOINUSER', 'CHAT', 'REACTION', 'SIGNAL',
  'USERSEARCH', 'FRIENDREQUEST', 'DMSEND', 'WATCHINVITE',
]) {
  process.env[`RATE_LIMIT_${name}_MAX`] = '3';
  process.env[`RATE_LIMIT_${name}_WINDOW_MS`] = '60000';
}

const { db } = await import('../db/index');
const { auth } = await import('../routes/auth');
const { rooms, handleMediaServing, uploadsDir } = await import('../routes/rooms');
const { users } = await import('../routes/users');
const { friends } = await import('../routes/friends');
const { messages } = await import('../routes/messages');
const { invites } = await import('../routes/invites');
const { requireAuth } = await import('../middleware/auth');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { hashPassword } = await import('../auth/auth');
const { createPendingSignup } = await import('../auth/pendingSignup');
const { resetRateLimits, setRateLimitClock } = await import('../rate-limit');

const app = new Hono();
app.route('/api/auth', auth);
app.route('/api/rooms', rooms);
app.route('/api/users', users);
app.route('/api/friends', friends);
app.route('/api/messages', messages);
app.route('/api/watch-invites', invites);
app.use('/api/uploads/*', requireAuth);
app.on(['GET', 'HEAD'], '/api/uploads/:filename', handleMediaServing);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedUser(id: string, name: string, username: string, email: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)`
  ).run(id, name, username, email, now, now);
}

async function login(userId: string): Promise<string> {
  return createSession(userId);
}

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function call(
  token: string | null,
  method: string,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = cookie(token);
  if (body !== undefined) headers['content-type'] = 'application/json';
  Object.assign(headers, extraHeaders ?? {});
  return app.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

async function createRoom(hostToken: string, name: string): Promise<string> {
  const res = await call(hostToken, 'POST', '/api/rooms', {
    name,
    category: 'Movie',
    privacy: 'public',
    maxParticipants: 4,
  });
  assert.equal(res.status, 201, `createRoom ${name} should succeed`);
  return ((await json(res)).room as { id: string }).id;
}

const U = { a: 'user-a', b: 'user-b', c: 'user-c', d: 'user-d' };
let tokens: Record<string, string> = {};

before(async () => {
  for (const [key, id] of Object.entries(U)) {
    seedUser(id, `User ${key.toUpperCase()}`, `user${key}`, `${key}@test.dev`);
  }
  for (const [key, id] of Object.entries(U)) {
    tokens[key] = await login(id);
  }
});

beforeEach(() => {
  resetRateLimits();
});

after(() => {
  setRateLimitClock(() => Date.now());
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

// ─── A/J. Login flood + Retry-After ──────────────────────────────────────────

test('A: login is rate-limited with 429 + Retry-After and stays generic', async () => {
  const loginBody = { identifier: 'a@test.dev', password: 'wrong-password' };
  for (let i = 0; i < 3; i++) {
    const res = await call(null, 'POST', '/api/auth/login', loginBody);
    assert.equal(res.status, 401, 'requests before the limit must still fail generically');
    const body = await json(res);
    assert.notEqual((body.error as { code: string }).code, 'RATE_LIMITED');
  }
  const blocked = await call(null, 'POST', '/api/auth/login', loginBody);
  assert.equal(blocked.status, 429);
  const body = await json(blocked);
  assert.equal((body.error as { code: string }).code, 'RATE_LIMITED');
  assert.ok(blocked.headers.get('retry-after'), '429 must carry a Retry-After header');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1, 'Retry-After must be >= 1 second');
});

// ─── B. Signup ────────────────────────────────────────────────────────────────

test('B: signup is rate-limited', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await call(null, 'POST', '/api/auth/signup', {
      name: `User${i}`,
      email: `rl${i}@test.dev`,
      username: `rluser${i}`,
      password: 'ValidPass123!',
    });
    // No SMTP credentials in tests -> 503 EMAIL_DELIVERY_FAILED; still counted.
    assert.notEqual(res.status, 429, `attempt ${i + 1} must not be rate-limited`);
  }
  const blocked = await call(null, 'POST', '/api/auth/signup', {
    name: 'User3',
    email: 'rl3@test.dev',
    username: 'rluser3',
    password: 'ValidPass123!',
  });
  assert.equal(blocked.status, 429);
});

// ─── C. OTP verification ──────────────────────────────────────────────────────

test('C: verify-email is rate-limited', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await call(null, 'POST', '/api/auth/verify-email', {
      email: `ghost${i}@test.dev`,
      otp: '000000',
    });
    assert.equal(res.status, 400, 'unknown pending signup must be 400');
  }
  const blocked = await call(null, 'POST', '/api/auth/verify-email', {
    email: 'ghost3@test.dev',
    otp: '000000',
  });
  assert.equal(blocked.status, 429);
});

// ─── D. OTP attempt cap is preserved ──────────────────────────────────────────

test('D: per-OTP attempt cap still fires before the rate limiter', async () => {
  const prevMax = process.env.RATE_LIMIT_VERIFYEMAIL_MAX;
  const prevEmailMax = process.env.RATE_LIMIT_VERIFYEMAILEMAIL_MAX;
  process.env.RATE_LIMIT_VERIFYEMAIL_MAX = '1000';
  process.env.RATE_LIMIT_VERIFYEMAILEMAIL_MAX = '1000';
  try {
    const hash = await hashPassword('ValidPass123!');
    await createPendingSignup('Otp User', 'otpuser', 'otp@test.dev', hash);
    let lastCode = '';
    for (let i = 0; i < 5; i++) {
      const res = await call(null, 'POST', '/api/auth/verify-email', {
        email: 'otp@test.dev',
        otp: '000000',
      });
      assert.equal(res.status, 400, `wrong OTP ${i + 1} must be 400`);
      lastCode = ((await json(res)).error as { code: string }).code;
    }
    assert.equal(lastCode, 'INVALID');
    const exhausted = await call(null, 'POST', '/api/auth/verify-email', {
      email: 'otp@test.dev',
      otp: '000000',
    });
    const body = await json(exhausted);
    assert.equal(exhausted.status, 429, '6th attempt must be rejected');
    assert.equal((body.error as { code: string }).code, 'MAX_ATTEMPTS', 'OTP attempt cap must win');
  } finally {
    if (prevMax !== undefined) process.env.RATE_LIMIT_VERIFYEMAIL_MAX = prevMax;
    else delete process.env.RATE_LIMIT_VERIFYEMAIL_MAX;
    if (prevEmailMax !== undefined) process.env.RATE_LIMIT_VERIFYEMAILEMAIL_MAX = prevEmailMax;
    else delete process.env.RATE_LIMIT_VERIFYEMAILEMAIL_MAX;
  }
});

// ─── E. Forgot password ───────────────────────────────────────────────────────

test('E: forgot-password is rate-limited', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await call(null, 'POST', '/api/auth/forgot-password', {
      email: `nobody${i}@test.dev`,
    });
    assert.equal(res.status, 200, 'forgot-password must stay generic before the limit');
  }
  const blocked = await call(null, 'POST', '/api/auth/forgot-password', {
    email: 'nobody3@test.dev',
  });
  assert.equal(blocked.status, 429);
});

// ─── F. Reset password ────────────────────────────────────────────────────────

test('F: reset-password is rate-limited', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await call(null, 'POST', '/api/auth/reset-password', {
      resetToken: `garbage-token-${i}`,
      newPassword: 'ValidPass123!',
    });
    assert.equal(res.status, 400, 'garbage token must be 400');
  }
  const blocked = await call(null, 'POST', '/api/auth/reset-password', {
    resetToken: 'garbage-token-3',
    newPassword: 'ValidPass123!',
  });
  assert.equal(blocked.status, 429);
});

// ─── G. Chat flood ────────────────────────────────────────────────────────────

test('G: chat is rate-limited per user+room', async () => {
  const roomId = await createRoom(tokens.a, 'Chat Flood');
  for (let i = 0; i < 3; i++) {
    const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/chat`, { text: `hi ${i}` });
    assert.equal(res.status, 201, `chat ${i + 1} must succeed`);
  }
  const blocked = await call(tokens.a, 'POST', `/api/rooms/${roomId}/chat`, { text: 'spam' });
  assert.equal(blocked.status, 429);
});

// ─── G2. Reaction flood ───────────────────────────────────────────────────────

test('G2: reactions are rate-limited per user+room', async () => {
  const roomId = await createRoom(tokens.a, 'Reaction Flood');
  for (let i = 0; i < 3; i++) {
    const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/reaction`, { emoji: '🎉' });
    assert.equal(res.status, 200, `reaction ${i + 1} must succeed`);
  }
  const blocked = await call(tokens.a, 'POST', `/api/rooms/${roomId}/reaction`, { emoji: '🎉' });
  assert.equal(blocked.status, 429);
});

// ─── G3. Social flood ─────────────────────────────────────────────────────────

test('G3: DM sends are rate-limited per user', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await call(tokens.a, 'POST', '/api/messages/user-b', { text: `hi ${i}` });
    assert.equal(res.status, 403, 'non-friend send still reaches the limiter before the guard');
  }
  const blocked = await call(tokens.a, 'POST', '/api/messages/user-b', { text: 'spam' });
  assert.equal(blocked.status, 429);
  const body = await json(blocked);
  assert.equal((body.error as { code: string }).code, 'RATE_LIMITED');
});

// ─── H. Signal flood ──────────────────────────────────────────────────────────

test('H: signaling is rate-limited per user+room', async () => {
  const roomId = await createRoom(tokens.a, 'Signal Flood');
  const joined = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(joined.status, 200);
  for (let i = 0; i < 3; i++) {
    const res = await call(tokens.b, 'POST', `/api/rooms/${roomId}/signal`, {
      signal: { type: 'candidate', candidate: 'candidate:x' },
      targetUserId: U.a,
    });
    assert.equal(res.status, 200, `signal ${i + 1} must succeed`);
  }
  const blocked = await call(tokens.b, 'POST', `/api/rooms/${roomId}/signal`, {
    signal: { type: 'candidate', candidate: 'candidate:x' },
    targetUserId: U.a,
  });
  assert.equal(blocked.status, 429);
});

// ─── I. Join flood ────────────────────────────────────────────────────────────

test('I: join is rate-limited per IP and per user', async () => {
  const roomIds = [];
  for (let i = 0; i < 4; i++) {
    roomIds.push(await createRoom(tokens.a, `Join Flood ${i}`));
  }
  for (let i = 0; i < 3; i++) {
    const res = await call(tokens.b, 'POST', `/api/rooms/${roomIds[i]}/join`, {});
    assert.equal(res.status, 200, `join ${i + 1} must succeed`);
  }
  const blocked = await call(tokens.b, 'POST', `/api/rooms/${roomIds[3]}/join`, {});
  assert.equal(blocked.status, 429);
});

// ─── K. Window expiry ─────────────────────────────────────────────────────────

test('K: rate-limit buckets expire after their window', async () => {
  const prevMax = process.env.RATE_LIMIT_LOGIN_MAX;
  const prevUserMax = process.env.RATE_LIMIT_LOGINUSER_MAX;
  const prevWin = process.env.RATE_LIMIT_LOGIN_WINDOW_MS;
  process.env.RATE_LIMIT_LOGIN_MAX = '2';
  process.env.RATE_LIMIT_LOGINUSER_MAX = '2';
  process.env.RATE_LIMIT_LOGIN_WINDOW_MS = '60000';
  let fakeNow = 1_000_000;
  setRateLimitClock(() => fakeNow);
  const loginBody = { identifier: 'a@test.dev', password: 'wrong-password' };
  try {
    for (let i = 0; i < 2; i++) {
      const res = await call(null, 'POST', '/api/auth/login', loginBody);
      assert.notEqual(res.status, 429);
    }
    const blocked = await call(null, 'POST', '/api/auth/login', loginBody);
    assert.equal(blocked.status, 429, 'must be blocked inside the window');
    fakeNow += 60_001;
    const after = await call(null, 'POST', '/api/auth/login', loginBody);
    assert.equal(after.status, 401, 'must be allowed again after the window expires');
  } finally {
    setRateLimitClock(() => Date.now());
    if (prevMax !== undefined) process.env.RATE_LIMIT_LOGIN_MAX = prevMax;
    else delete process.env.RATE_LIMIT_LOGIN_MAX;
    if (prevUserMax !== undefined) process.env.RATE_LIMIT_LOGINUSER_MAX = prevUserMax;
    else delete process.env.RATE_LIMIT_LOGINUSER_MAX;
    if (prevWin !== undefined) process.env.RATE_LIMIT_LOGIN_WINDOW_MS = prevWin;
    else delete process.env.RATE_LIMIT_LOGIN_WINDOW_MS;
  }
});

// ─── L. Spoofed XFF cannot bypass (TRUST_PROXY off) ───────────────────────────

test('L: spoofed x-forwarded-for does NOT bypass when TRUST_PROXY is off', async () => {
  const xffs = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'];
  for (let i = 0; i < 3; i++) {
    const res = await call(null, 'POST', '/api/auth/signup', {
      name: `Xff${i}`,
      email: `xff${i}@test.dev`,
      username: `xffuser${i}`,
      password: 'ValidPass123!',
    }, { 'x-forwarded-for': xffs[i] });
    assert.notEqual(res.status, 429, `attempt ${i + 1} must not be rate-limited`);
  }
  const blocked = await call(null, 'POST', '/api/auth/signup', {
    name: 'Xff3',
    email: 'xff3@test.dev',
    username: 'xffuser3',
    password: 'ValidPass123!',
  }, { 'x-forwarded-for': xffs[3] });
  assert.equal(blocked.status, 429, 'rotating spoofed XFF must not bypass the IP limiter');
});

// ─── M. TRUST_PROXY=true honors XFF ───────────────────────────────────────────

test('M: TRUST_PROXY=true keys buckets by x-forwarded-for', async () => {
  process.env.TRUST_PROXY = 'true';
  try {
    for (let i = 0; i < 3; i++) {
      const res = await call(null, 'POST', '/api/auth/signup', {
        name: `Tp${i}`,
        email: `tp${i}@test.dev`,
        username: `tpuser${i}`,
        password: 'ValidPass123!',
      }, { 'x-forwarded-for': '5.6.7.8' });
      assert.notEqual(res.status, 429, `attempt ${i + 1} from 5.6.7.8 must not be rate-limited`);
    }
    const blocked = await call(null, 'POST', '/api/auth/signup', {
      name: 'Tp3',
      email: 'tp3@test.dev',
      username: 'tpuser3',
      password: 'ValidPass123!',
    }, { 'x-forwarded-for': '5.6.7.8' });
    assert.equal(blocked.status, 429, '4th attempt from the same trusted IP must be blocked');
    const other = await call(null, 'POST', '/api/auth/signup', {
      name: 'Tp4',
      email: 'tp4@test.dev',
      username: 'tpuser4',
      password: 'ValidPass123!',
    }, { 'x-forwarded-for': '9.9.9.9' });
    assert.notEqual(other.status, 429, 'a different trusted client IP must not be blocked');
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

// ─── N. Different users are not grouped ───────────────────────────────────────

test('N: user-scoped chat limits do not group different users', async () => {
  const roomId = await createRoom(tokens.a, 'Per User Chat');
  const joinedB = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(joinedB.status, 200);
  const joinedC = await call(tokens.c, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(joinedC.status, 200);
  for (let i = 0; i < 3; i++) {
    const resB = await call(tokens.b, 'POST', `/api/rooms/${roomId}/chat`, { text: `b${i}` });
    assert.equal(resB.status, 201);
  }
  const blockedB = await call(tokens.b, 'POST', `/api/rooms/${roomId}/chat`, { text: 'spam' });
  assert.equal(blockedB.status, 429, 'b must be blocked after 3 chats');
  for (let i = 0; i < 3; i++) {
    const resC = await call(tokens.c, 'POST', `/api/rooms/${roomId}/chat`, { text: `c${i}` });
    assert.equal(resC.status, 201, 'c must not be affected by b limit');
  }
  const exhaustedC = await call(tokens.c, 'POST', `/api/rooms/${roomId}/chat`, { text: 'one more' });
  assert.equal(exhaustedC.status, 429, 'c hits its own quota independently');
});