// server/auth/pendingSignup.ts
// Handles temporary unverified signup records in the pendingSignups table.
// A PraConnect account is ONLY created in the users table after successful OTP verification.

import { db } from '../db/index';
import { generateId } from './auth';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

export interface PendingSignupRow {
  id: string;
  name: string;
  username: string;
  email: string;
  passwordHash: string;
  otpHash: string;
  expiresAt: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  passwordHash: string | null;
  avatarUrl: string | null;
  emailVerified: number;
  googleProviderId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Crypto helpers ──────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generates a cryptographically secure 6-digit OTP. */
export function generateOtp(): string {
  while (true) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const value = new DataView(bytes.buffer).getUint32(0, false) % 1000000;
    if (value >= 0) return value.toString().padStart(6, '0');
  }
}

/**
 * Creates or replaces a pending signup record.
 * Does NOT insert into the users table.
 * Returns the raw 6-digit OTP (to be dispatched via email).
 */
export async function createPendingSignup(
  name: string,
  username: string,
  email: string,
  passwordHash: string
): Promise<string> {
  const rawOtp = generateOtp();
  const otpHash = await sha256Hex(rawOtp);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();
  const id = generateId();

  // Remove any previous pending signup for this email or username
  db.prepare('DELETE FROM pendingSignups WHERE email = ? OR username = ?').run(email, username);

  db.prepare(`
    INSERT INTO pendingSignups (id, name, username, email, passwordHash, otpHash, expiresAt, attempts, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, name, username, email, passwordHash, otpHash, expiresAt, now, now);

  return rawOtp;
}

/**
 * Looks up a pending signup by email.
 */
export function getPendingSignupByEmail(email: string): PendingSignupRow | null {
  return (
    (db.prepare('SELECT * FROM pendingSignups WHERE email = ?').get(email) as
      | PendingSignupRow
      | undefined) ?? null
  );
}

/**
 * Looks up a pending signup by username.
 */
export function getPendingSignupByUsername(username: string): PendingSignupRow | null {
  return (
    (db.prepare('SELECT * FROM pendingSignups WHERE username = ?').get(username) as
      | PendingSignupRow
      | undefined) ?? null
  );
}

/**
 * Deletes a pending signup record (e.g. if email dispatch failed or cleanup).
 */
export function deletePendingSignup(email: string): void {
  db.prepare('DELETE FROM pendingSignups WHERE email = ?').run(email);
}

/**
 * Regenerates OTP for an existing pending signup.
 * Returns raw OTP and user's name, or null if no pending signup exists.
 */
export async function resendPendingSignupOtp(
  email: string
): Promise<{ otp: string; name: string } | null> {
  const pending = getPendingSignupByEmail(email);
  if (!pending) return null;

  const rawOtp = generateOtp();
  const otpHash = await sha256Hex(rawOtp);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

  db.prepare(`
    UPDATE pendingSignups
    SET otpHash = ?, expiresAt = ?, attempts = 0, updatedAt = ?
    WHERE id = ?
  `).run(otpHash, expiresAt, now, pending.id);

  return { otp: rawOtp, name: pending.name };
}

export interface VerifyPendingSignupResult {
  ok: boolean;
  user?: UserRow;
  error?: 'NOT_FOUND' | 'EXPIRED' | 'MAX_ATTEMPTS' | 'INVALID';
}

/**
 * Verifies submitted OTP against pendingSignups.
 * If valid, ATOMICALLY inserts the verified user into `users` table,
 * sets emailVerified = 1, and deletes the pending signup record.
 */
export async function verifyPendingSignupOtp(
  email: string,
  submittedOtp: string
): Promise<VerifyPendingSignupResult> {
  const now = new Date().toISOString();
  const pending = getPendingSignupByEmail(email);

  if (!pending) return { ok: false, error: 'NOT_FOUND' };
  if (pending.expiresAt < now) return { ok: false, error: 'EXPIRED' };
  if (pending.attempts >= MAX_OTP_ATTEMPTS) return { ok: false, error: 'MAX_ATTEMPTS' };

  // Increment attempts counter
  db.prepare('UPDATE pendingSignups SET attempts = attempts + 1 WHERE id = ?').run(pending.id);

  const submittedHash = await sha256Hex(submittedOtp);
  if (submittedHash !== pending.otpHash) {
    return { ok: false, error: 'INVALID' };
  }

  // Atomic activation transaction
  const userId = generateId();
  const createAndActivate = db.transaction(() => {
    // Insert into permanent users table with emailVerified = 1
    db.prepare(`
      INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, googleProviderId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, NULL, 1, NULL, ?, ?)
    `).run(userId, pending.name, pending.username, pending.email, pending.passwordHash, now, now);

    // Remove pending signup record
    db.prepare('DELETE FROM pendingSignups WHERE id = ?').run(pending.id);

    return (
      (db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined) ?? null
    );
  });

  const createdUser = createAndActivate();
  if (!createdUser) {
    return { ok: false, error: 'INVALID' };
  }

  return { ok: true, user: createdUser };
}
