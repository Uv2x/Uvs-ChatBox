import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Renderer lives in src/renderer; output goes to dist/renderer.
// base must be './' so Electron can load assets via file:// in production.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
    },
  },
  server: {
    port: 5173,
    // Fail loudly instead of silently switching ports — the Electron main
    // process and the dev:electron wait-on are both hardcoded to 5173.
    strictPort: true,
  },
});
