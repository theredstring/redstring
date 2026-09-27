/**
 * Auto-layout bench: lay out every corpus graph the way the app does, grade
 * what gets drawn, write the numbers down.
 *
 *   npm run bench:layout                               # baseline vs app
 *   LAYOUT_BENCH_CONFIGS=app,force,pattern npm run bench:layout
 *   LAYOUT_BENCH_LABEL=after-fix npm run bench:layout  # results/after-fix.json
 *   LAYOUT_BENCH_LARGE=1 npm run bench:layout          # + the 606-node stress web
 *   LAYOUT_BENCH_ONLY=parse-tree npm run bench:layout  # substring filter on case names
 *
 * Skipped unless LAYOUT_BENCH is set: a full run takes a minute or more, and
 * it produces a report, not a pass/fail.
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { withSeed, mulberry32 } from './env.js';
import { syntheticCases, realCases } from './corpus.js';
import { measureLayout, grade, renderSvg, SCORER_VERSION } from './metrics.js';
import { applyLayout, LAYOUT_ITERATION_PRESETS } from '../../src/services/graphLayoutService.js';
import { withEmptyGroupPlaceholders } from '../../src/services/groupLayout.js';

const RUN = !!process.env.LAYOUT_BENCH;
const LABEL = process.env.LAYOUT_BENCH_LABEL || 'latest';
const CONFIG_NAMES = (process.env.LAYOUT_BENCH_CONFIGS || 'baseline,app').split(',');
const ONLY = process.env.LAYOUT_BENCH_ONLY || '';
const SEEDS = Number(process.env.LAYOUT_BENCH_SEEDS || 1);

// What the store holds on a fresh install (graphStore getDefaultForceTunerSettings).
const STORED_TUNER = {
  repulsionStrength: 2200, attractionStrength: 0.05, linkDistance: 400, minLinkDistance: 280,
  centerStrength: 0.015, collisionRadius: 90, edgeAvoidance: 0.95, alphaDecay: 0.008, velocityDecay: 0.85
};
const EDGE_FONT = 71.28; // resolveEdgeLabelFontSize at default text settings
const GROUP_FONT = 45;

/** useGraphLayout's computeIterationBudget, restated (it is module-private). */
function iterationBudget(n, m, presetIterations) {
  const per = (n * n) / 2 + n * m;
  const rate = 12000 / (1 + (n / 400) ** 2);
  const affordable = per > 0 ? Math.floor((2500 * rate) / per) : presetIterations;
  const iterations = Math.max(80, Math.min(presetIterations, affordable));
  return { iterations, alphaDecay: 1 - 0.001 ** (1 / iterations) };
}

/**
 * The options object useGraphLayout builds, field for field, for a canvas of
 * the app's real size (NodeCanvas's canvasSize is 100000 square).
 */
function appOptions(c, overrides = {}) {
  const budget = iterationBudget(c.nodes.length, c.edges.length, LAYOUT_ITERATION_PRESETS.balanced.iterations);
  const layoutWidth = 100000, layoutHeight = 100000;
  return {
    width: layoutWidth,
    height: layoutHeight,
    padding: Math.max(300, Math.min(layoutWidth, layoutHeight) * 0.08),
    layoutScale: 'balanced',
    layoutScaleMultiplier: 1,
    iterationPreset: 'balanced',
    iterations: budget.iterations,
    alphaDecay: budget.alphaDecay,
    useExistingPositions: (c.groups || []).length === 0,
    groups: c.groups || [],
    edgeLabelFontSize: EDGE_FONT,
    groupLabelFontSize: GROUP_FONT,
    groupLabelScale: 1,
    gridSize: 200,
    routingStyle: 'straight',
    lombardiCurvature: 1,
    solver: 'force',
    ...STORED_TUNER,
    ...overrides
  };
}

/** applyOffscreenLayout's call (the wizard / AI path), field for field. */
function offscreenOptions(c) {
  return {
    width: 2000, height: 2000, padding: 300, useExistingPositions: false,
    groups: c.groups || [], edgeLabelFontSize: EDGE_FONT, groupLabelFontSize: GROUP_FONT,
    groupLabelScale: 1, gridSize: 200, routingStyle: 'straight', lombardiCurvature: 1
  };
}

export const CONFIGS = {
  // What the Auto Layout button runs today (store default 'best').
  app: { algorithm: 'best', options: {} },
  // The pre-bench default: force solver alone, no label repair. The baseline
  // every grade in the README is measured against.
  baseline: { algorithm: 'node-driven', options: { labelRepair: false } },
  // Single solvers, each finished by the repair (the portfolio's candidates).
  force: { algorithm: 'node-driven', options: {} },
  pattern: { algorithm: 'pattern', options: {} },
  community: { algorithm: 'community', options: {} },
  stress: { algorithm: 'node-driven', options: { solver: 'stress' } },
  offscreen: { algorithm: 'best', build: offscreenOptions },
  // Routed styles (no repair — it models straight connections only).
  lombardi: { algorithm: 'pattern', options: { routingStyle: 'lombardi' } },
  // Legacy shapes, for reference.
  hierarchical: { algorithm: 'hierarchical', options: {} },
  radial: { algorithm: 'radial', options: {} },
  circular: { algorithm: 'circular', options: {} },
  grid: { algorithm: 'grid', options: {} }
};

/** Synthetic graphs arrive at the origin; scatter them the way a paste or wizard run would. */
function initialPositions(c, seed) {
  if (c.kind === 'real') return c.nodes;
  const rnd = mulberry32(seed * 7919 + c.nodes.length);
  const span = 400 * Math.sqrt(c.nodes.length);
  return c.nodes.map(n => ({ ...n, x: Math.round(rnd() * span), y: Math.round(rnd() * span) }));
}

function runCase(c, configName, seed) {
  const cfg = CONFIGS[configName];
  const placed = initialPositions(c, seed);
  const aug = withEmptyGroupPlaceholders(placed, c.groups || [], (id) => {
    const n = c.nodes.find(x => x.id === id);
    return n ? { currentWidth: n.width, currentHeight: n.height } : null;
  });
  const cc = { ...c, nodes: aug.nodes, groups: aug.groups };
  const options = cfg.build ? cfg.build(cc) : appOptions(cc, cfg.options);
  const t0 = performance.now();
  const updates = withSeed(seed, () => applyLayout(aug.nodes, c.edges, cfg.algorithm, options));
  const ms = performance.now() - t0;
  const positions = new Map(aug.nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  updates.forEach(u => positions.set(u.instanceId, { x: u.x, y: u.y }));
  const raw = measureLayout(cc, positions, { fontSize: EDGE_FONT, groupLabelFontSize: GROUP_FONT, gridSize: 200 });
  const g = grade(raw);
  if (process.env.LAYOUT_BENCH_SVG) {
    const dir = path.join(__dirname, 'results', 'svg', LABEL);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${configName}-${c.name.replace(/[^a-z0-9-]/gi, '_')}.svg`), renderSvg(cc, positions, { fontSize: EDGE_FONT, groupLabelFontSize: GROUP_FONT, gridSize: 200 }));
  }
  return { case: c.name, config: configName, seed, ms: Math.round(ms), grade: +g.grade.toFixed(2), sub: g.sub, raw };
}

const fmt = (v, d = 2) => (v === null || v === undefined ? '  -  ' : typeof v === 'number' ? v.toFixed(d) : String(v));

describe.skipIf(!RUN)('layout bench', () => {
  it('grades the corpus', () => {
    const cases = [...syntheticCases(), ...realCases({ includeLarge: !!process.env.LAYOUT_BENCH_LARGE })]
      .filter(c => !ONLY || ONLY.split(',').some(s => c.name.includes(s)));
    const results = [];
    const quiet = { log: console.log, warn: console.warn };
    for (const cfg of CONFIG_NAMES) {
      for (const c of cases) {
        for (let s = 1; s <= SEEDS; s++) {
          console.log = () => {}; console.warn = () => {};
          let r;
          try { r = runCase(c, cfg, s); } catch (err) {
            r = { case: c.name, config: cfg, seed: s, error: String(err?.stack || err).slice(0, 400), grade: 0 };
          } finally { console.log = quiet.log; console.warn = quiet.warn; }
          results.push(r);
        }
      }
    }

    // ── Report ─────────────────────────────────────────────────────────────
    const lines = [];
    const cols = ['grade', 'n', 'm', 'nodeOv', 'edgeThru', 'cross', 'lblLbl', 'lblNode', 'lblEdge', 'crowd', 'chars%', 'grpOv', 'foreign', 'edgeGrp', 'silh', 'proxV', 'stress', 'ink', 'ms'];
    lines.push(['config', 'case'.padEnd(26), ...cols.map(c => c.padStart(7))].join(' '));
    results.forEach(r => {
      if (r.error) { lines.push(`${r.config.padEnd(6)} ${r.case.padEnd(26)} ERROR ${r.error.split('\n')[0]}`); return; }
      const x = r.raw;
      const row = [r.grade, x.n, x.m, x.nodeOverlaps, x.edgeThroughNode, x.crossings, x.labelLabel, x.labelNode, x.labelEdge,
        x.labelCrowded, x.labelCharsShown === null ? null : 100 * x.labelCharsShown, x.groupOverlaps, x.foreignInGroup,
        x.edgeThroughGroup, x.silhouette, x.proximityViolations, x.stress, x.inkDensity, r.ms];
      lines.push([r.config.padEnd(6), r.case.slice(0, 26).padEnd(26), ...row.map((v, i) => fmt(v, [0, 1, 2].includes(i) ? (i === 0 ? 1 : 0) : (Number.isInteger(v) ? 0 : 2)).padStart(7))].join(' '));
    });
    const summary = {};
    CONFIG_NAMES.forEach(cfg => {
      const rs = results.filter(r => r.config === cfg);
      const mean = (k) => rs.reduce((s, r) => s + (r[k] ?? 0), 0) / Math.max(1, rs.length);
      const sumRaw = (k) => rs.reduce((s, r) => s + (r.raw?.[k] ?? 0), 0);
      summary[cfg] = {
        meanGrade: +mean('grade').toFixed(2),
        minGrade: +Math.min(...rs.map(r => r.grade)).toFixed(2),
        hard: {
          nodeOverlaps: sumRaw('nodeOverlaps'), edgeThroughNode: sumRaw('edgeThroughNode'),
          labelLabel: sumRaw('labelLabel'), labelNode: sumRaw('labelNode'), labelEdge: sumRaw('labelEdge'),
          groupOverlaps: sumRaw('groupOverlaps'), foreignInGroup: sumRaw('foreignInGroup')
        },
        crossings: sumRaw('crossings'), labelCrowded: sumRaw('labelCrowded'), labelsTruncated: sumRaw('labelsTruncated'),
        totalMs: rs.reduce((s, r) => s + (r.ms || 0), 0)
      };
      lines.push(`\n[${cfg}] mean grade ${summary[cfg].meanGrade}  min ${summary[cfg].minGrade}  ${JSON.stringify(summary[cfg].hard)}  crossings ${summary[cfg].crossings}  crowded ${summary[cfg].labelCrowded}  truncated ${summary[cfg].labelsTruncated}  ${summary[cfg].totalMs}ms`);
    });
    console.log('\n' + lines.join('\n'));

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${LABEL}.json`), JSON.stringify({ label: LABEL, scorer: SCORER_VERSION, date: new Date().toISOString(), summary, results }, null, 1));
  }, 30 * 60 * 1000);
});
