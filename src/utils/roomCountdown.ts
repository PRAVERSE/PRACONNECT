// src/utils/roomCountdown.ts
// Lightweight rejoin-window countdown formatting shared by the Explore UI and
// its tests. The server-provided rejoinExpiresAt is authoritative; this helper
// only renders MM:SS from a client-side clock, clamping at 00:00 so an expired
// room never shows a negative value.

/** Format the remaining time until `expiresAt` as MM:SS (clamped to 00:00). */
export function formatCountdown(expiresAt: string, now: number): string {
  const total = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** True when the client-side rejoin window has already closed. */
export function isRejoinWindowClosed(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= now;
}
