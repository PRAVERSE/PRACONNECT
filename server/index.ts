// server/index.ts
// PraConnect backend entry point.
// Runs directly with Bun: bun run server/index.ts
// Or with tsx for Node: npx tsx server/index.ts

import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './routes/auth';
import { rooms } from './routes/rooms';
import { startRoomCleanupWorker } from './rooms/cleanup';

// Initialize database (runs schema on first start)
import './db/index';

// Validate SMTP configuration safely on startup without logging secrets
const smtpLoaded = Boolean(
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.EMAIL_FROM
);
console.log(`[smtp] SMTP configuration loaded: ${smtpLoaded ? 'yes' : 'no'}`);

const app = new Hono();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow requests from the Vite dev server. Credentials required for cookies.
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

// ─── Request logger ───────────────────────────────────────────────────────────
// Only logs method + path + status — no request bodies
app.use('*', logger());

import fs from 'node:fs';
import path from 'node:path';

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.ogv':
    case '.ogg': return 'video/ogg';
    case '.mov': return 'video/quicktime';
    case '.mkv': return 'video/x-matroska';
    case '.avi': return 'video/x-msvideo';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

import { handleMediaServing } from './routes/rooms';

// ─── Routes ───────────────────────────────────────────────────────────────────
app.route('/api/auth', auth);
app.route('/api/rooms', rooms);

// ─── Media File Serving with HTTP 206 Partial Content (Range Requests) ────────
app.on(['GET', 'HEAD'], '/api/uploads/:filename', handleMediaServing);

// Health check
app.get('/api/health', (c) => c.json({ ok: true, service: 'praconnect-api' }));

// 404 fallback
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404));

// Global error handler
app.onError((err, c) => {
  console.error('[server] Unhandled error:', err.message);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }, 500);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// Empty-room cleanup worker (does not keep the process alive on its own)
startRoomCleanupWorker();

// Bun-native server
const bunGlobal = (globalThis as any).Bun;
if (typeof bunGlobal !== 'undefined') {
  bunGlobal.serve({
    fetch: app.fetch,
    port: PORT,
  });
  console.log(`[server] PraConnect API running on http://localhost:${PORT}`);
} else {
  // Node.js mode — use @hono/node-server
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port: PORT });
  console.log(`[server] PraConnect API running on http://localhost:${PORT} (Node.js mode)`);
}

export default app;
