// server/auth/session.ts
// Server-side session management using SQLite / Cloudflare D1.
// Sessions are identified by a random token stored as a SHA-256 hash in the DB.
// The browser only ever receives the raw token via an HttpOnly cookie.

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db } from '../db/index';
import { generateId } from './auth';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// 30-day sessions
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Use __Host- prefix in production (requires Secure + no Domain + Path=/)
// In dev we use a plain name so HTTP works.
export const SESSION_COOKIE_NAME = IS_PRODUCTION
  ? '__Host-praconnect-session'
  : 'praconnect-session';

// ─── Crypto helpers ──────────────────────────────────────────────────────────

/** SHA-256 hash a string, returns hex. */
async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate a secure random token (32 random bytes → 64 hex chars). */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── DB row shape ────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
}

interface UserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  emailVerified: number;
  role: string;
  createdAt: string;
}

interface JoinedSessionRow {
  s_id: string;
  s_userId: string;
  s_tokenHash: string;
  s_expiresAt: string;
  s_createdAt: string;
  s_lastUsedAt: string;
  u_id: string;
  u_name: string;
  u_username: string;
  u_email: string;
  u_avatarUrl: string | null;
  u_emailVerified: number;
  u_role: string;
  u_createdAt: string;
}

// ─── Pre-compiled statements ──────────────────────────────────────────────────
// These are lazy statement objects — db.prepare() stores the SQL but performs
// no I/O. All I/O happens asynchronously in .get()/.run()/.all().
const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastUsedAt)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getSessionUserStmt = db.prepare(`
  SELECT s.id AS s_id, s.userId AS s_userId, s.tokenHash AS s_tokenHash,
         s.expiresAt AS s_expiresAt, s.createdAt AS s_createdAt, s.lastUsedAt AS s_lastUsedAt,
         u.id AS u_id, u.name AS u_name, u.username AS u_username, u.email AS u_email,
         u.avatarUrl AS u_avatarUrl, u.emailVerified AS u_emailVerified, u.role AS u_role,
         u.createdAt AS u_createdAt
  FROM sessions s
  JOIN users u ON u.id = s.userId
  WHERE s.tokenHash = ? AND s.expiresAt > ?
`);

const touchSessionStmt = db.prepare(`UPDATE sessions SET lastUsedAt = ? WHERE id = ?`);
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE tokenHash = ?`);
const deleteAllUserSessionsStmt = db.prepare(`DELETE FROM sessions WHERE userId = ?`);

// ─── Session operations ──────────────────────────────────────────────────────

/** Create a new session for a user. Returns the raw token to send as a cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await insertSessionStmt.run(generateId(), userId, tokenHash, expiresAt, now, now);

  return token;
}

/** Look up a session by raw token. Updates lastUsedAt if stale (>60s). Returns null if invalid/expired. */
export async function getSessionUser(
  token: string
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const tokenHash = await sha256Hex(token);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  const row = await getSessionUserStmt.get<JoinedSessionRow>(tokenHash, now);
  if (!row) return null;

  // Throttle touching lastUsedAt to avoid constant disk writes on read requests
  const lastUsedMs = Date.parse(row.s_lastUsedAt);
  if (isNaN(lastUsedMs) || nowMs - lastUsedMs > 60_000) {
    try {
      await touchSessionStmt.run(now, row.s_id);
    } catch {
      // Ignore transient errors
    }
  }

  return {
    session: {
      id: row.s_id,
      userId: row.s_userId,
      tokenHash: row.s_tokenHash,
      expiresAt: row.s_expiresAt,
      createdAt: row.s_createdAt,
      lastUsedAt: row.s_lastUsedAt,
    },
    user: {
      id: row.u_id,
      name: row.u_name,
      username: row.u_username,
      email: row.u_email,
      avatarUrl: row.u_avatarUrl,
      emailVerified: row.u_emailVerified,
      role: row.u_role,
      createdAt: row.u_createdAt,
    },
  };
}

/** Delete a specific session (logout). */
export async function deleteSession(token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await deleteSessionStmt.run(tokenHash);
}

/** Delete ALL sessions for a user (e.g., after password reset). */
export async function deleteAllUserSessions(userId: string): Promise<void> {
  await deleteAllUserSessionsStmt.run(userId);
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────

/** Set the session cookie on the response. */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: IS_PRODUCTION,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Clear the session cookie. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: IS_PRODUCTION,
    path: '/',
  });
}

/** Read the raw session token from the request cookie. */
export function getSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}
