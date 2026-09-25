// Build for `npm run perf:canvas -- --explain` (refactor P0.04; see commitLog.js).
// The profile build, but unminified (component names survive) and with every
//   const [x, setX] = useState(
// in NodeCanvas and the canvas hooks rewritten to record setX → "x" in
// globalThis.__stateNames, so the commit log can say which state changed.
// Output goes to dist-explain/, never dist-profile/: its timings are not
// comparable with the real profile build.
import { defineConfig, mergeConfig } from 'vite';
import base from '../../../vite.config.js';

const USE_STATE = /const\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*(?:React\.)?useState\(/g;
const HELPER = `import { useState as __explainUseState } from 'react';
const __useNamedState = (name, init) => {
  const pair = __explainUseState(init);
  (globalThis.__stateNames ||= new Map()).set(pair[1], name);
  return pair;
};
`;

const nameState = {
  name: 'perf-explain-name-state',
  enforce: 'pre',
  transform(code, id) {
    if (!/\/src\/(NodeCanvas\.jsx|hooks\/[^/]+\.js)$/.test(id)) return null;
    let n = 0;
    const out = code.replace(USE_STATE, (_m, value, setter) => {
      n += 1;
      return `const [${value}, ${setter}] = __useNamedState(${JSON.stringify(value)}, `;
    });
    return n ? { code: HELPER + out, map: null } : null;
  },
};

export default defineConfig((env) => mergeConfig(base(env), {
  plugins: [nameState],
  build: { outDir: 'dist-explain', minify: false, sourcemap: false },
}));
