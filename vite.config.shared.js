/**
 * Shared Vite configuration used by both Chrome extension and native app builds.
 */
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';
import { existsSync, readdirSync, writeFileSync } from 'fs';

/** Generate data/courses/index.json listing all .md files in the directory. */
export function courseManifestPlugin() {
  return {
    name: 'course-manifest',
    buildStart() {
      const dir = resolve(import.meta.dirname, 'data/courses');
      if (!existsSync(dir)) return;
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      const ids = files.map(f => f.replace(/\.md$/, ''));
      writeFileSync(resolve(dir, 'index.json'), JSON.stringify(ids));
    },
  };
}

/** Static assets shared by all builds (data, prompts, lib, assets, js). */
export function sharedStaticCopyTargets() {
  return [
    { src: 'lib', dest: '' },
    { src: 'data', dest: '' },
    { src: 'prompts', dest: '' },
    { src: 'assets', dest: '' },
    { src: 'js', dest: '' },
    ...(existsSync('.env.js') ? [{ src: '.env.js', dest: '', rename: '.env.js' }] : []),
  ];
}

/** Shared plugins used by all builds. */
export function sharedPlugins(extraTargets = []) {
  return [
    react(),
    courseManifestPlugin(),
    viteStaticCopy({
      targets: [...sharedStaticCopyTargets(), ...extraTargets],
    }),
  ];
}
