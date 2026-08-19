// server/routes/push.ts
// Push notification subscription management endpoints.

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { apiError } from '../auth/auth';
import { rateLimit } from '../rate-limit';
import {
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
} from '../push/pushService';

export const pushRoutes = new Hono();

pushRoutes.use('*', requireAuth);

pushRoutes.get('/vapid-public-key', (c) => {
  return c.json({ publicKey: getVapidPublicKey() });
});

pushRoutes.post('/subscribe', async (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `pushSub:${userId}`, 'dmSend');
  if (tooMany) return tooMany;

  const body = await c.req.json().catch(() => ({}));
  const { endpoint, keys, userAgent } = body as any;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return c.json(apiError('VALIDATION_ERROR', 'Missing push subscription credentials.'), 400);
  }

  const res = savePushSubscription(userId, endpoint, keys.p256dh, keys.auth, userAgent);
  return c.json({ ok: true, subscriptionId: res.subscriptionId });
});

pushRoutes.post('/unsubscribe', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const { endpoint } = body as any;

  if (!endpoint) {
    return c.json(apiError('VALIDATION_ERROR', 'Endpoint required.'), 400);
  }

  removePushSubscription(userId, endpoint);
  return c.json({ ok: true });
});
