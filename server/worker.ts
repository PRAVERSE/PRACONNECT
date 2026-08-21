// server/worker.ts
// Primary Cloudflare Worker entry point for PraConnect.
// Handles API requests, WebSocket upgrades to RealtimeDO, Backblaze B2 storage,
// and static SPA asset serving via Cloudflare Assets.

import { createApp } from './app';
import { RealtimeDO } from './realtime/durableObject';
import { setMediaStorage, BackblazeB2MediaStorage } from './storage/mediaStorage';
import { getSessionUser, SESSION_COOKIE_NAME } from './auth/session';
import { setD1Database } from './db/d1-adapter';

// Export the Durable Object class for Cloudflare runtime binding
export { RealtimeDO };

export interface Env {
  DB: any; // D1Database
  REALTIME_DO?: any; // DurableObjectNamespace
  ASSETS?: any; // Fetcher
  B2_APPLICATION_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  B2_BUCKET_NAME?: string;
  B2_BUCKET_ID?: string;
  B2_ENDPOINT?: string;
  APP_URL?: string;
  NODE_ENV?: string;
  SESSION_SECRET?: string;
  ADMIN_EMAILS?: string;
  ADMIN_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  EMAIL_FROM?: string;
  STUN_URL?: string;
  TURN_URL?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
}

let appInstance: ReturnType<typeof createApp> | null = null;

function getApp(): ReturnType<typeof createApp> {
  if (!appInstance) {
    appInstance = createApp({ enableStaticServing: false });
  }
  return appInstance;
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // 0. Bind D1 database before any route processes a request
    if (env.DB) {
      setD1Database(env.DB);
    }

    // 1. Initialize Backblaze B2 Media Storage if credentials exist
    if (env.B2_APPLICATION_KEY_ID && env.B2_APPLICATION_KEY && env.B2_BUCKET_NAME) {
      setMediaStorage(
        new BackblazeB2MediaStorage({
          applicationKeyId: env.B2_APPLICATION_KEY_ID,
          applicationKey: env.B2_APPLICATION_KEY,
          bucketName: env.B2_BUCKET_NAME,
          bucketId: env.B2_BUCKET_ID,
          endpoint: env.B2_ENDPOINT,
        })
      );
    }

    // 2. Real-time WebSocket upgrade handling (/ws)
    if (url.pathname === '/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (env.REALTIME_DO) {
        // Extract session cookie from request to authenticate user
        const cookieHeader = request.headers.get('Cookie') || '';
        let sessionToken: string | undefined;
        for (const cookie of cookieHeader.split(';')) {
          const parts = cookie.split('=');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const val = parts.slice(1).join('=').trim();
            if (name === SESSION_COOKIE_NAME || name === '__Host-praconnect-session' || name === 'praconnect-session') {
              sessionToken = decodeURIComponent(val);
              break;
            }
          }
        }

        let userId = url.searchParams.get('userId');
        if (!userId && sessionToken) {
          try {
            const session = await getSessionUser(sessionToken);
            if (session?.user?.id) {
              userId = session.user.id;
            }
          } catch {
            // Session lookup fallback
          }
        }

        // Get RealtimeDO instance (singleton hub for real-time presence & calling)
        const id = env.REALTIME_DO.idFromName('global_realtime_hub');
        const stub = env.REALTIME_DO.get(id);

        const newUrl = new URL(request.url);
        if (userId) {
          newUrl.searchParams.set('userId', userId);
        }

        const newHeaders = new Headers(request.headers);
        if (userId) {
          newHeaders.set('x-user-id', userId);
        }

        const forwardReq = new Request(newUrl.toString(), {
          headers: newHeaders,
        });

        return stub.fetch(forwardReq);
      }
    }

    // 3. API, Health, and Static Asset Routing
    const app = getApp();

    // Attach environment bindings to globalThis / process.env fallbacks where needed
    if (env.APP_URL && typeof process !== 'undefined' && process.env) {
      process.env.APP_URL = env.APP_URL;
    }
    if (env.ADMIN_EMAILS && typeof process !== 'undefined' && process.env) {
      process.env.ADMIN_EMAILS = env.ADMIN_EMAILS;
    }

    // Check if path is an API route or health check
    if (
      url.pathname.startsWith('/api') ||
      url.pathname === '/health' ||
      url.pathname === '/ready'
    ) {
      return app.fetch(request, env, ctx);
    }

    // 4. Static frontend asset serving via Cloudflare Assets (Vite SPA)
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
      // SPA Fallback: non-matching routes get index.html
      const spaUrl = new URL('/index.html', request.url);
      return env.ASSETS.fetch(new Request(spaUrl.toString(), request));
    }

    // Fallback to Hono application
    return app.fetch(request, env, ctx);
  },
};
