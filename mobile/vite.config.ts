import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Capacitor loads the built web assets from `dist/` inside the app bundle, so
// base must be relative (no leading slash).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
});
