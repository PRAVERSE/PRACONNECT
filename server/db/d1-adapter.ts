// server/db/d1-adapter.ts
// Cloudflare D1-backed database adapter for the Worker runtime.
// This file is aliased over server/db/index.ts by wrangler.jsonc at bundle time,
// so better-sqlite3 is NEVER imported or executed in the Worker bundle.
//
// Interface compatibility with better-sqlite3:
//   db.prepare(sql)             → D1LazyStatement (safe at module scope — no I/O)
//   stmt.get(...args)           → Promise<T | undefined>
//   stmt.all(...args)           → Promise<T[]>
//   stmt.run(...args)           → Promise<{ changes: number; lastInsertRowid: number }>
//   db.exec(sql)                → Promise<void>
//   db.transaction(fn)          → (...args) => Promise<ReturnType<fn>>
//   db.pragma(...)              → no-op
//   db.open                     → true

// ─── D1 singleton ─────────────────────────────────────────────────────────────
// Populated by worker.ts before the first request is processed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _d1: any = null;

/** Called from server/worker.ts once per fetch() invocation before routing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setD1Database(d1: any): void {
  _d1 = d1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getD1(): any {
  if (!_d1) {
    throw new Error('[d1-adapter] D1 database is not initialized. Call setD1Database(env.DB) before using db.');
  }
  return _d1;
}

// ─── Lazy D1 Statement ────────────────────────────────────────────────────────

class D1LazyStatement {
  private readonly sql: string;

  constructor(sql: string) {
    this.sql = sql;
  }

  /** Execute and return the first row as type T, or undefined. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get<T = Record<string, unknown>>(...args: any[]): Promise<T | undefined> {
    const d1 = getD1();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt: any = d1.prepare(this.sql);
    const bound = args.length > 0 ? stmt.bind(...args) : stmt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await bound.first();
    return (result as T) ?? undefined;
  }

  /** Execute and return all rows as T[]. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async all<T = Record<string, unknown>>(...args: any[]): Promise<T[]> {
    const d1 = getD1();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt: any = d1.prepare(this.sql);
    const bound = args.length > 0 ? stmt.bind(...args) : stmt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await bound.all();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((result.results ?? []) as T[]);
  }

  /** Execute a write statement. Returns { changes, lastInsertRowid }. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(...args: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
    const d1 = getD1();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt: any = d1.prepare(this.sql);
    const bound = args.length > 0 ? stmt.bind(...args) : stmt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await bound.run();
    return {
      changes: (result.meta?.changes as number) ?? 0,
      lastInsertRowid: (result.meta?.last_row_id as number) ?? 0,
    };
  }
}

// ─── D1 db object ─────────────────────────────────────────────────────────────

export const db = {
  /** Create a lazy prepared statement. Safe to call at module scope (no I/O). */
  prepare(sql: string): D1LazyStatement {
    return new D1LazyStatement(sql);
  },

  /** Execute raw SQL (DDL / multi-statement). */
  async exec(sql: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d1: any = getD1();
    await d1.exec(sql);
  },

  /**
   * Simulate a transaction wrapper for D1.
   * D1 doesn't support interactive transactions from Worker code,
   * so this simply runs the function body sequentially.
   */
  transaction<T>(fn: () => T): () => Promise<T> {
    return async (): Promise<T> => {
      return await fn();
    };
  },

  /** No-op in D1 — pragmas are managed by the D1 service internally. */
  pragma(_pragma: string): void {
    // no-op
  },

  /** Always true in D1 Workers — the DB connection is always live. */
  get open(): boolean {
    return true;
  },
};

// ─── Admin bootstrap stubs ────────────────────────────────────────────────────
// Admin promotion via DB is done through D1 migrations / Cloudflare dashboard
// in production Workers. The Node.js startup bootstrap cannot run synchronously
// in Workers, so we export safe no-op stubs.

export function parseAdminEmails(_env?: Record<string, string | undefined>): string[] {
  return [];
}

export async function bootstrapAdminRole(
  _env?: Record<string, string | undefined>
): Promise<string[]> {
  return [];
}

/** No-op in D1 Workers — D1 stays open for the lifetime of the isolate. */
export function closeDatabase(): void {
  // no-op
}
