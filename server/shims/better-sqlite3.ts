// server/shims/better-sqlite3.ts
// Cloudflare Worker shim for better-sqlite3.
// This file is aliased over the real 'better-sqlite3' npm package by wrangler.jsonc
// when bundling for the Worker runtime. It provides stub exports that throw
// immediately if called, preventing the native addon from ever loading.
//
// In practice, this shim is NEVER called at runtime because server/db/index.ts
// (which imports better-sqlite3) is itself replaced by server/db/d1-adapter.ts
// via the alias configuration. This shim exists as a safety net.

const WORKER_ERROR = '[better-sqlite3] This module is not available in the Cloudflare Worker runtime. Use the D1 adapter instead.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Database(): any {
  throw new Error(WORKER_ERROR);
}

Database.prototype.prepare = () => { throw new Error(WORKER_ERROR); };
Database.prototype.exec = () => { throw new Error(WORKER_ERROR); };
Database.prototype.close = () => { throw new Error(WORKER_ERROR); };

export default Database;
