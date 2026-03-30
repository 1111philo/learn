import { defineConfig } from 'vite';
import { resolve } from 'path';
import { sharedPlugins } from './vite.config.shared.js';

/**
 * Native app build (Capacitor + Electron).
 * Same dist/ output as the Chrome extension build, but without
 * manifest.json or background.js (those are Chrome-specific).
 */
export default defineConfig({
  plugins: sharedPlugins(),
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'sidepanel.html'),
    },
  },
});
