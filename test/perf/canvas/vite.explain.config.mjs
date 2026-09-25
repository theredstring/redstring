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
// The setter is wrapped (once per hook: the WeakMap keeps its identity stable)
// so every call is logged against the next commit — which is how a bailout, a
// render in which no state actually changed, gets a name.
const __useNamedState = (name, init) => {
  const pair = __explainUseState(init);
  const names = (globalThis.__stateNames ||= new Map());
  const wrapped = (globalThis.__wrappedSetters ||= new WeakMap());
  let set = wrapped.get(pair[1]);
  if (!set) {
    const original = pair[1];
    set = (value) => {
      const log = globalThis.__commitLog;
      if (log?.on) (log.pendingSets ||= []).push(typeof value === 'function' ? name + '(fn)' : name);
      return original(value);
    };
    wrapped.set(original, set);
    names.set(original, name);
    names.set(set, name);
  }
  return [pair[0], set];
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

// zustand's useStore, with its subscription logged when the selector's result
// changed: React then re-renders the subscriber, and if the value is equal again
// by render time that render is a bailout with no setter to name.
const ZUSTAND_USE_STORE = `const slice = React.useSyncExternalStore(
    api.subscribe,`;
const logStore = {
  name: 'perf-explain-log-store',
  transform(code, id) {
    if (!/zustand\/esm\/react\.mjs$/.test(id) || !code.includes(ZUSTAND_USE_STORE)) return null;
    return {
      code: code.replace(ZUSTAND_USE_STORE, `const seen = React.useRef({});
  const subscribe = React.useCallback((cb) => api.subscribe(() => {
    const log = globalThis.__commitLog;
    const { selector: sel, slice: prev } = seen.current;
    if (log?.on && sel && !Object.is(sel(api.getState()), prev)) {
      (log.pendingSets ||= []).push('store ' + String(sel).replace(/\\s+/g, ' ').slice(0, 70));
    }
    cb();
  }), [api]);
  const slice = React.useSyncExternalStore(
    subscribe,`).replace('React.useDebugValue(slice);', 'seen.current = { selector, slice };\n  React.useDebugValue(slice);'),
      map: null,
    };
  },
};

// React's own update entry points (dispatchSetState, dispatchReducerAction,
// forceStoreRerender in the 18.3 profiling build), reported to
// globalThis.__explainDispatch so commitLog.js can name the caller of any update
// aimed at NodeCanvas, library hooks included. Matched on the minified source:
// if React changes, the patterns stop matching and the build says so.
const DISPATCHERS = [
  [/function (\w+)\(a,b,c\)\{var d=(\w+)\(a\),e=\{lane:d,action:c,hasEagerState:!1/, 'set'],
  [/function (\w+)\(a,b,c\)\{var d=(\w+)\(a\);c=\{lane:d,action:c,hasEagerState:!1/, 'reducer'],
  [/function (\w+)\(a\)\{var b=(\w+)\(a,1\);null!==b&&/, 'storeRerender'],
];
const logDispatch = {
  name: 'perf-explain-log-dispatch',
  transform(code, id) {
    if (!/react-dom\.profiling\.min\.js$/.test(id)) return null;
    let out = code;
    for (const [re, kind] of DISPATCHERS) {
      if (!re.test(out)) throw new Error(`explain build: React's ${kind} dispatcher not found`);
      out = out.replace(re, (m) => m.replace('{', `{globalThis.__explainDispatch&&globalThis.__explainDispatch(a,${JSON.stringify(kind)});`));
    }
    return { code: out, map: null };
  },
};

export default defineConfig((env) => mergeConfig(base(env), {
  plugins: [nameState, logStore, logDispatch],
  build: { outDir: 'dist-explain', minify: false, sourcemap: false },
}));
