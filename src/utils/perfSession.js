/**
 * Whole-app smoothness session — `__diag.session()`, or always-on in a build
 * made with VITE_PERF_SESSION=1 (the iPad measuring build).
 *
 * canvasDiagnostics measures the canvas on demand from a console. This
 * measures the whole app while it is used normally, on a device with no
 * console: every frame's length, what the person was doing at the time
 * (idle, a gesture on the canvas, on a panel, scrolling, typing), which
 * frame loops and timers are running, which CSS animations are playing and
 * whether they're on screen, and for each animation as it starts, how long
 * after the tap it began and how its frames went (`[perf] anim`). Every 10 s
 * it logs one `[perf]` line (the Capacitor bridge forwards console.log to the
 * device log) and keeps a running total in `__diag.sessionReport()`.
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
    // This file's own frames, by file in development and by name in a bundle.
    if (line.includes('perfSession') || /\b(origin|rsWrapped\w*)\b/.test(line)) continue;
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
  // The panel resizers are bare divs; the cursor is what marks them.
  try { if (getComputedStyle(el).cursor === 'col-resize') return 'resize'; } catch { /* detached */ }
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
  return { frames: 0, dropped: 0, long: 0, worst: 0, total: 0, worstRender: 0 };
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
    lastTap: -1e9,
    playsByAnimation: new Map(), // "name on element" -> times started
    stopped: false,
  };
  session = s;

  // --- what the person is doing ---------------------------------------
  const opts = { capture: true, passive: true };
  const onDown = (e) => { s.pointerDown = true; s.region = regionOf(e.target); s.lastInput = performance.now(); };
  const onUp = () => { s.pointerDown = false; s.lastInput = s.lastTap = performance.now(); };
  const onMove = () => { if (s.pointerDown) s.lastInput = performance.now(); };
  const onScroll = (e) => { s.lastScroll = performance.now(); s.scrollRegion = regionOf(e.target); };
  const onKey = () => { s.lastKey = s.lastTap = performance.now(); };
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
  window.requestAnimationFrame = function rsWrappedRaf(cb) {
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
  window.setInterval = function rsWrappedSetInterval(fn, ms, ...args) {
    const id = nativeSetInterval(fn, ms, ...args);
    s.intervals.set(id, { site: origin(), ms: Number(ms) || 0 });
    return id;
  };
  window.clearInterval = (id) => {
    s.intervals.delete(id);
    return nativeClearInterval(id);
  };

  // --- animation moments ------------------------------------------------
  // One `[perf] anim` line per animation or transition the app starts (or
  // per batch of them starting together): how long after the tap or key it
  // started, and the frames for MOMENT_MS after. `play` counts how many times
  // that animation has started this session, so a first play that stalls and
  // a later one that doesn't show up side by side.
  const MOMENT_MS = 400;
  let moment = null;
  const finishMoment = () => {
    const m = moment;
    moment = null;
    if (!m || !log) return;
    console.log(TAG, 'anim', JSON.stringify({
      what: m.names,
      play: m.play,
      fromInput: m.fromInput,
      frames: m.frames.length,
      worst: Math.round(Math.max(0, ...m.frames)),
      // The slowest frame's style, layout and paint, apart from the script
      // that ran between frames (see the message channel below).
      worstRender: Math.round(m.worstRender),
      dropped: m.frames.reduce((n, dt) => n + (dt > DROP_MS ? Math.max(1, Math.round(dt / FRAME_MS) - 1) : 0), 0),
    }));
  };
  const onAnimStart = (e) => {
    const name = e.animationName || (e.propertyName ? `${e.propertyName} transition` : e.type);
    startMoment(`${name} on ${describe(e.target)}`);
  };
  // Also the motion script drives frame by frame (a morph, a glide), which
  // fires no animation event: its code calls perfMark (below) as it starts.
  s.mark = (name) => startMoment(`${name} (script)`);
  function startMoment(what) {
    const t = performance.now();
    // Started in the same frame as the one being watched: part of it.
    if (moment && t - moment.at < 50) {
      if (moment.names.length < 4 && !moment.names.includes(what)) moment.names.push(what);
      return;
    }
    finishMoment();
    const play = (s.playsByAnimation.get(what) || 0) + 1;
    s.playsByAnimation.set(what, play);
    moment = { at: t, names: [what], play, fromInput: t - s.lastTap < 1500 ? Math.round(t - s.lastTap) : null, frames: [], worstRender: 0 };
  }
  // A message posted from a frame callback arrives once that frame's
  // rendering (style, layout, paint) is done, so the time between them is
  // what drawing the frame cost; the rest of a long frame is script.
  const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  let renderFrom = 0;
  let renderAct = null;
  if (channel) {
    channel.port1.onmessage = () => {
      const ms = performance.now() - renderFrom;
      if (moment) moment.worstRender = Math.max(moment.worstRender, ms);
      // And for a gesture, against what it was (a resize drag, a pan).
      if (renderAct) {
        for (const map of [s.byActivity, s.windowByActivity]) {
          const b = map[renderAct];
          if (b) b.worstRender = Math.max(b.worstRender, ms);
        }
      }
    };
  }
  document.addEventListener('animationstart', onAnimStart, opts);
  document.addEventListener('transitionstart', onAnimStart, opts);

  // --- frames -------------------------------------------------------------
  let last = performance.now();
  const tick = (now) => {
    if (s.stopped) return;
    const dt = now - last;
    last = now;
    if (moment) {
      moment.frames.push(dt);
      if (now - moment.at > MOMENT_MS) finishMoment();
    }
    const act = activity(now);
    renderAct = s.pointerDown ? act : null;
    if (channel && (moment || renderAct)) { renderFrom = performance.now(); channel.port2.postMessage(0); }
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
    ...(b.worstRender ? { worstRender: Math.round(b.worstRender) } : {}),
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
    finishMoment();
    if (channel) channel.port1.onmessage = null;
    document.removeEventListener('animationstart', onAnimStart, opts);
    document.removeEventListener('transitionstart', onAnimStart, opts);
    session = null;
  };

  if (log) console.log(TAG, 'session started');
  return s;
}

/**
 * Mark the start of an animation script drives (no CSS animation event
 * announces it), so the session times it like any other. A no-op unless a
 * session is running.
 */
export function perfMark(name) {
  session?.mark?.(name);
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
// Optional chaining: the CLI and the daemon load this outside Vite, with no env.
if (import.meta.env?.VITE_PERF_SESSION === '1' && typeof window !== 'undefined') {
  startSession();
  setInterval(sessionReport, 60000);
}
