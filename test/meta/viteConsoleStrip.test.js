// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import config from '../../vite.config.js';

const resolve = (command, mode) => (typeof config === 'function' ? config({ command, mode }) : config);

describe('built bundles strip console.log (vite.config.js)', () => {
  afterEach(() => { delete process.env.VITE_PERF_SESSION; });

  it('the web, desktop and store builds drop console.log and console.debug, nothing else', () => {
    for (const mode of ['production', 'capacitor']) {
      expect(resolve('build', mode).esbuild?.pure, mode).toEqual(['console.log', 'console.debug']);
    }
  });

  it('the dev server and the measuring builds keep every log', () => {
    expect(resolve('serve', 'development').esbuild).toBeUndefined();
    expect(resolve('build', 'profile').esbuild).toBeUndefined();
    process.env.VITE_PERF_SESSION = '1';
    expect(resolve('build', 'capacitor').esbuild).toBeUndefined();
  });
});
