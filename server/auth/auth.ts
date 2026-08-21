// ─── Password (Web Crypto PBKDF2-SHA512) ────────────────────────────────────
// Native Web Crypto implementation that runs universally on Cloudflare Workers,
// Node.js 18+, Bun, and browsers without native binary compilation.

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 64; // 512 bits

function bufferToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const passwordBuffer = new TextEncoder().encode(password);

  const key = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-512',
    },
    key,
    HASH_BYTES * 8
  );

  const saltHex = bufferToHex(salt);
  const hashHex = bufferToHex(derivedBits);
  return `pbkdf2:sha512:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    if (!storedHash || !password) return false;

    // 1. Standard PBKDF2 format
    if (storedHash.startsWith('pbkdf2:sha512:')) {
      const parts = storedHash.split(':');
      if (parts.length !== 5) return false;
      const iterations = parseInt(parts[2], 10);
      const saltHex = parts[3];
      const expectedHashHex = parts[4];

      const salt = hexToBuffer(saltHex);
      const passwordBuffer = new TextEncoder().encode(password);

      const key = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: salt as any,
          iterations,
          hash: 'SHA-512',
        },
        key,
        expectedHashHex.length * 4
      );

      const derivedHashHex = bufferToHex(derivedBits);
      return constantTimeEqual(derivedHashHex, expectedHashHex);
    }

    // 2. Legacy argon2 fallback (if running in Node.js environment)
    if (storedHash.startsWith('$argon2')) {
      try {
        if (typeof process !== 'undefined' && process.versions?.node) {
          const { createRequire } = await import('node:module');
          const require = createRequire(import.meta.url);
          const argon = require('@node-rs/argon2');
          return await argon.verify(storedHash, password);
        }
      } catch {
        return false;
      }
    }

    return false;
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
  bio?: string | null;
  emailVerified: boolean;
  /** Phase A: 'admin' (server-promoted owner) or 'user'. Always read from the
   *  database row — a role supplied by the client is never trusted. */
  role: 'admin' | 'user';
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
    bio: (row.bio as string | null) ?? null,
    emailVerified: row.emailVerified === 1,
    role: row.role === 'admin' ? 'admin' : 'user',
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
