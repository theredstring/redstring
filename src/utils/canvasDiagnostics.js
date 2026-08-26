/**
 * Canvas render diagnostics — `window.__diag` in the console.
 *
 * Built because repeated theorising about the canvas's raster/compositing cost
 * kept producing plausible-but-wrong fixes. Everything here MEASURES; nothing
 * here assumes. Output is written with console.log so it forwards to the
 * Electron terminal (see the console-message hook in electron/main.cjs) and can
 * be pasted straight into a bug report.
 *
 * Typical session:
 *   __diag.help()
 *   __diag.scan()                     // what is actually in the render tree
 *   __diag.record(5000)               // 5s of frame timings, then a report
 *   __diag.compare(5000)              // same, with the gesture layer disabled
 *
 * Import for side effect only. Costs nothing until a command is run.
 */

const TAG = '[diag]';
const log = (...a) => console.log(TAG, ...a);

const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/* ------------------------------------------------------------------ */
/* element lookup                                                      */
/* ------------------------------------------------------------------ */

function els() {
  const container = document.querySelector('.canvas-area');
  const svg = document.querySelector('svg.canvas');
  // The gesture layer is the div between them, if it exists.
  let layer = null;
  if (svg && svg.parentElement && svg.parentElement !== container) layer = svg.parentElement;
  const group = svg?.querySelector('g');
  const orbit = document.querySelector('.orbit-overlay');
  return { container, svg, layer, group, orbit };
}

/* ------------------------------------------------------------------ */
/* structural scan                                                     */
/* ------------------------------------------------------------------ */

// Properties whose presence changes how the compositor treats a subtree.
const TRIGGERS = [
  'willChange', 'filter', 'backdropFilter', 'mixBlendMode',
  'isolation', 'contain', 'clipPath', 'mask', 'perspective', 'backfaceVisibility',
];

const NEUTRAL = new Set(['auto', 'none', 'normal', 'visible', '', 'None']);

function scan({ limit = 60000 } = {}) {
  const { container, svg, layer, group, orbit } = els();
  if (!svg) { log('no svg.canvas in the DOM — is a graph open?'); return null; }

  log('─── structural scan ───────────────────────────────');
  log('gesture layer present:', !!layer);
  if (layer) {
    log('  layer style :', JSON.stringify({
      position: layer.style.position || getComputedStyle(layer).position,
      contain: getComputedStyle(layer).contain,
      overflow: getComputedStyle(layer).overflow,
      willChange: getComputedStyle(layer).willChange,
      transform: layer.style.transform || 'none',
    }));
    log('  layer box   :', layer.clientWidth + 'x' + layer.clientHeight);
  }
  log('content <g> transform:', group?.getAttribute('transform') || '(none)');

  const all = svg.querySelectorAll('*');
  const total = all.length;
  const byTag = {};
  const opacityGroups = [];   // <g>/container elements with opacity < 1  ← expensive
  const opacityLeaves = [];   // leaf shapes with opacity < 1             ← cheap
  const triggered = {};
  const large = [];
  let foreignObjects = 0;
  let defsKids = 0;

  const cap = Math.min(total, limit);
  for (let i = 0; i < cap; i++) {
    const el = all[i];
    const tag = el.tagName;
    byTag[tag] = (byTag[tag] || 0) + 1;
    if (tag === 'foreignObject') foreignObjects++;
    if (tag === 'defs') defsKids += el.children.length;

    // Size: anything approaching the 100k plane is worth knowing about.
    const w = Number(el.getAttribute?.('width'));
    const h = Number(el.getAttribute?.('height'));
    if ((w >= 10000 || h >= 10000)) {
      large.push(`${tag} ${w || '?'}x${h || '?'} fill=${el.getAttribute('fill') || '-'} opacity=${el.getAttribute('opacity') ?? el.style?.opacity ?? '-'}`);
    }

    const cs = getComputedStyle(el);

    // Group opacity forces an offscreen buffer for the whole subtree; opacity
    // on a leaf shape does not. The distinction is the point of this bucket.
    const o = parseFloat(cs.opacity);
    if (Number.isFinite(o) && o < 1) {
      const rec = `${tag}${el.getAttribute('class') ? '.' + el.getAttribute('class') : ''} opacity=${o}`;
      if (el.children.length > 0) opacityGroups.push(`${rec} children=${el.children.length}`);
      else opacityLeaves.push(rec);
    }

    for (const p of TRIGGERS) {
      const v = cs[p];
      if (v && !NEUTRAL.has(v)) {
        (triggered[p] ||= []).push(`${tag}${el.getAttribute('class') ? '.' + el.getAttribute('class') : ''}=${v}`);
      }
    }
  }

  log('elements inside <svg>:', total, cap < total ? `(scanned ${cap})` : '');
  const tags = Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 14);
  log('  by tag    :', tags.map(([t, n]) => `${t}:${n}`).join(' '));
  log('  foreignObject:', foreignObjects, ' defs children:', defsKids);

  log('OPACITY < 1 on containers (forces offscreen buffer + blend):', opacityGroups.length);
  for (const r of opacityGroups.slice(0, 25)) log('   ·', r);
  if (opacityGroups.length > 25) log('   … and', opacityGroups.length - 25, 'more');
  log('OPACITY < 1 on leaf shapes (cheap):', opacityLeaves.length);

  for (const p of TRIGGERS) {
    const hits = triggered[p];
    if (!hits?.length) continue;
    log(`${p}:`, hits.length);
    for (const r of [...new Set(hits)].slice(0, 12)) log('   ·', r);
  }

  log('large elements (>=10000px):', large.length);
  for (const r of large.slice(0, 12)) log('   ·', r);

  if (orbit) {
    const items = orbit.querySelectorAll('.orbit-items > g').length;
    const conns = orbit.querySelectorAll('.orbit-connections > g, .orbit-connections > line').length;
    log('ORBIT active — items:', items, 'connections:', conns,
        'total orbit elements:', orbit.querySelectorAll('*').length);
    const oc = getComputedStyle(orbit);
    log('  orbit root  : opacity=' + oc.opacity, 'visibility=' + oc.visibility,
        'willChange=' + oc.willChange, 'isolation=' + oc.isolation);
  } else {
    log('ORBIT not present');
  }

  log('devicePixelRatio:', window.devicePixelRatio,
      ' viewport:', window.innerWidth + 'x' + window.innerHeight,
      ' container:', container ? container.clientWidth + 'x' + container.clientHeight : 'n/a');
  log('───────────────────────────────────────────────────');
  return { total, opacityGroups: opacityGroups.length, triggered };
}

/* ------------------------------------------------------------------ */
/* frame recording                                                     */
/* ------------------------------------------------------------------ */

let recording = null;

function record(ms = 5000, label = '') {
  if (recording) { log('already recording'); return; }
  const frames = [];
  const longFrames = [];
  let raf = 0;
  let last = performance.now();
  const started = last;

  let lafObs = null;
  try {
    lafObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const scripts = (e.scripts || []).map(s =>
          `${s.name || s.invoker || '?'}:${Math.round(s.duration)}ms`);
        longFrames.push({
          dur: Math.round(e.duration),
          block: Math.round(e.blockingDuration ?? 0),
          style: Math.round((e.styleAndLayoutStart != null)
            ? (e.startTime + e.duration - e.styleAndLayoutStart) : 0),
          scripts,
        });
      }
    });
    lafObs.observe({ type: 'long-animation-frame', buffered: false });
  } catch { lafObs = null; }

  const tick = (t) => {
    frames.push(t - last);
    last = t;
    if (t - started < ms) raf = requestAnimationFrame(tick);
    else finish();
  };

  const finish = () => {
    cancelAnimationFrame(raf);
    try { lafObs?.disconnect(); } catch { /* ignore */ }
    recording = null;

    const d = frames.slice(1).filter(Number.isFinite);
    const sorted = [...d].sort((a, b) => a - b);
    const sum = d.reduce((a, b) => a + b, 0);
    const orbitOn = !!document.querySelector('.orbit-overlay');

    log('─── frame report', label ? `(${label})` : '', '──────────────────');
    log('duration:', num(sum) + 'ms', ' frames:', d.length,
        ' fps:', num(d.length / (sum / 1000)));
    log('frame ms  avg:', num(sum / d.length),
        ' p50:', num(pct(sorted, 50)),
        ' p95:', num(pct(sorted, 95)),
        ' max:', num(sorted[sorted.length - 1]));
    log('janky frames  >24ms:', d.filter(x => x > 24).length,
        ' >50ms:', d.filter(x => x > 50).length,
        ' >100ms:', d.filter(x => x > 100).length);
    log('orbit active during recording:', orbitOn);
    if (lafObs) {
      log('long animation frames:', longFrames.length);
      for (const f of longFrames.slice(0, 10)) {
        log(`   · ${f.dur}ms (blocking ${f.block}ms, style+layout ~${f.style}ms)`,
            f.scripts.length ? ' scripts: ' + f.scripts.join(', ') : ' [no script attribution — cost is paint/raster, not JS]');
      }
      if (!longFrames.length) {
        log('   (none — if frames are still janky, the cost is in the compositor,');
        log('    i.e. raster/upload, not on the main thread)');
      }
    } else {
      log('long-animation-frame API unavailable in this runtime');
    }
    log('───────────────────────────────────────────────────');
  };

  recording = { finish };
  log(`recording ${ms}ms${label ? ' — ' + label : ''}… interact with the canvas now`);
  raf = requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ */
/* DOM write rate                                                      */
/* ------------------------------------------------------------------ */

/**
 * Count every attribute mutation inside the canvas over a window, bucketed by
 * element and attribute. This is the direct test of "is it the animation
 * frame rate?" — a MutationObserver sees `setAttribute` and inline-style writes
 * alike, so it reports the true invalidation rate rather than an assumed one.
 *
 * Anything writing inside the pan/zoom content group dirties the canvas raster,
 * so writes/sec here is the number that governs repaint pressure.
 */
function writes(ms = 3000, label = '') {
  const { svg } = els();
  if (!svg) { log('no svg.canvas'); return; }

  const counts = new Map();
  let total = 0;

  const obs = new MutationObserver((records) => {
    for (const r of records) {
      total++;
      const el = r.target;
      const cls = el.getAttribute?.('class');
      const key = `${el.tagName}${cls ? '.' + String(cls).split(' ')[0] : ''} [${r.attributeName}]`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });

  obs.observe(svg, { attributes: true, subtree: true });
  const t0 = performance.now();
  log(`counting canvas DOM writes for ${ms}ms${label ? ' — ' + label : ''}…`);

  setTimeout(() => {
    obs.disconnect();
    const secs = (performance.now() - t0) / 1000;
    log('─── DOM write report', label ? `(${label})` : '', '─────────────');
    log('total attribute mutations:', total,
        ' →', num(total / secs, 0), 'writes/sec');
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [k, n] of rows) {
      log(`   ${String(n).padStart(6)}  (${num(n / secs, 0).padStart(5)}/s)  ${k}`);
    }
    if (!total) log('   (nothing wrote — the canvas is genuinely idle)');
    log('───────────────────────────────────────────────────');
  }, ms);
}

/* ------------------------------------------------------------------ */
/* gesture-layer A/B                                                   */
/* ------------------------------------------------------------------ */

/**
 * Neutralise the wrapper div added for compositor zoom, so its STRUCTURAL cost
 * can be measured separately from the delta-writing logic. `__compositorZoom`
 * only stops the writes — it leaves the containing/clipping box in place, so it
 * can never exonerate the box itself.
 */
function wrapper(mode = 'status') {
  const { layer } = els();
  if (!layer) { log('no gesture layer found'); return; }
  const cs = getComputedStyle(layer);
  if (mode === 'status') {
    log('gesture layer:', JSON.stringify({
      contain: cs.contain, overflow: cs.overflow, willChange: cs.willChange,
      transform: layer.style.transform || 'none',
    }));
    return;
  }
  if (mode === 'off') {
    // As close to "this div isn't here" as we can get without unmounting it.
    layer.style.contain = 'none';
    layer.style.overflow = 'visible';
    layer.style.willChange = 'auto';
    layer.style.transform = 'none';
    if (typeof window !== 'undefined') window.__compositorZoom = false;
    log('gesture layer NEUTRALISED (contain/overflow/will-change/transform cleared,');
    log('and __compositorZoom = false). Re-run your test now.');
    return;
  }
  if (mode === 'on') {
    layer.style.contain = '';
    layer.style.overflow = '';
    layer.style.willChange = '';
    layer.style.transform = '';
    if (typeof window !== 'undefined') delete window.__compositorZoom;
    log('gesture layer restored to defaults');
    return;
  }
  log('usage: __diag.wrapper("status" | "off" | "on")');
}

/** Record with the layer active, then neutralised, and print both. */
async function compare(ms = 5000) {
  log('A/B: keep doing the SAME interaction through both halves.');
  wrapper('on');
  await new Promise(r => setTimeout(r, 300));
  record(ms, 'gesture layer ON');
  await new Promise(r => setTimeout(r, ms + 500));
  wrapper('off');
  await new Promise(r => setTimeout(r, 300));
  record(ms, 'gesture layer OFF');
  await new Promise(r => setTimeout(r, ms + 500));
  log('A/B done. Compare the two frame reports above.');
}

/* ------------------------------------------------------------------ */
/* suspect bisection                                                   */
/* ------------------------------------------------------------------ */

/**
 * Turn individual suspects off, one at a time, and see which one changes the
 * symptom. Ordered by an audit of what actually forces raster/blend work in the
 * canvas subtree — try them top to bottom.
 *
 * Everything here is a live DOM/flag change: nothing persists past a reload,
 * and `reset` puts it all back.
 */
const SUSPECTS = {
  // A ~9-viewport-area rgba(0,0,0,0.7) rect that paints ABOVE the whole graph
  // whenever orbit is on. Every tile it covers becomes non-opaque and has to
  // blend the entire stack beneath it, and its geometry is rewritten on every
  // pan tick. Only exists in orbit mode — which is the mode that misbehaves.
  dimrect: {
    what: 'the orbit dim rect (3x viewport, 70% black, blends everything under it)',
    off: () => { const r = document.querySelector('[data-orbit-dim]'); if (r) r.style.display = 'none'; return !!r; },
    on: () => { const r = document.querySelector('[data-orbit-dim]'); if (r) r.style.display = ''; },
  },
  // Shrink rather than remove: keeps the dimming, cuts the blended area ~9x.
  dimsmall: {
    what: 'the dim rect shrunk from 3x viewport to roughly 1x (same look, 1/9 the blend)',
    off: () => {
      const r = document.querySelector('[data-orbit-dim]');
      if (!r) return false;
      const w = Number(r.getAttribute('width')) || 0;
      const h = Number(r.getAttribute('height')) || 0;
      const x = Number(r.getAttribute('x')) || 0;
      const y = Number(r.getAttribute('y')) || 0;
      r.setAttribute('x', x + w / 3); r.setAttribute('y', y + h / 3);
      r.setAttribute('width', w / 3); r.setAttribute('height', h / 3);
      log('   (note: the next pan/zoom tick resizes it back — measure immediately)');
      return true;
    },
    on: () => {},
  },
  // ~450 SVG elements that now stay painted during pan, because the overlay's
  // zoom mode default was changed to 'full'.
  orbit: {
    what: 'the orbit overlay contents (items + connections)',
    off: () => { const o = document.querySelector('.orbit-overlay'); if (o) o.style.visibility = 'hidden'; return !!o; },
    on: () => { const o = document.querySelector('.orbit-overlay'); if (o) o.style.visibility = ''; },
  },
  // The rAF loop that never idles: ~280 attribute writes 15x/sec, forever.
  rotation: {
    what: 'the orbit rotation loop (its per-frame writes into the canvas raster)',
    off: () => { window.__orbitFreeze = true; return true; },
    on: () => { delete window.__orbitFreeze; },
  },
  // The wrapper div added for compositor zoom: contain/overflow/will-change.
  wrapper: {
    what: 'the compositor-zoom wrapper (contain:paint + clip + will-change)',
    off: () => { wrapper('off'); return true; },
    on: () => { wrapper('on'); },
  },
  // A 100k x 100k rect filled with a translucent pattern.
  grid: {
    what: 'the 100000x100000 grid pattern rect',
    off: () => { const g = document.querySelector('.grid-overlay'); if (g) g.style.display = 'none'; return !!g; },
    on: () => { const g = document.querySelector('.grid-overlay'); if (g) g.style.display = ''; },
  },
};

function suspect(name) {
  if (!name || name === 'list') {
    log('suspects, in the order worth testing:');
    for (const [k, s] of Object.entries(SUSPECTS)) log(`  __diag.suspect("${k}")`.padEnd(30), '—', s.what);
    log('  __diag.suspect("reset")        — put everything back');
    log('');
    log('method: turn ONE off, look at the canvas, note whether the symptom');
    log('changed, then reset before trying the next.');
    return;
  }
  if (name === 'reset') {
    for (const s of Object.values(SUSPECTS)) { try { s.on(); } catch { /* ignore */ } }
    log('all suspects restored');
    return;
  }
  const s = SUSPECTS[name];
  if (!s) { log('unknown suspect:', name); suspect('list'); return; }
  const found = s.off();
  log(found ? `DISABLED: ${s.what}` : `not present right now: ${s.what}`);
  if (found) log('→ look at the canvas now. Better? Then this is (part of) the cause.');
}

/* ------------------------------------------------------------------ */
/* live probe                                                          */
/* ------------------------------------------------------------------ */

function probe() {
  const { svg, layer, group } = els();
  log('─── probe ─────────────────────────────────────────');
  log('content <g> attr :', group?.getAttribute('transform') || '(none)');
  log('layer transform  :', layer?.style.transform || '(none)');
  log('layer will-change:', layer ? getComputedStyle(layer).willChange : 'n/a');
  log('layer contain    :', layer ? getComputedStyle(layer).contain : 'n/a');
  log('svg client rect  :', svg ? JSON.stringify(svg.getBoundingClientRect().toJSON()) : 'n/a');
  log('flags            :', JSON.stringify({
    compositorZoom: window.__compositorZoom,
    orbitZoomMode: window.__orbitZoomMode,
    orbitFreeze: window.__orbitFreeze,
    orbitHz: window.__orbitHz,
    zoomRecommit: window.__zoomRecommit,
  }));
  log('───────────────────────────────────────────────────');
}

function help() {
  log('canvas diagnostics');
  log('  __diag.scan()            structural audit of the canvas render tree');
  log('  __diag.record(ms, label) record frame timings, then print a report');
  log('  __diag.writes(ms, label) count canvas DOM writes/sec, by element+attr');
  log('  __diag.probe()           live transform / layer / flag state');
  log('  __diag.wrapper(m)        "status" | "off" | "on" — A/B the gesture layer');
  log('  __diag.compare(ms)       record ON then OFF, same interaction both times');
  log('  __diag.suspect("list")   bisect: disable one suspect at a time  <-- START HERE');
  log('');
  log('fastest path: open orbit, then __diag.suspect("dimrect"). If the canvas');
  log('goes calm, the dim rect is the cause and the rest of this is noise.');
  log('');
  log('suggested run (paste the whole terminal output back):');
  log('  --- orbit OFF ---');
  log('  1) __diag.scan()');
  log('  2) __diag.record(5000,"idle")           touch nothing');
  log('  3) __diag.writes(3000,"idle")           touch nothing');
  log('  4) __diag.record(5000,"pan")            pan continuously');
  log('  --- orbit ON ---');
  log('  5) __diag.scan()');
  log('  6) __diag.record(5000,"orbit idle")     touch nothing');
  log('  7) __diag.writes(3000,"orbit idle")     touch nothing  <-- key number');
  log('  8) __diag.record(5000,"orbit pan")      pan continuously');
  log('  --- isolate the new wrapper ---');
  log('  9) __diag.wrapper("off") then repeat 6-8');
}

if (typeof window !== 'undefined') {
  window.__diag = { help, scan, record, writes, probe, wrapper, compare, suspect, els };
}

export default null;
