// server/productionEnv.ts
// Phase 6.7: production environment validation and static-serving mode.
// Never prints the value of any secret — errors only name missing/invalid
// variables.

import path from 'node:path';

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Production static serving is active when running with NODE_ENV=production,
 * or when STATIC_DIR is set explicitly (deployment/testing override).
 */
export function isStaticServingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.STATIC_DIR);
}

/** Resolve the directory that serves the Vite build output (default ./dist). */
export function resolveDistDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : path.resolve(process.cwd(), 'dist');
}

/**
 * Validate the configuration required for a production server. Throws with a
 * clear, secret-free message when a required setting is missing or invalid.
 * Optional services (SMTP, OAuth, TURN) are deliberately NOT required — the
 * application runs without them (STUN-only fallback, email-free mode).
 */
export function validateProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];

  if (env.NODE_ENV !== 'production') {
    errors.push('NODE_ENV must be set to "production"');
  }

  const appUrl = env.APP_URL;
  if (!appUrl) {
    errors.push('APP_URL is required (the public https:// origin of the app)');
  } else if (!/^https:\/\//.test(appUrl)) {
    errors.push('APP_URL must start with https:// (production session cookies are Secure-only)');
  }

  const dbPath = env.DATABASE_PATH;
  if (!dbPath) {
    errors.push('DATABASE_PATH is required (use an absolute persistent path outside the project)');
  } else {
    const distRoot = resolveDistDir(env);
    const relative = path.relative(distRoot, path.resolve(dbPath));
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      errors.push('DATABASE_PATH must not point inside dist/ (the database would be lost on rebuild)');
    }
  }

  if (errors.length > 0) {
    throw new Error(`[server] Production environment validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/** Non-fatal startup warnings for partially configured optional services. */
export function productionWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];

  const smtpParts = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_USER, env.SMTP_PASS, env.EMAIL_FROM];
  if (smtpParts.some(Boolean) && !smtpParts.every(Boolean)) {
    warnings.push('SMTP is partially configured — email features stay disabled until all SMTP_* values are set');
  }

  if (env.TRUST_PROXY === 'true') {
    warnings.push('TRUST_PROXY=true — only keep this when the server sits behind a trusted reverse proxy that sets forwarding headers');
  }

  return warnings;
}