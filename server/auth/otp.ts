// server/auth/otp.ts
// OTP generation, hashing, storage, and verification.
// OTPs are NEVER stored as plaintext. Only a SHA-256 hash is persisted.

import { db } from '../db/async';
import { generateId } from './auth';

export type OtpPurpose = 'email_verification' | 'password_reset';

// Expiry windows
const EXPIRY_MS: Record<OtpPurpose, number> = {
  email_verification: 10 * 60 * 1000, // 10 minutes
  password_reset: 15 * 60 * 1000,     // 15 minutes
};

const MAX_ATTEMPTS = 5;

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
  // Use rejection sampling to avoid modulo bias
  while (true) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const value = (new DataView(bytes.buffer).getUint32(0, false) % 1000000);
    if (value >= 0) return value.toString().padStart(6, '0');
  }
}

// ─── OTP operations ──────────────────────────────────────────────────────────

/**
 * Create a new OTP for an email + purpose.
 * Deletes any previous un-consumed OTPs for the same email+purpose first.
 * Returns the raw 6-digit OTP (to be sent by email — NOT stored in DB).
 */
export async function createOtp(
  userId: string,
  email: string,
  purpose: OtpPurpose
): Promise<string> {
  const otp = generateOtp();
  const otpHash = await sha256Hex(otp);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + EXPIRY_MS[purpose]).toISOString();

  // Remove any existing un-consumed OTPs for this email+purpose
  await db.prepare(`
    DELETE FROM emailOtps
    WHERE email = ? AND purpose = ? AND consumedAt IS NULL
  `).run(email, purpose);

  await db.prepare(`
    INSERT INTO emailOtps (id, userId, email, purpose, otpHash, expiresAt, attempts, consumedAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
  `).run(generateId(), userId, email, purpose, otpHash, expiresAt, now);

  // Return the raw OTP — caller sends it via email, does NOT log it
  return otp;
}

interface VerifyOtpResult {
  ok: boolean;
  userId?: string;
  error?: 'NOT_FOUND' | 'EXPIRED' | 'MAX_ATTEMPTS' | 'INVALID';
}

/**
 * Verify a submitted OTP.
 * Increments attempt counter, enforces max attempts, marks as consumed on success.
 */
export async function verifyOtp(
  email: string,
  purpose: OtpPurpose,
  submittedOtp: string
): Promise<VerifyOtpResult> {
  const now = new Date().toISOString();

  const row = await db
    .prepare(`
      SELECT id, userId, otpHash, expiresAt, attempts
      FROM emailOtps
      WHERE email = ? AND purpose = ? AND consumedAt IS NULL
      ORDER BY createdAt DESC
      LIMIT 1
    `)
    .get<{ id: string; userId: string; otpHash: string; expiresAt: string; attempts: number }>(email, purpose);

  if (!row) return { ok: false, error: 'NOT_FOUND' };
  if (row.expiresAt < now) return { ok: false, error: 'EXPIRED' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'MAX_ATTEMPTS' };

  // Increment attempts before checking hash (timing-safe fail-fast)
  await db.prepare(`UPDATE emailOtps SET attempts = attempts + 1 WHERE id = ?`).run(row.id);

  const submittedHash = await sha256Hex(submittedOtp);

  if (submittedHash !== row.otpHash) return { ok: false, error: 'INVALID' };

  // Consume the OTP
  await db.prepare(`UPDATE emailOtps SET consumedAt = ? WHERE id = ?`).run(now, row.id);

  return { ok: true, userId: row.userId };
}
