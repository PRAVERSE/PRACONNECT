import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      // Bind all interfaces (IPv4 + IPv6 dual stack). Binding IPv4-only with
      // --host=0.0.0.0 caused the HMR WebSocket to fail on Windows: the browser
      // resolves `localhost` to ::1 first, finds nothing listening on IPv6,
      // and the WS dies silently while HTTP falls back to 127.0.0.1.
      host: true,
      // Explicit HMR endpoint matching the actual serving port/host so the
      // client never derives a mismatched WebSocket URL.
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 3000,
      },
      // Proxy /api requests to the Hono backend during development.
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
