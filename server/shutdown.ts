// server/shutdown.ts
// Phase 6.7: graceful shutdown for SIGINT/SIGTERM with a double-shutdown
// guard and a bounded grace window for active connections (e.g. SSE streams).

export interface ShutdownableServer {
  close(callback?: () => void): void;
  closeIdleConnections?: () => void;
}

export interface GracefulShutdownOptions {
  /** Runs after the HTTP server closes (stop workers, close the database). */
  cleanup?: () => void;
  log?: (message: string) => void;
  /** Injectable for tests; defaults to process.exit. */
  exit?: (code: number) => void;
  /** Bounded grace for active connections before a forced exit. */
  timeoutMs?: number;
}

export function createShutdownHandler(server: ShutdownableServer, options: GracefulShutdownOptions = {}) {
  const {
    cleanup,
    log = console.log,
    exit = (code: number) => process.exit(code),
    timeoutMs = 10000,
  } = options;
  let shuttingDown = false;

  return (signal: string): void => {
    if (shuttingDown) return; // a second SIGINT/SIGTERM is a no-op
    shuttingDown = true;
    log(`[server] ${signal} received — shutting down`);

    const forceExit = setTimeout(() => {
      log('[server] graceful shutdown timed out — forcing exit');
      exit(1);
    }, timeoutMs);
    forceExit.unref?.();

    server.close(() => {
      clearTimeout(forceExit);
      log('[server] HTTP server closed');
      try {
        cleanup?.();
      } catch (err) {
        console.error('[server] shutdown cleanup error:', (err as Error).message);
      }
      exit(0);
    });

    // Close idle keep-alive sockets so close() completes promptly. Active
    // SSE connections get the grace window before the forced exit.
    server.closeIdleConnections?.();
  };
}

export function installGracefulShutdown(server: ShutdownableServer, options: GracefulShutdownOptions = {}) {
  const handler = createShutdownHandler(server, options);
  process.once('SIGINT', () => handler('SIGINT'));
  process.once('SIGTERM', () => handler('SIGTERM'));
  return handler;
}