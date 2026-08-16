// server/auth/loginActivity.ts
// Records authentication activity to the SQLite loginActivity table.
// Stores id, userId, loginTime, location (coarse/unknown), and authenticationMethod.

import { db } from '../db/index';
import { generateId } from './auth';

export type AuthMethod = 'email' | 'google' | 'signup';

export interface LoginActivityRow {
  id: string;
  userId: string;
  loginTime: string;
  location: string;
  authenticationMethod: string;
}

/**
 * Record a successful authentication event.
 * Never throws — authentication must not fail because of logging errors.
 */
export function recordLoginActivity(
  userId: string,
  authenticationMethod: AuthMethod,
  location: string = 'unknown'
): void {
  try {
    const id = generateId();
    const loginTime = new Date().toISOString();
    const cleanLocation = (location && location.trim()) || 'unknown';

    db.prepare(`
      INSERT INTO loginActivity (id, userId, loginTime, location, authenticationMethod)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, loginTime, cleanLocation, authenticationMethod);
  } catch (err) {
    console.error('[loginActivity] Failed to record login activity:', (err as Error).message);
  }
}
