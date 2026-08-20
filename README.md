# PraConnect

Peer-to-peer (WebRTC) video/audio rooms with a collaborative whiteboard, real-time presence and chat, plus secure media uploads. Built with React + Vite, Hono, better-sqlite3, and WebRTC.

## Architecture

```
Browser (React SPA, Vite)
   │  WebRTC (STUN/TURN, host/srflx/relay candidates)
   │  HTTPS (Reverse Proxy: TLS termination, then plain HTTP to Node)
   │  /api/*            JSON + Server-Sent Events (room events, replays)
   ▼
Node.js (Hono, @hono/node-server)
   ├── SQLite (better-sqlite3, WAL)     ── DATABASE_PATH
   └── Uploads (streamed, size-limited) ── UPLOADS_DIR
```

- **API + static files, one server, one entry point** (`server/index.ts`). In production the same process serves `dist/` (the Vite build) with SPA fallback — no separate static host needed.
- **SSE with replay & reconnection**: the client remembers the last event id and replays missed events after a disconnect; room membership is recovered transparently if the socket reconnects late.
- **Media security (Phase 6.1/6.2)**: uploads are streamed through the server with a size cap, are only readable by room members (media authorization check), and are never reachable via the static/SPA path.
- **MKV movie support (Phase 6.9)**: local uploads accept MP4, WebM, MOV, and MKV. The server verifies Matroska/EBML signatures (never trusting the extension), then converts MKV (and codec-incompatible MP4/MOV when FFprobe is available) to a browser-compatible MP4 (H.264 + AAC, fast-start) via FFmpeg. The room only receives the playable MP4 URL once conversion completes — an unplayable MKV is never broadcast. **FFmpeg is an optional system requirement**: without it, MKV uploads are rejected with a clear message instead. Verify with `ffmpeg -version`. FFmpeg is executed server-side with argument arrays only (no shell), bounded by a timeout, and its output is never exposed to end users.
- **Media Library (Phase B/C)**: admins upload large videos (default cap **10 GiB** via `MAX_ADMIN_MEDIA_BYTES` — a safe upper bound) through a **resumable chunked pipeline**: the client slices the file into 8 MiB chunks (`file.slice`, never `file.arrayBuffer()`) and streams one `PUT` per chunk. Sessions track progress in `mediaUploadSessions`; after a disconnect only the missing chunks are re-sent. On `complete` the server assembles the seekable source (streamed, never buffered), validates the container with FFprobe, remuxes (H.264/AAC) or transcodes to a **playable MP4 (H.264 + AAC, faststart)**, generates a poster, and marks the item ready. Bytes live behind the **`MediaStorage` abstraction** (`LocalDiskStorage` for development; object storage swaps in without route changes). Users browse/search/stream/download **published + ready** items over HTTP Range (200/206/HEAD/416); admins manage every state. Rooms select library items by `mediaId` (host-only) and every participant streams the same playable MP4 from their own authenticated session — **library video never travels over WebRTC**, and playback stays synchronized through the existing server-authoritative play/pause/seek state.
- **Rate limiting (Phase 6.3)**: in-memory limiter on auth endpoints; `TRUST_PROXY=true` only behind a trusted reverse proxy.
- **Bounded ICE restarts (Phase 6.6)**: configurable STUN/TURN, relay-only mode for diagnostics, exponential backoff, restart attempts capped.
- **Production hardening (Phase 6.8)**: a periodic maintenance worker prunes expired auth data (sessions/OTPs/reset tokens/pending signups), old login activity, stale `roomEvents` (per-room cap + age retention, replay window always preserved), and orphaned upload files — aggregate counts only in the logs. Room cleanup is transactional; deleted rooms also remove their media files from disk. Full-mesh rooms are capped at **12 participants** (`MAX_ROOM_PARTICIPANTS`, clamped server-side — the client cannot request more). Poster URLs are validated server-side (`http(s)` or `/api/uploads/` only). `POST /api/auth/logout-all` logs the user out of every device.

## Development

**Prerequisites:** Node.js (>= 20 recommended), npm.

```bash
npm install
npm run dev        # Vite on :3000, API on :4000 (tsx watch, auto-restart)
```

- The Vite dev server proxies `/api/*` to `http://localhost:4000` (`vite.config.ts`).
- Copy `.env.example` to `.env` for OAuth/email/WebRTC settings (all optional).
- Run tests: `npm test` (node:test suites: rooms, rate limit, SSE reconnect, ICE config, production serving).
- Type-check + lint: `npm run lint`.

## Production

```bash
npm install
npm run build      # client build → dist/
npm run start      # NODE_ENV=production, serves dist/ + API on :4000
```

`npm run start` validates the production environment and **fails fast** (with a clear message) if anything required is missing — it never prints secret values.

### Required environment (production)

| Variable | Requirement |
| --- | --- |
| `APP_URL` | Public origin, must start with `https://` (Secure session cookies). |
| `DATABASE_PATH` | Absolute, persistent, outside `dist/`. |

See `.env.example` → *Production* section for the full list (optional: `STATIC_DIR`, SMTP, Google OAuth, TURN — the app runs without them).

### Serving architecture (recommended)

```
Internet ── HTTPS/TLS ── Reverse proxy (Caddy / nginx / Render / Fly.io) ── :4000 Node
                              │                                          │
                              └── dist/ served by the Node process        └── uploads/ (persistent volume)
```

- **TLS** terminates at the proxy; the proxy forwards plain HTTP to Node on `:4000` (or a private port). Set `TRUST_PROXY=true` only if the proxy overwrites `X-Forwarded-For`.
- The database file and `uploads/` must live on **persistent storage** (mount a volume) — both are outside `dist/`.
- **Health checks**: `GET /health` (liveness, always OK) and `GET /ready` (readiness, 503 when the database is unavailable). Point your load balancer at `/ready`.
- **Graceful shutdown**: `SIGINT`/`SIGTERM` close the HTTP server (bounded grace for active SSE connections), then stop the cleanup worker and close the database before exit. A second signal is ignored during shutdown.
- **Backups**: stop the process (or rely on WAL checkpoints) before copying the `.db` file. `*.db-wal` / `*.db-shm` must be backed up together if the process is running.

### Reverse-proxy example (Caddy)

```caddyfile
praconnect.example.com {
    reverse_proxy 127.0.0.1:4000
}
```

## Environment variables

Full reference in [.env.example](.env.example): ports, `APP_URL`, `DATABASE_PATH`, `UPLOADS_DIR`, SMTP, Google OAuth, rate-limit tuning (`TRUST_PROXY`, `RATE_LIMIT_*`), cleanup/retention (`LOGIN_ACTIVITY_RETENTION_MS`, `ROOM_EVENTS_MAX_PER_ROOM`, `ROOM_EVENTS_RETENTION_MS`, `ORPHAN_UPLOAD_RETENTION_MS`, `MAX_ROOM_PARTICIPANTS`), Media Library (`MEDIA_STORAGE_DIR`, `MAX_ADMIN_MEDIA_BYTES`, `MEDIA_UPLOAD_CHUNK_BYTES`, `MEDIA_CONVERT_TIMEOUT_MS`, `MEDIA_RETAIN_ORIGINAL`, `MEDIA_SESSION_TTL_MS`, `ORPHAN_MEDIA_RETENTION_MS`, `FFMPEG_PATH`, `FFPROBE_PATH`), and WebRTC (`VITE_STUN_SERVERS`, `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`, `VITE_WEBRTC_RELAY_ONLY`).

> **TURN credentials are exposed to browsers** (they are `VITE_*` values bundled into the client). Production must use short-lived/ephemeral credentials minted by a TURN REST API — never long-lived secrets.

## Security notes

- Session cookies are `Secure` + `SameSite` in production (`__Host-praconnect-session`); OAuth flows are bound to the user's browser session.
- CORS is an explicit allowlist (`APP_URL`, localhost dev origins), credentials enabled, no wildcard.
- Static file serving is confined to `dist/` via realpath containment; `.env`, `*.db`, uploads, and API paths are never served by it (verified by the `production-serving` test suite, which includes traversal attempts).
- Uploads are size-limited, streamed to disk, and content-served only to authorized room members.
- Expired sessions/OTPs/tokens are pruned periodically; `loginActivity` is retained for a configurable period; nothing beyond aggregate counts is logged.
- Room cleanup is transactional and removes upload media files; orphaned upload files are swept after a configurable grace period without ever touching non-media files.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Concurrent Vite (`:3000`) + API watch (`:4000`) |
| `npm run build` | Vite production build → `dist/` |
| `npm run start` | Production server (validates env, serves `dist/` + API) |
| `npm test` | All server/client test suites |
| `npm run lint` | Type-check both tsconfigs |
| `npm run clean` | Remove `dist/` (POSIX only) |#   P R A C O N N E C T .  
 