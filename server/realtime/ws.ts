// server/realtime/ws.ts
// Server-side WebSocket messaging layer for PraConnect.
// Handles connection authentication, heartbeat, message lifecycle (send, delivered, read),
// ephemeral typing, presence, reconnect delta sync, and multi-tab fan-out.

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { getSessionUser, SESSION_COOKIE_NAME } from '../auth/session';
import {
  registerConnection,
  unregisterConnection,
  getUserConnections,
} from './registry';
import {
  isAcceptedFriendship,
  sendDirectMessage,
  editDirectMessage,
  toggleMessageReaction,
  updateDeliveryWatermark,
  updateReadWatermark,
  syncMessagesAfterSequence,
  getUserPrivacySettings,
  conversationIdFor,
  DirectMessage,
  getUserPublicProfile,
} from '../social/service';

interface ExtWebSocket extends WebSocket {
  isAlive?: boolean;
  userId?: string;
}

export interface ActiveCallSession {
  callId: string;
  callerUserId: string;
  recipientUserId: string;
  callType: 'audio' | 'video';
  status: 'ringing' | 'accepted' | 'connecting' | 'connected' | 'ended' | 'rejected' | 'cancelled';
  createdAt: number;
}

/** Server-authoritative in-memory registry of active call sessions. */
export const activeCallSessions = new Map<string, ActiveCallSession>();

/** Sweep stale call sessions older than 5 minutes. */
export function sweepStaleCallSessions(now = Date.now()): void {
  for (const [callId, session] of activeCallSessions.entries()) {
    if (now - session.createdAt > 300_000) {
      activeCallSessions.delete(callId);
    }
  }
}

/** In-memory typing timeouts per user+conversation. */
const typingTimeouts = new Map<string, NodeJS.Timeout>();

/** Clean all typing timers associated with a specific user. */
export function clearUserTypingTimers(userId: string): void {
  for (const [key, timer] of typingTimeouts.entries()) {
    if (key.startsWith(`${userId}:`)) {
      clearTimeout(timer);
      typingTimeouts.delete(key);
    }
  }
}

/** Bounded in-memory ephemeral store for vanish mode (non-durable across restarts). */
const vanishSessions = new Map<string, DirectMessage[]>();
const MAX_VANISH_MESSAGES_PER_CONVERSATION = 50;

function typingKey(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

function clearTypingTimer(userId: string, conversationId: string): void {
  const key = typingKey(userId, conversationId);
  const existing = typingTimeouts.get(key);
  if (existing) {
    clearTimeout(existing);
    typingTimeouts.delete(key);
  }
}

/** Parse Cookie header safely. */
function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  for (const cookie of cookieHeader.split(';')) {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      list[name] = decodeURIComponent(val);
    }
  }
  return list;
}

/** Send JSON frame to a WebSocket cleanly. */
function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // socket error
    }
  }
}

/** Fan out event to all active sockets of a specific user. */
export function broadcastToUser(userId: string, payload: unknown, excludeSocket?: WebSocket): void {
  const sockets = getUserConnections(userId);
  for (const socket of sockets) {
    if (socket !== excludeSocket) {
      sendJson(socket, payload);
    }
  }
}

/** Extract peer userId from canonical conversationId (format: userA:userB). */
function getPeerUserIdFromConversation(conversationId: string, currentUserId: string): string | null {
  if (typeof conversationId !== 'string' || !conversationId.includes(':')) return null;
  const parts = conversationId.split(':');
  if (parts.length !== 2) return null;
  if (parts[0] === currentUserId) return parts[1];
  if (parts[1] === currentUserId) return parts[0];
  return null;
}

let wssInstance: WebSocketServer | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/** Initialize the WebSocket server on an existing HTTP server or standalone. */
export function setupWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wssInstance = wss;

  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const url = req.url ?? '';
    // Only handle WebSocket requests targeting /ws
    if (!url.startsWith('/ws')) {
      return;
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    const token =
      cookies[SESSION_COOKIE_NAME] ||
      cookies['praconnect-session'] ||
      cookies['__Host-praconnect-session'];

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const authResult = await getSessionUser(token).catch(() => null);
    if (!authResult || !authResult.user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, authResult.user);
    });
  });

  wss.on('connection', (ws: ExtWebSocket, req: IncomingMessage, user: { id: string; role: string }) => {
    ws.isAlive = true;
    ws.userId = user.id;

    registerConnection(user.id, ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    sendJson(ws, {
      type: 'connection:ready',
      userId: user.id,
      role: user.role,
    });

    ws.on('message', async (data: Buffer | string) => {
      try {
        const rawText = data.toString();
        const event = JSON.parse(rawText);
        if (!event || typeof event.type !== 'string') {
          sendJson(ws, { type: 'error', code: 'INVALID_EVENT', message: 'Event must contain a valid type.' });
          return;
        }

        await handleClientEvent(ws, user.id, event);
      } catch (err: any) {
        sendJson(ws, {
          type: 'error',
          code: 'MALFORMED_PAYLOAD',
          message: 'Failed to parse WebSocket JSON payload.',
        });
      }
    });

    ws.on('close', () => {
      if (ws.userId) {
        const becameOffline = unregisterConnection(ws.userId, ws);
        if (becameOffline) {
          clearUserTypingTimers(ws.userId);
        }
      }
    });

    ws.on('error', () => {
      if (ws.userId) {
        const becameOffline = unregisterConnection(ws.userId, ws);
        if (becameOffline) {
          clearUserTypingTimers(ws.userId);
        }
      }
    });
  });

  // Heartbeat ping every 25s and sweep stale call sessions
  heartbeatInterval = setInterval(() => {
    sweepStaleCallSessions();
    wss.clients.forEach((client: ExtWebSocket) => {
      if (client.isAlive === false) {
        if (client.userId) unregisterConnection(client.userId, client);
        return client.terminate();
      }
      client.isAlive = false;
      client.ping();
    });
  }, 25000);

  return wss;
}

/** Close all active WebSocket connections and cleanup background interval. */
export function closeWebSocketServer(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (wssInstance) {
    wssInstance.clients.forEach((client) => {
      client.terminate();
    });
    wssInstance.close();
    wssInstance = null;
  }
}

/** Handle client-sent WebSocket events. */
async function handleClientEvent(ws: ExtWebSocket, userId: string, event: any): Promise<void> {
  switch (event.type) {
    case 'ping': {
      sendJson(ws, { type: 'pong' });
      break;
    }

    case 'message:send': {
      const { clientMessageId, conversationId, text, replyToMessageId, forwardedFromMessageId, attachmentId, vanish } = event;
      if (!clientMessageId || typeof clientMessageId !== 'string') {
        sendJson(ws, { type: 'error', code: 'VALIDATION_ERROR', message: 'clientMessageId is required.' });
        return;
      }

      const peerId = getPeerUserIdFromConversation(conversationId, userId);
      if (!peerId || !isAcceptedFriendship(userId, peerId)) {
        sendJson(ws, {
          type: 'error',
          code: 'FRIENDSHIP_REQUIRED',
          message: 'You must be accepted friends to send messages.',
          clientMessageId,
        });
        return;
      }

      const result = sendDirectMessage(userId, peerId, text ?? '', {
        replyToMessageId,
        forwardedFromMessageId,
        attachmentId,
        vanish,
      });
      if (!result.ok || !result.message) {
        sendJson(ws, {
          type: 'error',
          code: result.error?.code ?? 'MESSAGE_FAILED',
          message: result.error?.message ?? 'Failed to send message.',
          clientMessageId,
        });
        return;
      }

      const message: DirectMessage = result.message;

      // Handle bounded in-memory vanish store
      if (vanish) {
        const existing = vanishSessions.get(conversationId) ?? [];
        existing.push(message);
        if (existing.length > MAX_VANISH_MESSAGES_PER_CONVERSATION) existing.shift();
        vanishSessions.set(conversationId, existing);
      }

      // 1. ACK the sender socket
      sendJson(ws, {
        type: 'message:sent',
        clientMessageId,
        message,
      });

      // 2. Broadcast to recipient's sockets
      broadcastToUser(peerId, {
        type: 'message:new',
        message,
      });

      // 3. Multi-tab sync: update sender's other sockets
      broadcastToUser(userId, {
        type: 'message:sent',
        clientMessageId,
        message,
      }, ws);
      break;
    }

    case 'message:delivered': {
      const { conversationId, throughSequenceId } = event;
      const peerId = getPeerUserIdFromConversation(conversationId, userId);
      if (!peerId || !isAcceptedFriendship(userId, peerId)) return;

      const seq = Number(throughSequenceId);
      if (Number.isInteger(seq) && seq > 0) {
        const res = updateDeliveryWatermark(userId, peerId, seq);
        if (res.ok && res.newWatermark === seq) {
          // Inform peer (sender) that recipient has delivered through sequenceId
          broadcastToUser(peerId, {
            type: 'message:delivery',
            conversationId,
            throughSequenceId: seq,
            recipientId: userId,
          });
        }
      }
      break;
    }

    case 'messages:read': {
      const { conversationId, throughSequenceId } = event;
      const peerId = getPeerUserIdFromConversation(conversationId, userId);
      if (!peerId || !isAcceptedFriendship(userId, peerId)) return;

      const seq = Number(throughSequenceId);
      if (Number.isInteger(seq) && seq > 0) {
        const res = updateReadWatermark(userId, peerId, seq);
        const privacy = getUserPrivacySettings(userId);
        if (res.ok && privacy.readReceipts && res.newWatermark === seq) {
          // Inform peer (sender) that recipient has read messages through sequenceId
          broadcastToUser(peerId, {
            type: 'messages:read',
            conversationId,
            throughSequenceId: seq,
            readerUserId: userId,
          });
        }
      }
      break;
    }

    case 'typing:start': {
      const { conversationId } = event;
      const peerId = getPeerUserIdFromConversation(conversationId, userId);
      if (!peerId || !isAcceptedFriendship(userId, peerId)) return;

      // Notify recipient ONLY (ephemeral)
      broadcastToUser(peerId, {
        type: 'typing',
        conversationId,
        userId,
        state: 'typing',
      });

      // Set server-side fallback auto-timeout (7 seconds)
      clearTypingTimer(userId, conversationId);
      const timer = setTimeout(() => {
        broadcastToUser(peerId, {
          type: 'typing',
          conversationId,
          userId,
          state: 'stopped',
        });
      }, 7000);
      typingTimeouts.set(typingKey(userId, conversationId), timer);
      break;
    }

    case 'typing:stop': {
      const { conversationId } = event;
      const peerId = getPeerUserIdFromConversation(conversationId, userId);
      if (!peerId || !isAcceptedFriendship(userId, peerId)) return;

      clearTypingTimer(userId, conversationId);
      broadcastToUser(peerId, {
        type: 'typing',
        conversationId,
        userId,
        state: 'stopped',
      });
      break;
    }

    case 'sync': {
      const conversations = Array.isArray(event.conversations) ? event.conversations : [];
      for (const conv of conversations) {
        const { conversationId, lastSequenceId } = conv;
        const peerId = getPeerUserIdFromConversation(conversationId, userId);
        if (!peerId || !isAcceptedFriendship(userId, peerId)) continue;

        const lastSeq = Number(lastSequenceId) || 0;
        const result = syncMessagesAfterSequence(userId, peerId, lastSeq, 100);
        if (result.ok && result.messages) {
          sendJson(ws, {
            type: 'sync:messages',
            conversationId,
            messages: result.messages,
          });
        }
      }
      break;
    }

    case 'message:edit': {
      const { messageId, text } = event;
      if (!messageId || typeof text !== 'string') return;
      const res = editDirectMessage(userId, messageId, text);
      if (res.ok && res.message) {
        const peerId = getPeerUserIdFromConversation(res.message.conversationId!, userId);
        broadcastToUser(userId, { type: 'message:edited', message: res.message });
        if (peerId) broadcastToUser(peerId, { type: 'message:edited', message: res.message });
      }
      break;
    }

    case 'message:reaction': {
      const { messageId, emoji, reaction } = event;
      const cleanEmoji = emoji || reaction;
      if (!messageId || typeof cleanEmoji !== 'string') return;
      const res = toggleMessageReaction(userId, messageId, cleanEmoji);
      if (res.ok && res.conversationId) {
        const peerId = res.peerId || getPeerUserIdFromConversation(res.conversationId, userId);
        const payload = {
          type: 'message:reaction',
          conversationId: res.conversationId,
          messageId,
          emoji: res.emoji,
          action: res.action,
          reactions: res.reactions,
          userId,
        };
        broadcastToUser(userId, payload);
        if (peerId) broadcastToUser(peerId, payload);
      }
      break;
    }

    case 'call:invite': {
      // [CALL_TRACE] Server: right when it receives the call-initiate event
      console.log('[CALL_TRACE][SERVER] Received call:invite event from user:', userId, {
        rawEvent: event,
      });

      const targetId = (event.recipientUserId || event.targetUserId) as string | undefined;
      if (!targetId || typeof targetId !== 'string') {
        console.warn('[CALL_TRACE][SERVER] call:invite rejected: INVALID_RECIPIENT');
        sendJson(ws, {
          type: 'error',
          code: 'INVALID_RECIPIENT',
          message: 'Recipient user ID is required for call.',
        });
        return;
      }

      if (targetId === userId) {
        console.warn('[CALL_TRACE][SERVER] call:invite rejected: CANNOT_CALL_SELF');
        sendJson(ws, {
          type: 'error',
          code: 'CANNOT_CALL_SELF',
          message: 'You cannot call yourself.',
        });
        return;
      }

      if (!isAcceptedFriendship(userId, targetId)) {
        console.warn('[CALL_TRACE][SERVER] call:invite rejected: FRIENDSHIP_REQUIRED between', userId, 'and', targetId);
        sendJson(ws, {
          type: 'error',
          code: 'FRIENDSHIP_REQUIRED',
          message: 'Calls require accepted friendship.',
        });
        return;
      }

      const callId =
        typeof event.callId === 'string' && event.callId.trim().length > 0
          ? event.callId.trim()
          : `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const cType: 'audio' | 'video' = event.callType === 'video' ? 'video' : 'audio';
      const callerProfile = getUserPublicProfile(userId);

      activeCallSessions.set(callId, {
        callId,
        callerUserId: userId,
        recipientUserId: targetId,
        callType: cType,
        status: 'ringing',
        createdAt: Date.now(),
      });

      const invitePayload = {
        type: 'call:invite',
        callId,
        callerUserId: userId,
        recipientUserId: targetId,
        callType: cType,
        senderUserId: userId,
        caller: callerProfile || {
          id: userId,
          name: 'Friend',
          username: 'friend',
          avatarUrl: null,
        },
        peerName: callerProfile?.name || 'Friend',
      };

      // [CALL_TRACE] Server: right when it attempts to relay/emit to the target socket (log whether socket was found)
      const targetSockets = getUserConnections(targetId);
      console.log('[CALL_TRACE][SERVER] Attempting relay to target user:', targetId, {
        socketsFound: targetSockets.size > 0,
        activeSocketCount: targetSockets.size,
        callId,
      });

      broadcastToUser(targetId, invitePayload);
      break;
    }

    case 'call:accept':
    case 'call:reject':
    case 'call:cancel':
    case 'call:ended':
    case 'sdp:offer':
    case 'sdp:answer':
    case 'ice:candidate': {
      const callId = event.callId as string | undefined;
      if (!callId || typeof callId !== 'string') {
        sendJson(ws, {
          type: 'error',
          code: 'MISSING_CALL_ID',
          message: 'callId is required for call signaling.',
        });
        return;
      }

      const session = activeCallSessions.get(callId);
      if (!session) {
        sendJson(ws, {
          type: 'error',
          code: 'INVALID_CALL_SESSION',
          message: 'Call session not found or expired.',
        });
        return;
      }

      // Enforce caller & recipient identity matching server session
      if (userId !== session.callerUserId && userId !== session.recipientUserId) {
        sendJson(ws, {
          type: 'error',
          code: 'CALL_FORBIDDEN',
          message: 'You are not a participant in this call session.',
        });
        return;
      }

      const peerId = userId === session.callerUserId ? session.recipientUserId : session.callerUserId;

      if (event.type === 'call:accept') {
        session.status = 'accepted';
        const acceptPayload = { type: 'call:accept', callId, senderUserId: userId };
        broadcastToUser(session.callerUserId, acceptPayload);
        broadcastToUser(session.recipientUserId, acceptPayload, ws);
      } else if (event.type === 'call:reject') {
        session.status = 'rejected';
        activeCallSessions.delete(callId);
        broadcastToUser(peerId, { ...event, callId, senderUserId: userId });
      } else if (event.type === 'call:cancel') {
        session.status = 'cancelled';
        activeCallSessions.delete(callId);
        broadcastToUser(peerId, { ...event, callId, senderUserId: userId });
      } else if (event.type === 'call:ended') {
        session.status = 'ended';
        activeCallSessions.delete(callId);
        broadcastToUser(peerId, { ...event, callId, senderUserId: userId });
      } else {
        broadcastToUser(peerId, { ...event, callId, senderUserId: userId });
      }
      break;
    }

    default: {
      sendJson(ws, {
        type: 'error',
        code: 'UNKNOWN_EVENT_TYPE',
        message: `Event type '${event.type}' is not recognized.`,
      });
    }
  }
}
