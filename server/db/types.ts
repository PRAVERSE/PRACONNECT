// server/db/types.ts
// Shared database interface used by both the Node.js (better-sqlite3) adapter
// and the Cloudflare D1 adapter. Routes and services import db from ../db/index
// and use this interface without knowing which backend is active.

/** A prepared statement with async .get/.all/.run compatible with D1 and better-sqlite3 wrappers. */
export interface DbStatement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = Record<string, unknown>>(...args: any[]): Promise<T | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all<T = Record<string, unknown>>(...args: any[]): Promise<T[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(...args: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
}

/** Shared DB interface compatible with both better-sqlite3 (wrapped) and Cloudflare D1. */
export interface DbClient {
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => T): () => Promise<T>;
  pragma(pragma: string): void;
  readonly open: boolean;
}
