// scripts/seed-local-test-admins.ts
// LOCAL DEVELOPMENT ONLY — seeds the two configured admin accounts plus one
// normal user into the local dev database so password login can be tested.
//
//   npx tsx scripts/seed-local-test-admins.ts
//
// Security rules (see the dev-test-credentials policy):
//   - The password is NEVER hard-coded here. It is read from the
//     LOCAL_TEST_PASSWORD environment variable (must be 8+ characters).
//   - Nothing password-like is ever printed or logged by this script.
//   - No ADMIN_PASSWORD / ADMIN_PASSWORDS environment variables are used.
//   - Authorization is unchanged: admin = users.role === 'admin', granted only
//     by the existing server-side bootstrapAdminRole() (ADMIN_EMAILS).
//   - The password is stored with the EXISTING Argon2id password hashing
//     system (server/auth/auth.ts hashPassword) — the same one /api/auth/login
//     verifies against. No parallel auth path is created.
//
// The script is idempotent: existing accounts are preserved; the test password
// is applied only when an account has no password yet (e.g. a Google-created
// account). Re-running after db:reset-local recreates the accounts.

import 'dotenv/config';

// ─── 1. Safety checks (before any database code runs) ────────────────────────
const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
if (nodeEnv === 'production') {
  console.error('Local test-admin seeding blocked: NODE_ENV is production.');
  process.exit(1);
}

const testPassword = process.env.LOCAL_TEST_PASSWORD;
if (!testPassword || testPassword.length === 0) {
  console.error('LOCAL_TEST_PASSWORD must be set before seeding local test admins.');
  process.exit(1);
}

// ─── 2. Existing server auth system (same DB, same hasher, same bootstrap) ───
const { db, bootstrapAdminRole } = await import('../server/db/index');
const { hashPassword } = await import('../server/auth/auth');

// ─── 3. Accounts ─────────────────────────────────────────────────────────────
// Emails are config values (already public in .env ADMIN_EMAILS), never secrets.
const ADMIN_A = {
  id: 'local-admin-a',
  name: 'Suman Saurabh Jha',
  username: 'sumansourabhj',
  email: 'sumansourabhj@gmail.com',
};
const ADMIN_B = {
  id: 'local-admin-b',
  name: 'Suman Jha',
  username: 'sumanj15122008',
  email: 'sumanj15122008@gmail.com',
};
const NORMAL_USER = {
  id: 'local-normal-user',
  name: 'PraConnect Test User',
  username: 'praconnecttestuser',
  email: 'testuser@praconnect.local',
};

const passwordHash = await hashPassword(testPassword);
const now = new Date().toISOString();

function upsert(account: { id: string; name: string; username: string; email: string }): void {
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, googleProviderId, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, 1, NULL, 'user', ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       username    = excluded.username,
       name        = excluded.name,
       passwordHash = COALESCE(users.passwordHash, excluded.passwordHash),
       updatedAt   = excluded.updatedAt`
  ).run(account.id, account.name, account.username, account.email, passwordHash, now, now);
}

upsert(ADMIN_A);
upsert(ADMIN_B);
upsert(NORMAL_USER);

// ─── 4. Admin role via the existing bootstrap (never hand-assigned) ──────────
bootstrapAdminRole();

// ─── 5. Report — only id, email, role (never password/token/hash) ────────────
const rows = db
  .prepare('SELECT id, email, role FROM users ORDER BY createdAt')
  .all() as { id: string; email: string; role: string }[];
console.log('\n[seed-local-test-admins] accounts ready (id/email/role only):');
for (const row of rows) {
  console.log(`  ${row.id} | ${row.email} | ${row.role}`);
}

db.close();