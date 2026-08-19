// server/rate-limit.ts
// Shared server-side rate limiting + trusted-proxy client IP resolution.
//
// DEPLOYMENT NOTES
// ----------------
// - The limiter is IN-MEMORY and therefore correct only for this single-
//   instance SQLite deployment. It is not shared across processes and resets
//   on restart. For a multi-instance production deployment, back this store
//   with a shared one such as Redis (key -> { count, resetAt }) and swap the
//   class below; the per-route call sites and limits do not change.
// - TRUST_PROXY controls whether the `x-forwarded-for` header is honored:
//     TRUST_PROXY=true  -> server sits directly behind a trusted reverse
//                          proxy that overwrites the header (the first entry
//                          is treated as the real client).
//     unset / false     -> x-forwarded-for is IGNORED and the socket address
//                          reported by the runtime is used. This prevents a
//                          client from rotating spoofed headers to bypass
//                          rate limits.
// - Every limit can be overridden at runtime via environment variables:
//     RATE_LIMIT_<NAME>_MAX         (number of allowed requests)
//     RATE_LIMIT_<NAME>_WINDOW_MS   (window length in milliseconds)

import type { Context } from 'hono';
import { apiError } from './auth/auth';

// ─── Default limits ───────────────────────────────────────────────────────────

export const LIMITS = {
  // Authentication (per IP unless noted)
  login: { max: 10, windowMs: 15 * 60 * 1000 },
  loginUser: { max: 10, windowMs: 15 * 60 * 1000 }, // per identifier (before account lookup — no enumeration)
  signup: { max: 10, windowMs: 60 * 60 * 1000 },
  signupEmail: { max: 5, windowMs: 60 * 60 * 1000 }, // per target email
  verifyEmail: { max: 30, windowMs: 15 * 60 * 1000 },
  verifyEmailEmail: { max: 30, windowMs: 15 * 60 * 1000 }, // per target email
  resendVerification: { max: 5, windowMs: 15 * 60 * 1000 },
  resendVerificationEmail: { max: 5, windowMs: 15 * 60 * 1000 }, // SMTP abuse guard
  forgotPassword: { max: 5, windowMs: 15 * 60 * 1000 },
  forgotPasswordEmail: { max: 5, windowMs: 15 * 60 * 1000 }, // SMTP abuse guard
  verifyPasswordReset: { max: 30, windowMs: 15 * 60 * 1000 },
  verifyPasswordResetEmail: { max: 30, windowMs: 15 * 60 * 1000 },
  resetPassword: { max: 10, windowMs: 15 * 60 * 1000 },
  resetPasswordToken: { max: 10, windowMs: 15 * 60 * 1000 }, // per reset token hash
  // Realtime (per authenticated user + room unless noted)
  join: { max: 60, windowMs: 10 * 1000 }, // per IP
  joinUser: { max: 25, windowMs: 10 * 1000 }, // per user
  chat: { max: 30, windowMs: 10 * 1000 },
  reaction: { max: 60, windowMs: 10 * 1000 }, // emoji bursts need a little headroom
  signal: { max: 200, windowMs: 10 * 1000 }, // WebRTC bursts need headroom
  // Social (per authenticated user unless noted)
  userSearch: { max: 60, windowMs: 60 * 1000 }, // directory lookups
  friendRequest: { max: 20, windowMs: 60 * 1000 }, // per target user pair
  dmSend: { max: 60, windowMs: 60 * 1000 },
  watchInvite: { max: 20, windowMs: 60 * 1000 },
  // DM context features (per authenticated user)
  dmForward: { max: 30, windowMs: 60 * 1000 },
  dmDelete: { max: 60, windowMs: 60 * 1000 },
  dmPin: { max: 60, windowMs: 60 * 1000 },
  dmStar: { max: 60, windowMs: 60 * 1000 },
  dmConversationSettings: { max: 90, windowMs: 60 * 1000 },
  dmLock: { max: 10, windowMs: 60 * 1000 }, // PIN attempts are deliberately tight
  callInvite: { max: 20, windowMs: 60 * 1000 },
} as const;

export type LimitName = keyof typeof LIMITS;

function limitConfig(name: LimitName): { max: number; windowMs: number } {
  const base = LIMITS[name];
  const maxRaw = process.env[`RATE_LIMIT_${name.toUpperCase()}_MAX`];
  const windowRaw = process.env[`RATE_LIMIT_${name.toUpperCase()}_WINDOW_MS`];
  const max = maxRaw ? Number(maxRaw) : base.max;
  const windowMs = windowRaw ? Number(windowRaw) : base.windowMs;
  return {
    max: Number.isFinite(max) && max >= 0 ? max : base.max,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : base.windowMs,
  };
}

// ─── Clock (injectable for deterministic tests) ───────────────────────────────

let timeSource: () => number = () => Date.now();

/** Test hook: swap the clock used by the limiter (restore with the default). */
export function setRateLimitClock(fn: () => number): void {
  timeSource = fn;
}

// ─── In-memory bucket store ───────────────────────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(sweepMs = 60_000) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    this.sweepTimer.unref?.();
  }

  check(key: string, max: number, windowMs: number): { allowed: boolean; retryAfter: number } {
    const now = timeSource();
    const entry = this.buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    if (entry.count >= max) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  /** Removes all expired buckets so attacker-driven keys cannot grow forever. */
  sweep(): void {
    const now = timeSource();
    for (const [key, entry] of this.buckets) {
      if (entry.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** Test hook: clear every bucket. */
  resetAll(): void {
    this.buckets.clear();
  }
}

export const limiter = new RateLimiter();
export const resetRateLimits = (): void => limiter.resetAll();

// ─── Client IP resolution ─────────────────────────────────────────────────────

export function getClientIp(c: Context): string {
  // Only honor x-forwarded-for when explicitly behind a trusted proxy.
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
  }
  const env = c.env as
    | { server?: { incoming?: { socket?: { remoteAddress?: string } } }; incoming?: { socket?: { remoteAddress?: string } } }
    | undefined;
  return env?.server?.incoming?.socket?.remoteAddress ?? env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

// ─── Per-request helper ───────────────────────────────────────────────────────

/** Returns a 429 Response when the key is over its limit, otherwise null. */
export function rateLimit(c: Context, key: string, name: LimitName): Response | null {
  const { max, windowMs } = limitConfig(name);
  const result = limiter.check(key, max, windowMs);
  if (result.allowed) return null;
  c.header('Retry-After', String(result.retryAfter));
  return c.json(apiError('RATE_LIMITED', 'Too many requests. Please try again later.'), 429);
}
