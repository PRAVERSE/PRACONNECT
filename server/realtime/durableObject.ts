// server/realtime/durableObject.ts
// Cloudflare Durable Object implementation for PraConnect real-time messaging,
// presence tracking, typing indicators, watch invites, and WebRTC 1-to-1 call signaling.

export interface ActiveCallSession {
  callId: string;
  callerUserId: string;
  recipientUserId: string;
  callType: 'audio' | 'video';
  status: 'ringing' | 'accepted' | 'connecting' | 'connected' | 'ended' | 'rejected' | 'cancelled';
  createdAt: number;
}

export class RealtimeDO {
  state: any;
  env: any;
  // userId -> Set of WebSockets
  userSockets: Map<string, Set<any>> = new Map();
  // ws -> userId
  socketUsers: Map<any, string> = new Map();
  // callId -> ActiveCallSession
  activeCalls: Map<string, ActiveCallSession> = new Map();

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. WebSocket upgrade endpoint: /ws
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new (globalThis as any).WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      // Extract userId from URL query or headers
      const userId = url.searchParams.get('userId') || request.headers.get('x-user-id');

      if (!userId) {
        server.accept();
        server.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Authentication required.' }));
        server.close(4001, 'Unauthorized');
        return new Response(null, { status: 101, webSocket: client } as any);
      }

      this.handleSession(server, userId);
      return new Response(null, { status: 101, webSocket: client } as any);
    }

    // 2. Broadcast / internal API endpoint for worker-to-DO dispatch
    if (request.method === 'POST') {
      try {
        const body = await request.json() as { action: string; targetUserId?: string; roomId?: string; payload?: any };
        if (body.action === 'emit_user' && body.targetUserId && body.payload) {
          this.sendToUser(body.targetUserId, body.payload);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (body.action === 'emit_all' && body.payload) {
          this.broadcast(body.payload);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), { status: 400 });
      }
    }

    return new Response('RealtimeDO active', { status: 200 });
  }

  private handleSession(ws: any, userId: string): void {
    if (typeof ws.accept === 'function') {
      ws.accept();
    }

    // Register user socket
    const existing = this.userSockets.get(userId) ?? new Set();
    const wasOffline = existing.size === 0;
    existing.add(ws);
    this.userSockets.set(userId, existing);
    this.socketUsers.set(ws, userId);

    if (wasOffline) {
      // Notify online
      this.broadcastUserPresence(userId, 'online');
    }

    // Send connected welcome frame
    this.sendJson(ws, {
      type: 'connected',
      userId,
      serverTime: new Date().toISOString(),
    });

    ws.addEventListener('message', async (event: any) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : null;
        if (!data || typeof data.type !== 'string') return;
        await this.handleClientEvent(ws, userId, data);
      } catch (err) {
        console.error('[RealtimeDO] message handling error:', err);
      }
    });

    ws.addEventListener('close', () => {
      this.cleanupSocket(ws, userId);
    });

    ws.addEventListener('error', () => {
      this.cleanupSocket(ws, userId);
    });
  }

  private cleanupSocket(ws: any, userId: string): void {
    this.socketUsers.delete(ws);
    const set = this.userSockets.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.userSockets.delete(userId);
        const now = new Date().toISOString();
        this.broadcastUserPresence(userId, 'offline', now);
      }
    }
  }

  private broadcastUserPresence(userId: string, status: 'online' | 'offline', lastSeenAt?: string | null): void {
    const payload = {
      type: 'presence',
      userId,
      status,
      lastSeenAt: lastSeenAt ?? null,
    };
    this.broadcast(payload);
  }

  private sendJson(ws: any, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket may be closing
    }
  }

  public sendToUser(userId: string, payload: unknown): boolean {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return false;
    for (const ws of Array.from(sockets)) {
      this.sendJson(ws, payload);
    }
    return true;
  }

  public broadcast(payload: unknown, excludeWs?: any): void {
    const message = JSON.stringify(payload);
    for (const ws of this.socketUsers.keys()) {
      if (excludeWs && ws === excludeWs) continue;
      try {
        ws.send(message);
      } catch {
        // Socket error
      }
    }
  }

  private async handleClientEvent(ws: any, userId: string, data: any): Promise<void> {
    switch (data.type) {
      case 'ping':
        this.sendJson(ws, { type: 'pong', timestamp: Date.now() });
        break;

      case 'typing_start':
        if (data.recipientUserId && data.conversationId) {
          this.sendToUser(data.recipientUserId, {
            type: 'typing_start',
            senderUserId: userId,
            conversationId: data.conversationId,
          });
        }
        break;

      case 'typing_stop':
        if (data.recipientUserId && data.conversationId) {
          this.sendToUser(data.recipientUserId, {
            type: 'typing_stop',
            senderUserId: userId,
            conversationId: data.conversationId,
          });
        }
        break;

      // ─── WebRTC 1-to-1 Call Signaling ─────────────────────────────────────
      case 'call_offer':
        if (data.recipientUserId && data.offer) {
          const callId = data.callId || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          this.activeCalls.set(callId, {
            callId,
            callerUserId: userId,
            recipientUserId: data.recipientUserId,
            callType: data.callType || 'video',
            status: 'ringing',
            createdAt: Date.now(),
          });
          this.sendToUser(data.recipientUserId, {
            type: 'call_offer',
            callId,
            callerUserId: userId,
            callerName: data.callerName || 'Friend',
            callerAvatar: data.callerAvatar,
            callType: data.callType || 'video',
            offer: data.offer,
          });
        }
        break;

      case 'call_answer':
        if (data.callerUserId && data.answer) {
          this.sendToUser(data.callerUserId, {
            type: 'call_answer',
            callId: data.callId,
            recipientUserId: userId,
            answer: data.answer,
          });
        }
        break;

      case 'call_ice_candidate':
        if (data.targetUserId && data.candidate) {
          this.sendToUser(data.targetUserId, {
            type: 'call_ice_candidate',
            callId: data.callId,
            senderUserId: userId,
            candidate: data.candidate,
          });
        }
        break;

      case 'call_rejected':
        if (data.callerUserId) {
          this.sendToUser(data.callerUserId, {
            type: 'call_rejected',
            callId: data.callId,
            reason: data.reason || 'declined',
          });
        }
        break;

      case 'call_ended':
        if (data.targetUserId) {
          this.sendToUser(data.targetUserId, {
            type: 'call_ended',
            callId: data.callId,
          });
        }
        break;

      case 'call_media_state':
        if (data.targetUserId) {
          this.sendToUser(data.targetUserId, {
            type: 'call_media_state',
            callId: data.callId,
            senderUserId: userId,
            micOn: data.micOn,
            cameraOn: data.cameraOn,
            screenShareOn: data.screenShareOn,
          });
        }
        break;

      default:
        // Pass through or ignore unknown
        break;
    }
  }
}
