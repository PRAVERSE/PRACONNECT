// server/routes/auth.ts
// All authentication endpoints mounted under /api/auth

import { Hono } from 'hono';
import { db, bootstrapAdminRole } from '../db/async';
import {
  hashPassword,
  verifyPassword,
  normalizeEmail,
  validateEmail,
  validateUsername,
  validatePassword,
  validateName,
  sanitizeUser,
  generateId,
  apiError,
} from '../auth/auth';
import { createSession, deleteSession, deleteAllUserSessions, setSessionCookie, clearSessionCookie, getSessionToken, getSessionUser } from '../auth/session';
import { createOtp, verifyOtp } from '../auth/otp';
import { buildGoogleAuthUrl, exchangeCodeForTokens, getGoogleUserInfo, generateOAuthState, deriveUsernameFromGoogle } from '../auth/google';
import { sendEmailVerificationOtp, sendPasswordResetOtp, sendResendVerificationOtp } from '../email/smtp';
import { recordLoginActivity } from '../auth/loginActivity';
import { requireAuth } from '../middleware/auth';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getClientIp, rateLimit } from '../rate-limit';

const auth = new Hono();

function getCoarseLocation(c: { req: { header: (h: string) => string | undefined } }): string {
  try {
    const headerVal =
      c.req.header('cf-ipcountry') ||
      c.req.header('x-country-code') ||
      c.req.header('x-vercel-ip-country') ||
      c.req.header('x-geo-country');
    if (headerVal && headerVal.trim() && headerVal !== 'XX' && headerVal !== 'T1') {
      return headerVal.trim();
    }
  } catch {
    // fallback
  }
  return 'unknown';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  passwordHash: string | null;
  avatarUrl: string | null;
  emailVerified: number;
  googleProviderId: string | null;
  /** Phase D: server role — 'admin' or 'user'. Always read from DB; never
   *  supplied by the client. bootstrapAdminRole() promotes configured admins. */
  role: string;
  createdAt: string;
  updatedAt: string;
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  return (await db.prepare('SELECT * FROM users WHERE email = ?').get<UserRow>(email)) ?? null;
}

async function findUserById(id: string): Promise<UserRow | null> {
  return (await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(id)) ?? null;
}

import {
  createPendingSignup,
  resendPendingSignupOtp,
  verifyPendingSignupOtp,
  deletePendingSignup
} from '../auth/pendingSignup';

// ─── POST /signup ─────────────────────────────────────────────────────────────

auth.post('/signup', async (c) => {
  const ipLimit = rateLimit(c, `signup:ip:${getClientIp(c)}`, 'signup');
  if (ipLimit) return ipLimit;

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const { name, email: rawEmail, username: rawUsername, password } = body as Record<string, string>;

  // Validate inputs
  const nameErr = validateName(name ?? '');
  if (nameErr) return c.json(apiError('VALIDATION_ERROR', nameErr), 400);

  const emailErr = validateEmail(rawEmail ?? '');
  if (emailErr) return c.json(apiError('VALIDATION_ERROR', emailErr), 400);

  const usernameErr = validateUsername(rawUsername ?? '');
  if (usernameErr) return c.json(apiError('VALIDATION_ERROR', usernameErr), 400);

  const passwordErr = validatePassword(password ?? '');
  if (passwordErr) return c.json(apiError('VALIDATION_ERROR', passwordErr), 400);

  const email = normalizeEmail(rawEmail);
  const username = rawUsername.trim().toLowerCase();

  // Protect against repeated signup attempts targeting the same email.
  const emailLimit = rateLimit(c, `signup:email:${email}`, 'signupEmail');
  if (emailLimit) return emailLimit;

  // Check uniqueness against verified users in the permanent users table
  const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) return c.json(apiError('EMAIL_TAKEN', 'An account with this email already exists.'), 409);

  const existingUsername = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) return c.json(apiError('USERNAME_TAKEN', 'This username is already taken.'), 409);

  const passwordHash = await hashPassword(password);

  // Store in pendingSignups (NOT the users table) and generate OTP
  const otp = await createPendingSignup(name.trim(), username, email, passwordHash);

  try {
    await sendEmailVerificationOtp(email, name.trim(), otp);
  } catch (err) {
    // Roll back pending signup on delivery failure
    await deletePendingSignup(email);
    return c.json(apiError('EMAIL_DELIVERY_FAILED', "We couldn't send the verification email. Please try again."), 503);
  }

  return c.json({
    message: 'Account created. Please check your email for a verification code.',
    emailVerificationRequired: true,
    email,
  }, 201);
});

// ─── POST /verify-email ───────────────────────────────────────────────────────

auth.post('/verify-email', async (c) => {
  const ipLimit = rateLimit(c, `verifyEmail:ip:${getClientIp(c)}`, 'verifyEmail');
  if (ipLimit) return ipLimit;

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const { email: rawEmail, otp } = body as Record<string, string>;
  if (!rawEmail || !otp) return c.json(apiError('VALIDATION_ERROR', 'Email and OTP are required.'), 400);

  const email = normalizeEmail(rawEmail);

  // Rate limit per target email. The per-OTP attempt cap inside
  // verifyPendingSignupOtp is preserved and enforced independently.
  const emailLimit = rateLimit(c, `verifyEmail:email:${email}`, 'verifyEmailEmail');
  if (emailLimit) return emailLimit;

  // Verifies OTP and atomically activates user in `users` table
  const result = await verifyPendingSignupOtp(email, otp.trim());

  if (!result.ok || !result.user) {
    const messages: Record<string, string> = {
      NOT_FOUND: 'No pending verification found for this email. Please sign up again.',
      EXPIRED: 'The verification code has expired. Please request a new one.',
      MAX_ATTEMPTS: 'Too many incorrect attempts. Please request a new code.',
      INVALID: 'Invalid verification code.',
    };
    const code = result.error ?? 'INVALID';
    const status = code === 'MAX_ATTEMPTS' ? 429 : 400;
    return c.json(apiError(code, messages[code] ?? 'Invalid code.'), status);
  }

  const user = result.user;

  // Create session
  const token = await createSession(user.id);
  setSessionCookie(c, token);
  await recordLoginActivity(user.id, 'signup', getCoarseLocation(c));

  return c.json({ authenticated: true, user: sanitizeUser(user as unknown as Record<string, unknown>) });
});

// ─── POST /resend-verification ────────────────────────────────────────────────

auth.post('/resend-verification', async (c) => {
  const ipLimit = rateLimit(c, `resend:ip:${getClientIp(c)}`, 'resendVerification');
  if (ipLimit) return ipLimit;

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const { email: rawEmail } = body as Record<string, string>;
  if (!rawEmail) return c.json(apiError('VALIDATION_ERROR', 'Email is required.'), 400);

  const email = normalizeEmail(rawEmail);

  // Aggressive per-email limit — every resend triggers an SMTP delivery.
  const emailLimit = rateLimit(c, `resend:email:${email}`, 'resendVerificationEmail');
  if (emailLimit) return emailLimit;

  // If an unverified pending signup exists, regenerate OTP and dispatch email
  const pending = await resendPendingSignupOtp(email);
  if (pending) {
    try {
      await sendResendVerificationOtp(email, pending.name, pending.otp);
    } catch (err) {
      return c.json(apiError('EMAIL_DELIVERY_FAILED', "We couldn't send the verification email. Please try again."), 503);
    }
  }

  return c.json({ message: 'If an unverified account exists for this email, a new code has been sent.' });
});

// ─── POST /login ──────────────────────────────────────────────────────────────

auth.post('/login', async (c) => {
  const ipLimit = rateLimit(c, `login:ip:${getClientIp(c)}`, 'login');
  if (ipLimit) return ipLimit;

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const { identifier, password } = body as Record<string, string>;
  if (!identifier || !password) {
    return c.json(apiError('VALIDATION_ERROR', 'Identifier and password are required.'), 400);
  }

  // Per-identifier limit applied BEFORE the account lookup so it never leaks
  // whether an account exists (both real and unknown identifiers get blocked).
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const userLimit = rateLimit(c, `login:user:${normalizedIdentifier}`, 'loginUser');
  if (userLimit) return userLimit;

  // Find by email or username
  const user = (await db.prepare(`
    SELECT * FROM users WHERE email = ? OR username = ?
  `).get<UserRow>(normalizedIdentifier, normalizedIdentifier)) ?? null;

  // Use a generic error to prevent account enumeration
  const INVALID_CREDS = apiError('INVALID_CREDENTIALS', 'Invalid email/username or password.');

  if (!user) return c.json(INVALID_CREDS, 401);
  if (!user.passwordHash) {
    // Google-only account — give a more helpful message
    return c.json(apiError('NO_PASSWORD', 'This account uses Google sign-in. Please continue with Google.'), 401);
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return c.json(INVALID_CREDS, 401);

  // Seamlessly upgrade legacy Argon2 hashes to PBKDF2 upon successful verification
  if (user.passwordHash.startsWith('$argon2')) {
    try {
      const upgradedHash = await hashPassword(password);
      await db.prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?').run(
        upgradedHash,
        new Date().toISOString(),
        user.id
      );
    } catch {
      // Ignore background rehash error
    }
  }

  if (!user.emailVerified) {
    return c.json(apiError('EMAIL_NOT_VERIFIED', 'Please verify your email before logging in.'), 403);
  }

  // Bootstrap BEFORE loading freshUser so the session carries the promoted role.
  await bootstrapAdminRole();
  const freshUser = (await findUserById(user.id)) ?? user;

  // Dev diagnostic — never logs password/token/session data.
  if (process.env.NODE_ENV !== 'production') {
    console.log('[AUTH ROLE] login user', { email: freshUser.email, role: freshUser.role });
  }

  const token = await createSession(freshUser.id);
  setSessionCookie(c, token);
  await recordLoginActivity(freshUser.id, 'email', getCoarseLocation(c));

  return c.json({ authenticated: true, user: sanitizeUser(freshUser as unknown as Record<string, unknown>) });
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

auth.get('/me', async (c) => {
  const token = getSessionToken(c);
  if (!token) return c.json({ authenticated: false });

  const result = await getSessionUser(token);
  if (!result) return c.json({ authenticated: false });

  const safeUser = sanitizeUser(result.user as unknown as Record<string, unknown>);

  // Dev diagnostic — never logs password/token/session data.
  if (process.env.NODE_ENV !== 'production') {
    console.log('[AUTH ROLE] /me', { email: safeUser.email, role: safeUser.role });
  }

  return c.json({
    authenticated: true,
    user: safeUser,
  });
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

auth.post('/logout', async (c) => {
  const token = getSessionToken(c);
  if (token) {
    await deleteSession(token);
  }
  clearSessionCookie(c);
  return c.json({ message: 'Logged out successfully.' });
});

// ─── POST /logout-all ─────────────────────────────────────────────────────────
// Logs the user out of every device: all sessions for the account are deleted,
// including the current one (its cookie is cleared as well). Reuses the
// existing deleteAllUserSessions; no session tokens are exposed.

auth.post('/logout-all', requireAuth, async (c) => {
  const userId = c.get('userId');
  await deleteAllUserSessions(userId);
  clearSessionCookie(c);
  return c.json({ message: 'Logged out of all devices.' });
});

// ─── GET /google ──────────────────────────────────────────────────────────────

auth.get('/google', (c) => {
  const state = generateOAuthState();
  // Store state in a short-lived cookie (5 min) for CSRF validation
  setCookie(c, 'praconnect_oauth_state', state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 5 * 60,
  });

  const url = buildGoogleAuthUrl(state);
  return c.redirect(url, 302);
});

// ─── GET /google/callback ─────────────────────────────────────────────────────

auth.get('/google/callback', async (c) => {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const { code, state, error: googleError } = c.req.query();

  if (googleError) {
    console.error('[google/callback] Google returned error:', googleError);
    return c.redirect(`${appUrl}/auth?error=google_denied`, 302);
  }

  if (!code || !state) {
    return c.redirect(`${appUrl}/auth?error=invalid_callback`, 302);
  }

  // Verify CSRF state
  const storedState = getCookie(c, 'praconnect_oauth_state');
  deleteCookie(c, 'praconnect_oauth_state', { path: '/' });

  if (!storedState || storedState !== state) {
    return c.redirect(`${appUrl}/auth?error=invalid_state`, 302);
  }

  let googleUser;
  try {
    const tokens = await exchangeCodeForTokens(code);
    googleUser = await getGoogleUserInfo(tokens.access_token);
  } catch (err) {
    console.error('[google/callback] Token exchange error:', (err as Error).message);
    return c.redirect(`${appUrl}/auth?error=google_error`, 302);
  }

  if (!googleUser.email_verified) {
    return c.redirect(`${appUrl}/auth?error=google_unverified_email`, 302);
  }

  const email = normalizeEmail(googleUser.email);
  const now = new Date().toISOString();

  // Check if we already have a user with this Google provider ID
  let user: UserRow | null = (await db.prepare(
    'SELECT * FROM users WHERE googleProviderId = ?'
  ).get<UserRow>(googleUser.sub)) ?? null;

  if (!user) {
    // Check if there's already a password-based account with this email
    const emailUser = await findUserByEmail(email);

    if (emailUser) {
      // Safe account linking: link Google to the existing account
      // We only do this because Google has verified the email (email_verified = true above)
      await db.prepare(`
        UPDATE users SET googleProviderId = ?, avatarUrl = COALESCE(avatarUrl, ?), updatedAt = ? WHERE id = ?
      `).run(googleUser.sub, googleUser.picture ?? null, now, emailUser.id);
      user = await findUserById(emailUser.id);
    } else {
      // Create a new user
      const baseUsername = deriveUsernameFromGoogle(googleUser.name, email);
      // Ensure uniqueness
      let username = baseUsername;
      let suffix = 1;
      while (await db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
        username = `${baseUsername}${suffix++}`;
      }

      const userId = generateId();
      await db.prepare(`
        INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, googleProviderId, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)
      `).run(userId, googleUser.name, username, email, googleUser.picture ?? null, googleUser.sub, now, now);
      user = await findUserById(userId);
    }
  }

  if (!user) {
    return c.redirect(`${appUrl}/auth?error=server_error`, 302);
  }

  await bootstrapAdminRole();
  user = (await findUserById(user.id)) ?? user;

  const token = await createSession(user.id);
  setSessionCookie(c, token);
  await recordLoginActivity(user.id, 'google', getCoarseLocation(c));

  return c.redirect(`${appUrl}/`, 302);
});

// ─── POST /forgot-password ────────────────────────────────────────────────────

auth.post('/forgot-password', async (c) => {
  const ipLimit = rateLimit(c, `forgot:ip:${getClientIp(c)}`, 'forgotPassword');
  if (ipLimit) return ipLimit;

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const { email: rawEmail } = body as Record<string, string>;
  if (!rawEmail) return c.json(apiError('VALIDATION_ERROR', 'Email is required.'), 400);

  const GENERIC_RESPONSE = {
    message: 'If an account exists for this email, a verification code has been sent.',
  };

  const emailErr = validateEmail(rawEmail);
  if (emailErr) return c.json(GENERIC_RESPONSE); // Don't reveal validation issues

  const email = normalizeEmail(rawEmail);

  // Per-email SMTP abuse guard. Applied before the account lookup so the
  // generic response (and account enumeration) is unaffected.
  const emailLimit = rateLimit(c, `forgot:email:${email}`, 'forgotPasswordEmail');
  if (emailLimit) return emailLimit;

  const user = await findUserByEmail(email);

  if (user && user.emailVerified) {
    const otp = await createOtp(user.id, email, 'password_reset');
    try {
      await sendPasswordResetOtp(email, user.name, otp);
    } catch {
      console.error('[forgot-password] Password reset email delivery failed.');
    }
  }

  return c.json(GENERIC_RESPONSE);
});

// ─── POST /verify-password-reset ─────────────────────────────────────────────

auth.post('/verify-password-reset', async (c) => {
  const ipLimit = rateLimit(c, `verifyReset:ip:${getClientIp(c)}`, 'verifyPasswordReset');
  if (ipLimit) return ipLimit;

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const { email: rawEmail, otp } = body as Record<string, string>;
  if (!rawEmail || !otp) return c.json(apiError('VALIDATION_ERROR', 'Email and OTP are required.'), 400);

  const email = normalizeEmail(rawEmail);

  const emailLimit = rateLimit(c, `verifyReset:email:${email}`, 'verifyPasswordResetEmail');
  if (emailLimit) return emailLimit;

  const result = await verifyOtp(email, 'password_reset', otp.trim());
  if (!result.ok) {
    const messages: Record<string, string> = {
      NOT_FOUND: 'No password reset request found. Please request a new code.',
      EXPIRED: 'The code has expired. Please request a new one.',
      MAX_ATTEMPTS: 'Too many incorrect attempts. Please request a new code.',
      INVALID: 'Invalid code.',
    };
    const code = result.error ?? 'INVALID';
    const status = code === 'MAX_ATTEMPTS' ? 429 : 400;
    return c.json(apiError(code, messages[code] ?? 'Invalid code.'), status);
  }

  // Issue a short-lived password-reset token
  const resetToken = (() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  })();

  const tokenHash = await (async (token: string) => {
    const data = new TextEncoder().encode(token);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  })(resetToken);

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

  await db.prepare(`
    INSERT INTO passwordResetTokens (id, userId, tokenHash, expiresAt, usedAt, createdAt)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(generateId(), result.userId!, tokenHash, expiresAt, now);

  return c.json({ resetToken });
});

// ─── POST /reset-password ─────────────────────────────────────────────────────

auth.post('/reset-password', async (c) => {
  const ipLimit = rateLimit(c, `resetPassword:ip:${getClientIp(c)}`, 'resetPassword');
  if (ipLimit) return ipLimit;

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const { resetToken, newPassword } = body as Record<string, string>;
  if (!resetToken || !newPassword) {
    return c.json(apiError('VALIDATION_ERROR', 'Reset token and new password are required.'), 400);
  }

  const passwordErr = validatePassword(newPassword);
  if (passwordErr) return c.json(apiError('VALIDATION_ERROR', passwordErr), 400);

  // Hash the submitted token for DB lookup
  const tokenHash = await (async (token: string) => {
    const data = new TextEncoder().encode(token);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  })(resetToken);

  // Prevent brute-forcing a specific reset token across requests.
  const tokenLimit = rateLimit(c, `resetPassword:token:${tokenHash}`, 'resetPasswordToken');
  if (tokenLimit) return tokenLimit;

  const now = new Date().toISOString();

  const row = (await db.prepare(`
    SELECT id, userId, expiresAt, usedAt FROM passwordResetTokens WHERE tokenHash = ?
  `).get<{ id: string; userId: string; expiresAt: string; usedAt: string | null }>(tokenHash)) ?? null;

  if (!row) return c.json(apiError('INVALID_RESET_TOKEN', 'Invalid or expired reset token.'), 400);
  if (row.usedAt) return c.json(apiError('RESET_TOKEN_USED', 'This reset token has already been used.'), 400);
  if (row.expiresAt < now) return c.json(apiError('RESET_TOKEN_EXPIRED', 'This reset token has expired. Please request a new one.'), 400);

  const passwordHash = await hashPassword(newPassword);

  // Mark token as used
  await db.prepare('UPDATE passwordResetTokens SET usedAt = ? WHERE id = ?').run(now, row.id);

  // Update password and invalidate all sessions (force re-login)
  await db.prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?').run(passwordHash, now, row.userId);
  await deleteAllUserSessions(row.userId);

  return c.json({ message: 'Password reset successfully. Please log in with your new password.' });
});

export { auth };
