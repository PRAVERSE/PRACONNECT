// One-off seed: admin user + session for the live multi-GB upload test.
// Run BEFORE starting the server (the DB must not be open twice).
// Prints the session cookie value on stdout.
import { db } from '../db/index';
import { createSession, SESSION_COOKIE_NAME } from '../auth/session';

const now = new Date().toISOString();
db.prepare(
  `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, NULL, NULL, 1, 'admin', ?, ?)`
).run('live-multigb-admin', 'Live MultiGB Admin', 'livemultigbadmin', 'live-multigb@test.dev', now, now);

const token = await createSession('live-multigb-admin');
console.log(`${SESSION_COOKIE_NAME}=${token}`);
