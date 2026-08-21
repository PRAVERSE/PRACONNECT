// server/db/index.ts
// Node.js (better-sqlite3) database module.
// Re-exports the raw synchronous better-sqlite3 Database and helpers.
//
// CLOUDFLARE WORKERS:
//   wrangler.jsonc aliases server/db/async.ts (NOT this file) to d1-adapter.ts.
//   This file is also excluded from the Worker bundle because nothing in the
//   Worker import graph reaches it after the alias replaces server/db/async.ts.
//
// Route files import db from '../db/async' — compatible with both Node and D1.
// Test files may import from '../db/index' for direct better-sqlite3 access.

export { db, parseAdminEmails, bootstrapAdminRole, closeDatabase } from './node';
