#!/usr/bin/env node
/**
 * gen-stress-fixture.mjs: deterministic generator for the committed canvas
 * fixtures (NodeCanvas refactor P0.02, DECISION D-15).
 *
 *   node scripts/gen-stress-fixture.mjs           # (re)write both fixtures
 *   node scripts/gen-stress-fixture.mjs --check   # exit 1 if a committed file is stale
 *
 * Writes:
 *   test/fixtures/canvas/small.redstring   about smoke-test size, shaped for the P0.03 flows
 *   test/fixtures/canvas/stress.redstring  ~600 nodes / ~1,000 edges, for finding scaling cliffs
 *
 * Both are real `.redstring` files. They are built by driving the real store
 * actions in the headless store (addNodePrototype, addNodeInstance, addEdge,
 * createGroup, convertGroupToNodeGroup, createNewGraph) and serialised with the
 * real `exportToRedstring`. Nothing is hand-assembled, so the shapes are the ones
 * the app itself produces, and loading them exercises the same import path as
 * opening a file.
 *
 * Determinism, so re-running produces byte-identical output:
 *   - Date is frozen at FIXED_TIME before any app module loads.
 *   - Math.random is replaced by a seeded PRNG.
 *   - Every ID this script chooses is explicit and readable (p-*, i-*, e-*).
 *   - The store still mints UUIDs internally (groups, node-group definition
 *     graphs and anchors, graph-defining prototypes). Those are renamed after
 *     export, in order of first appearance, to fixed v4-shaped UUIDs. Export
 *     order follows Map insertion order, which is itself deterministic.
 *
 * The local-only "chambers" fixture is NOT produced here; it is a copy of a real
 * universe and never leaves Grant's machine (see D-15).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'test', 'fixtures', 'canvas');
const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Determinism shims. These must be installed before the store is imported.
// ---------------------------------------------------------------------------
const FIXED_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_TIME);
    else super(...args);
  }
  static now() { return FIXED_TIME; }
}
globalThis.Date = FrozenDate;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(0xC0FFEE);

// The store and format modules log freely. Keep the generator's output readable.
const log = console.log.bind(console);
const quiet = () => {};

async function loadApp() {
  console.log = quiet;
  console.warn = quiet;
  console.info = quiet;
  console.debug = quiet;
  const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
  const { exportToRedstring, importFromRedstring } = await import('../src/formats/redstringFormat.js');
  const { useGraphStore } = await createHeadlessStore();
  return { useGraphStore, exportToRedstring, importFromRedstring };
}

/** Wipe the singleton store back to an empty universe between fixtures. */
function resetStore(useGraphStore, baseline) {
  useGraphStore.setState({
    ...baseline,
    graphs: new Map(),
    graphViews: new Map(),
    edges: new Map(),
    nodePrototypes: new Map(baseline.nodePrototypes),
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
  });
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function canonicalizeUuids(text, namespaceNibble) {
  const map = new Map();
  return text.replace(UUID_RE, (m) => {
    const key = m.toLowerCase();
    if (!map.has(key)) {
      const n = map.size + 1;
      map.set(key, `00000000-0000-4000-8${namespaceNibble}00-${n.toString(16).padStart(12, '0')}`);
    }
    return map.get(key);
  });
}

/**
 * Pan that puts world (0,0) at container point (640, 350) at the given zoom:
 * the middle of the canvas area in a 1280x800 window (the canvas container
 * starts under the 50 px header). NodeCanvas maps
 *   world = (client - containerRect - pan) / zoom + canvasOffset
 * with canvasOffset = -50000 (canvasSize.offsetX/Y), so
 *   pan = point - (0 - canvasOffset) * zoom.
 */
function viewCentredOnOrigin(zoom) {
  const CANVAS_OFFSET = -50000;
  return { x: 640 + CANVAS_OFFSET * zoom, y: 350 + CANVAS_OFFSET * zoom };
}

// ---------------------------------------------------------------------------
// Small fixture: a handful of nodes laid out around world (0,0), which is the
// centre of the default view, so every flow target is on screen at zoom 1.
// ---------------------------------------------------------------------------
function buildSmall(store) {
  const S = () => store.getState();
  const THING = 'base-thing-prototype';

  // Graph B first: createNewGraph activates what it creates, so the last one
  // created (A) ends up active. Both stay open as header tabs (F15).
  S().createNewGraph({ id: 'g-small-b', name: 'Small Web B', color: '#4A5568' });
  S().createNewGraph({ id: 'g-small-a', name: 'Small Web A', color: '#8B0000' });

  const protos = [
    ['p-alpha', 'Alpha', '#8B0000'],
    ['p-beta', 'Beta', '#8B0000'],
    ['p-gamma', 'Gamma', '#6B2D5C'],
    ['p-delta', 'Delta', '#8B0000'],
    ['p-epsilon', 'Epsilon', '#2F4F4F'],
    ['p-zeta', 'Zeta', '#8B0000'],
    ['p-eta', 'Eta', '#6B2D5C'],
    ['p-theta', 'Theta', '#8B0000'],
    ['p-iota', 'Iota', '#2F4F4F'],
    ['p-lambda', 'Lambda', '#8B0000'],
    ['p-mu', 'Mu', '#6B2D5C'],
    ['p-nu', 'Nu', '#2F4F4F'],
    // Relation prototypes: named edge definitions, so labels have real text.
    ['p-rel-supports', 'supports', '#8B0000'],
    ['p-rel-causes', 'causes', '#8B0000'],
  ];
  for (const [id, name, color] of protos) {
    S().addNodePrototype({ id, name, color, description: '', typeNodeId: THING, definitionGraphIds: [] });
  }

  const A = 'g-small-a';
  // x/y are the node's top-left in world units; a node is roughly 210x130.
  // Left block: two rows of free nodes, then a plain group below them. Right:
  // a node-group. The lower right quarter is left empty on purpose, as a known
  // patch of bare canvas for pan, marquee and plus-sign flows.
  const placeA = [
    ['i-alpha', 'p-alpha', -760, -380],
    ['i-beta', 'p-beta', -380, -380],
    ['i-gamma', 'p-gamma', 0, -380],
    ['i-delta', 'p-delta', -760, -120],
    ['i-epsilon', 'p-epsilon', -380, -120],
    // Node-group members (right of centre).
    ['i-zeta', 'p-zeta', 420, -100],
    ['i-eta', 'p-eta', 700, -100],
    // Plain-group members (bottom left).
    ['i-theta', 'p-theta', -760, 200],
    ['i-iota', 'p-iota', -420, 200],
  ];
  for (const [iid, pid, x, y] of placeA) S().addNodeInstance(A, pid, { x, y }, iid);

  const edgesA = [
    ['e-alpha-beta', 'i-alpha', 'i-beta', 'p-rel-supports', true],
    ['e-beta-gamma', 'i-beta', 'i-gamma', null, true],
    ['e-alpha-delta', 'i-alpha', 'i-delta', null, false],
    ['e-delta-epsilon', 'i-delta', 'i-epsilon', 'p-rel-causes', true],
    ['e-epsilon-beta', 'i-epsilon', 'i-beta', null, false],
    ['e-theta-iota', 'i-theta', 'i-iota', 'p-rel-supports', false],
    ['e-zeta-eta', 'i-zeta', 'i-eta', null, true],
  ];
  for (const [id, src, dst, rel, arrow] of edgesA) {
    S().addEdge(A, {
      id,
      sourceId: src,
      destinationId: dst,
      ...(rel ? { definitionNodeIds: [rel] } : {}),
      directionality: { arrowsToward: new Set(arrow ? [dst] : []) },
    });
  }

  S().createGroup(A, { name: 'Pair', color: '#8B0000', memberInstanceIds: ['i-theta', 'i-iota'] });
  const clusterGroupId = S().createGroup(A, { name: 'Cluster', color: '#6B2D5C', memberInstanceIds: ['i-zeta', 'i-eta'] });
  S().convertGroupToNodeGroup(A, clusterGroupId, null, true, 'Cluster', '#6B2D5C');

  const B = 'g-small-b';
  S().addNodeInstance(B, 'p-lambda', { x: -300, y: -150 }, 'i-lambda');
  S().addNodeInstance(B, 'p-mu', { x: 150, y: -150 }, 'i-mu');
  S().addNodeInstance(B, 'p-nu', { x: -80, y: 120 }, 'i-nu');
  S().addEdge(B, { id: 'e-lambda-mu', sourceId: 'i-lambda', destinationId: 'i-mu', definitionNodeIds: ['p-rel-causes'] });
  S().addEdge(B, { id: 'e-mu-nu', sourceId: 'i-mu', destinationId: 'i-nu' });
  // Stored cameras. Without one, export writes pan {0,0} / zoom 1, which puts
  // the far corner of the canvas on screen, nowhere near any node. Both views
  // put world (0,0) at the middle of the canvas area of a 1280x800 window. A
  // and B use different zooms so F15 can tell the views apart.
  S().updateGraphView(A, viewCentredOnOrigin(0.65), 0.65);
  S().updateGraphView(B, viewCentredOnOrigin(0.8), 0.8);

  S().setActiveGraph(A);
  // Only a few Things bookmarked, like a real universe.
  store.setState({ savedNodeIds: new Set(['p-alpha', 'p-beta']) });
}

// ---------------------------------------------------------------------------
// Stress fixture: ~600 instances on one graph, ~1,000 edges, groups nested two
// deep, node-groups, self-loops, parallel edges, and named (labelled) edges.
// ---------------------------------------------------------------------------
const WORDS = [
  'river', 'lantern', 'thesis', 'archive', 'signal', 'harbor', 'method', 'ember', 'ledger', 'orbit',
  'canopy', 'margin', 'vector', 'quarry', 'fable', 'tessera', 'meridian', 'cipher', 'atlas', 'hollow',
  'praxis', 'relic', 'summit', 'weave', 'kernel', 'mosaic', 'tundra', 'garnet', 'axiom', 'drift',
];
const RELATIONS = [
  'supports', 'contradicts', 'part of', 'causes', 'precedes',
  'refines', 'enables', 'questions', 'cites', 'depends on',
];

function buildStress(store, rand) {
  const S = () => store.getState();
  const THING = 'base-thing-prototype';
  const G = 'g-stress';
  const COLS = 25;
  const ROWS = 24;
  // Cell pitch, in world units. A two-word node is ~400 wide and ~130 tall.
  const DX = 500;
  const DY = 300;
  const UNIQUE_PROTOS = 450;
  const TARGET_EDGES = 1000;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pad = (n, w) => String(n).padStart(w, '0');

  S().createNewGraph({ id: G, name: 'Stress Web', color: '#8B0000' });

  for (let r = 0; r < RELATIONS.length; r++) {
    S().addNodePrototype({ id: `p-rel-${pad(r, 2)}`, name: RELATIONS[r], color: '#8B0000', description: '', typeNodeId: THING, definitionGraphIds: [] });
  }
  for (let p = 0; p < UNIQUE_PROTOS; p++) {
    const words = 1 + Math.floor(rand() * 2);
    const name = Array.from({ length: words }, () => pick(WORDS)).join(' ');
    const color = pick(['#8B0000', '#8B0000', '#6B2D5C', '#2F4F4F', '#4A5568']);
    S().addNodePrototype({ id: `p-s-${pad(p, 3)}`, name: `${name} ${p}`, color, description: '', typeNodeId: THING, definitionGraphIds: [] });
  }

  // Instances on a jittered grid centred on world (0,0). The last 150 reuse
  // prototypes, since real graphs place the same Thing more than once.
  const cell = [];
  let n = 0;
  for (let row = 0; row < ROWS; row++) {
    cell.push([]);
    for (let col = 0; col < COLS; col++) {
      const id = `i-s-${pad(n, 4)}`;
      const protoId = n < UNIQUE_PROTOS ? `p-s-${pad(n, 3)}` : `p-s-${pad(Math.floor(rand() * UNIQUE_PROTOS), 3)}`;
      const x = Math.round((col - (COLS - 1) / 2) * DX + (rand() - 0.5) * 60);
      const y = Math.round((row - (ROWS - 1) / 2) * DY + (rand() - 0.5) * 50);
      S().addNodeInstance(G, protoId, { x, y }, id);
      cell[row].push(id);
      n++;
    }
  }

  // Edges. Each carries a relation (label text) 75% of the time and an arrow
  // 60% of the time.
  let edgeCount = 0;
  const pairs = [];
  const addEdge = (src, dst) => {
    const id = `e-s-${pad(edgeCount, 4)}`;
    const labelled = rand() < 0.75;
    const arrow = rand() < 0.6;
    S().addEdge(G, {
      id,
      sourceId: src,
      destinationId: dst,
      ...(labelled ? { definitionNodeIds: [`p-rel-${pad(Math.floor(rand() * RELATIONS.length), 2)}`] } : {}),
      directionality: { arrowsToward: new Set(arrow ? [dst] : []) },
    });
    pairs.push([src, dst]);
    edgeCount++;
  };

  // Neighbour mesh.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (col + 1 < COLS && rand() < 0.62) addEdge(cell[row][col], cell[row][col + 1]);
      if (row + 1 < ROWS && rand() < 0.5) addEdge(cell[row][col], cell[row + 1][col]);
      if (col + 1 < COLS && row + 1 < ROWS && rand() < 0.08) addEdge(cell[row][col], cell[row + 1][col + 1]);
    }
  }
  // 20 self-loops.
  for (let k = 0; k < 20; k++) {
    const id = cell[Math.floor(rand() * ROWS)][Math.floor(rand() * COLS)];
    addEdge(id, id);
  }
  // 50 parallel edges: repeat an existing pair, half of them reversed.
  const meshPairs = pairs.filter(([a, b]) => a !== b);
  for (let k = 0; k < 50; k++) {
    const [a, b] = meshPairs[Math.floor(rand() * meshPairs.length)];
    if (k % 2 === 0) addEdge(a, b);
    else addEdge(b, a);
  }
  // Longer-range edges (within 4 cells) until the target count.
  while (edgeCount < TARGET_EDGES) {
    const r1 = Math.floor(rand() * ROWS);
    const c1 = Math.floor(rand() * COLS);
    const r2 = Math.min(ROWS - 1, Math.max(0, r1 + Math.floor(rand() * 9) - 4));
    const c2 = Math.min(COLS - 1, Math.max(0, c1 + Math.floor(rand() * 9) - 4));
    if (r1 === r2 && c1 === c2) continue;
    addEdge(cell[r1][c1], cell[r2][c2]);
  }

  // Groups. The grid is tiled into 5x4-cell blocks (5 x 6 = 30 blocks). In
  // each block:
  //   - every block gets an outer plain group over a 3x2 corner,
  //   - every third block nests an inner group (2 of the outer members)
  //     inside that outer group,
  //   - every fifth block turns a separate 2x1 pair into a node-group (with an
  //     anchor instance and a definition graph, as the real conversion does).
  const blockCols = Math.floor(COLS / 5);
  const blockRows = Math.floor(ROWS / 4);
  let groupCount = 0;
  let nodeGroupCount = 0;
  let nestedCount = 0;
  for (let br = 0; br < blockRows; br++) {
    for (let bc = 0; bc < blockCols; bc++) {
      const r0 = br * 4;
      const c0 = bc * 5;
      const block = br * blockCols + bc;
      const outer = [cell[r0][c0], cell[r0][c0 + 1], cell[r0][c0 + 2], cell[r0 + 1][c0], cell[r0 + 1][c0 + 1], cell[r0 + 1][c0 + 2]];
      S().createGroup(G, { name: `Region ${block}`, color: pick(['#8B0000', '#6B2D5C', '#2F4F4F']), memberInstanceIds: outer });
      groupCount++;
      if (block % 3 === 0) {
        S().createGroup(G, { name: `Core ${block}`, color: '#8B0000', memberInstanceIds: [outer[0], outer[1]] });
        groupCount++;
        nestedCount++;
      }
      if (block % 5 === 0) {
        const members = [cell[r0 + 2][c0 + 3], cell[r0 + 2][c0 + 4]];
        const gid = S().createGroup(G, { name: `Thing ${block}`, color: '#6B2D5C', memberInstanceIds: members });
        S().convertGroupToNodeGroup(G, gid, null, true, `Thing ${block}`, '#6B2D5C');
        groupCount++;
        nodeGroupCount++;
      }
    }
  }

  // Zoomed out enough to show a few hundred nodes, so culling has work to do.
  S().updateGraphView(G, viewCentredOnOrigin(0.4), 0.4);
  S().setActiveGraph(G);
  store.setState({ savedNodeIds: new Set(['p-s-000', 'p-s-001', 'p-s-002']) });
  return { edgeCount, groupCount, nodeGroupCount, nestedCount };
}

// ---------------------------------------------------------------------------

function summarize(storeState, graphId) {
  const g = storeState.graphs.get(graphId);
  const edges = (g.edgeIds || []).map((id) => storeState.edges.get(id)).filter(Boolean);
  const pairKey = (e) => [e.sourceId, e.destinationId].sort().join('|');
  const pairCounts = new Map();
  for (const e of edges) pairCounts.set(pairKey(e), (pairCounts.get(pairKey(e)) || 0) + 1);
  return {
    instances: g.instances.size,
    edges: edges.length,
    groups: g.groups?.size || 0,
    nodeGroups: [...(g.groups?.values() || [])].filter((gr) => gr.linkedNodePrototypeId).length,
    selfLoops: edges.filter((e) => e.sourceId === e.destinationId).length,
    parallelPairs: [...pairCounts.values()].filter((c) => c > 1).length,
    labelled: edges.filter((e) => e.definitionNodeIds?.length).length,
  };
}

async function main() {
  const { useGraphStore, exportToRedstring, importFromRedstring } = await loadApp();
  const baseline = { ...useGraphStore.getState() };

  const outputs = [];
  const make = (name, nibble, build, activeGraphId) => {
    resetStore(useGraphStore, baseline);
    Math.random = mulberry32(0xC0FFEE);
    const extra = build(useGraphStore, mulberry32(0x5EED));
    const json = exportToRedstring(useGraphStore.getState());
    const text = `${canonicalizeUuids(JSON.stringify(json, null, 1), nibble)}\n`;
    // Round-trip through the real importer: the fixture must load cleanly.
    const { storeState, errors } = importFromRedstring(JSON.parse(text));
    if (errors?.length) throw new Error(`${name}: import reported ${errors.length} error(s): ${errors[0]}`);
    outputs.push({ name, text, summary: { ...summarize(storeState, activeGraphId), graphs: storeState.graphs.size, prototypes: storeState.nodePrototypes.size, ...(extra || {}) } });
  };

  make('small', '1', (store) => buildSmall(store), 'g-small-a');
  make('stress', '2', (store, rand) => buildStress(store, rand), 'g-stress');

  mkdirSync(OUT_DIR, { recursive: true });
  let stale = false;
  for (const { name, text, summary } of outputs) {
    const file = join(OUT_DIR, `${name}.redstring`);
    if (CHECK) {
      let current = null;
      try { current = readFileSync(file, 'utf-8'); } catch { /* missing */ }
      if (current !== text) {
        stale = true;
        log(`STALE  ${file}`);
      } else {
        log(`ok     ${file}`);
      }
    } else {
      writeFileSync(file, text);
      log(`wrote  ${file}  (${(text.length / 1024).toFixed(0)} KB)`);
    }
    log(`       ${JSON.stringify(summary)}`);
  }
  if (stale) process.exit(1);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
