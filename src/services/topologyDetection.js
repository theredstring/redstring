/**
 * Topology detection for conditional auto-layout.
 *
 * Force-directed layout is the general solver: it works on anything but is
 * unpredictable — the same graph laid out twice looks different, and readers
 * can't learn to read it. When a graph *does* have an obvious shape (a
 * taxonomy tree, a feedback loop, a pipeline, a hub-and-spoke), a dedicated
 * layout is both prettier and — more importantly — predictable.
 *
 * This module answers one question: "what shape is this?" It classifies each
 * connected component independently, because a real Redstring graph is often
 * a tree next to a loop next to a pile of floaters.
 *
 * Classification runs on the SIMPLE UNDIRECTED graph (self-loops dropped,
 * parallel edges collapsed) because shape is a structural property. Direction
 * is consulted separately, only to orient trees and to distinguish DAGs.
 */

export const TOPOLOGY = {
  SINGLE: 'single',   // one node, no edges
  CHAIN: 'chain',     // a path — every node has degree <= 2, no cycle
  CYCLE: 'cycle',     // a simple ring — every node has degree exactly 2
  STAR: 'star',       // one hub connected to everything else, nothing else connected
  TREE: 'tree',       // connected and acyclic, branching
  DAG: 'dag',         // directed acyclic with merges (layered / pipeline shape)
  MESH: 'mesh'        // no clean structure — force-directed is the honest answer
};

/** Layouts that pair with each topology. Consumed by patternLayouts.js. */
export const TOPOLOGY_LAYOUT = {
  [TOPOLOGY.SINGLE]: 'single',
  [TOPOLOGY.CHAIN]: 'chain',
  [TOPOLOGY.CYCLE]: 'cycle',
  [TOPOLOGY.STAR]: 'star',
  [TOPOLOGY.TREE]: 'tree',
  [TOPOLOGY.DAG]: 'layered',
  [TOPOLOGY.MESH]: 'force'
};

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Collapse a raw edge list into the simple undirected graph used for shape
 * detection. Parallel edges keep the LONGEST label so downstream spacing
 * reserves room for the widest thing that will actually be drawn there.
 */
export function buildSimpleGraph(nodes, edges) {
  const nodeIds = new Set(nodes.map(n => n.id));
  const adjacency = new Map();
  nodes.forEach(n => adjacency.set(n.id, new Set()));

  const uniqueEdges = new Map();
  const selfLoops = [];

  (edges || []).forEach(edge => {
    if (!edge) return;
    const { sourceId, destinationId } = edge;
    if (!nodeIds.has(sourceId) || !nodeIds.has(destinationId)) return;
    if (sourceId === destinationId) { selfLoops.push(edge); return; }

    const key = pairKey(sourceId, destinationId);
    const existing = uniqueEdges.get(key);
    if (!existing) {
      uniqueEdges.set(key, edge);
    } else if ((edge.name || '').length > (existing.name || '').length) {
      uniqueEdges.set(key, edge);
    }
    adjacency.get(sourceId).add(destinationId);
    adjacency.get(destinationId).add(sourceId);
  });

  return {
    adjacency,
    uniqueEdges: Array.from(uniqueEdges.values()),
    selfLoops
  };
}

/**
 * Split a graph into connected components. Each component carries its own
 * node list and the subset of edges internal to it, so pattern layouts can be
 * run on a component in isolation and packed afterward.
 */
export function buildComponents(nodes, edges) {
  const { adjacency, uniqueEdges } = buildSimpleGraph(nodes, edges);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const componentOf = new Map();
  const components = [];

  nodes.forEach(node => {
    if (componentOf.has(node.id)) return;
    const index = components.length;
    const members = [];
    const stack = [node.id];
    componentOf.set(node.id, index);

    while (stack.length > 0) {
      const currentId = stack.pop();
      members.push(nodeById.get(currentId));
      (adjacency.get(currentId) || new Set()).forEach(neighborId => {
        if (!componentOf.has(neighborId)) {
          componentOf.set(neighborId, index);
          stack.push(neighborId);
        }
      });
    }

    components.push({ nodes: members, edges: [], simpleEdges: [] });
  });

  // Assign every original edge (including parallels) to its component, plus
  // the deduped simple edges used for structural reasoning.
  (edges || []).forEach(edge => {
    const index = componentOf.get(edge?.sourceId);
    if (index === undefined) return;
    if (componentOf.get(edge.destinationId) !== index) return; // shouldn't happen
    components[index].edges.push(edge);
  });
  uniqueEdges.forEach(edge => {
    const index = componentOf.get(edge.sourceId);
    if (index === undefined) return;
    components[index].simpleEdges.push(edge);
  });

  // Largest first: the dominant component sets the packing shelf.
  components.sort((a, b) => b.nodes.length - a.nodes.length);
  return components;
}

/** Kahn's algorithm — true if the directed edge set has no directed cycle. */
function isDirectedAcyclic(nodeIds, edges) {
  const inDegree = new Map();
  const outgoing = new Map();
  nodeIds.forEach(id => { inDegree.set(id, 0); outgoing.set(id, []); });

  edges.forEach(edge => {
    if (edge.sourceId === edge.destinationId) return;
    outgoing.get(edge.sourceId).push(edge.destinationId);
    inDegree.set(edge.destinationId, inDegree.get(edge.destinationId) + 1);
  });

  const queue = [];
  inDegree.forEach((deg, id) => { if (deg === 0) queue.push(id); });

  let visited = 0;
  while (queue.length > 0) {
    const id = queue.pop();
    visited += 1;
    outgoing.get(id).forEach(next => {
      const remaining = inDegree.get(next) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    });
  }
  return visited === nodeIds.length;
}

/** BFS returning { distances, farthestId } from a start node. */
function bfsFrom(startId, adjacency) {
  const distances = new Map([[startId, 0]]);
  const queue = [startId];
  let farthestId = startId;

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const dist = distances.get(id);
    if (dist > distances.get(farthestId)) farthestId = id;
    (adjacency.get(id) || new Set()).forEach(neighborId => {
      if (!distances.has(neighborId)) {
        distances.set(neighborId, dist + 1);
        queue.push(neighborId);
      }
    });
  }
  return { distances, farthestId };
}

/**
 * Pick the node a tree should hang from.
 *
 * Preference order:
 *   1. caller-supplied rootId
 *   2. the unique directed source (nothing points at it) — matches how people
 *      author taxonomies: the general term points down at the specific ones
 *   3. if several sources, the one whose subtree is shallowest (most balanced)
 *   4. the graph-theoretic center (minimizes height) for undirected trees
 */
export function chooseTreeRoot(nodes, edges, adjacency, preferredId = null) {
  const ids = nodes.map(n => n.id);
  if (preferredId && adjacency.has(preferredId)) return preferredId;
  if (ids.length === 0) return null;

  const hasIncoming = new Set();
  edges.forEach(edge => {
    if (edge.sourceId !== edge.destinationId) hasIncoming.add(edge.destinationId);
  });
  const sources = ids.filter(id => !hasIncoming.has(id));

  if (sources.length === 1) return sources[0];
  if (sources.length > 1) {
    let best = sources[0];
    let bestHeight = Infinity;
    sources.forEach(id => {
      const { distances } = bfsFrom(id, adjacency);
      let height = 0;
      distances.forEach(d => { if (d > height) height = d; });
      // Only a valid root if it reaches the whole component.
      if (distances.size === ids.length && height < bestHeight) {
        bestHeight = height;
        best = id;
      }
    });
    if (bestHeight < Infinity) return best;
  }

  // Tree center via double sweep: the midpoint of the longest path.
  const first = bfsFrom(ids[0], adjacency).farthestId;
  const second = bfsFrom(first, adjacency);
  const { distances } = second;
  const back = bfsFrom(second.farthestId, adjacency);
  let center = ids[0];
  let bestEccentricity = Infinity;
  ids.forEach(id => {
    const a = distances.get(id);
    const b = back.distances.get(id);
    if (a === undefined || b === undefined) return;
    const eccentricity = Math.max(a, b);
    if (eccentricity < bestEccentricity) {
      bestEccentricity = eccentricity;
      center = id;
    }
  });
  return center;
}

/**
 * Classify one connected component.
 *
 * The checks are ordered from most to least specific, and every positive check
 * is an exact structural test (not a threshold) except DAG, which is a
 * judgement call about density.
 *
 * @returns {{ kind: string, confidence: number, meta: object }}
 */
export function classifyComponent(component, options = {}) {
  const { nodes, edges, simpleEdges } = component;
  const n = nodes.length;

  if (n === 0) return { kind: TOPOLOGY.MESH, confidence: 0, meta: {} };
  if (n === 1) return { kind: TOPOLOGY.SINGLE, confidence: 1, meta: {} };

  const { adjacency } = buildSimpleGraph(nodes, simpleEdges || edges);
  const m = (simpleEdges || edges).length;

  const degrees = new Map();
  let maxDegree = 0;
  let maxDegreeId = nodes[0].id;
  let degreeTwoCount = 0;
  let leafCount = 0;

  nodes.forEach(node => {
    const degree = (adjacency.get(node.id) || new Set()).size;
    degrees.set(node.id, degree);
    if (degree > maxDegree) { maxDegree = degree; maxDegreeId = node.id; }
    if (degree === 2) degreeTwoCount += 1;
    if (degree === 1) leafCount += 1;
  });

  const acyclic = m === n - 1; // connected + |E| = |V|-1 ⟺ tree

  if (acyclic) {
    // A path: at most two endpoints, everything else strung between them.
    if (maxDegree <= 2) {
      const endpoints = nodes.filter(node => degrees.get(node.id) <= 1).map(node => node.id);
      return {
        kind: TOPOLOGY.CHAIN,
        confidence: 1,
        meta: { startId: endpoints[0] ?? nodes[0].id, endpoints }
      };
    }
    // A star: one hub touching everything, and n-1 leaves. Requires 4+ nodes —
    // below that a "star" is just a short path and reads better as one.
    if (n >= 4 && maxDegree === n - 1 && leafCount === n - 1) {
      return {
        kind: TOPOLOGY.STAR,
        confidence: 1,
        meta: { hubId: maxDegreeId }
      };
    }
    return {
      kind: TOPOLOGY.TREE,
      confidence: 1,
      meta: { rootId: chooseTreeRoot(nodes, edges, adjacency, options.rootId), leafCount }
    };
  }

  // A single ring: exactly as many edges as nodes, every node degree 2.
  //
  // Except: a fork/join diamond (a→b, a→c, b→d, c→d) is also an undirected
  // ring, and drawing it as a circle hides what it actually is — two parallel
  // branches between a start and an end. The signature is one source and one
  // sink with no directed cycle; that goes to the layered layout instead. A
  // genuine feedback loop has a directed cycle and stays a ring.
  if (m === n && degreeTwoCount === n) {
    const isForkJoin = isForkJoinDiamond(nodes, edges);
    if (!isForkJoin) {
      return {
        kind: TOPOLOGY.CYCLE,
        confidence: 1,
        meta: { ringIds: traceCycle(nodes[0].id, adjacency) }
      };
    }
    return { kind: TOPOLOGY.DAG, confidence: 0.9, meta: { density: 1, forkJoin: true } };
  }

  // Directed acyclic with merge points — pipelines, dependency graphs,
  // derivation chains. Layered layout reads these far better than force does,
  // but only while they stay sparse; dense DAGs become spaghetti in any
  // layered form, so hand those back to the force solver.
  //
  // The 1.4 threshold is calibrated: a tree sits at (n-1)/n ≈ 1, a realistic
  // pipeline with a few merges lands near 1.2, and a complete graph — which is
  // technically a DAG once you orient it, but is visually a mesh — starts at
  // 1.5 for K4 and climbs from there.
  const density = m / Math.max(1, n);
  const maxDagDensity = options.maxDagDensity ?? 1.4;
  if (density <= maxDagDensity && isDirectedAcyclic(nodes.map(node => node.id), edges)) {
    return {
      kind: TOPOLOGY.DAG,
      confidence: density <= 1.3 ? 0.85 : 0.65,
      meta: { density }
    };
  }

  return { kind: TOPOLOGY.MESH, confidence: 1, meta: { density } };
}

/**
 * True for an undirected ring whose directions make it a fork/join: exactly
 * one node nothing points at, exactly one node that points at nothing, and no
 * directed cycle. That is a diamond, not a loop.
 */
function isForkJoinDiamond(nodes, edges) {
  const inDegree = new Map(nodes.map(n => [n.id, 0]));
  const outDegree = new Map(nodes.map(n => [n.id, 0]));
  edges.forEach(edge => {
    if (!edge || edge.sourceId === edge.destinationId) return;
    if (!inDegree.has(edge.destinationId) || !outDegree.has(edge.sourceId)) return;
    inDegree.set(edge.destinationId, inDegree.get(edge.destinationId) + 1);
    outDegree.set(edge.sourceId, outDegree.get(edge.sourceId) + 1);
  });

  let sources = 0;
  let sinks = 0;
  nodes.forEach(node => {
    if (inDegree.get(node.id) === 0) sources += 1;
    if (outDegree.get(node.id) === 0) sinks += 1;
  });

  return sources === 1 && sinks === 1 && isDirectedAcyclic(nodes.map(n => n.id), edges);
}

/** Walk a degree-2 ring, returning node ids in cyclic order. */
function traceCycle(startId, adjacency) {
  const order = [startId];
  const seen = new Set([startId]);
  let current = startId;
  let previous = null;

  for (;;) {
    const neighbors = Array.from(adjacency.get(current) || []);
    const next = neighbors.find(id => id !== previous && !seen.has(id));
    if (next === undefined) break;
    order.push(next);
    seen.add(next);
    previous = current;
    current = next;
  }
  return order;
}

/**
 * Full detection pass: components plus their classifications.
 *
 * @returns {{ components: Array, summary: object }} components each carry a
 *   `topology` ({kind, confidence, meta}); summary reports the dominant kind
 *   (by node count) for UI display.
 */
export function detectTopology(nodes, edges, options = {}) {
  const components = buildComponents(nodes, edges).map(component => ({
    ...component,
    topology: classifyComponent(component, options)
  }));

  const byKind = new Map();
  components.forEach(component => {
    const kind = component.topology.kind;
    byKind.set(kind, (byKind.get(kind) || 0) + component.nodes.length);
  });

  let dominant = TOPOLOGY.MESH;
  let dominantCount = -1;
  byKind.forEach((count, kind) => {
    if (count > dominantCount) { dominantCount = count; dominant = kind; }
  });

  return {
    components,
    summary: {
      dominant,
      componentCount: components.length,
      counts: Object.fromEntries(byKind)
    }
  };
}

export default {
  TOPOLOGY,
  TOPOLOGY_LAYOUT,
  detectTopology,
  classifyComponent,
  buildComponents,
  buildSimpleGraph,
  chooseTreeRoot
};
