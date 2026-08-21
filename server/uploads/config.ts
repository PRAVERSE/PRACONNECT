// server/uploads/config.ts
// Phase 6.8: shared uploads directory resolution (single source of truth for
// both the upload route and the filesystem-lifecycle cleanup).

import fs from 'node:fs';
import path from 'node:path';

// UPLOADS_DIR is overridable for test isolation; defaults to ./uploads.
const defaultBase = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '';
export const uploadsDir = typeof process !== 'undefined' && process.env?.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(defaultBase, 'uploads');

export function ensureUploadsDir(): void {
  try {
    if (typeof fs?.existsSync === 'function' && typeof fs?.mkdirSync === 'function') {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
    }
  } catch {
    // Graceful no-op in serverless / Workers environments without filesystem access
  }
}

// Ensure directory exists in Node.js runtime without throwing in Workers
ensureUploadsDir();

