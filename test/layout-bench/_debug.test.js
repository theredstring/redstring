import { it } from 'vitest';
import './env.js';
import { realCases } from './corpus.js';
import { measureLayout, grade } from './metrics.js';
import { applyLayout } from '../../src/services/graphLayoutService.js';
import { repairLayout, explainScene } from '../../src/services/layoutRepair.js';
import { withEmptyGroupPlaceholders } from '../../src/services/groupLayout.js';
it('debug', () => {
  for (const name of ['chambers:953466']) {
    const c0 = realCases().find(x => x.name === name);
    const aug = withEmptyGroupPlaceholders(c0.nodes, c0.groups, (id) => { const n = c0.nodes.find(x => x.id === id); return n ? { currentWidth: n.width, currentHeight: n.height } : null; });
    const c = { ...c0, nodes: aug.nodes, groups: aug.groups };
    const base = { width: 100000, height: 100000, padding: 8000, groups: c.groups, edgeLabelFontSize: 71.28, groupLabelFontSize: 45, gridSize: 200, useExistingPositions: !c.groups.length, iterations: 600, alphaDecay: 0.008 };
    for (const [alg, extra] of [['node-driven', {}], ['node-driven', { useExistingPositions: false }], ['pattern', {}], ['community', {}]]) {
      const log = console.log; console.log = () => {};
      const up = applyLayout(c.nodes, c.edges, alg, { ...base, ...extra, labelRepair: false });
      console.log = log;
      const pos = new Map(up.map(u => [u.instanceId, { x: u.x, y: u.y }]));
      const r = repairLayout(pos, c.nodes, c.edges, { ...base, ...extra });
      const g = grade(measureLayout(c, r.positions, {}));
      const ex = explainScene(r.positions, c.nodes, c.edges, { ...base, ...extra });
      const agg = {}; ex.forEach(e => { agg[e.what] = +((agg[e.what] || 0) + e.cost).toFixed(1); });
      const ex0 = explainScene(pos, c.nodes, c.edges, { ...base, ...extra });
      const sum = (a) => a.reduce((t, e) => t + e.cost, 0).toFixed(1);
      console.log('EXPLAIN', alg, JSON.stringify(agg), 'explainBefore', sum(ex0), 'r.before', r.before.toFixed(1), 'explainAfter', sum(ex), 'r.after', r.after.toFixed(1), 'moves', r.moves);
      console.log(name, alg, JSON.stringify(extra), 'Q', r.quality.toFixed(3), 'cost', r.after.toFixed(1), 'grade', g.grade.toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(g.sub).filter(([k, v]) => v !== null && v < 0.9).map(([k, v]) => [k, +v.toFixed(2)]))));
    }
  }
});
