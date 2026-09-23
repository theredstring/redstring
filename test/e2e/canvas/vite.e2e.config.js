// Vite config for the canvas e2e web server: the app's own config, with a
// private dependency cache.
//
// Vite's default cacheDir is node_modules/.vite. If node_modules is a symlink
// (as in some worktrees), that cache is the main checkout's, which a developer's
// running dev server also uses; a test server re-optimising dependencies there
// can force a reload in that server. A cache inside this folder can't collide
// with anything else.
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import baseConfig from '../../../vite.config.js';

const cacheDir = fileURLToPath(new URL('./.vite-cache', import.meta.url));

export default defineConfig(async (env) => {
  const base = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
  return mergeConfig(base, { cacheDir });
});
