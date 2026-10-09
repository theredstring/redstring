/**
 * Random universe states, shaped like the store's (Maps of prototypes, graphs
 * and edges; instance and group Maps inside graphs; Sets), built to reach every
 * branch of exportToRedstring: abstraction chains that name other Things,
 * links on each rung, provenance, enriched images, quarantined fields, groups,
 * open definitions, connections owned by edgeIds or only by their ends, and
 * IDs that look like array indexes (which objects order first).
 *
 * Plus random edits that replace what they change, the way the store does, so
 * a test can walk a universe through many saves.
 *
 * Seeded: the same seed always gives the same universe and the same edits.
 */

export const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pick = (r, list) => list[Math.floor(r() * list.length)];
const NAMES = ['Cat', 'Mammal', 'Thing', 'Lung', 'Pneumonia', 'α-D-glucose', 'Café', 'Tree 🌳', '', 'with "quotes"', 'line\nbreak'];

const makePrototype = (r, id, allIds) => {
  const p = { id, name: pick(r, NAMES) + (r() < 0.5 ? ` ${id}` : ''), description: r() < 0.5 ? pick(r, NAMES) : '' };
  if (r() < 0.7) p.color = pick(r, ['#8B0000', '#123456']);
  if (r() < 0.4 && allIds.length) p.typeNodeId = pick(r, allIds);
  if (r() < 0.6 && allIds.length) {
    const chain = [id];
    for (let i = 0; i < 1 + Math.floor(r() * 3); i++) chain.push(pick(r, allIds));
    p.abstractionChains = { specificity: chain };
    if (r() < 0.3) p.abstractionChains.other = [pick(r, allIds), id];
  }
  if (r() < 0.4) {
    p.externalLinks = ['https://example.org/' + id, 'https://www.wikidata.org/wiki/Q' + Math.floor(r() * 100)];
    p.semanticMetadata = { linkConfirmations: r() < 0.5 ? { ['https://example.org/' + id]: { state: 'exact', by: 'user' } } : {} };
  }
  if (r() < 0.15) p.semanticMetadata = { ...(p.semanticMetadata || {}), provenance: { wasAttributedTo: 'wizard', generatedAtTime: '2026-10-01T00:00:00.000Z' } };
  if (r() < 0.15) {
    p.imageSrc = 'data:image/png;base64,AAAA' + id;
    p.thumbnailSrc = 'data:image/png;base64,BB' + id;
    p.imageAspectRatio = 1.5;
    if (r() < 0.5) p.semanticMetadata = { ...(p.semanticMetadata || {}), autoEnriched: true, wikipediaThumbnail: 'https://x/y.png' };
  }
  if (r() < 0.1) p._preserved = { '9.9.9': { futureField: id } };
  if (r() < 0.1) p.agentConfig = { model: 'm', apiKey: 'secret' };
  if (r() < 0.1) p.createdAt = 1700000000000;
  if (r() < 0.1) p.conjugation = 'cats';
  if (r() < 0.1) p.isSpecificityChainNode = true;
  if (r() < 0.1) p.personalMeaning = 'mine';
  p.definitionGraphIds = [];
  return p;
};

const makeInstance = (r, id, protoIds) => {
  const inst = { id, prototypeId: pick(r, protoIds), x: Math.floor(r() * 2000) - 1000, y: Math.floor(r() * 2000) - 1000, scale: 1 };
  if (r() < 0.1) inst.sizeMul = 2;
  if (r() < 0.05) inst.openDefinition = { index: 0, offset: { x: 10, y: 20 } };
  if (r() < 0.05) inst._preserved = { '9.9.9': { f: 1 } };
  if (r() < 0.05) inst.name = 'named';
  return inst;
};

/**
 * @param {number} seed
 * @param {Object} [size]
 * @returns {Object} a store-shaped universe state
 */
export function randomUniverse(seed, { prototypes = 30, graphs = 8, edges = 20 } = {}) {
  const r = rng(seed);
  const protoIds = Array.from({ length: prototypes }, (_, i) => (i % 13 === 5 ? String(100 - i) : `p-${seed}-${i}`));
  const nodePrototypes = new Map();
  for (const id of protoIds) nodePrototypes.set(id, makePrototype(r, id, protoIds));

  const graphMap = new Map();
  const allInstances = [];
  for (let g = 0; g < graphs; g++) {
    const id = g === 3 ? '7' : `g-${seed}-${g}`;
    const instances = new Map();
    const n = Math.floor(r() * 8);
    for (let i = 0; i < n; i++) {
      const iid = `i-${seed}-${g}-${i}`;
      instances.set(iid, makeInstance(r, iid, protoIds));
      allInstances.push([id, iid]);
    }
    const graph = { id, name: r() < 0.9 ? pick(r, NAMES) : '', description: r() < 0.5 ? 'about' : '', instances, edgeIds: [], definingNodeIds: [pick(r, protoIds)] };
    if (r() < 0.3) graph.panOffset = { x: 5, y: 6 };
    if (r() < 0.3) graph.zoomLevel = 0.5;
    if (r() < 0.5) graph.directed = r() < 0.5;
    if (r() < 0.3) graph.color = '#abcdef';
    if (r() < 0.2) graph._preserved = { '9.9.9': { g: 1 } };
    if (r() < 0.3 && n > 1) {
      const members = [...instances.keys()].slice(0, 2);
      graph.groups = new Map([[`grp-${g}`, { id: `grp-${g}`, name: 'Group', color: '#111111', memberInstanceIds: members }]]);
    }
    graphMap.set(id, graph);
    if (r() < 0.5) nodePrototypes.get(graph.definingNodeIds[0]).definitionGraphIds.push(id);
  }

  const edgeMap = new Map();
  for (let e = 0; e < edges && allInstances.length > 1; e++) {
    const [gid, a] = pick(r, allInstances);
    const sameGraph = allInstances.filter(([g2]) => g2 === gid);
    const [, b] = pick(r, sameGraph);
    const id = `e-${seed}-${e}`;
    const edge = { id, sourceId: a, destinationId: b, name: r() < 0.5 ? 'rel' : undefined, typeNodeId: 'base-connection-prototype' };
    if (r() < 0.5) edge.definitionNodeIds = [pick(r, protoIds)];
    const arrows = r() < 0.5 ? new Set([b]) : r() < 0.5 ? [a, b] : new Set();
    edge.directionality = { arrowsToward: arrows };
    if (r() < 0.1) edge.semanticMetadata = { provenance: { wasAttributedTo: 'wizard' } };
    if (r() < 0.1) edge._preserved = { '9.9.9': { e: 1 } };
    if (r() < 0.05) edge.sourceVia = ['x'];
    edgeMap.set(id, edge);
    // Most edges are listed by their web; some are owned only through their ends.
    if (r() < 0.85) {
      const g = graphMap.get(gid);
      graphMap.set(gid, { ...g, edgeIds: [...g.edgeIds, id] });
    }
  }

  const graphIds = [...graphMap.keys()];
  return {
    nodePrototypes,
    graphs: graphMap,
    edges: edgeMap,
    edgePrototypes: new Map([['base-connection-prototype', { id: 'base-connection-prototype', name: 'Connection' }]]),
    graphViews: new Map(graphIds.filter(() => r() < 0.3).map((id) => [id, { panOffset: { x: 1, y: 2 }, zoomLevel: 2 }])),
    openGraphIds: graphIds.slice(0, 2),
    activeGraphId: graphIds[0] || null,
    activeDefinitionNodeId: protoIds[0],
    expandedGraphIds: new Set(graphIds.filter(() => r() < 0.3)),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(protoIds.filter(() => r() < 0.2)),
    savedGraphIds: new Set(),
    showConnectionNames: r() < 0.5,
    wizardPlansByConversation: {},
    wizardGoalsByConversation: {},
    mergeDismissals: {},
    universeCreatedAt: '2026-01-01T00:00:00.000Z',
    _universeSlug: `u${seed}`,
    ...(r() < 0.3 ? { _preserved: { '9.9.9': { root: true } } } : {}),
  };
}

const replaceIn = (map, id, value) => { const next = new Map(map); if (value === undefined) next.delete(id); else next.set(id, value); return next; };

/**
 * One random edit, replacing what it changes the way the store does (new
 * objects for changed entries, the rest shared). Covers the dependencies that
 * cross from one entry into another: renaming a Thing changes the summaries
 * of webs that show it; changing a chain changes other Things' broader links;
 * moving an instance's Thing changes its connections' statements.
 *
 * @returns {Object} the next state
 */
export function randomEdit(state, r) {
  const protoIds = [...state.nodePrototypes.keys()];
  const graphIds = [...state.graphs.keys()];
  const edgeIds = [...state.edges.keys()];
  const kind = Math.floor(r() * 16);
  switch (kind) {
    case 0: { // rename a Thing
      const id = pick(r, protoIds);
      return { ...state, nodePrototypes: replaceIn(state.nodePrototypes, id, { ...state.nodePrototypes.get(id), name: 'Renamed ' + Math.floor(r() * 1000) }) };
    }
    case 1: { // change a chain: other Things' broader links follow
      const id = pick(r, protoIds);
      const chain = [id, pick(r, protoIds), pick(r, protoIds)];
      return { ...state, nodePrototypes: replaceIn(state.nodePrototypes, id, { ...state.nodePrototypes.get(id), abstractionChains: { specificity: chain } }) };
    }
    case 2: { // add a Thing
      const id = `new-${Math.floor(r() * 1e9)}`;
      return { ...state, nodePrototypes: replaceIn(state.nodePrototypes, id, makePrototype(r, id, protoIds)) };
    }
    case 3: { // delete a Thing
      if (protoIds.length < 3) return state;
      return { ...state, nodePrototypes: replaceIn(state.nodePrototypes, pick(r, protoIds), undefined) };
    }
    case 4: { // move an instance
      const gid = pick(r, graphIds);
      const g = state.graphs.get(gid);
      const ids = [...g.instances.keys()];
      if (!ids.length) return state;
      const iid = pick(r, ids);
      const instances = new Map(g.instances);
      instances.set(iid, { ...instances.get(iid), x: Math.floor(r() * 500), y: Math.floor(r() * 500) });
      return { ...state, graphs: replaceIn(state.graphs, gid, { ...g, instances }) };
    }
    case 5: { // change which Thing an instance is: its connections' statements change
      const gid = pick(r, graphIds);
      const g = state.graphs.get(gid);
      const ids = [...g.instances.keys()];
      if (!ids.length) return state;
      const iid = pick(r, ids);
      const instances = new Map(g.instances);
      instances.set(iid, { ...instances.get(iid), prototypeId: pick(r, protoIds) });
      return { ...state, graphs: replaceIn(state.graphs, gid, { ...g, instances }) };
    }
    case 6: { // add an edge, listed by its web
      const gid = pick(r, graphIds);
      const g = state.graphs.get(gid);
      const ids = [...g.instances.keys()];
      if (ids.length < 2) return state;
      const id = `ne-${Math.floor(r() * 1e9)}`;
      const edge = { id, sourceId: ids[0], destinationId: ids[1], directionality: { arrowsToward: new Set([ids[1]]) }, definitionNodeIds: [pick(r, protoIds)] };
      return { ...state, edges: replaceIn(state.edges, id, edge), graphs: replaceIn(state.graphs, gid, { ...g, edgeIds: [...g.edgeIds, id] }) };
    }
    case 7: { // change an edge
      if (!edgeIds.length) return state;
      const id = pick(r, edgeIds);
      return { ...state, edges: replaceIn(state.edges, id, { ...state.edges.get(id), name: 'changed', directionality: { arrowsToward: new Set() } }) };
    }
    case 8: { // delete an edge (left listed in its web, as a stale id can be)
      if (!edgeIds.length) return state;
      return { ...state, edges: replaceIn(state.edges, pick(r, edgeIds), undefined) };
    }
    case 9: { // bookmark or unbookmark a Thing
      const id = pick(r, protoIds);
      const saved = new Set(state.savedNodeIds);
      if (saved.has(id)) saved.delete(id); else saved.add(id);
      return { ...state, savedNodeIds: saved };
    }
    case 10: { // expand a web, switch the active web
      const expanded = new Set(state.expandedGraphIds);
      expanded.add(pick(r, graphIds));
      return { ...state, expandedGraphIds: expanded, activeGraphId: pick(r, graphIds) };
    }
    case 11: { // pan a web
      const views = new Map(state.graphViews);
      views.set(pick(r, graphIds), { panOffset: { x: Math.floor(r() * 100), y: 3 }, zoomLevel: 1 + r() });
      return { ...state, graphViews: views };
    }
    case 12: { // rename a web
      const gid = pick(r, graphIds);
      return { ...state, graphs: replaceIn(state.graphs, gid, { ...state.graphs.get(gid), name: 'Web ' + Math.floor(r() * 100) }) };
    }
    case 13: { // change a connection type Thing's type (predicates follow it)
      const id = pick(r, protoIds);
      return { ...state, nodePrototypes: replaceIn(state.nodePrototypes, id, { ...state.nodePrototypes.get(id), typeNodeId: pick(r, protoIds) }) };
    }
    case 14: { // add a web
      const id = `ng-${Math.floor(r() * 1e9)}`;
      const iid = `ni-${Math.floor(r() * 1e9)}`;
      const graph = { id, name: 'New', instances: new Map([[iid, makeInstance(r, iid, protoIds)]]), edgeIds: [], definingNodeIds: [pick(r, protoIds)] };
      return { ...state, graphs: replaceIn(state.graphs, id, graph) };
    }
    default: { // delete a web
      if (graphIds.length < 3) return state;
      return { ...state, graphs: replaceIn(state.graphs, pick(r, graphIds), undefined) };
    }
  }
}
