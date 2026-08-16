// server/middleware/auth.ts
// Hono middleware that reads and validates the session cookie.

import type { Context, Next } from 'hono';
import { getSessionToken, getSessionUser } from '../auth/session';
import { sanitizeUser } from '../auth/auth';
import { apiError } from '../auth/auth';

// Extend Hono's context Variables type via module augmentation
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    user: ReturnType<typeof sanitizeUser>;
  }
}

/**
 * requireAuth — rejects with 401 if the request has no valid session.
 * Attaches ctx.var.user and ctx.var.userId for downstream handlers.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const token = getSessionToken(c);
  if (!token) {
    return c.json(apiError('UNAUTHENTICATED', 'Authentication required.'), 401);
  }

  const result = await getSessionUser(token);
  if (!result) {
    return c.json(apiError('UNAUTHENTICATED', 'Session expired or invalid.'), 401);
  }

  c.set('userId', result.user.id);
  c.set('user', sanitizeUser(result.user as unknown as Record<string, unknown>));

  await next();
}

/**
 * optionalAuth — same as requireAuth but does not reject.
 * Useful for endpoints that behave differently for authed vs unauthed users.
 */
export async function optionalAuth(c: Context, next: Next): Promise<void> {
  const token = getSessionToken(c);
  if (token) {
    const result = await getSessionUser(token);
    if (result) {
      c.set('userId', result.user.id);
      c.set('user', sanitizeUser(result.user as unknown as Record<string, unknown>));
    }
  }
  await next();
}
