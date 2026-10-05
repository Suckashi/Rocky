import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web UI is built into dist/web and served by Rocky's own server. Roko and the Rocky
// marks are served from assets/ (/roko/..., /rocky/...).
export default defineConfig({
  root: 'src/web',
  publicDir: '../../assets',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    // Development only: the API lives on Rocky's server; its Origin check expects its own origin.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        headers: { origin: 'http://127.0.0.1:4317' },
      },
    },
  },
});
