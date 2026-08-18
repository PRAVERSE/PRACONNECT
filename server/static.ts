// server/static.ts
// Phase 6.7: production static file serving for the Vite build output (dist/).
// Safe by construction: API paths are never touched, requested paths are
// normalized and confined to dist/ (realpath-verified, so symlinks cannot
// escape), and SPA fallback only ever applies to non-API GET/HEAD requests.

import fs from 'node:fs';
import path from 'node:path';
import type { Context } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** True for request paths owned by the API — never served as static/SPA. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Split a (possibly percent-encoded) URL pathname into safe segments.
 * Returns null when the path is unsafe: traversal ('..'), backslashes, NUL,
 * or undecodable percent-encoding.
 */
export function safePathSegments(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    out.push(segment);
  }
  return out;
}

/**
 * Resolve a URL pathname to a file inside distDir, or null when the request
 * is unsafe or the file does not exist. Both distDir and the candidate are
 * realpath-resolved so symlinks cannot escape the build directory. The root
 * path ('/' and '') resolves to distDir/index.html.
 */
export function resolveStaticFile(distDir: string, pathname: string): string | null {
  let distReal: string;
  try {
    distReal = fs.realpathSync(distDir);
  } catch {
    return null; // dist/ not built — nothing to serve
  }

  const segments = safePathSegments(pathname);
  if (!segments) return null;

  const candidate = path.join(distDir, ...(segments.length > 0 ? segments : ['index.html']));
  let real: string;
  try {
    real = fs.realpathSync(candidate);
    if (!fs.statSync(real).isFile()) return null;
  } catch {
    return null; // missing file or unreadable
  }

  const relative = path.relative(distReal, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return real;
}

/** Serve a resolved static file (GET/HEAD) with safe headers. */
export function serveStaticFile(c: Context, filePath: string, contentType?: string): Response {
  const stat = fs.statSync(filePath);
  const headers: Record<string, string> = {
    'Content-Type': contentType ?? mimeFor(filePath),
    'Content-Length': String(stat.size),
    // index.html must never be cached aggressively (SPA fallback target).
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400',
  };
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(fs.readFileSync(filePath), { status: 200, headers });
}