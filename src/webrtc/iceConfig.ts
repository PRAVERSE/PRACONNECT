// src/webrtc/iceConfig.ts
// Phase 6.6: single authoritative source for the RTCPeerConnection ICE
// configuration. Environment-driven STUN/TURN with deterministic validation
// and safe fallbacks — the WebRTCManager must never build iceServers itself.
//
// Security: VITE_* values ship to the browser, so TURN credentials in
// production must be short-lived/ephemeral (e.g. TURN REST API credentials).
// This module never logs or exposes credentials through diagnostics.

export interface IceConfigInput {
  /** Comma-separated `stun:` URLs (VITE_STUN_SERVERS). */
  stunServers?: string | null;
  /** Comma-separated `turn:` / `turns:` URLs (VITE_TURN_URLS). */
  turnUrls?: string | null;
  turnUsername?: string | null;
  turnCredential?: string | null;
  /** Opt-in diagnostic mode: force relay-only ICE gathering. Default: false. */
  relayOnly?: boolean;
}

export interface IceConfigDiagnostics {
  stunConfigured: boolean;
  stunCount: number;
  turnConfigured: boolean;
  turnCount: number;
  turnTransportTypes: string[];
  relayOnly: boolean;
}

export interface IceConfigResult {
  rtcConfig: RTCConfiguration;
  diagnostics: IceConfigDiagnostics;
}

/** Public STUN fallbacks used when no STUN servers are configured. */
export const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

/**
 * Bounded ICE restart policy (Phase 6.6). Attempts use exponential backoff
 * and stop after ICE_RESTART_MAX_ATTEMPTS — a hard failure can never loop
 * restartIce forever.
 */
export const ICE_RESTART = {
  maxAttempts: 3,
  baseDelayMs: 1500,
  maxDelayMs: 12000,
} as const;

/** Delay for the given 1-based restart attempt, or null once the budget is spent. */
export function nextIceRestartDelayMs(attemptNumber: number): number | null {
  if (attemptNumber < 1) return ICE_RESTART.baseDelayMs;
  if (attemptNumber > ICE_RESTART.maxAttempts) return null;
  return Math.min(ICE_RESTART.baseDelayMs * Math.pow(2, attemptNumber - 1), ICE_RESTART.maxDelayMs);
}

/**
 * Split a comma-separated URL list, trimming whitespace, dropping empty
 * entries and duplicates, and keeping only URLs accepted by `keep`.
 */
export function parseIceUrlList(
  raw: string | null | undefined,
  keep?: (url: string) => boolean
): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const url = part.trim();
    if (!url) continue;
    if (keep && !keep(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Best-effort transport classification of a TURN URL ('udp' | 'tcp' | 'tls'). */
export function transportTypeOf(url: string): string {
  const query = /[?&]transport=([a-z0-9]+)/i.exec(url);
  if (query) return query[1].toLowerCase() === 'tcp' ? 'tcp' : 'udp';
  return url.startsWith('turns:') ? 'tls' : 'udp';
}

/**
 * Build the RTCConfiguration from environment-shaped input. Deterministic and
 * never throws for optional TURN misconfiguration:
 * - empty/whitespace/duplicate URLs are dropped
 * - STUN URLs are kept only for `stun:` schemes, TURN URLs only for
 *   `turn:`/`turns:` schemes
 * - a TURN entry is created only when URLs AND username AND credential exist;
 *   anything less degrades to STUN-only
 */
export function buildIceConfig(input: IceConfigInput): IceConfigResult {
  const stun = parseIceUrlList(input.stunServers ?? '', (u) => u.startsWith('stun:'));
  const turn = parseIceUrlList(input.turnUrls ?? '', (u) => u.startsWith('turn:') || u.startsWith('turns:'));

  const effectiveStun = stun.length > 0 ? stun : DEFAULT_STUN_SERVERS;

  const hasTurnCredentials = Boolean(input.turnUsername && input.turnCredential);
  const turnEntry: RTCIceServer[] =
    turn.length > 0 && hasTurnCredentials
      ? [{ urls: turn, username: input.turnUsername!, credential: input.turnCredential! }]
      : [];

  const iceServers: RTCIceServer[] = [
    ...(effectiveStun.length > 0 ? [{ urls: effectiveStun }] : []),
    ...turnEntry,
  ];

  const rtcConfig: RTCConfiguration = {
    iceServers,
    ...(input.relayOnly ? { iceTransportPolicy: 'relay' as const } : {}),
  };

  return {
    rtcConfig,
    diagnostics: {
      stunConfigured: effectiveStun.length > 0,
      stunCount: effectiveStun.length,
      turnConfigured: turnEntry.length > 0,
      turnCount: turn.length,
      turnTransportTypes: turn.map(transportTypeOf),
      relayOnly: Boolean(input.relayOnly),
    },
  };
}

/**
 * Read the ICE configuration from Vite's import.meta.env. Supports the
 * canonical Phase 6.6 names (VITE_STUN_SERVERS, VITE_TURN_URLS) plus the
 * legacy singular names (VITE_STUN_SERVER, VITE_TURN_SERVER) for compatibility.
 */
export function getEnvIceConfig(): IceConfigResult {
  const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {};
  return buildIceConfig({
    stunServers: env.VITE_STUN_SERVERS ?? env.VITE_STUN_SERVER,
    turnUrls: env.VITE_TURN_URLS ?? env.VITE_TURN_SERVER,
    turnUsername: env.VITE_TURN_USERNAME,
    turnCredential: env.VITE_TURN_CREDENTIAL,
    relayOnly: env.VITE_WEBRTC_RELAY_ONLY === 'true',
  });
}