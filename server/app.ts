// server/app.ts
// Phase 6.7: Hono application factory. The entry point (server/index.ts)
// owns the process lifecycle — environment validation, listening, workers,
// and graceful shutdown — while this module owns routing and middleware.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import path from 'node:path';
import { auth } from './routes/auth';
import { rooms, handleMediaServing } from './routes/rooms';
import { profile } from './routes/profile';
import { users } from './routes/users';
import { friends } from './routes/friends';
import { messages } from './routes/messages';
import { invites } from './routes/invites';
import { media } from './routes/media';
import { adminMedia } from './routes/adminMedia';
import { requireAuth } from './middleware/auth';
import { db } from './db/index';
import { isApiPath, resolveStaticFile, serveStaticFile } from './static';
import { isStaticServingEnabled, resolveDistDir } from './productionEnv';

export interface CreateAppOptions {
  /** Force static serving from this directory (deployment/testing override). */
  staticDir?: string;
  /** Override the static-serving decision (default: NODE_ENV=production or STATIC_DIR). */
  enableStaticServing?: boolean;
}

const NOT_FOUND_BODY = { error: { code: 'NOT_FOUND', message: 'Route not found.' } };

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  // ─── CORS (unchanged from the original entry point) ─────────────────────────
  // Allowlist only; credentials are required for cookies. Never a wildcard.
  const allowedOrigins = [
    process.env.APP_URL ?? 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:5173',
  ];

  app.use('*', cors({
    origin: (origin) => {
      if (!origin) return null; // same-origin requests
      if (allowedOrigins.includes(origin)) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  }));

  // ─── Request logger (method + path + status only; never bodies) ─────────────
  app.use('*', logger());

  // ─── API routes (unchanged) ─────────────────────────────────────────────────
  app.route('/api/auth', auth);
  app.route('/api/rooms', rooms);
  app.route('/api/profile', profile);
  app.route('/api/users', users);
  app.route('/api/friends', friends);
  app.route('/api/messages', messages);
  app.route('/api/watch-invites', invites);
  app.route('/api/media', media);
  app.route('/api/admin/media', adminMedia);

  // Uploaded media: authenticated + room-membership authorized (Phase 6.2).
  app.use('/api/uploads/*', requireAuth);
  app.on(['GET', 'HEAD'], '/api/uploads/:filename', handleMediaServing);

  // ─── Health & readiness (Phase 6.7) ─────────────────────────────────────────
  // Cheap, secret-free endpoints for load balancer / proxy health checks.
  app.get('/health', (c) => c.json({ ok: true }));
  // /ready verifies the minimum dependency required to accept traffic: the DB.
  app.get('/ready', (c) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  // Existing health route — preserved for backward compatibility.
  app.get('/api/health', (c) => c.json({ ok: true, service: 'praconnect-api' }));

  // ─── Static serving + SPA fallback (Phase 6.7) ──────────────────────────────
  // Only active in production (NODE_ENV=production) or when explicitly enabled
  // via STATIC_DIR / staticDir / enableStaticServing. /api/* is never touched;
  // non-GET/HEAD requests are never SPA-fallback'd; missing files fall back to
  // dist/index.html.
  const servingEnabled =
    options.enableStaticServing ?? (Boolean(options.staticDir) || isStaticServingEnabled(process.env));
  const distDir = options.staticDir ? path.resolve(options.staticDir) : resolveDistDir(process.env);

  app.notFound((c) => {
    const pathname = c.req.path;

    if (isApiPath(pathname)) {
      return c.json(NOT_FOUND_BODY, 404);
    }

    if (servingEnabled && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      const file = resolveStaticFile(distDir, pathname);
      if (file) return serveStaticFile(c, file);
      // SPA fallback: non-API browser routes (e.g. /room/ABC123) get the app
      // shell so client-side routing can take over.
      const indexFile = resolveStaticFile(distDir, '/');
      if (indexFile) return serveStaticFile(c, indexFile, 'text/html; charset=utf-8');
    }

    return c.json(NOT_FOUND_BODY, 404);
  });

  // ─── Global error handler (unchanged) ───────────────────────────────────────
  app.onError((err, c) => {
    console.error('[server] Unhandled error:', err.message);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }, 500);
  });

  return app;
}