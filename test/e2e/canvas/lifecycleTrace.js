// Lifecycle trace recorder for the pie / carousel / control-panel machine
// (P5.02 step 0; the field list is P5.02a §7 step 0).
//
//   const trace = await startLifecycleTrace(page);
//   … drive the flow …
//   const snaps = await trace.stop();   // the sequence of DISTINCT snapshots
//
// In the page it imports /src/store/canvasUIStore.js (the same module instance
// the app uses, as helpers.js does) and takes a snapshot
//   - synchronously on every canvasUIStore change (so every intermediate store
//     state is seen, in the order the app writes it), and
//   - once per requestAnimationFrame (so DOM-only facts — panel mount and
//     animation class, pie bubble classes — are seen as they are painted).
// Consecutive identical snapshots are collapsed and there are no timestamps, so
// two runs of the same scenario on the same code give the same sequence, as
// long as the scenario lets the lifecycle settle between steps (waitForQuiet).
// Checked for every scenario in lifecycleScenarios.js (reports/P5.02-step0.md).
// The frame-only stream (`stop({ source: 'frame' })`) is NOT byte-stable: where
// independent timers end within a frame or two of each other (the carousel exit
// tail: 300 ms exit guard, panel fly-out, pie pop), a short state is painted
// for one, two or three frames depending on the run.
//
// Ids that did not exist when the trace started (e.g. a concept added from the
// carousel) are random uuids; they are renamed `new:1`, `new:2`… in order of
// first appearance so traces stay comparable across runs.
//
// Not observable here (NodeCanvas locals, not in any store or the DOM):
// isPieMenuActionInProgress (click guard), carouselExitInProgressRef,
// pendingSwapOperation, pendingCarouselReturnFocusRef, carouselCloseRequestedRef,
// carouselClosedByClickAwayRef, pieMenuPage, carouselFocusedNode (the DOM shows
// the focused level: carouselFocus), and the panels' …ShouldShow / …Visible
// latches (the DOM shows the result: mounted + its animation class).

/** Field order of a snapshot; also documents what each one is. */
export const LIFECYCLE_FIELDS = [
  'activeGraphId', //         graphStore.activeGraphId
  'pieTarget', //             selectedNodeIdForPieMenu
  'transitioning', //         isTransitioningPieMenu
  'pieRendered', //           isPieMenuRendered
  'pieDataNodeId', //         currentPieMenuData?.node?.id
  'stage', //                 carouselPieMenuStage
  'stageFlag', //             isCarouselStageTransition
  'pendingAbstraction', //    pendingAbstractionNodeId
  'pendingDecompose', //      pendingDecomposeNodeId
  'previewing', //            previewingNodeId
  'carouselVisible', //       abstractionCarouselVisible
  'carouselNodeId', //        abstractionCarouselNode?.id
  'carouselAnim', //          carouselAnimationState
  'exitGuard', //             justCompletedCarouselExit
  'promptVisible', //         abstractionPrompt.visible
  'selection', //             [...selectedInstanceIds].sort()
  // DOM
  'panels', //                { node, group, connection, abstraction }: null | '<mode>:<entering|visible|exiting>'
  'pies', //                  per g.pie-menu: '<bubble phase classes joined by +> x<bubble count>'
  'carouselLevels', //        number of [data-carousel-level] entries rendered
  'carouselFocus', //         the level drawn at full opacity (the focused one), or null mid-step
];

/**
 * Start recording. Returns `{ stop(opts?) }`; `stop()` resolves to the
 * distinct-snapshot sequence (store writes and frames). `stop({ source:
 * 'frame' })` returns only the painted states: per-frame samples that held for
 * at least two consecutive frames, collapsed the same way. `stop({ raw: true })`
 * returns `{ all, frame }`.
 */
export async function startLifecycleTrace(page) {
  await page.evaluate(async (fields) => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    const gs = window.useGraphStore;
    if (window.__lifecycleTrace) window.__lifecycleTrace.dispose();

    // Ids present at the start keep their names; later ones are renamed.
    const known = new Set();
    const g0 = gs.getState();
    for (const [gid, g] of g0.graphs) {
      known.add(gid);
      for (const iid of g.instances?.keys?.() || []) known.add(iid);
    }
    for (const pid of g0.nodePrototypes.keys()) known.add(pid);
    const renamed = new Map();
    const norm = (id) => {
      if (id == null) return null;
      if (known.has(id)) return id;
      if (!renamed.has(id)) renamed.set(id, `new:${renamed.size + 1}`);
      return renamed.get(id);
    };

    const PANEL_SEL = {
      node: '.unified-bottom-panel.mode-nodes, .unified-bottom-panel.mode-decompose',
      group: '.unified-bottom-panel.mode-group, .unified-bottom-panel.mode-nodegroup',
      connection: '.unified-bottom-panel.mode-connections',
      abstraction: '.unified-bottom-panel.abstraction-control-panel',
    };
    const panelState = (sel) => {
      const els = document.querySelectorAll(sel);
      if (!els.length) return null;
      return [...els].map((el) => {
        const mode = [...el.classList].find((c) => c.startsWith('mode-'))?.slice(5) || '?';
        const anim = ['entering', 'visible', 'exiting'].find((c) => el.classList.contains(c)) || 'mounted';
        return `${mode}:${anim}`;
      }).join(',');
    };
    const BUBBLE = ['is-popping', 'is-shrinking', 'is-visible-steady', 'is-page-out', 'is-page-in', 'is-entering'];
    const pieState = (pm) => {
      const bubbles = pm.querySelectorAll('.pie-menu-bubble-inner');
      const phases = new Set();
      bubbles.forEach((b) => { for (const c of BUBBLE) if (b.classList.contains(c)) phases.add(c.slice(3)); });
      return `${[...phases].sort().join('+') || 'none'} x${bubbles.length}`;
    };

    const focusOf = (levels) => {
      const full = levels.filter((g) => Number(getComputedStyle(g).opacity) > 0.99);
      return full.length === 1 ? Number(full[0].getAttribute('data-carousel-level')) : null;
    };

    const snap = () => {
      const s = ui.getState();
      const levels = [...document.querySelectorAll('[data-carousel-level]')];
      const values = {
        activeGraphId: norm(gs.getState().activeGraphId),
        pieTarget: norm(s.selectedNodeIdForPieMenu),
        transitioning: !!s.isTransitioningPieMenu,
        pieRendered: !!s.isPieMenuRendered,
        pieDataNodeId: norm(s.currentPieMenuData?.node?.id ?? null),
        stage: s.carouselPieMenuStage,
        stageFlag: !!s.isCarouselStageTransition,
        pendingAbstraction: norm(s.pendingAbstractionNodeId),
        pendingDecompose: norm(s.pendingDecomposeNodeId),
        previewing: norm(s.previewingNodeId),
        carouselVisible: !!s.abstractionCarouselVisible,
        carouselNodeId: norm(s.abstractionCarouselNode?.id ?? null),
        carouselAnim: s.carouselAnimationState,
        exitGuard: !!s.justCompletedCarouselExit,
        promptVisible: !!s.abstractionPrompt?.visible,
        selection: [...(s.selectedInstanceIds || [])].map(norm).sort(),
        panels: Object.fromEntries(Object.entries(PANEL_SEL).map(([k, sel]) => [k, panelState(sel)])),
        pies: [...document.querySelectorAll('svg.canvas g.pie-menu')].map(pieState),
        carouselLevels: levels.length,
        carouselFocus: focusOf(levels),
      };
      // Fixed key order, so equal states serialise identically.
      const out = {};
      for (const f of fields) out[f] = values[f];
      return out;
    };

    const streams = { all: [], frame: [] };
    const push = (list, s) => {
      const key = JSON.stringify(s);
      if (list.length && list[list.length - 1].key === key) return;
      list.push({ key, s });
    };
    // The frame stream keeps only states seen by at least two consecutive
    // frames. A state that lasts less than about a frame (e.g. the store has
    // written pie data but React has not mounted the menu yet) is caught by a
    // frame sample only sometimes; every animation-driven state lasts ≥100 ms.
    let run = null; // { key, s, n }
    const flushRun = (minFrames) => { if (run && run.n >= minFrames) push(streams.frame, run.s); };
    const record = (source) => {
      const s = snap();
      push(streams.all, s);
      if (source !== 'frame') return;
      const key = JSON.stringify(s);
      if (run && run.key === key) { run.n += 1; return; }
      flushRun(2);
      run = { key, s, n: 1 };
    };

    let running = true;
    const unsubscribe = ui.subscribe(() => { if (running) record('store'); });
    const tick = () => { if (!running) return; record('frame'); requestAnimationFrame(tick); };
    record('frame');
    requestAnimationFrame(tick);

    window.__lifecycleTrace = {
      streams,
      // The last frame state is kept whatever its length (the scenario ended
      // on it after waiting for the lifecycle to settle).
      dispose() { if (running) flushRun(1); running = false; unsubscribe(); },
    };
  }, LIFECYCLE_FIELDS);

  return {
    async stop({ source = 'all', raw = false } = {}) {
      const res = await page.evaluate(() => {
        const t = window.__lifecycleTrace;
        if (!t) return null;
        t.dispose();
        window.__lifecycleTrace = null;
        return { all: t.streams.all.map((e) => e.s), frame: t.streams.frame.map((e) => e.s) };
      });
      if (!res) throw new Error('lifecycle trace was not running (did the page navigate?)');
      if (raw) return res;
      return source === 'frame' ? res.frame : res.all;
    },
  };
}

/**
 * Wait until the running trace has recorded nothing new for `quietMs` (the
 * lifecycle has settled: animations ended, guard timers fired). Scenarios call
 * this between steps so each step starts from a settled state, which is what
 * makes two runs give the same sequence.
 */
export async function waitForQuiet(page, { quietMs = 500, timeout = 10_000 } = {}) {
  const deadline = Date.now() + timeout;
  const len = () => page.evaluate(() => window.__lifecycleTrace?.streams.all.length ?? -1);
  let last = await len();
  let since = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(50);
    const cur = await len();
    if (cur !== last) { last = cur; since = Date.now(); } else if (Date.now() - since >= quietMs) return;
  }
  throw new Error('lifecycle did not settle');
}

// ---- helpers for asserting on a trace ------------------------------------

/** Index of the first snapshot at or after `from` that matches `pred`, or -1. */
export function findIndex(trace, pred, from = 0) {
  for (let i = from; i < trace.length; i++) if (pred(trace[i])) return i;
  return -1;
}

/**
 * Assert that snapshots matching each predicate occur in this order (each at or
 * after the previous match, the first at or after `start`). Returns the matched
 * indexes. `preds` is a list of [label, predicate].
 */
export function expectInOrder(expect, trace, preds, start = 0) {
  const idx = [];
  let from = start;
  for (const [label, pred] of preds) {
    const i = findIndex(trace, pred, from);
    expect(i, `trace: "${label}" should occur after [${idx.join(',')}]\n${summarize(trace)}`).toBeGreaterThanOrEqual(0);
    idx.push(i);
    from = i;
  }
  return idx;
}

/**
 * Compare a fresh trace with a baseline under the "states may only disappear"
 * rule: `fresh` must be a subsequence of `baseline` (same first and last
 * state; no state the baseline never had; baseline order kept). Returns
 * `{ ok, message, dropped }`, where `dropped` lists the baseline states the
 * fresh trace skipped — to be reviewed (were any of them painted?), not
 * accepted blindly.
 */
export function compareTraces(baseline, fresh) {
  const key = (s) => JSON.stringify(s);
  const dropped = [];
  let j = 0;
  for (let i = 0; i < fresh.length; i++) {
    const k = key(fresh[i]);
    while (j < baseline.length && key(baseline[j]) !== k) dropped.push(baseline[j++]);
    if (j >= baseline.length) {
      return { ok: false, message: `fresh state #${i} is not in the baseline (or is out of order):\n${summarize([fresh[i]])}`, dropped };
    }
    j++;
  }
  while (j < baseline.length) dropped.push(baseline[j++]);
  if (!fresh.length || key(fresh[0]) !== key(baseline[0])) return { ok: false, message: 'first state differs', dropped };
  if (key(fresh[fresh.length - 1]) !== key(baseline[baseline.length - 1])) return { ok: false, message: 'final state differs', dropped };
  return { ok: true, message: dropped.length ? `${dropped.length} intermediate states dropped` : 'identical', dropped };
}

/** A compact one-line-per-snapshot view, for failure messages and reports. */
export function summarize(trace) {
  return trace.map((s, i) => {
    const p = s.panels || {};
    const panels = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' ');
    return `${String(i).padStart(3)} tgt=${s.pieTarget} tr=${+s.transitioning} rend=${+s.pieRendered} data=${s.pieDataNodeId} `
      + `st=${s.stage}${s.stageFlag ? '!' : ''} pA=${s.pendingAbstraction} pD=${s.pendingDecompose} prev=${s.previewing} `
      + `cx=${+s.carouselVisible}/${s.carouselAnim}${s.exitGuard ? '/guard' : ''} lv=${s.carouselLevels}@${s.carouselFocus} prompt=${+s.promptVisible} `
      + `sel=[${s.selection}] pies=[${s.pies || ''}] ${panels} g=${s.activeGraphId}`;
  }).join('\n');
}
