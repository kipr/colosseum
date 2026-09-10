import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The Playwright suite runs its own Express on a different port so it can use
// the test database while `npm run dev` keeps the dev database on 3000.
const apiTarget = process.env.COLOSSEUM_API_URL || 'http://localhost:3000';

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
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Drifting to the next free port would let the e2e stack attach to the dev
    // stack's Vite (or the reverse), so a taken port has to be an error.
    strictPort: true,
    proxy: {
      '^/api/.*': createProxyConfig(apiTarget),
      '^/auth/.*': createProxyConfig(apiTarget),
      '^/scoresheet/.*': createProxyConfig(apiTarget),
      '^/field-templates.*': createProxyConfig(apiTarget),
      '^/data/.*': createProxyConfig(apiTarget),
      '^/scores/.*': createProxyConfig(apiTarget),
      '^/chat/.*': createProxyConfig(apiTarget),
      '^/events(?:/.*)?$': createProxyConfig(apiTarget),
      '^/teams(?:/.*)?$': createProxyConfig(apiTarget),
      '^/seeding/.*': createProxyConfig(apiTarget),
      '^/double-seeding/.*': createProxyConfig(apiTarget),
      '^/brackets(?:/.*)?$': createProxyConfig(apiTarget),
      '^/queue(?:/.*)?$': createProxyConfig(apiTarget),
      '^/audit/.*': createProxyConfig(apiTarget),
      '^/documentation-scores(?:/.*)?$': createProxyConfig(apiTarget),
      '^/awards(?:/.*)?$': createProxyConfig(apiTarget),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
