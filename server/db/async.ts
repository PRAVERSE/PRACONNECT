// server/db/async.ts
// Async-compatible database module.
//
// NODE.JS (local dev / tests):
//   Wraps the better-sqlite3 synchronous API in a DbClient-compatible async
//   interface (Promises that resolve immediately with synchronous values).
//
// CLOUDFLARE WORKERS (production):
//   wrangler.jsonc aliases THIS module to ./d1-adapter at bundle time,
//   so this file is replaced by the D1-backed implementation. better-sqlite3
//   and server/db/index.ts are NEVER imported in the Worker bundle.
//
// Route files and auth helpers import db from '../db/async'.
// Test files import db from '../db/index' for direct better-sqlite3 access.

import { db as rawDb, parseAdminEmails, bootstrapAdminRole as rawBootstrap, closeDatabase } from './node';
import type { DbClient, DbStatement } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapStatement(stmt: any): DbStatement {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async get<T = Record<string, unknown>>(...args: any[]): Promise<T | undefined> {
      const result = args.length > 0 ? stmt.get(...args) : stmt.get();
      return (result as T) ?? undefined;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async all<T = Record<string, unknown>>(...args: any[]): Promise<T[]> {
      const result = args.length > 0 ? stmt.all(...args) : stmt.all();
      return (result ?? []) as T[];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async run(...args: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
      const info = args.length > 0 ? stmt.run(...args) : stmt.run();
      return { changes: info.changes ?? 0, lastInsertRowid: info.lastInsertRowid ?? 0 };
    },
  };
}

export const db: DbClient = {
  prepare(sql: string): DbStatement {
    return wrapStatement(rawDb.prepare(sql));
  },

  async exec(sql: string): Promise<void> {
    rawDb.exec(sql);
  },

  transaction<T>(fn: () => T): () => Promise<T> {
    const tx = rawDb.transaction(fn);
    return async (): Promise<T> => tx();
  },

  pragma(pragma: string): void {
    rawDb.pragma(pragma);
  },

  get open(): boolean {
    return rawDb.open;
  },
};

export { parseAdminEmails, closeDatabase };

export async function bootstrapAdminRole(env?: NodeJS.ProcessEnv): Promise<string[]> {
  return rawBootstrap(env);
}
