/**
 * Whole-app smoothness session — `__diag.session()`, or always-on in a build
 * made with VITE_PERF_SESSION=1 (the iPad measuring build).
 *
 * canvasDiagnostics measures the canvas on demand from a console. This
 * measures the whole app while it is used normally, on a device with no
 * console: every frame's length, what the person was doing at the time
 * (idle, a gesture on the canvas, on a panel, scrolling, typing), which
 * frame loops and timers are running, and which CSS animations are playing
 * and whether they're on screen. Every 10 s it logs one `[perf]` line (the
 * Capacitor bridge forwards console.log to the device log) and keeps a
 * running total in `__diag.sessionReport()`.
 *
 * Inert unless started: nothing is wrapped and nothing runs.
 */

const TAG = '[perf]';
const FRAME_MS = 1000 / 60;
const DROP_MS = FRAME_MS * 1.5;
const LONG_MS = 50;
const WINDOW_MS = 10000;

let session = null;

// Where a frame loop or timer was registered: the first stack frame outside
// this file. Stack capture is costly, so each call site is sampled.
function origin() {
  const stack = new Error().stack || '';
  const lines = stack.split('\n').slice(1);
  for (const line of lines) {
    if (line.includes('perfSession')) continue;
    const at = line.trim().replace(/^at /, '');
    // "fn@url:line:col" (WebKit) or "fn (url:line:col)" (V8)
    const m = at.match(/^(.*?)[@ (]+(?:.*\/)?([^/]+?):(\d+):\d+\)?$/);
    return m ? `${m[1] || '(anon)'} ${m[2]}:${m[3]}` : at.slice(0, 80);
  }
  return '(unknown)';
}

function regionOf(target) {
  const el = target && target.nodeType === 1 ? target : target?.parentElement;
  if (!el?.closest) return 'other';
  if (el.closest('.canvas-modal, [role="dialog"]')) return 'modal';
  if (el.closest('.panel-container')) return 'panel';
  if (el.closest('header')) return 'header';
  if (el.closest('.canvas-area, svg.canvas')) return 'canvas';
  return 'other';
}

function describe(el) {
  if (!el || el.nodeType !== 1) return '?';
  const cls = el.getAttribute('class');
  return `${el.tagName.toLowerCase()}${cls ? '.' + String(cls).trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
}

function onScreen(el) {
  if (!el?.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
}

function newBucket() {
  return { frames: 0, dropped: 0, long: 0, worst: 0, total: 0 };
}

export function startSession({ log = true } = {}) {
  if (session) return session;
  const originals = { raf: window.requestAnimationFrame, setInterval: window.setInterval, clearInterval: window.clearInterval };
  const nativeRaf = (cb) => originals.raf.call(window, cb);
  const nativeSetInterval = (...a) => originals.setInterval.apply(window, a);
  const nativeClearInterval = (id) => originals.clearInterval.call(window, id);

  const s = {
    t0: performance.now(),
    byActivity: {},          // activity -> bucket (whole session)
    windowByActivity: {},    // activity -> bucket (current 10 s)
    rafSites: new Map(),     // origin -> calls (sampled origin, counted calls)
    rafCallsIdle: 0,
    idleFrames: 0,
    intervals: new Map(),    // id -> { site, ms }
    animations: new Map(),   // "name on element" -> { visible, hidden }
    pointerDown: false,
    region: 'other',
    lastScroll: -1e9,
    lastKey: -1e9,
    lastInput: -1e9,
    stopped: false,
  };
  session = s;

  // --- what the person is doing ---------------------------------------
  const opts = { capture: true, passive: true };
  const onDown = (e) => { s.pointerDown = true; s.region = regionOf(e.target); s.lastInput = performance.now(); };
  const onUp = () => { s.pointerDown = false; s.lastInput = performance.now(); };
  const onMove = () => { if (s.pointerDown) s.lastInput = performance.now(); };
  const onScroll = (e) => { s.lastScroll = performance.now(); s.scrollRegion = regionOf(e.target); };
  const onKey = () => { s.lastKey = performance.now(); };
  const onWheel = (e) => { s.lastScroll = performance.now(); s.scrollRegion = regionOf(e.target); };
  window.addEventListener('pointerdown', onDown, opts);
  window.addEventListener('pointerup', onUp, opts);
  window.addEventListener('pointercancel', onUp, opts);
  window.addEventListener('pointermove', onMove, opts);
  window.addEventListener('touchstart', onDown, opts);
  window.addEventListener('touchend', onUp, opts);
  window.addEventListener('scroll', onScroll, opts);
  window.addEventListener('wheel', onWheel, opts);
  window.addEventListener('keydown', onKey, opts);

  function activity(now) {
    if (s.pointerDown) return `gesture:${s.region}`;
    if (now - s.lastScroll < 300) return `scroll:${s.scrollRegion || 'other'}`;
    if (now - s.lastKey < 600) return 'typing';
    if (now - s.lastInput < 1000) return `settling:${s.region}`;
    return 'idle';
  }

  // --- who keeps the frame loop busy ------------------------------------
  const sampled = new Map(); // function -> origin, so each loop is traced once
  let rafThisFrame = 0;
  window.requestAnimationFrame = (cb) => {
    rafThisFrame++;
    let site = sampled.get(cb);
    if (!site) {
      // A loop passes the same function every frame; a new closure each frame
      // is traced 1 time in 30.
      site = Math.random() < 1 / 30 || !sampled.size ? origin() : null;
      if (site) sampled.set(cb, site);
    }
    if (site) s.rafSites.set(site, (s.rafSites.get(site) || 0) + 1);
    return nativeRaf(cb);
  };
  window.setInterval = (fn, ms, ...args) => {
    const id = nativeSetInterval(fn, ms, ...args);
    s.intervals.set(id, { site: origin(), ms: Number(ms) || 0 });
    return id;
  };
  window.clearInterval = (id) => {
    s.intervals.delete(id);
    return nativeClearInterval(id);
  };

  // --- frames -------------------------------------------------------------
  let last = performance.now();
  const tick = (now) => {
    if (s.stopped) return;
    const dt = now - last;
    last = now;
    const act = activity(now);
    for (const map of [s.byActivity, s.windowByActivity]) {
      const b = map[act] || (map[act] = newBucket());
      b.frames++;
      b.total += dt;
      if (dt > DROP_MS) b.dropped += Math.max(1, Math.round(dt / FRAME_MS) - 1);
      if (dt > LONG_MS) b.long++;
      if (dt > b.worst) b.worst = dt;
    }
    if (act === 'idle') {
      s.idleFrames++;
      s.rafCallsIdle += Math.max(0, rafThisFrame - 1); // minus our own tick
    }
    rafThisFrame = 0;
    nativeRaf(tick);
  };
  nativeRaf(tick);

  // --- CSS animations -------------------------------------------------------
  const sampleAnimations = () => {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue;
      const name = a.animationName || a.transitionProperty || a.id || 'animation';
      const target = a.effect?.target;
      const key = `${name} on ${describe(target)}${a.effect?.getTiming?.().iterations === Infinity ? ' (infinite)' : ''}`;
      const e = s.animations.get(key) || { visible: 0, hidden: 0 };
      if (onScreen(target)) e.visible++;
      else e.hidden++;
      s.animations.set(key, e);
    }
  };
  const animTimer = nativeSetInterval(sampleAnimations, 2000);

  // --- reporting ------------------------------------------------------------
  const summarise = (buckets) => Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, {
    s: +(b.total / 1000).toFixed(1),
    fps: b.total ? +((b.frames / b.total) * 1000).toFixed(0) : 0,
    dropped: b.dropped,
    long: b.long,
    worst: Math.round(b.worst),
  }]));

  const windowTimer = nativeSetInterval(() => {
    if (log && Object.keys(s.windowByActivity).length) {
      console.log(TAG, JSON.stringify({ window: summarise(s.windowByActivity) }));
    }
    s.windowByActivity = {};
  }, WINDOW_MS);

  s.report = () => {
    const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
    return {
      seconds: Math.round((performance.now() - s.t0) / 1000),
      byActivity: summarise(s.byActivity),
      idleFrameLoopsPerFrame: s.idleFrames ? +(s.rafCallsIdle / s.idleFrames).toFixed(2) : 0,
      frameLoops: top(s.rafSites, 12).map(([site, calls]) => ({ site, calls })),
      intervals: [...s.intervals.values()].reduce((acc, { site, ms }) => {
        const key = `${site} every ${ms}ms`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      animations: [...s.animations].sort((a, b) => (b[1].visible + b[1].hidden) - (a[1].visible + a[1].hidden)).slice(0, 25)
        .map(([key, v]) => ({ key, visibleSamples: v.visible, hiddenSamples: v.hidden })),
    };
  };
  s.stop = () => {
    s.stopped = true;
    window.requestAnimationFrame = originals.raf;
    window.setInterval = originals.setInterval;
    window.clearInterval = originals.clearInterval;
    nativeClearInterval(animTimer);
    nativeClearInterval(windowTimer);
    for (const [t, f] of [['pointerdown', onDown], ['pointerup', onUp], ['pointercancel', onUp], ['pointermove', onMove],
      ['touchstart', onDown], ['touchend', onUp], ['scroll', onScroll], ['wheel', onWheel], ['keydown', onKey]]) {
      window.removeEventListener(t, f, opts);
    }
    session = null;
  };

  if (log) console.log(TAG, 'session started');
  return s;
}

export function sessionReport() {
  if (!session) return null;
  const r = session.report();
  console.log(TAG, 'report', JSON.stringify(r));
  return r;
}

export function stopSession() {
  const r = sessionReport();
  session?.stop();
  return r;
}

// The measuring build runs a session from launch, and prints the full report
// every minute so it reaches the device log without a console.
if (import.meta.env.VITE_PERF_SESSION === '1') {
  startSession();
  setInterval(sessionReport, 60000);
}
