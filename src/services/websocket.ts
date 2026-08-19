// src/services/websocket.ts
// Frontend WebSocket client service for PraConnect real-time messaging.
// Manages socket connection lifecycle, exponential backoff reconnects, ping/pong,
// typed event dispatching, and typing throttling. Keeps transport mechanics
// cleanly separated from React state / AppContext.

import { DirectMessageItem } from '../api/social';

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export interface ServerEvent {
  type: string;
  [key: string]: any;
}

export type EventCallback = (event: ServerEvent) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isExplicitlyClosed = false;

  // Ephemeral typing state
  private typingThrottles: Map<string, number> = new Map();
  private typingStopTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Get the current connection state. */
  public getState(): ConnectionState {
    return this.state;
  }

  /** Subscribe to a WebSocket event. Returns an unsubscribe function. */
  public on(eventType: string, callback: EventCallback): () => void {
    const set = this.listeners.get(eventType) ?? new Set<EventCallback>();
    set.add(callback);
    this.listeners.set(eventType, set);
    return () => this.off(eventType, callback);
  }

  /** Unsubscribe from an event. */
  public off(eventType: string, callback: EventCallback): void {
    const set = this.listeners.get(eventType);
    if (set) {
      set.delete(callback);
      if (set.size === 0) this.listeners.delete(eventType);
    }
  }

  /** Emit an event to registered listeners. */
  private emit(eventType: string, event: ServerEvent): void {
    const set = this.listeners.get(eventType);
    if (set) {
      for (const cb of Array.from(set)) {
        try {
          cb(event);
        } catch (err) {
          console.error(`[ws] Listener error for ${eventType}:`, err);
        }
      }
    }
  }

  private updateState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('connection_state_change', { type: 'connection_state_change', state: newState });
    }
  }

  /** Open the WebSocket connection tied to the current browser session. */
  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this.updateState(this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.updateState('CONNECTED');
        this.startHeartbeat();
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as ServerEvent;
          if (parsed && typeof parsed.type === 'string') {
            this.emit(parsed.type, parsed);
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      socket.onclose = () => {
        this.stopHeartbeat();
        this.ws = null;
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        } else {
          this.updateState('DISCONNECTED');
        }
      };

      socket.onerror = () => {
        // Socket close event will handle reconnect
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  /** Close connection explicitly (e.g. on logout). */
  public disconnect(): void {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.updateState('DISCONNECTED');
  }

  private scheduleReconnect(): void {
    this.updateState('RECONNECTING');
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Exponential backoff: 1s, 2s, 4s, 8s, 15s, 30s max
    const delays = [1000, 2000, 4000, 8000, 15000, 30000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Send a typed event through the WebSocket. Returns true if sent. */
  public send(payload: ServerEvent): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // ─── Ephemeral typing helpers ──────────────────────────────────────────────

  /** Notify conversation partner that user is typing (throttled). */
  public sendTypingStart(conversationId: string): void {
    const now = Date.now();
    const lastSent = this.typingThrottles.get(conversationId) ?? 0;

    // Send typing:start at most once every 2.5 seconds
    if (now - lastSent > 2500) {
      this.typingThrottles.set(conversationId, now);
      this.send({ type: 'typing:start', conversationId });
    }

    // Reset 2s stop timer
    const existingStopTimer = this.typingStopTimers.get(conversationId);
    if (existingStopTimer) clearTimeout(existingStopTimer);

    const stopTimer = setTimeout(() => {
      this.sendTypingStop(conversationId);
    }, 2000);
    this.typingStopTimers.set(conversationId, stopTimer);
  }

  /** Notify conversation partner that user has stopped typing. */
  public sendTypingStop(conversationId: string): void {
    const existingStopTimer = this.typingStopTimers.get(conversationId);
    if (existingStopTimer) {
      clearTimeout(existingStopTimer);
      this.typingStopTimers.delete(conversationId);
    }
    this.typingThrottles.delete(conversationId);
    this.send({ type: 'typing:stop', conversationId });
  }

  // ─── Message action helpers ────────────────────────────────────────────────

  public sendDirectMessage(
    clientMessageId: string,
    conversationId: string,
    text: string,
    options?: { replyToMessageId?: string; forwardedFromMessageId?: string }
  ): boolean {
    return this.send({
      type: 'message:send',
      clientMessageId,
      conversationId,
      text,
      replyToMessageId: options?.replyToMessageId,
      forwardedFromMessageId: options?.forwardedFromMessageId,
    });
  }

  public sendDeliveryAck(conversationId: string, throughSequenceId: number): boolean {
    return this.send({
      type: 'message:delivered',
      conversationId,
      throughSequenceId,
    });
  }

  public sendReadAck(conversationId: string, throughSequenceId: number): boolean {
    return this.send({
      type: 'messages:read',
      conversationId,
      throughSequenceId,
    });
  }

  public requestSync(conversations: { conversationId: string; lastSequenceId: number }[]): boolean {
    return this.send({
      type: 'sync',
      conversations,
    });
  }
}

export const wsService = new WebSocketService();
