/**
 * The graphs the bench grades.
 *
 * Synthetic cases are generated from a fixed seed, so the corpus is identical
 * on every run. Each one exists to exercise a specific failure the user named
 * or a special path the layout code takes (a pattern dispatcher branch, the
 * group pipeline, the anchor/title-tab rule, isolated-node packing, parallel
 * connections). Real cases come from the committed canvas fixtures, plus the
 * local-only chambers universe when it is present on this machine (it is
 * personal content and never committed — see test/fixtures/canvas/.gitignore).
 */
import fs from 'fs';
import path from 'path';
import './env.js';
import { mulberry32 } from './env.js';
import { getNodeDimensions } from '../../src/utils.js';
import { importFromRedstring } from '../../src/formats/redstringFormat.js';
import { buildParseGraph, buildNestedGroupWeb } from '../../src/services/__tests__/layoutHelpers.js';

const ROOT = path.resolve(__dirname, '../..');

// Names a real universe would hold: short, medium, and long, mixed.
const WORDS = [
  'Cell', 'Mitochondrion', 'ATP', 'Enzyme', 'Membrane', 'Nucleus', 'Ribosome', 'Protein folding',
  'Signal transduction', 'Oxidative stress', 'Glucose', 'Krebs cycle', 'DNA repair', 'Apoptosis',
  'Lipid bilayer', 'Receptor', 'Ion channel', 'Cytoskeleton', 'Golgi apparatus', 'Vesicle',
  'Hormone', 'Insulin', 'Kinase', 'Phosphatase', 'Transcription factor', 'Gene expression',
  'Epigenetics', 'Chromatin', 'Histone', 'RNA polymerase', 'Codon', 'tRNA', 'Peptide bond',
  'Chaperone', 'Proteasome', 'Ubiquitin', 'Autophagy', 'Lysosome', 'Endoplasmic reticulum', 'Calcium'
];
const RELATIONS = [
  'is a', 'part of', 'causes', 'inhibits', 'produces', 'regulates', 'binds to', 'requires',
  'is located in', 'is composed of', 'activates', 'transports', 'is precursor of',
  'is a necessary precondition for', 'depends on', 'contributes to'
];

/** Size a node the way the canvas does. */
const sized = (id, name) => {
  const d = getNodeDimensions({ name }, false, null);
  return { id, name, width: d.currentWidth, height: d.currentHeight, labelWidth: d.currentWidth, labelHeight: d.currentHeight, x: 0, y: 0 };
};

const mkEdge = (s, t, name, i = 0) => ({ id: `${s}->${t}#${i}`, sourceId: s, destinationId: t, name, directionality: { arrowsToward: [t] } });

function synthetic(name, seed, build) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const nameFor = (i) => `${pick(WORDS)}${i % 3 === 0 ? '' : ` ${i}`}`;
  return { name, kind: 'synthetic', ...build({ rnd, pick, nameFor }) };
}

/** Planted-partition graph: dense inside communities, sparse bridges between. */
function planted(k, size, pIn, bridges, seed, labelled = true) {
  return synthetic(`communities-${k}x${size}`, seed, ({ rnd, pick, nameFor }) => {
    const nodes = [], edges = [], clusters = new Map();
    for (let c = 0; c < k; c++) {
      const ids = [];
      for (let i = 0; i < size; i++) {
        const id = `c${c}n${i}`;
        nodes.push(sized(id, nameFor(c * size + i)));
        clusters.set(id, `k${c}`);
        ids.push(id);
      }
      // A spanning chain keeps each community connected, then random chords.
      for (let i = 1; i < ids.length; i++) edges.push(mkEdge(ids[i - 1], ids[i], labelled ? pick(RELATIONS) : ''));
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 2; j < ids.length; j++) if (rnd() < pIn) edges.push(mkEdge(ids[i], ids[j], labelled ? pick(RELATIONS) : ''));
      }
    }
    for (let b = 0; b < bridges; b++) {
      const c1 = b % k, c2 = (b + 1) % k;
      if (c1 === c2) continue;
      edges.push(mkEdge(`c${c1}n${Math.floor(rnd() * size)}`, `c${c2}n${Math.floor(rnd() * size)}`, labelled ? pick(RELATIONS) : ''));
    }
    return { nodes, edges, clusters };
  });
}

export function syntheticCases() {
  const cases = [];

  // The sentence diagram: 4x node-width variance, a long label on every edge.
  {
    const g = buildParseGraph();
    cases.push({
      name: 'parse-tree', kind: 'synthetic',
      nodes: g.nodes.map(n => sized(n.id, n.id)),
      edges: g.edges.map((e, i) => ({ ...e, id: `${e.id}#${i}`, directionality: { arrowsToward: [e.destinationId] } }))
    });
  }

  cases.push(planted(2, 8, 0.35, 2, 11));
  cases.push(planted(4, 6, 0.4, 5, 12));
  cases.push(planted(3, 10, 0.25, 4, 13));

  // Disconnected pieces of every shape, plus loose nodes.
  cases.push(synthetic('components-mixed', 21, ({ pick, nameFor }) => {
    const nodes = [], edges = [];
    let i = 0;
    const add = () => { const id = `n${i}`; nodes.push(sized(id, nameFor(i))); i++; return id; };
    const chain = [add(), add(), add(), add()];
    for (let k = 1; k < chain.length; k++) edges.push(mkEdge(chain[k - 1], chain[k], pick(RELATIONS)));
    const hub = add();
    for (let k = 0; k < 5; k++) edges.push(mkEdge(hub, add(), pick(RELATIONS)));
    const tri = [add(), add(), add()];
    edges.push(mkEdge(tri[0], tri[1], pick(RELATIONS)), mkEdge(tri[1], tri[2], pick(RELATIONS)), mkEdge(tri[2], tri[0], pick(RELATIONS)));
    const pair = [add(), add()];
    edges.push(mkEdge(pair[0], pair[1], pick(RELATIONS)));
    add(); add(); add();
    return { nodes, edges };
  }));

  cases.push(synthetic('hub-star-14', 31, ({ pick, nameFor }) => {
    const nodes = [sized('hub', 'Central concept')], edges = [];
    for (let k = 0; k < 14; k++) { nodes.push(sized(`s${k}`, nameFor(k))); edges.push(mkEdge('hub', `s${k}`, pick(RELATIONS))); }
    return { nodes, edges };
  }));

  cases.push(synthetic('dense-10', 41, ({ rnd, pick, nameFor }) => {
    const nodes = [], edges = [];
    for (let k = 0; k < 10; k++) nodes.push(sized(`n${k}`, nameFor(k)));
    for (let a = 0; a < 10; a++) for (let b = a + 1; b < 10; b++) if (rnd() < 0.5) edges.push(mkEdge(`n${a}`, `n${b}`, pick(RELATIONS)));
    return { nodes, edges };
  }));

  cases.push(synthetic('cycle-8', 51, ({ pick, nameFor }) => {
    const nodes = [], edges = [];
    for (let k = 0; k < 8; k++) nodes.push(sized(`n${k}`, nameFor(k)));
    for (let k = 0; k < 8; k++) edges.push(mkEdge(`n${k}`, `n${(k + 1) % 8}`, pick(RELATIONS)));
    return { nodes, edges };
  }));

  cases.push(synthetic('lattice-4x4', 61, ({ nameFor }) => {
    const nodes = [], edges = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) nodes.push(sized(`n${r}_${c}`, nameFor(r * 4 + c)));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (c < 3) edges.push(mkEdge(`n${r}_${c}`, `n${r}_${c + 1}`, 'next to'));
      if (r < 3) edges.push(mkEdge(`n${r}_${c}`, `n${r + 1}_${c}`, 'above'));
    }
    return { nodes, edges };
  }));

  cases.push(synthetic('long-labels', 71, ({ nameFor }) => {
    const nodes = [], edges = [];
    const rel = ['is a necessary precondition for', 'is historically associated with', 'was superseded in practice by', 'is frequently confused with'];
    for (let k = 0; k < 9; k++) nodes.push(sized(`n${k}`, nameFor(k)));
    for (let k = 1; k < 9; k++) edges.push(mkEdge(`n${Math.floor((k - 1) / 2)}`, `n${k}`, rel[k % rel.length]));
    return { nodes, edges };
  }));

  cases.push(synthetic('parallel-edges', 81, ({ nameFor }) => {
    const nodes = [], edges = [];
    for (let k = 0; k < 6; k++) nodes.push(sized(`n${k}`, nameFor(k)));
    edges.push(mkEdge('n0', 'n1', 'causes', 0), mkEdge('n0', 'n1', 'inhibits', 1), mkEdge('n1', 'n0', 'regulates', 2));
    edges.push(mkEdge('n1', 'n2', 'binds to', 0), mkEdge('n2', 'n1', 'activates', 1));
    edges.push(mkEdge('n2', 'n3', 'part of'), mkEdge('n3', 'n4', 'produces'), mkEdge('n4', 'n5', 'requires'), mkEdge('n5', 'n0', 'depends on'));
    return { nodes, edges };
  }));

  // Thing-groups (no anchor), bridged, with loose nodes around them.
  cases.push(synthetic('groups-flat-3', 91, ({ rnd, pick, nameFor }) => {
    const nodes = [], edges = [], groups = [];
    let i = 0;
    for (let g = 0; g < 3; g++) {
      const ids = [];
      for (let k = 0; k < 4 + g; k++) { const id = `n${i}`; nodes.push(sized(id, nameFor(i))); ids.push(id); i++; }
      for (let k = 1; k < ids.length; k++) edges.push(mkEdge(ids[k - 1], ids[k], pick(RELATIONS)));
      if (ids.length > 3) edges.push(mkEdge(ids[0], ids[2], pick(RELATIONS)));
      groups.push({ id: `G${g}`, name: `${pick(WORDS)} group`, memberInstanceIds: ids });
    }
    for (let k = 0; k < 3; k++) { const id = `n${i}`; nodes.push(sized(id, nameFor(i))); i++; edges.push(mkEdge(id, `n${Math.floor(rnd() * 10)}`, pick(RELATIONS))); }
    edges.push(mkEdge('n0', 'n5', pick(RELATIONS)), mkEdge('n6', 'n11', pick(RELATIONS)));
    return { nodes, edges, groups };
  }));

  // Node-groups nested three deep: anchors as title tabs, propagated membership.
  {
    const g = buildNestedGroupWeb({ depth: 2, branch: 3, leaves: 3 });
    cases.push({
      name: 'node-groups-nested', kind: 'synthetic',
      nodes: g.nodes.map(n => sized(n.id, n.id.startsWith('a') ? `Group ${n.id.slice(1)}` : `Item ${n.id.slice(1)}`)),
      edges: g.edges.map((e, i) => ({ ...e, id: `${e.id}#${i}` })),
      groups: g.groups
    });
  }

  // Two groups, two free clusters, a singleton group, one isolated node.
  cases.push(synthetic('groups-and-clusters', 101, ({ pick, nameFor }) => {
    const nodes = [], edges = [], groups = [];
    let i = 0;
    const add = () => { const id = `n${i}`; nodes.push(sized(id, nameFor(i))); i++; return id; };
    const ga = [add(), add(), add(), add()];
    const gb = [add(), add(), add()];
    ga.slice(1).forEach((id, k) => edges.push(mkEdge(ga[k], id, pick(RELATIONS))));
    gb.slice(1).forEach((id, k) => edges.push(mkEdge(gb[k], id, pick(RELATIONS))));
    groups.push({ id: 'GA', name: 'First group', memberInstanceIds: ga }, { id: 'GB', name: 'Second group', memberInstanceIds: gb });
    const c1 = [add(), add(), add(), add(), add()];
    c1.slice(1).forEach((id) => edges.push(mkEdge(c1[0], id, pick(RELATIONS))));
    const c2 = [add(), add(), add()];
    edges.push(mkEdge(c2[0], c2[1], pick(RELATIONS)), mkEdge(c2[1], c2[2], pick(RELATIONS)));
    const solo = add();
    groups.push({ id: 'GS', name: 'Singleton', memberInstanceIds: [solo] });
    add();
    edges.push(mkEdge(ga[0], gb[0], pick(RELATIONS)));
    return { nodes, edges, groups };
  }));

  return cases;
}

// ============================================================================
// REAL UNIVERSES
// ============================================================================

const resolveEdgeName = (edge, protos, edgeProtos) => {
  if (edge.connectionName) return edge.connectionName;
  if (edge.definitionNodeIds?.length) { const p = protos.get(edge.definitionNodeIds[0]); if (p?.name) return p.name; }
  if (edge.typeNodeId) { const p = edgeProtos?.get(edge.typeNodeId); if (p?.name) return p.name; }
  return '';
};

function casesFromUniverse(file, label, pickGraph) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return [];
  const origLog = console.log;
  console.log = () => {};
  let storeState;
  try { ({ storeState } = importFromRedstring(JSON.parse(fs.readFileSync(full, 'utf8')))); } finally { console.log = origLog; }
  const out = [];
  for (const [gid, g] of storeState.graphs) {
    if (!pickGraph(g, gid)) continue;
    const nodes = [];
    for (const inst of g.instances.values()) {
      const proto = storeState.nodePrototypes.get(inst.prototypeId);
      if (!proto) continue;
      const d = getNodeDimensions({ ...proto, ...inst }, false, null);
      nodes.push({ id: inst.id, name: proto.name, width: d.currentWidth, height: d.currentHeight, labelWidth: d.currentWidth, labelHeight: d.currentHeight, imageHeight: d.calculatedImageHeight || 0, x: inst.x || 0, y: inst.y || 0 });
    }
    const ids = new Set(nodes.map(n => n.id));
    const edges = (g.edgeIds || []).map(id => storeState.edges.get(id)).filter(e => e && ids.has(e.sourceId) && ids.has(e.destinationId))
      .map(e => ({ id: e.id, sourceId: e.sourceId, destinationId: e.destinationId, name: resolveEdgeName(e, storeState.nodePrototypes, storeState.edgePrototypes), directionality: { arrowsToward: [...(e.directionality?.arrowsToward || [])] } }));
    const groups = Array.from(g.groups?.values() || []).map(gr => ({ ...gr, memberInstanceIds: (gr.memberInstanceIds || []).filter(id => ids.has(id)) }));
    out.push({ name: `${label}:${gid.slice(-6)}`, kind: 'real', nodes, edges, groups });
  }
  return out;
}

export function realCases({ includeLarge = false } = {}) {
  const cases = [];
  cases.push(...casesFromUniverse('test/fixtures/canvas/small.redstring', 'small', (g) => g.instances?.size >= 6));
  if (includeLarge) cases.push(...casesFromUniverse('test/fixtures/canvas/stress.redstring', 'stress', (g) => g.instances?.size >= 500));
  // Local-only: the richest real-world grouped graphs we have. Selected by
  // shape, not by name, so no personal content is written into the corpus.
  const local = casesFromUniverse('test/fixtures/canvas/local/claudes-chambers.redstring', 'chambers', (g) => {
    const n = g.instances?.size || 0, e = (g.edgeIds || []).length;
    return n >= 15 && n <= 60 && e >= 9;
  });
  cases.push(...local);
  return cases;
}
