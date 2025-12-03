import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
      '^/api/.*': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '^/auth/.*': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '^/admin/spreadsheets.*': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '^/admin/drive.*': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '^/scoresheet/templates.*': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '^/data/.*': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '^/scores/.*': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
    },
  },
});

