import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The Cloudflare tunnel only exposes port 5173; Vite proxies API + socket
// traffic to the backend on 3001 so the tunnel needs a single origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@poker/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
    // Required so the trycloudflare.com tunnel host is accepted.
    allowedHosts: ['.trycloudflare.com'],
  },
});
