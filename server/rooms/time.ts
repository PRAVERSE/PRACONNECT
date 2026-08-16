// server/rooms/time.ts
// Shared time helpers for room services.

export function nowIso(): string {
  return new Date().toISOString();
}