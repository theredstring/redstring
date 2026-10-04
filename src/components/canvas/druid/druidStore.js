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
// The whole run is kept for Copy; the view draws the last stretch of it.
const KEEP = 2000;

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

const clip = (t, n) => { const x = String(t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/** A model call, kept small: what kind, what was asked, what came back. */
export function compactCall(c) {
  const answer = c.kind === 'fill' ? c.text : c.kind === 'choose' ? (Number.isInteger(c.index) ? c.index + 1 : c.index) : c.key;
  return { kind: c.kind, q: clip(c.question, 240), a: answer ?? null, ...(c.error ? { error: clip(c.error, 160) } : {}) };
}

/** What sleep did, in a line: only what it did. */
function sleptLine(slept) {
  if (!slept) return '';
  if (slept.error) return `failed: ${slept.error}`;
  const parts = [];
  for (const [k, v] of Object.entries(slept)) {
    if (Array.isArray(v) && v.length) parts.push(`${k} ${v.length}${typeof v[0] === 'string' ? ` (${v.slice(0, 4).join('; ')})` : ''}`);
    else if (typeof v === 'number' && v > 0) parts.push(`${k} ${v}`);
  }
  return parts.join(', ') || 'nothing to tidy';
}

/**
 * The whole run as plain text, for pasting into a conversation about it:
 * the settings, the through line, each moment (where it was, what it thought,
 * what it was offered, what it chose and what came of it, what it was asked
 * and answered, what sleep did), what was said either way, and, given one,
 * an outline of the universe as found from Home.
 */
export function transcriptOf({ stream = [], throughLine = '', held = [], error = null, settings = null, stats = null } = {}, { outline = '', now = new Date() } = {}) {
  const lines = [`The Druid, copied ${now.toISOString().slice(0, 16).replace('T', ' ')}`];
  if (settings) lines.push(`Mind: ${settings.mind === 'afm' ? "Apple's model" : `${settings.model} (LM Studio)`} · ${settings.speak === 'commands' ? 'writes commands' : 'picks from a menu'}`);
  if (stats?.calls) lines.push(`Calls: ${stats.calls}, ${Math.round(stats.ms / Math.max(1, stats.calls))} ms each`);
  if (throughLine) lines.push(`Lately: ${throughLine}`);
  if (held.length) lines.push(`Holding in mind: ${held.join(', ')}`);
  if (error) lines.push(`Error: ${error}`);
  lines.push('');
  for (const e of stream) {
    if (e.kind === 'you') { lines.push(`You: ${e.text}${e.pending ? ' (not heard yet)' : ''}`, ''); continue; }
    if (e.kind === 'reply') { lines.push(`The Druid: ${e.text}`, ''); continue; }
    const where = [e.locus?.webName, e.locus?.focusName].filter(Boolean).join(' › ');
    lines.push(`[${e.tick}]${where ? ` ${where}` : ''}${e.size ? `  (${e.size.webs} webs, ${e.size.things} Things)` : ''}`);
    if (e.thought) lines.push(`  thought: ${e.thought}`);
    if (e.menu?.length) lines.push(`  offered: ${e.menu.map((m, i) => `${m === e.chose ? '*' : ''}${i + 1} ${m}`).join(' | ')}`);
    for (const err of e.offerErrors || []) lines.push(`  offer broke: ${typeof err === 'string' ? err : JSON.stringify(err)}`);
    lines.push(`  chose: ${e.chose || 'nothing'}${e.text ? ` → "${e.text}"` : ''}${e.otherText ? ` (wrote "${e.otherText}")` : ''}`);
    lines.push(`  ${e.result?.ok === false ? 'FAILED' : 'result'}: ${e.result?.summary || ''}${e.result?.error && e.result.error !== e.result.summary ? ` (${e.result.error})` : ''}`);
    for (const c of e.asked || []) lines.push(`  asked (${c.kind}): ${c.q} → ${c.a === null ? '—' : `"${c.a}"`}${c.error ? ` [${c.error}]` : ''}`);
    const flags = [e.repeating && 'repeating itself', e.unbacked?.length && `thought not kept: ${e.unbacked.join(', ')}`].filter(Boolean);
    if (flags.length) lines.push(`  note: ${flags.join(' · ')}`);
    if (e.slept) lines.push(`  slept: ${sleptLine(e.slept)}`);
    lines.push('');
  }
  if (outline) lines.push(outline);
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
          // What it was asked and answered, small, for Copy.
          moment.asked = (r.calls || []).map(compactCall);
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

  /** The whole run as plain text, with the universe as found from Home (transcriptOf). */
  transcript: async () => {
    let text = '';
    try {
      const [{ createWorld }, { outline }, { default: useGraphStore }] = await Promise.all([
        import('../../../druid/world.js'),
        import('../../../druid/lab/outline.js'),
        import('../../../store/graphStore.js')
      ]);
      text = outline(session?.world || createWorld({ store: useGraphStore }));
    } catch (err) {
      text = `(could not outline the universe: ${err?.message || err})`;
    }
    return transcriptOf(get(), { outline: text });
  },

  clear: () => set({ stream: [], throughLine: '', held: [], error: null })
}));

export default useDruidStore;
