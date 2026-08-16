// server/auth/auth.ts
// Core auth helpers: password hashing (Argon2id), input validation, user sanitization.
// Uses @node-rs/argon2 for Argon2id (pre-built binaries, works on Windows/Node/Bun).

import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

// ─── Password ────────────────────────────────────────────────────────────────

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, password);
  } catch {
    return false;
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) return 'Invalid email address.';
  return null;
}

export function validateUsername(username: string): string | null {
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (username.length > 30) return 'Username must be at most 30 characters.';
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return 'Username may only contain letters, numbers, underscores, hyphens, and dots.';
  if (/^[._-]|[._-]$/.test(username))
    return 'Username must not start or end with a special character.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password is too long.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit.';
  return null;
}

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return 'Name is required.';
  if (trimmed.length > 100) return 'Name is too long.';
  return null;
}

// ─── Safe user shape ─────────────────────────────────────────────────────────

export interface SafeUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  createdAt: string;
}

/** Strip all sensitive DB fields before sending to the client. */
export function sanitizeUser(row: Record<string, unknown>): SafeUser {
  return {
    id: row.id as string,
    name: row.name as string,
    username: row.username as string,
    email: row.email as string,
    avatarUrl: (row.avatarUrl as string | null) ?? null,
    emailVerified: row.emailVerified === 1,
    createdAt: row.createdAt as string,
  };
}

// ─── ID generation ───────────────────────────────────────────────────────────

/** Generates a 32-char hex ID from 16 random bytes (Web Crypto). */
export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Error helper ────────────────────────────────────────────────────────────

export function apiError(code: string, message: string) {
  return { error: { code, message } };
}
