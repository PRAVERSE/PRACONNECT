// server/auth/session.ts
// Server-side session management using SQLite.
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
  createdAt: string;
}

// ─── Session operations ──────────────────────────────────────────────────────

/** Create a new session for a user. Returns the raw token to send as a cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastUsedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(generateId(), userId, tokenHash, expiresAt, now, now);

  return token;
}

/** Look up a session by raw token. Updates lastUsedAt. Returns null if invalid/expired. */
export async function getSessionUser(
  token: string
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  const session = db
    .prepare<string[], SessionRow>(`SELECT * FROM sessions WHERE tokenHash = ? AND expiresAt > ?`)
    .get(tokenHash, now);

  if (!session) return null;

  // Touch lastUsedAt
  db.prepare(`UPDATE sessions SET lastUsedAt = ? WHERE id = ?`).run(now, session.id);

  const user = db
    .prepare<string[], UserRow>(`SELECT * FROM users WHERE id = ?`)
    .get(session.userId);

  if (!user) return null;

  return { session, user };
}

/** Delete a specific session (logout). */
export async function deleteSession(token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  db.prepare(`DELETE FROM sessions WHERE tokenHash = ?`).run(tokenHash);
}

/** Delete ALL sessions for a user (e.g., after password reset). */
export function deleteAllUserSessions(userId: string): void {
  db.prepare(`DELETE FROM sessions WHERE userId = ?`).run(userId);
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
