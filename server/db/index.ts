// server/db/index.ts
// Dual-runtime database interface.
//
// In Cloudflare Workers (production):
//   - Module evaluation: db.prepare(sql) returns lazy wrappers with zero I/O and zero Node imports.
//   - Request execution: Queries execute against Cloudflare D1 (env.DB), initialized via
//     setD1Database(env.DB) in server/worker.ts.
//   - better-sqlite3 and createRequire are NEVER called or reachable in Cloudflare Workers.
//
// In Node.js (local dev & tsx test runner):
//   - Statements lazily execute against the better-sqlite3 implementation in ./node.ts.

import { createRequire } from 'node:module';
import { db as d1Db, setD1Database as d1SetD1Database } from './d1-adapter';

// ─── Environment & Runtime State ─────────────────────────────────────────────

let _isD1Active = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _nodeDb: any = null;

export function isCloudflareWorkers(): boolean {
  if (_isD1Active) return true;
  // Cloudflare Workers runtime globals
  if (typeof (globalThis as any).WebSocketPair !== 'undefined') return true;
  if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') return true;
  if (typeof process === 'undefined') return true;
  if (!process.versions?.node) return true;
  return false;
}

/** Called by server/worker.ts on each fetch request to bind D1. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setD1Database(d1: any): void {
  _isD1Active = true;
  d1SetD1Database(d1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNodeDb(): any {
  if (isCloudflareWorkers()) {
    throw new Error('Node.js SQLite adapter cannot be used in Cloudflare Workers; D1 database is required.');
  }
  if (!_nodeDb) {
    const req = typeof require !== 'undefined'
      ? require
      : (typeof createRequire !== 'undefined' ? createRequire(import.meta.url) : null);
    if (!req) {
      throw new Error('Module loader is unavailable for Node.js SQLite database adapter.');
    }
    const target = './' + 'node';
    _nodeDb = req(target);
  }
  return _nodeDb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getActiveClient(): any {
  if (_isD1Active) {
    return d1Db;
  }
  if (isCloudflareWorkers()) {
    throw new Error('Cloudflare D1 database has not been initialized. Ensure setD1Database(env.DB) is called in worker.ts fetch handler.');
  }
  return getNodeDb().db;
}

// ─── Lazy Universal Statement ────────────────────────────────────────────────

export class UniversalStatement<BindParameters extends unknown[] = any[], Result = any> {
  constructor(public readonly sql: string) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = Result>(...args: any[]): Result extends never ? T | undefined : (unknown extends Result ? T | undefined : Result | undefined) {
    const client = getActiveClient();
    const stmt = client.prepare(this.sql);
    return stmt.get(...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all<T = Result>(...args: any[]): Result extends never ? T[] : (unknown extends Result ? T[] : Result[]) {
    const client = getActiveClient();
    const stmt = client.prepare(this.sql);
    return stmt.all(...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(...args: any[]): { changes: number; lastInsertRowid: number | bigint } {
    const client = getActiveClient();
    const stmt = client.prepare(this.sql);
    return stmt.run(...args);
  }
}

// ─── Unified Database Object ─────────────────────────────────────────────────

export const db = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare<T1 = any, T2 = any>(sql: string): UniversalStatement<
    T1 extends unknown[] ? T1 : any[],
    T2 extends Record<string, unknown> ? T2 : (T1 extends Record<string, unknown> ? T1 : any)
  > {
    // Safe at module top-level: creates a lazy statement wrapper without executing any I/O
    return new UniversalStatement(sql) as any;
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec(sql: string): any {
    const client = getActiveClient();
    return client.exec(sql);
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      const client = getActiveClient();
      return client.transaction(fn)(...args);
    }) as any;
  },

  pragma(pragma: string): void {
    if (_isD1Active) {
      d1Db.pragma(pragma);
      return;
    }
    if (isCloudflareWorkers()) {
      return;
    }
    getNodeDb().db.pragma(pragma);
  },

  close(): void {
    if (isCloudflareWorkers()) {
      return;
    }
    getNodeDb().closeDatabase();
  },

  get open(): boolean {
    const client = getActiveClient();
    return client.open;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function parseAdminEmails(env?: NodeJS.ProcessEnv): string[] {
  if (isCloudflareWorkers()) {
    return [];
  }
  return getNodeDb().parseAdminEmails(env);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bootstrapAdminRole(env?: NodeJS.ProcessEnv): any {
  if (isCloudflareWorkers()) {
    return Promise.resolve([]);
  }
  return getNodeDb().bootstrapAdminRole(env);
}

export function closeDatabase(): void {
  if (isCloudflareWorkers()) {
    return;
  }
  getNodeDb().closeDatabase();
}
