// server/storage/mediaStorage.ts
// Phase B: Media Library storage abstraction.
//
// MediaStorage is the single seam between the media routes and where bytes
// live. Phase C swaps LocalDiskStorage for object storage / streaming storage
// behind the same interface — routes never touch filesystem paths.
//
// Safety rules (enforced by LocalDiskStorage):
//   - keys are opaque server-generated strings; user input never becomes a key
//   - keys are validated against a strict charset and can never escape the
//     storage root (no '/', '\', '..', control characters, or absolute paths)
//   - the root is resolved from MEDIA_STORAGE_DIR (default: uploads/library)

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { Readable, Writable } from 'node:stream';

export interface MediaReadResult {
  stream: Readable;
  size: number;
}

export interface MediaStorage {
  /** Write a byte stream under `key` (replaces any existing content). */
  write(key: string, stream: Readable): Promise<void>;
  /** Open a destination stream for `key`. Errors during writes must leave no
   *  partial object behind (the caller is responsible for deleting on
   *  failure). */
  openWriteStream(key: string): Promise<Writable>;
  /** Open `key` for reading, optionally a byte range [start, end] inclusive.
   *  Resolves null when the key does not exist. */
  read(key: string, opts?: { start?: number; end?: number }): Promise<MediaReadResult | null>;
  /** Delete `key` (missing files are treated as success). */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Size of the stored object, or null when missing. */
  stat(key: string): Promise<{ size: number } | null>;
  /** All keys under a `prefix` (e.g. 'upload/<sessionId>/'), for session
   *  completeness checks and orphan sweeps. Keys are returned without the
   *  storage root prefix. */
  listKeys(prefix: string): Promise<string[]>;
}

const SAFE_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Maximum length of a storage key (server-generated, keeps paths bounded). */
export const MAX_STORAGE_KEY_LENGTH = 200;

/** True when `key` is a safe storage key. Every implementation must reject
 *  unsafe keys — keys are server-generated, this is defense in depth. */
export function isSafeStorageKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) {
    return false;
  }
  if (!SAFE_KEY_RE.test(key)) return false;
  if (key === '.' || key === '..') return false;
  return true;
}

/** Resolve MEDIA_STORAGE_DIR (default: uploads/library under the project root). */
export function resolveStorageRoot(env: NodeJS.ProcessEnv = (typeof process !== 'undefined' ? process.env : {}) as any): string {
  const dir = env?.MEDIA_STORAGE_DIR ?? path.join('uploads', 'library');
  return path.resolve(dir);
}

export class LocalDiskStorage implements MediaStorage {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ? path.resolve(root) : resolveStorageRoot();
  }

  private resolve(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new Error('Unsafe storage key rejected.');
    }
    const full = path.resolve(this.root, key);
    // Defense in depth: the resolved path must stay inside the root.
    const relative = path.relative(this.root, full);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Storage key escapes the storage root.');
    }
    return full;
  }

  async write(key: string, stream: Readable): Promise<void> {
    const full = this.resolve(key);
    await fs.promises.mkdir(this.root, { recursive: true });
    const dest = fs.createWriteStream(full, { flags: 'w' });
    try {
      await new Promise<void>((resolve, reject) => {
        pipeline(stream, dest, (err) => {
          if (err) {
            fs.promises.rm(full, { force: true }).catch(() => {});
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      await fs.promises.rm(full, { force: true }).catch(() => {});
      throw err;
    }
  }

  async openWriteStream(key: string): Promise<Writable> {
    const full = this.resolve(key);
    await fs.promises.mkdir(this.root, { recursive: true });
    return fs.createWriteStream(full, { flags: 'w' });
  }

  async read(
    key: string,
    opts?: { start?: number; end?: number }
  ): Promise<MediaReadResult | null> {
    const full = this.resolve(key);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(full);
    } catch {
      return null;
    }
    const size = stat.size;
    let start = 0;
    let end = size - 1;
    if (opts) {
      if (typeof opts.start === 'number' && opts.start >= 0) start = Math.min(opts.start, size);
      if (typeof opts.end === 'number' && opts.end >= 0) end = Math.min(opts.end, size - 1);
      if (start > end || start >= size) return null;
    }
    const stream = fs.createReadStream(full, { start, end });
    return { stream, size };
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.promises.rm(full, { force: true }).catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    const full = this.resolve(key);
    try {
      await fs.promises.access(full, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string): Promise<{ size: number } | null> {
    const full = this.resolve(key);
    try {
      const stat = await fs.promises.stat(full);
      return { size: stat.size };
    } catch {
      return null;
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    if (!prefix || !/^[a-zA-Z0-9._-]+$/.test(prefix)) {
      throw new Error('Unsafe storage prefix rejected.');
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const keys: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(prefix)) {
        keys.push(entry.name);
      }
    }
    return keys;
  }
}

// ─── Backblaze B2 Storage Re-export ──────────────────────────────────────────
export { BackblazeB2MediaStorage } from './backblazeB2Storage';
export type { BackblazeB2Config } from './backblazeB2Storage';

import { BackblazeB2MediaStorage } from './backblazeB2Storage';

// ─── Process-wide instance ───────────────────────────────────────────────────
// Routes use getMediaStorage() so tests / Workers can swap in the right instance.

let currentStorage: MediaStorage | null = null;

export function createMediaStorageFromEnv(env: Record<string, any> = {}): MediaStorage {
  const keyId = env.B2_APPLICATION_KEY_ID || (typeof process !== 'undefined' ? process.env?.B2_APPLICATION_KEY_ID : '');
  const appKey = env.B2_APPLICATION_KEY || (typeof process !== 'undefined' ? process.env?.B2_APPLICATION_KEY : '');
  const bucketName = env.B2_BUCKET_NAME || (typeof process !== 'undefined' ? process.env?.B2_BUCKET_NAME : '');
  const endpoint = env.B2_ENDPOINT || (typeof process !== 'undefined' ? process.env?.B2_ENDPOINT : '');
  const bucketId = env.B2_BUCKET_ID || (typeof process !== 'undefined' ? process.env?.B2_BUCKET_ID : undefined);

  if (keyId && appKey && bucketName) {
    return new BackblazeB2MediaStorage({
      applicationKeyId: keyId,
      applicationKey: appKey,
      bucketName,
      bucketId,
      endpoint: endpoint || undefined,
    });
  }

  return new LocalDiskStorage();
}

export function getMediaStorage(): MediaStorage {
  if (!currentStorage) {
    currentStorage = createMediaStorageFromEnv(typeof process !== 'undefined' ? process.env : {});
  }
  return currentStorage;
}

export function setMediaStorage(storage: MediaStorage | null): void {
  currentStorage = storage;
}

export function setMediaStorageForTesting(storage: MediaStorage | null): void {
  currentStorage = storage;
}