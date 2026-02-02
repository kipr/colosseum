import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Shared proxy config that suppresses connection errors during startup
const createProxyConfig = (target: string) => ({
  target,
  changeOrigin: true,
  configure: (proxy: any) => {
    proxy.on('error', (err: any, _req: any, res: any) => {
      // Silently handle connection refused errors (backend not ready yet)
      if (err.code === 'ECONNREFUSED') {
        if (res && res.writeHead) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'Backend starting up, please wait...' }),
          );
        }
      }
    });
  },
});

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: '../../static',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '^/api/.*': createProxyConfig('http://localhost:3000'),
      '^/auth/.*': createProxyConfig('http://localhost:3000'),
      '^/admin/.*': createProxyConfig('http://localhost:3000'),
      '^/scoresheet/.*': createProxyConfig('http://localhost:3000'),
      '^/field-templates.*': createProxyConfig('http://localhost:3000'),
      '^/data/.*': createProxyConfig('http://localhost:3000'),
      '^/scores/.*': createProxyConfig('http://localhost:3000'),
      '^/chat/.*': createProxyConfig('http://localhost:3000'),
      '^/events/.*': createProxyConfig('http://localhost:3000'),
      '^/teams/.*': createProxyConfig('http://localhost:3000'),
      '^/seeding/.*': createProxyConfig('http://localhost:3000'),
      '^/brackets/.*': createProxyConfig('http://localhost:3000'),
      '^/queue/.*': createProxyConfig('http://localhost:3000'),
      '^/audit/.*': createProxyConfig('http://localhost:3000'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
    },
  },
});
