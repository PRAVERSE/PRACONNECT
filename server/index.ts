// server/index.ts
// PraConnect server entry point.
//
// Development:   npm run dev            (Vite dev server proxies /api to this)
// Production:    npm run build && npm run start
//
// The production path serves dist/ with SPA fallback, runs a bounded cleanup
// worker, and shuts down gracefully on SIGINT/SIGTERM.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { validateProductionEnv, productionWarnings, isStaticServingEnabled, resolveDistDir } from './productionEnv';

// ─── Production environment gate ──────────────────────────────────────────────
// Fails fast with clear, secret-free messages before the database opens or any
// service starts. (db/app imports are dynamic so nothing initializes early.)
if (process.env.NODE_ENV === 'production') {
  validateProductionEnv(process.env);
  for (const warning of productionWarnings(process.env)) {
    console.warn(`[server] ${warning}`);
  }
}

// ─── Production build validation ──────────────────────────────────────────────
// dist/ must already exist when production serving is expected — the server
// never builds or falls back to a blank page.
const distDir = resolveDistDir(process.env);
if (isStaticServingEnabled(process.env)) {
  const indexHtml = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.error(`[server] dist/index.html not found at ${distDir}`);
    console.error('[server] Run "npm run build" first (production), or unset STATIC_DIR.');
    process.exit(1);
  }
}

// Build the application (opens the SQLite database, runs idempotent schema).
const [
  { createApp },
  { closeDatabase },
  { startRoomCleanupWorker, stopRoomCleanupWorker },
  { installGracefulShutdown },
  { setupWebSocketServer, closeWebSocketServer }
] = await Promise.all([
  import('./app'),
  import('./db/index'),
  import('./rooms/cleanup'),
  import('./shutdown'),
  import('./realtime/ws')
]);
const app = createApp();

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
console.log(`[server] PraConnect running in ${mode} mode`);
if (isStaticServingEnabled(process.env)) {
  console.log(`[server] Static serving enabled (dist: ${distDir})`);
}
console.log('[server] Health: GET /health — Readiness: GET /ready');

// Empty-room cleanup worker (does not keep the process alive on its own)
startRoomCleanupWorker();

// ─── Start ────────────────────────────────────────────────────────────────────
const bunGlobal = (globalThis as any).Bun;
if (typeof bunGlobal !== 'undefined') {
  // Bun-native server (best-effort graceful stop)
  const server = bunGlobal.serve({
    fetch: app.fetch,
    port: PORT,
  });
  console.log(`[server] PraConnect API running on http://localhost:${PORT}`);
  let shuttingDown = false;
  const stopBun = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received — shutting down`);
    closeWebSocketServer();
    stopRoomCleanupWorker();
    closeDatabase();
    try {
      server.stop(true);
    } catch {
      // already stopped
    }
    process.exit(0);
  };
  process.once('SIGINT', () => stopBun('SIGINT'));
  process.once('SIGTERM', () => stopBun('SIGTERM'));
} else {
  // Node.js mode — use @hono/node-server with graceful shutdown
  const { serve } = await import('@hono/node-server');
  const server = serve({ fetch: app.fetch, port: PORT });
  setupWebSocketServer(server as any);
  console.log(`[server] PraConnect API running on http://localhost:${PORT} (Node.js mode)`);
  installGracefulShutdown(server, {
    cleanup: () => {
      closeWebSocketServer();
      stopRoomCleanupWorker();
      closeDatabase();
    },
  });
}