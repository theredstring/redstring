/**
 * graphQuality - Shared graph quality analysis function
 *
 * Analyzes a set of nodes and edges for connectivity, orphans, disconnected
 * components, density, and composition. Used by populateDefinitionGraph,
 * createPopulatedGraph, expandGraph, buildComposition and sketchGraph to give the
 * model automatic feedback on what it just built.
 *
 * ── Why the hub checks exist ──────────────────────────────────────────────────
 *
 * This report is the objective the model optimizes against, and for a long time
 * it rewarded exactly the wrong shape. It asked for zero orphans, one connected
 * component, and a high average degree — and the cheapest way to satisfy all
 * three at once is to pick one node and wire everything to it. Asked to build a
 * cell, the model would produce a star: nine organelles, each connected to
 * Cytoplasm by "Suspended In", and a perfect score.
 *
 * A star is not a model of anything. It says "these things are near each other"
 * where the truth is usually "these things are INSIDE that one" — which in
 * Redstring is a layer, not an edge. So the report now names that pattern when it
 * sees it, and reports median degree alongside the mean, because the mean is
 * trivially inflated by the very hub the guidance is trying to discourage.
 *
 * Layers count as nodes throughout. A layer occupies a place on the canvas and
 * accepts edges exactly as a Thing does; excluding them made every node attached
 * only to a layer read as "orphaned", which pushed the model to add flat hub
 * edges to fix a problem that did not exist.
 */

/** One node holding at least this share of all edge endpoints reads as a hub. */
const HUB_ENDPOINT_SHARE = 0.5;
/** Below this many nodes, a "hub" is just a small graph. */
const HUB_MIN_NODES = 5;

/** One relation covering at least this share of edges reads as repetition. */
const MONOTONE_EDGE_SHARE = 0.6;
/** Below this many edges, repetition isn't yet a pattern. */
const MONOTONE_MIN_EDGES = 4;

/** At or above this many nodes, a graph with no layers is suspiciously flat. */
const FLATNESS_NODE_THRESHOLD = 8;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Analyze the quality of a graph given its nodes and edges.
 *
 * @param {Array<{name: string, description?: string}>} nodes - Node specs
 * @param {Array<{source: string, target: string, type?: string}>} edges - Edge specs
 * @param {Object} [opts]
 * @param {Array<{name: string}>} [opts.layers] - Layers at this level. They are
 *   treated as nodes for connectivity, and counted for the flatness check.
 * @returns {Object} Quality report
 */
export function analyzeGraphQuality(nodes, edges, opts = {}) {
  const layers = Array.isArray(opts.layers) ? opts.layers.filter(l => l && l.name) : [];

  // A layer is a Thing on the canvas. Edges point at it, it can be orphaned, and
  // it counts toward whether this level is composed or flat.
  const allNodes = [
    ...(nodes || []),
    ...layers.map(l => ({ name: l.name, description: l.description || 'layer', _isLayer: true }))
  ];

  if (allNodes.length === 0) {
    return {
      orphanedNodes: [],
      disconnectedComponents: 0,
      avgConnectionsPerNode: 0,
      medianConnectionsPerNode: 0,
      weakNodes: [],
      noDescriptionNodes: [],
      densityScore: 0,
      layerCount: layers.length,
      hub: null,
      dominantRelation: null,
      feedback: 'No nodes to analyze.'
    };
  }

  const nodeNames = allNodes.map(n => String(n.name || '').toLowerCase().trim());
  const nameSet = new Set(nodeNames);

  // Build adjacency list (case-insensitive)
  const adj = new Map();
  for (const name of nodeNames) {
    adj.set(name, new Set());
  }

  // Endpoint tallies drive the hub check: a node's degree undercounts it when the
  // model wires the same pair repeatedly, and the hub is about traffic, not
  // distinct neighbours.
  const endpointCounts = new Map();
  const relationCounts = new Map();
  let countedEdges = 0;

  for (const edge of (edges || [])) {
    const src = (edge.source || '').toLowerCase().trim();
    const tgt = (edge.target || '').toLowerCase().trim();
    if (!nameSet.has(src) || !nameSet.has(tgt)) continue;

    adj.get(src).add(tgt);
    adj.get(tgt).add(src);
    endpointCounts.set(src, (endpointCounts.get(src) || 0) + 1);
    endpointCounts.set(tgt, (endpointCounts.get(tgt) || 0) + 1);
    countedEdges++;

    const rel = String(edge.type || edge.definitionNode?.name || '').trim();
    if (rel) relationCounts.set(rel, (relationCounts.get(rel) || 0) + 1);
  }

  const displayName = (lower) =>
    allNodes.find(n => String(n.name || '').toLowerCase().trim() === lower)?.name || lower;

  // Find orphans (degree 0) and weak nodes (degree 1)
  const orphanedNodes = [];
  const weakNodes = [];
  const degrees = new Map();

  for (const [name, neighbors] of adj) {
    const degree = neighbors.size;
    degrees.set(name, degree);
    if (degree === 0) orphanedNodes.push(displayName(name));
    else if (degree === 1) weakNodes.push(displayName(name));
  }

  // Count connected components via BFS
  const visited = new Set();
  let componentCount = 0;

  for (const name of nodeNames) {
    if (visited.has(name)) continue;
    componentCount++;
    const queue = [name];
    visited.add(name);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // ── Hub detection ─────────────────────────────────────────────────────────
  let hub = null;
  if (allNodes.length >= HUB_MIN_NODES && countedEdges > 0) {
    let topName = null;
    let topCount = 0;
    for (const [name, count] of endpointCounts) {
      if (count > topCount) { topCount = count; topName = name; }
    }
    const share = topCount / (countedEdges * 2);
    if (topName && share >= HUB_ENDPOINT_SHARE) {
      hub = {
        name: displayName(topName),
        edgeShare: Math.round(share * 100),
        // A hub that is already a layer is fine — that IS the composed form.
        isLayer: !!allNodes.find(
          n => String(n.name || '').toLowerCase().trim() === topName && n._isLayer
        )
      };
    }
  }

  // ── Repeated-relation detection ───────────────────────────────────────────
  let dominantRelation = null;
  if (countedEdges >= MONOTONE_MIN_EDGES) {
    let topRel = null;
    let topRelCount = 0;
    for (const [rel, count] of relationCounts) {
      if (count > topRelCount) { topRelCount = count; topRel = rel; }
    }
    if (topRel && topRelCount / countedEdges >= MONOTONE_EDGE_SHARE) {
      dominantRelation = {
        type: topRel,
        count: topRelCount,
        share: Math.round((topRelCount / countedEdges) * 100)
      };
    }
  }

  // ── Connectivity ──────────────────────────────────────────────────────────
  const degreeValues = Array.from(degrees.values());
  const totalDegree = degreeValues.reduce((sum, d) => sum + d, 0);

  // The mean excludes the hub. Leaving it in lets one over-connected node carry
  // the whole graph past the "aim for 2-3 connections per node" bar while every
  // other node sits at 1 — which is the exact shape the guidance is trying to
  // discourage, scoring well.
  const hubKey = hub ? String(hub.name).toLowerCase().trim() : null;
  const nonHubDegrees = [];
  for (const [name, degree] of degrees) {
    if (name !== hubKey) nonHubDegrees.push(degree);
  }
  const meanBase = nonHubDegrees.length > 0 ? nonHubDegrees : degreeValues;
  const avgConnectionsPerNode = Math.round(
    (meanBase.reduce((s, d) => s + d, 0) / meanBase.length) * 100
  ) / 100;
  const medianConnectionsPerNode = median(degreeValues);

  // Density: actual edges / max possible edges (for undirected graph)
  const maxEdges = allNodes.length > 1 ? (allNodes.length * (allNodes.length - 1)) / 2 : 0;
  const densityScore = maxEdges > 0
    ? Math.round((countedEdges / maxEdges) * 100) / 100
    : 0;

  // ── Feedback ──────────────────────────────────────────────────────────────
  const issues = [];
  if (orphanedNodes.length > 0) {
    issues.push(`${orphanedNodes.length} orphaned node(s) with no connections: ${orphanedNodes.join(', ')}. Connect them to related nodes.`);
  }
  if (componentCount > 1) {
    issues.push(`Graph has ${componentCount} disconnected components — should be 1 connected graph. Add edges to bridge them.`);
  }

  // Named before the low-connectivity note, because the usual "fix" for low
  // connectivity is to add more spokes to the hub, which makes this worse.
  if (hub && !hub.isLayer) {
    issues.push(
      `HUB: "${hub.name}" sits on ${hub.edgeShare}% of all connection endpoints. `
      + 'A hub that dominant almost always means the other nodes are INSIDE it rather than merely related to it — '
      + `make "${hub.name}" a layer whose definition holds them, instead of spoking everything to it. `
      + 'If they really are peers, connect them to each other, not all to one center.'
    );
  }
  if (dominantRelation) {
    issues.push(
      `REPETITION: "${dominantRelation.type}" accounts for ${dominantRelation.share}% of connections (${dominantRelation.count}). `
      + 'One relation repeated across a whole graph is usually containment in disguise — that belongs in a layer. '
      + 'Otherwise give each pair the relation that actually describes it.'
    );
  }
  if (avgConnectionsPerNode < 1.5 && allNodes.length > 2 && !hub) {
    issues.push(`Low connectivity (avg ${avgConnectionsPerNode} connections/node). Aim for 2-3 connections per node — between peers, not all through one node.`);
  }
  if (layers.length === 0 && allNodes.length >= FLATNESS_NODE_THRESHOLD) {
    issues.push(
      `FLAT: ${allNodes.length} nodes at one level with no layers. `
      + 'Look for a cluster whose members define what it is, and make that cluster a layer — '
      + 'depth is what makes a graph navigable rather than a list.'
    );
  }

  // Check for nodes missing descriptions
  const noDescriptionNodes = allNodes
    .filter(n => !n._isLayer && (!n.description || n.description.trim() === ''))
    .map(n => n.name);
  if (noDescriptionNodes.length > 0) {
    issues.push(`${noDescriptionNodes.length} node(s) have no description: ${noDescriptionNodes.join(', ')}. Add brief bios.`);
  }

  const feedback = issues.length > 0
    ? 'QUALITY ISSUES: ' + issues.join(' ')
    : `Good structure. ${allNodes.length} nodes, ${countedEdges} edges`
      + (layers.length > 0 ? `, ${layers.length} layer(s)` : '')
      + ', all connected.';

  return {
    orphanedNodes,
    disconnectedComponents: componentCount,
    avgConnectionsPerNode,
    medianConnectionsPerNode,
    weakNodes,
    noDescriptionNodes,
    densityScore,
    layerCount: layers.length,
    hub,
    dominantRelation,
    feedback
  };
}
