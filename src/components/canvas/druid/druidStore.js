import { create } from 'zustand';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';

/**
 * The Druid's state in the app: whether it is living, what it has thought and
 * done lately, what you have said to it and what it said back, and the choices
 * for the next waking (model, way of choosing, follow). The Druid itself is in
 * src/druid/; this starts it, stops it, passes on what you say, and keeps what
 * the Wizard's Druid view shows.
 */

const SETTINGS_KEY = 'redstring_druid_settings';
const KEEP = 120;

export const DEFAULT_DRUID_SETTINGS = {
  mind: 'afm',
  endpoint: 'http://localhost:1234/v1/chat/completions',
  model: 'qwen/qwen3-4b-2507',
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

/**
 * Everything the view shows, as plain text: the through line, then each moment
 * (where it was, what it thought, what it chose and what came of it) and what
 * was said either way. For pasting into a bug report or a conversation.
 */
export function transcriptOf({ stream = [], throughLine = '', held = [], error = null } = {}) {
  const lines = [];
  if (throughLine) lines.push(`Lately: ${throughLine}`);
  if (held.length) lines.push(`Holding in mind: ${held.join(', ')}`);
  if (lines.length) lines.push('');
  for (const e of stream) {
    if (e.kind === 'you') { lines.push(`You: ${e.text}${e.pending ? ' (not heard yet)' : ''}`, ''); continue; }
    if (e.kind === 'reply') { lines.push(`The Druid: ${e.text}`, ''); continue; }
    const where = [e.locus?.webName, e.locus?.focusName].filter(Boolean).join(' › ');
    lines.push(`[${e.tick}]${where ? ` ${where}` : ''}`);
    if (e.thought) lines.push(`  ${e.thought}`);
    lines.push(`  ${e.chose || 'did not choose'}${e.text ? ` → ${e.text}` : ''}${e.result?.ok === false ? ' (failed)' : ''}`);
    if (e.result?.summary || e.slept) lines.push(`  ${e.result?.summary || ''}${e.slept ? ' · slept' : ''}`.trimEnd());
    lines.push('');
  }
  if (error) lines.push(`Error: ${error}`);
  return lines.join('\n').trim();
}

const keep = (stream) => stream.slice(-KEEP);

export const useDruidStore = create((set, get) => ({
  status: 'idle', // idle | starting | living | stopping
  error: null,
  /** What the view shows, oldest first: { kind: 'moment', ...cycle } | { kind: 'you' | 'reply', text } */
  stream: [],
  stats: null,
  held: [],
  throughLine: '',
  settings: readSettings(),

  setSetting: (key, value) => {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* per-device convenience only */ }
  },

  /** Say something to it: heard on its next moment, or when it next wakes. */
  say: (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    const pending = !session;
    set(s => ({ stream: keep([...s.stream, { kind: 'you', text: t, pending }]) }));
    if (session) session.say(t);
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
      const { settings, stream } = get();
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
        speak: settings.speak,
        onCycle: (r) => {
          // The view shows the moment, not the loop's internals.
          const moment = Object.fromEntries(Object.entries(r).filter(([k]) => !['state', 'calls', 'stats', 'reply', 'heard'].includes(k)));
          set(s => ({
            stream: keep([
              ...s.stream.map(e => (e.kind === 'you' && e.pending && r.heard?.length ? { ...e, pending: false } : e)),
              { kind: 'moment', ...moment },
              ...(r.reply ? [{ kind: 'reply', text: r.reply, tick: r.tick }] : [])
            ]),
            stats: r.stats,
            held: r.held || [],
            throughLine: r.throughLine || s.throughLine
          }));
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
      // What was said while it slept is heard as it wakes.
      for (const e of stream) if (e.kind === 'you' && e.pending) session.say(e.text);
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

  /** The stream as plain text (transcriptOf). */
  transcript: () => transcriptOf(get()),

  clear: () => set({ stream: [], throughLine: '', held: [], error: null })
}));

export default useDruidStore;
