import { defineConfig } from 'vite';
import { resolve } from 'path';
import { sharedPlugins } from './vite.config.shared.js';

/**
 * Chrome extension build.
 * Copies manifest.json and background.js in addition to shared assets.
 */
export default defineConfig({
  plugins: sharedPlugins([
    { src: 'manifest.json', dest: '' },
    { src: 'background.js', dest: '' },
  ]),
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'sidepanel.html'),
    },
  },
});
