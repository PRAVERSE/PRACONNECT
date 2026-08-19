// server/routes/calling.ts
// Hono router for WebRTC Calling configuration and short-lived ICE credentials.

import { Hono } from 'hono';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../rate-limit';

export const calling = new Hono();

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Helper to generate short-lived TURN credentials using HMAC-SHA1
 * (Standard coturn / TURN REST API specification).
 */
export function generateTurnCredentials(userId: string, secret: string, ttlSeconds = 86400): { username: string; credential: string } {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/**
 * Build authoritative list of ICE servers (STUN + TURN) based on environment.
 */
export function getIceServersForUser(userId: string, env: Record<string, string | undefined> = process.env): IceServerConfig[] {
  const stunUrl = env.STUN_URL || 'stun:stun.l.google.com:19302';
  const iceServers: IceServerConfig[] = [{ urls: stunUrl }];

  const turnUrl = env.TURN_URL;
  const turnSecret = env.TURN_SECRET || env.TURN_CREDENTIAL_SECRET;
  const turnUsername = env.TURN_USERNAME || env.TURN_USERNAME_SECRET;
  const turnCredential = env.TURN_CREDENTIAL;

  if (turnUrl) {
    if (turnSecret) {
      const { username, credential } = generateTurnCredentials(userId, turnSecret);
      iceServers.push({
        urls: turnUrl.includes(',') ? turnUrl.split(',').map((s) => s.trim()) : turnUrl,
        username,
        credential,
      });
    } else if (turnUsername && turnCredential) {
      iceServers.push({
        urls: turnUrl.includes(',') ? turnUrl.split(',').map((s) => s.trim()) : turnUrl,
        username: turnUsername,
        credential: turnCredential,
      });
    }
  }

  return iceServers;
}

// ─── GET /api/calling/ice-servers ──────────────────────────────────────────
calling.get('/ice-servers', requireAuth, (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `iceServers:${userId}`, 'dmSend');
  if (tooMany) return tooMany;

  const iceServers = getIceServersForUser(userId);
  return c.json({ ok: true, iceServers });
});
