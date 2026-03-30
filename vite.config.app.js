import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync } from 'fs';
import { sharedPlugins } from './vite.config.shared.js';

/**
 * Native app build (Capacitor + Electron).
 * Same dist/ output as the Chrome extension build, but without
 * manifest.json or background.js (those are Chrome-specific).
 * Copies sidepanel.html → index.html for Capacitor compatibility.
 */
export default defineConfig({
  plugins: [
    ...sharedPlugins(),
    {
      name: 'copy-index-html',
      closeBundle() {
        const outDir = resolve(import.meta.dirname, 'dist');
        const src = resolve(outDir, 'sidepanel.html');
        if (existsSync(src)) copyFileSync(src, resolve(outDir, 'index.html'));
      },
    },
  ],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'sidepanel.html'),
    },
  },
});
