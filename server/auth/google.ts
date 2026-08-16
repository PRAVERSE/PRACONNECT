// server/auth/google.ts
// Google OAuth 2.0 / OpenID Connect helpers.
// Does NOT use Firebase or any auth platform — plain HTTP to Google's endpoints.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

// ─── State parameter (CSRF protection) ───────────────────────────────────────

/** Generate a cryptographically random state string. */
export function generateOAuthState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Build the authorization URL ─────────────────────────────────────────────

export function buildGoogleAuthUrl(state: string): string {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const redirectUri = requireEnv('GOOGLE_REDIRECT_URI');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Exchange authorization code for tokens ───────────────────────────────────

interface GoogleTokens {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const redirectUri = requireEnv('GOOGLE_REDIRECT_URI');

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  return response.json() as Promise<GoogleTokens>;
}

// ─── Fetch Google user info ───────────────────────────────────────────────────

export interface GoogleUserInfo {
  sub: string;        // Google's unique user ID (our googleProviderId)
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  given_name?: string;
  family_name?: string;
}

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Google user info');
  }

  return response.json() as Promise<GoogleUserInfo>;
}

// ─── Username derivation helper ───────────────────────────────────────────────

/**
 * Derive a candidate username from a Google name/email.
 * The caller should check uniqueness and append a suffix if needed.
 */
export function deriveUsernameFromGoogle(name: string, email: string): string {
  // Try to use the local part of the email first (more predictable)
  const local = email.split('@')[0] ?? '';
  const base = local.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 28) || 'user';
  return base.toLowerCase();
}
