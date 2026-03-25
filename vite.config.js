import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '' },
        { src: 'background.js', dest: '' },
        { src: 'lib', dest: '' },
        { src: 'data', dest: '' },
        { src: 'prompts', dest: '' },
        { src: 'assets', dest: '' },
        { src: 'js', dest: '' },
        { src: '.env.js', dest: '', rename: '.env.js' },
      ],
    }),
  ],
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'sidepanel.html'),
    },
  },
});
