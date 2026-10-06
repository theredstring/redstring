import { create } from 'zustand';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';
import { deviceRecord } from './druidRecord.js';

/**
 * The Druid's state in the app: whether it is living, what it has thought and
 * done lately, what you have said to it and what it said back, and the choices
 * for the next waking (model, way of choosing, follow). The Druid itself is in
 * src/druid/; this starts it, stops it, passes on what you say, and keeps what
 * the Wizard's Druid view shows.
 *
 * What it shows is the run of the universe that is open: kept on this device
 * per universe (druidRecord.js), so it is there again after a reload or a
 * trip to another universe, until it is cleared.
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
  speak: 'menu',
  // 'quick': each moment follows the last at once; 'steady': a breath between
  // them, to read along. The model's calls are nearly all of a moment's time.
  pace: 'quick'
};

/** The breath between moments, by pace. */
export const PACE_MS = { quick: 0, steady: 600 };

const readSettings = () => {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_DRUID_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_DRUID_SETTINGS };
  } catch {
    return { ...DEFAULT_DRUID_SETTINGS };
  }
};

// The running Druid, kept where a hot reload cannot lose it. Re-run in dev,
// this module made a new store that said "Wake" while the old session went on
// writing, out of reach (and Wake started a second one beside it). The session
// reports to whichever store is current (`live.store`), and a new store takes
// over the old one's state while a session lives.
const live = (globalThis.__redstringDruid ||= { session: null, store: null, stopNote: null });

/** Where each universe's run is kept (IndexedDB in the app). */
const record = () => (live.record ||= deviceRecord());

/** Which universe the graph store holds: the identity its saves are checked against. */
const universeOf = (graphStore) => graphStore.getState()._universeSlug || null;

const ANOTHER_UNIVERSE = 'another universe was opened';
const SWITCHED_NOTE = 'Went to sleep when another universe was opened. Wake it to go on where it left off.';

/**
 * The graph store as the Druid's session sees it: the one universe it woke
 * in. Opened in another while a moment is under way, it would otherwise
 * write that moment there; now the moment fails instead.
 */
function fenced(graphStore, universe) {
  return {
    getState: () => {
      const st = graphStore.getState();
      if ((st._universeSlug || null) !== universe) throw new Error(ANOTHER_UNIVERSE);
      return st;
    }
  };
}

const clip = (t, n) => { const x = String(t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/** A model call, kept small: what kind, what was asked, what came back. */
export function compactCall(c) {
  const answer = c.kind === 'fill' ? c.text : c.kind === 'choose' ? (Number.isInteger(c.index) ? c.index + 1 : c.index) : c.key;
  return { kind: c.kind, q: clip(c.question, 240), a: answer ?? null, ...(c.error ? { error: clip(c.error, 160) } : {}) };
}

/** What sleep did, in a line: only what it did. */
/** What each part of a sleep did, in plain words (sleep.js). */
const SLEPT_WORDS = {
  merged: 'merged', split: 'split a kind', declined: 'kept apart', lapsed: 'let go of plans', dropped: 'let go of smaller goals',
  condensed: 'folded moments into the day', pruned: 'forgot', repaired: 'repaired', misplaced: 'flagged'
};

/** One sleep, as a line: "merged 2 (Molecules; Minerals), repaired 315", or "nothing to tidy". */
export function sleptLine(slept) {
  if (!slept) return '';
  if (slept.error) return `failed: ${slept.error}`;
  const parts = [];
  for (const [k, v] of Object.entries(slept)) {
    const word = SLEPT_WORDS[k] || k;
    if (Array.isArray(v) && v.length) parts.push(`${word} ${v.length}${typeof v[0] === 'string' ? ` (${v.slice(0, 4).join('; ')})` : ''}`);
    else if (typeof v === 'number' && v > 0) parts.push(`${word} ${v}`);
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
  if (settings) lines.push(`Mind: ${settings.mind === 'afm' ? "Apple's model" : `${settings.model} (LM Studio)`} · ${settings.speak === 'commands' ? 'writes commands' : 'picks from a menu'} · ${settings.pace === 'steady' ? 'steady' : 'quick'}`);
  if (stats?.calls) lines.push(`Calls: ${stats.calls}, ${Math.round(stats.ms / Math.max(1, stats.calls))} ms each`);
  if (throughLine) lines.push(`Lately: ${throughLine}`);
  if (held.length) lines.push(`Holding in mind: ${held.join(', ')}`);
  if (error) lines.push(`Error: ${error}`);
  lines.push('');
  for (const e of stream) {
    if (e.kind === 'you') { lines.push(`You: ${e.text}${e.pending ? ' (not heard yet)' : ''}`, ''); continue; }
    if (e.kind === 'reply') { lines.push(`The Druid: ${e.text}`, ''); continue; }
    if (e.kind === 'woke') { lines.push(`-- woke${e.at ? ` ${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')}` : ''} --`, ''); continue; }
    const where = [e.locus?.webName, e.locus?.focusName].filter(Boolean).join(' › ');
    lines.push(`[${e.tick}]${where ? ` ${where}` : ''}${e.size ? `  (${e.size.webs} webs, ${e.size.things} Things)` : ''}${e.heapMB ? `  heap ${e.heapMB} MB` : ''}${e.ms ? `  ${(e.ms / 1000).toFixed(1)} s` : ''}`);
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

/**
 * Each entry's place in its universe's run, and its key in the record. From
 * the clock, so one said while the record is still loading cannot take a
 * place an earlier one has.
 */
const nextSeq = (after) => Math.max((after || 0) + 1, Date.now());

/** What is kept beside the entries. */
const runOf = (s) => ({ throughLine: s.throughLine, held: s.held, stats: s.stats });

/** Add entries to the run shown, each with its place, and keep them. */
function addEntries(entries) {
  const s = now().getState();
  let seq = s.seq;
  const added = entries.map(e => ({ ...e, seq: (seq = nextSeq(seq)) }));
  now().setState({ stream: keep([...s.stream, ...added]), seq, answering: false });
  persist(now().getState(), added);
}

/** The Druid's standing instructions, as shipped (prompt-space.redstring). */
async function loadPromptSpace() {
  const [{ promptSpaceFrom }, shipped] = await Promise.all([
    import('../../../druid/promptSpace.js'),
    import('../../../druid/prompt-space.redstring?raw')
  ]);
  let json = null;
  try { json = JSON.parse(shipped.default); } catch { json = null; }
  return promptSpaceFrom(json, 'shipped');
}

/**
 * Answer what was said while it sleeps (druidSession.talkTo), from what the
 * open universe holds. Marks what was said as answered, so waking does not
 * answer it again.
 */
async function answerAsleep(entry, universe) {
  if (live.session) return; // woke in the meantime: it hears it itself
  // Said in a universe since left: that universe keeps it, and hears it when the Druid wakes there.
  const s = now().getState();
  if (s.universe !== universe) return;
  try {
    const [{ talkTo, backendFor }, { default: useGraphStore }, promptSpace] = await Promise.all([
      import('../../../druid/inApp/druidSession.js'),
      import('../../../store/graphStore.js'),
      loadPromptSpace()
    ]);
    if (universeOf(useGraphStore) !== universe) return;
    // The panel's conversation, for a universe whose Home has none yet.
    const history = s.stream.filter(e => (e.kind === 'you' || e.kind === 'reply') && e.seq < entry.seq).slice(-8)
      .map(e => ({ who: e.kind === 'you' ? 'person' : 'druid', text: e.text }));
    const r = await talkTo({ store: fenced(useGraphStore, universe), promptSpace, backend: await backendFor(s.settings) }, { text: entry.text, history });
    if (now().getState().universe !== universe) return;
    if (!r.text) { now().setState({ answering: false, error: r.error ? `It could not answer: ${r.error}` : null }); return; }
    const answered = { ...entry, answered: true };
    now().setState(st => ({ stream: st.stream.map(e => (e.seq === entry.seq ? answered : e)) }));
    persist(now().getState(), [answered]);
    addEntries([{ kind: 'reply', text: r.text, asleep: true }]);
  } catch (err) {
    now().setState({ answering: false, error: `It could not answer: ${err?.message || err}` });
  }
}

/** Write these entries (new or changed) to the universe's run. */
function persist(s, entries) {
  if (!s.universe) return;
  record().write(s.universe, { run: runOf(s), entries, keepFrom: s.stream[0]?.seq ?? 0 }).catch(() => { /* the panel goes on; only this device's copy missed it */ });
}

/**
 * The page's memory, where the browser reports it (Chromium, so Electron).
 * A long run in the app once ran the renderer out of memory and left a white
 * window; each moment now records the heap, and the Druid stops itself well
 * before the limit, so the universe and the transcript survive.
 */
export const HEAP_STOP_SHARE = 0.75;
export function heapNow() {
  const m = globalThis.performance?.memory;
  if (!m?.usedJSHeapSize) return null;
  return { usedMB: Math.round(m.usedJSHeapSize / 1048576), limitMB: Math.round(m.jsHeapSizeLimit / 1048576) };
}

// While a session lives, a re-run module picks up where the last store was.
// The living Druid goes on with the code it woke with: a change to it waits
// for the next waking, and the view says so (`behind`). One run went on for
// hours past a fix, leaving hundreds of nameless placements a sleep repairs.
const carried = live.session && live.store
  ? { ...(({ status, error, stream, stats, held, throughLine, universe, opened, seq }) => ({ status, error, stream, stats, held, throughLine, universe, opened, seq }))(live.store.getState()), behind: true }
  : {};

/** The store the running session reports to: the current one, after any hot reload. */
const now = () => live.store || useDruidStore;

export const useDruidStore = create((set, get) => ({
  status: 'idle', // idle | starting | living | stopping
  error: null,
  /** What the view shows, oldest first: { kind: 'moment', ...cycle } | { kind: 'you' | 'reply', text } | { kind: 'woke', at }, each with its seq */
  stream: [],
  stats: null,
  held: [],
  throughLine: '',
  settings: readSettings(),
  /** The universe whose run this is (its slug), and whether its record has been read. */
  universe: null,
  opened: false,
  seq: 0,
  /** Living on code from before a change (dev): Sleep and Wake to pick it up. */
  behind: false,
  /** Something said is waiting for its answer. */
  answering: false,
  ...carried,

  setSetting: (key, value) => {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* per-device convenience only */ }
  },

  /** Say something to it: heard on its next moment, or when it next wakes. */
  /**
   * Say something to it. Living, it answers as it hears it, at the start of
   * its next moment; asleep, it answers now (talk.js), and still hears it
   * when it wakes, without answering again.
   */
  say: (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    const pending = !live.session;
    const entry = { kind: 'you', text: t, pending, seq: nextSeq(get().seq) };
    set(s => ({ stream: keep([...s.stream, entry]), seq: entry.seq, answering: true }));
    persist(get(), [entry]);
    if (live.session) live.session.say(t);
    else {
      const { universe } = get();
      live.talking = (live.talking || Promise.resolve()).then(() => answerAsleep(entry, universe)).catch(() => {});
    }
  },

  start: async () => {
    if (live.session || get().status !== 'idle') return;
    set({ status: 'starting', error: null });
    try {
      const [{ startDruid, backendFor }, { executeTool }, { applyToolResultToStore }, { default: useGraphStore }, promptSpace] = await Promise.all([
        import('../../../druid/inApp/druidSession.js'),
        import('../../../wizard/tools/index.js'),
        import('../../../services/toolResultApplier.js'),
        import('../../../store/graphStore.js'),
        loadPromptSpace()
      ]);
      // An answer still being given while it slept goes first: the model takes one call at a time.
      await live.talking;
      // Its run is the open universe's: read it first, so what was said there while it slept is heard.
      if (!get().opened || get().universe !== universeOf(useGraphStore)) await watchUniverse();
      const { settings, stream } = get();
      const universe = universeOf(useGraphStore);
      const backend = await backendFor(settings);
      const store = fenced(useGraphStore, universe);
      live.session = startDruid({
        store,
        executeTool,
        applyToolResult: (name, result, id, cid) => { store.getState(); return applyToolResultToStore(name, result, id, cid, { confirmed: true }); },
        promptSpace,
        backend
      }, {
        speak: settings.speak,
        pauseMs: PACE_MS[settings.pace] ?? PACE_MS.quick,
        // Its answer, as soon as it has one: before the moment it goes on with.
        onReply: (text, tick) => {
          if (now().getState().universe !== universe) return;
          addEntries([{ kind: 'reply', text, tick }]);
        },
        onCycle: (r) => {
          // A moment finished as another universe opened belongs to neither run shown.
          if (now().getState().universe !== universe) return;
          // The view shows the moment, not the loop's internals.
          const moment = Object.fromEntries(Object.entries(r).filter(([k]) => !['state', 'calls', 'stats', 'reply', 'heard'].includes(k)));
          // What it was asked and answered, small, for Copy.
          moment.asked = (r.calls || []).map(compactCall);
          const heap = heapNow();
          if (heap) moment.heapMB = heap.usedMB;
          // How long the moment took, from the one before (or from waking).
          const at = Date.now();
          moment.ms = at - (live.lastMomentAt || at);
          live.lastMomentAt = at;
          const s = now().getState();
          const heard = [];
          const stream = s.stream.map(e => {
            if (!(e.kind === 'you' && e.pending && r.heard?.length)) return e;
            const h = { ...e, pending: false };
            heard.push(h);
            return h;
          });
          // Its reply came already (onReply), ahead of the moment.
          const added = [{ kind: 'moment', ...moment, seq: nextSeq(s.seq) }];
          now().setState({
            ...(r.heard?.length ? { answering: false } : {}),
            stream: keep([...stream, ...added]),
            seq: added[added.length - 1].seq,
            stats: r.stats,
            held: r.held || [],
            throughLine: r.throughLine || s.throughLine
          });
          persist(now().getState(), [...heard, ...added]);
          if (heap && heap.usedMB > heap.limitMB * HEAP_STOP_SHARE && live.session) {
            live.stopNote = `Stopped to keep the app from running out of memory (${heap.usedMB} of ${heap.limitMB} MB). Copy the transcript and send it to Claude.`;
            live.session.stop();
          }
          if (now().getState().settings.follow && r.locus?.focus) {
            // After the canvas has drawn what this cycle wrote.
            setTimeout(() => runCanvasCommand('navigateToPrototypeInstances', r.locus.focus), 150);
          }
        },
        onStop: ({ reason, error }) => {
          live.session = null;
          const note = live.stopNote || (error === ANOTHER_UNIVERSE ? SWITCHED_NOTE : null);
          now().setState({ status: 'idle', behind: false, answering: false, error: note || (reason === 'error' ? error : null) });
          live.stopNote = null;
        }
      });
      // What was said while it slept is heard as it wakes; what it answered then is not answered again.
      for (const e of stream) if (e.kind === 'you' && e.pending) live.session.say(e.text, { answered: !!e.answered });
      // Where this waking begins, in a run kept over many.
      const woke = { kind: 'woke', at: Date.now(), seq: nextSeq(get().seq) };
      live.lastMomentAt = woke.at;
      set(s => ({ status: 'living', behind: false, stream: keep([...s.stream, woke]), seq: woke.seq }));
      persist(get(), [woke]);
    } catch (err) {
      live.session = null;
      set({ status: 'idle', error: err?.message || String(err) });
    }
  },

  stop: () => {
    if (!live.session) return;
    set({ status: 'stopping' });
    live.session.stop();
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
      text = outline(live.session?.world || createWorld({ store: useGraphStore }));
    } catch (err) {
      text = `(could not outline the universe: ${err?.message || err})`;
    }
    return transcriptOf(get(), { outline: text });
  },

  /** Clear this universe's run, here and on this device. The universe keeps everything the Druid wrote into it. */
  clear: () => {
    const { universe } = get();
    set({ stream: [], throughLine: '', held: [], stats: null, error: null, answering: false });
    if (universe) record().clear(universe).catch(() => {});
  }
}));

live.store = useDruidStore;

/**
 * Show the run of the universe now open: read its record, and, if the Druid
 * is living in another, put it to sleep (it would write into this one).
 */
async function openUniverse(universe) {
  const s = now().getState();
  if (s.opened && s.universe === universe) return;
  // Only when it is known to live in another: one woken before the panel knew lives here.
  if (live.session && s.opened && s.universe !== universe) {
    live.stopNote = SWITCHED_NOTE;
    now().getState().stop();
  }
  // Shown before any universe was read (said while it loaded, or a run from
  // before runs were kept): it belongs to this one, so it is kept with it.
  let seq = s.seq;
  const before = s.opened ? [] : s.stream.map(e => (e.seq ? e : { ...e, seq: (seq = nextSeq(seq)) }));
  now().setState({
    answering: false,
    // Opened only once there is a universe: at startup the panel can come up before it loads.
    universe, opened: !!universe, stream: before, seq: Math.max(seq, before[before.length - 1]?.seq || 0),
    throughLine: s.opened ? '' : s.throughLine, held: s.opened ? [] : s.held, stats: s.opened ? null : s.stats,
    error: live.session ? s.error : null
  });
  if (!universe) return;
  if (before.length) persist(now().getState(), before);
  let saved = null;
  try { saved = await record().load(universe); } catch { saved = null; }
  if (!saved || now().getState().universe !== universe) return;
  now().setState(st => {
    // Anything said while it was being read goes after what was kept (once: it may be in both).
    const bySeq = new Map([...(saved.stream || []), ...st.stream].map(e => [e.seq, e]));
    const stream = keep([...bySeq.values()].sort((a, b) => a.seq - b.seq));
    return {
      stream,
      seq: Math.max(st.seq, stream[stream.length - 1]?.seq || 0),
      throughLine: st.throughLine || saved.throughLine || '',
      held: st.held.length ? st.held : (saved.held || []),
      stats: st.stats || saved.stats || null
    };
  });
}

/**
 * Follow the universe that is open: show its run now, and again whenever
 * another is opened. The view calls this as it mounts, and Wake does.
 */
export async function watchUniverse() {
  const { default: useGraphStore } = await import('../../../store/graphStore.js');
  // A re-run module watches with its own code; the last one's watch goes.
  live.unwatch?.();
  let last = universeOf(useGraphStore);
  live.unwatch = useGraphStore.subscribe((st) => {
    const universe = st._universeSlug || null;
    if (universe === last) return;
    last = universe;
    openUniverse(universe);
  });
  await openUniverse(last);
}

// Re-run in dev while a view was watching: this module's code watches from now on.
if (live.unwatch) watchUniverse().catch(() => {});

export default useDruidStore;
