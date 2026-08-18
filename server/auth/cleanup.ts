// server/auth/cleanup.ts
// Phase 6.8: bounded cleanup of expired/obsolete authentication data.
// Uses the timestamps already stored by the schema (expiresAt / loginTime) —
// no second clock is invented. Only expired rows are deleted: active sessions
// and still-valid verification/reset tokens are never touched. The function
// is idempotent and safe to run repeatedly, and returns aggregate counts only
// (callers log counts — never tokens, hashes, emails, or credentials).

import { db } from '../db/index';

/** How long loginActivity rows are retained (default: 30 days). */
export const LOGIN_ACTIVITY_RETENTION_MS = Math.max(
  0,
  parseInt(process.env.LOGIN_ACTIVITY_RETENTION_MS ?? '2592000000', 10) || 2592000000
);

export interface AuthCleanupResult {
  deletedSessions: number;
  deletedOtps: number;
  deletedResetTokens: number;
  deletedPendingSignups: number;
  deletedLoginActivity: number;
  total: number;
}

// Per-statement batch + per-table iteration cap keep each sweep bounded so a
// huge backlog can never block the server for an excessive period.
const BATCH = 2000;
const MAX_BATCHES = 25;

type CleanupTable = 'sessions' | 'emailOtps' | 'passwordResetTokens' | 'pendingSignups' | 'loginActivity';

/** Delete up to BATCH * MAX_BATCHES rows where `column` < cutoff. Returns the count. */
function deleteRowsBounded(table: CleanupTable, column: 'expiresAt' | 'loginTime', cutoff: string): number {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const info = db.prepare(`DELETE FROM ${table} WHERE ${column} < ? LIMIT ${BATCH}`).run(cutoff);
    total += info.changes;
    if (info.changes < BATCH) break;
  }
  return total;
}

/**
 * Delete expired sessions, OTPs, password-reset tokens, pending signups, and
 * loginActivity older than the configured retention. Returns aggregate counts.
 */
export function cleanupAuthData(now = Date.now()): AuthCleanupResult {
  const nowIso = new Date(now).toISOString();
  const loginCutoff = new Date(now - LOGIN_ACTIVITY_RETENTION_MS).toISOString();

  const deletedSessions = deleteRowsBounded('sessions', 'expiresAt', nowIso);
  const deletedOtps = deleteRowsBounded('emailOtps', 'expiresAt', nowIso);
  const deletedResetTokens = deleteRowsBounded('passwordResetTokens', 'expiresAt', nowIso);
  const deletedPendingSignups = deleteRowsBounded('pendingSignups', 'expiresAt', nowIso);
  const deletedLoginActivity = deleteRowsBounded('loginActivity', 'loginTime', loginCutoff);

  return {
    deletedSessions,
    deletedOtps,
    deletedResetTokens,
    deletedPendingSignups,
    deletedLoginActivity,
    total: deletedSessions + deletedOtps + deletedResetTokens + deletedPendingSignups + deletedLoginActivity,
  };
}
