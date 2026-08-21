// server/shims/better-sqlite3.js
// Cloudflare Worker shim for better-sqlite3.
// This file is aliased over the real 'better-sqlite3' npm package by wrangler.jsonc.
// It provides stub exports that throw immediately if called.
// In practice, this shim is NEVER called because the files that use better-sqlite3
// are themselves replaced by the db/index and db/async aliases.

const WORKER_ERROR = '[better-sqlite3] This module is not available in the Cloudflare Worker runtime. Use the D1 adapter instead.';

function Database() {
  throw new Error(WORKER_ERROR);
}

Database.prototype.prepare = () => { throw new Error(WORKER_ERROR); };
Database.prototype.exec = () => { throw new Error(WORKER_ERROR); };
Database.prototype.close = () => { throw new Error(WORKER_ERROR); };

module.exports = Database;
module.exports.default = Database;
