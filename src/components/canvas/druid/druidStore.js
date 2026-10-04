import { create } from 'zustand';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';

/**
 * The Druid panel's state: whether it is living, what it has done lately, and
 * the choices for the next start (model, seed, follow). The Druid itself is in
 * src/druid/; this only starts it, stops it, and keeps what the panel shows.
 */

const SETTINGS_KEY = 'redstring_druid_settings';
const KEEP = 60;

export const DEFAULT_DRUID_SETTINGS = {
  mind: 'afm',
  endpoint: 'http://localhost:1234/v1/chat/completions',
  model: 'qwen/qwen3-4b-2507',
  seed: '',
  follow: true,
  // 'menu': it chooses from moves offered (and can write a command as "something
  // else"); 'commands': it writes a plain command every time. The menu won the
  // lab on Apple's model (sensible 94% vs 66%, 2026-10-04).
  speak: 'menu'
};

const readSettings = () => {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_DRUID_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_DRUID_SETTINGS };
  } catch {
    return { ...DEFAULT_DRUID_SETTINGS };
  }
};

let session = null;

export const useDruidStore = create((set, get) => ({
  status: 'idle', // idle | starting | living | stopping
  error: null,
  cycles: [],
  stats: null,
  settings: readSettings(),

  setSetting: (key, value) => {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* per-device convenience only */ }
  },

  start: async () => {
    if (session || get().status !== 'idle') return;
    set({ status: 'starting', error: null });
    try {
      const [{ startDruid, backendFor }, { executeTool }, { applyToolResultToStore }, { default: useGraphStore }, { promptSpaceFrom }, shipped] = await Promise.all([
        import('../../../druid/inApp/druidSession.js'),
        import('../../../wizard/tools/index.js'),
        import('../../../services/toolResultApplier.js'),
        import('../../../store/graphStore.js'),
        import('../../../druid/promptSpace.js'),
        import('../../../druid/prompt-space.redstring?raw')
      ]);
      const { settings } = get();
      const backend = await backendFor(settings);
      let promptJson = null;
      try { promptJson = JSON.parse(shipped.default); } catch { promptJson = null; }
      session = startDruid({
        store: useGraphStore,
        executeTool,
        applyToolResult: (name, result, id, cid) => applyToolResultToStore(name, result, id, cid, { confirmed: true }),
        promptSpace: promptSpaceFrom(promptJson, 'shipped'),
        backend
      }, {
        seed: settings.seed,
        speak: settings.speak,
        onCycle: (r) => {
          // The panel shows the moment, not the loop's internals.
          const shown = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'state' && k !== 'calls' && k !== 'stats'));
          set(s => ({ cycles: [shown, ...s.cycles].slice(0, KEEP), stats: r.stats }));
          if (get().settings.follow && r.locus?.focus) {
            // After the canvas has drawn what this cycle wrote.
            setTimeout(() => runCanvasCommand('navigateToPrototypeInstances', r.locus.focus), 150);
          }
        },
        onStop: ({ reason, error }) => {
          session = null;
          set({ status: 'idle', error: reason === 'error' ? error : null });
        }
      });
      set({ status: 'living' });
    } catch (err) {
      session = null;
      set({ status: 'idle', error: err?.message || String(err) });
    }
  },

  stop: () => {
    if (!session) return;
    set({ status: 'stopping' });
    session.stop();
  },

  clear: () => set({ cycles: [] })
}));

export default useDruidStore;
