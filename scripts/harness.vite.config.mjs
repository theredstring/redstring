// The app's Vite config with a cache of its own per harness port, so the
// shared-universe harness (scripts/shared-universe-harness.mjs) never rewrites
// the dependency cache a normal `npm run dev` is using.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../vite.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default async (env) => {
  const config = typeof base === 'function' ? await base(env) : base;
  return { ...config, cacheDir: path.join(ROOT, '.vite-harness', String(process.env.HARNESS_PORT || 'default')) };
};
