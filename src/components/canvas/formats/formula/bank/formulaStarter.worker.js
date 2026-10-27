/**
 * The formula starter's worker: builds the chosen bank equations in a store
 * of its own, off the main thread, and hands that store's universe back to be
 * merged into the open one (formulaStarter.js). In the app's store every
 * write copies the whole universe, so building there took minutes in a large
 * one; here it holds only what it builds.
 *
 * The store this loads is a second one, and nothing it does may reach the
 * universe open in the app, or anywhere else. Before it loads: its
 * preferences live in memory only, and there is no IndexedDB (where the app
 * keeps universes and keys) and no network (Git sync) to reach. All it can do
 * is hand its state back.
 *
 * Messages: { bank, equationIds } in; { progress: { done, total } } while
 * building, then { ok: true, built } or { ok: false, error }.
 */
import fontUrl from '../../../../../assets/fonts/EmOne-SemiBold.woff2?url';

const memory = new Map();
const preferences = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => { memory.set(k, String(v)); },
  removeItem: (k) => { memory.delete(k); },
  clear: () => memory.clear(),
  key: (i) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
};
const shut = (name, value) => Object.defineProperty(self, name, { value, configurable: true, writable: false });
shut('localStorage', preferences);
shut('sessionStorage', preferences);
shut('indexedDB', undefined);
shut('fetch', () => Promise.reject(new Error('The formula starter does not reach the network.')));

/** The font the canvas measures names in, so each formula's Things are spaced as they are drawn. */
async function loadFont() {
  try {
    const face = new FontFace('EmOne', `url(${fontUrl})`, { weight: '600', style: 'normal' });
    self.fonts?.add(await face.load());
  } catch { /* measured in the fallback font: spaced a little differently */ }
}

self.onmessage = async ({ data }) => {
  try {
    await loadFont();
    const { takeFormulaBank } = await import('./formulaBank.js');
    const bank = takeFormulaBank(data.bank);
    const { buildStarterState } = await import('./formulaStarter.js');
    const built = buildStarterState(bank, data.equationIds, (done, total) => {
      if (done % 5 === 0 || done === total) self.postMessage({ progress: { done, total } });
    });
    self.postMessage({ ok: true, built });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) });
  }
};
