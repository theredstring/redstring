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
 *
 * ── Why connection names are checked ─────────────────────────────────────────
 *
 * A connection's name is a reusable Thing, but the model will pack a whole clause
 * into one ("Runs On Adenosine Built On") and hide a Thing the web needed. There
 * is no right word count, so a flagged name is a question, not a rule: the
 * feedback says to leave it when the name really is the relation.
 *
 * ── Why composition is checked ───────────────────────────────────────────────
 *
 * A web is the inside of its Thing, so "Car Contains Engine" states with an edge
 * what placing Engine in Car's web already says. Used a couple of times among
 * real relations, that edge slipped past the hub and repetition checks and scored
 * "Good structure". It can occasionally be a real relation between peers, so this
 * too is a question: the feedback names the better structure and when to keep it.
 *
 * The same reasoning runs the other way for a web with no edges at all. A set of
 * members can be correctly unconnected, and telling it to add edges is the very
 * pressure that produces "Contains".
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

/** A connection name this long has usually swallowed a clause. */
const LONG_CONNECTION_WORDS = 5;
/** Shorter node names ("A", "In") match ordinary words in a connection name. */
const MIN_NAMED_THING_LENGTH = 3;

/** Connection names that say one end makes up the other, by direction. "Is"/"Are" are stripped first. */
const WHOLE_TO_PART_RELATIONS = new Set([
  'contains', 'has', 'has part', 'has parts', 'includes', 'consists of', 'comprises', 'composed of', 'made of', 'made up of'
]);
const PART_TO_WHOLE_RELATIONS = new Set(['part of', 'contained in', 'contained by']);
/** How many composition edges the feedback spells out. The report keeps them all. */
const MAX_LISTED_COMPOSITION_EDGES = 6;

const nameWords = (name) => String(name || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');

/** Why this connection name looks overloaded, or null. `things` are in nameWords form. */
function connectionNameFault(relation, things) {
  const words = nameWords(relation);
  const named = things.find(t => t.length >= MIN_NAMED_THING_LENGTH && t !== words && ` ${words} `.includes(` ${t} `));
  if (named) return `names "${named}"`;
  if (` ${words} `.includes(' and ') || relation.includes('&')) return 'joins two relations';
  const count = words.split(' ').length;
  return count >= LONG_CONNECTION_WORDS ? `runs ${count} words` : null;
}

/**
 * A layer marked `collapsed` renders on the canvas as an ordinary node — its web
 * is defined but not spread open. That is a legitimate choice for supporting
 * detail, but if EVERY layer in a build is collapsed the user sees no nesting at
 * all, which is almost never what they asked for when they asked for depth.
 */
function allLayersCollapsed(layers) {
  return layers.length > 0 && layers.every(l => l.display === 'collapsed');
}

/** Edges named for composition, at this level and inside every layer's web. */
function findCompositionEdges(edges, layers) {
  const found = [];
  for (const edge of (edges || [])) {
    const relation = String(edge.type || edge.definitionNode?.name || '').trim();
    const words = nameWords(relation).replace(/^(is|are) /, '');
    if (WHOLE_TO_PART_RELATIONS.has(words)) {
      found.push({ source: edge.source, relation, target: edge.target, whole: edge.source, part: edge.target });
    } else if (PART_TO_WHOLE_RELATIONS.has(words)) {
      found.push({ source: edge.source, relation, target: edge.target, whole: edge.target, part: edge.source });
    }
  }
  for (const layer of (layers || [])) {
    if (layer?.definition) found.push(...findCompositionEdges(layer.definition.edges, layer.definition.layers));
  }
  return found;
}

/** Things placed in their own web, at this level and inside every layer's web. */
function findSelfPlaced(definingNames, nodes, layers) {
  const defining = new Set(definingNames.map(n => String(n || '').toLowerCase().trim()).filter(Boolean));
  const found = [...(nodes || []), ...(layers || [])]
    .map(n => n?.name)
    .filter(name => defining.has(String(name || '').toLowerCase().trim()));
  for (const layer of (layers || [])) {
    if (layer?.definition) found.push(...findSelfPlaced([layer.name], layer.definition.nodes, layer.definition.layers));
  }
  return [...new Set(found)];
}

/** The Things a web is the inside of. */
export function definingThingNames(graphState, graphId) {
  const protos = graphState?.nodePrototypes;
  const list = Array.isArray(protos) ? protos : (protos instanceof Map ? Array.from(protos.values()) : []);
  return list
    .filter(p => Array.isArray(p?.definitionGraphIds) && p.definitionGraphIds.includes(graphId))
    .map(p => p.name);
}

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
 * @param {string[]} [opts.definingNames] - The Things this web is the inside of.
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
      overloadedConnections: [],
      compositionEdges: [],
      selfPlaced: [],
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

  // Nodes already in the graph (expandGraph adds to one). An edge to one of
  // them is a real connection for the new node, so they count as endpoints, but
  // they are not what is being graded. They collapse into a single anchor: the
  // existing graph is one piece, and without it a new node wired only to an
  // existing one was reported as orphaned.
  const EXISTING = '\u0000existing';
  const existingSet = new Set(
    (opts.existingNames || []).map(n => String(n || '').toLowerCase().trim()).filter(n => n && !nameSet.has(n))
  );
  if (existingSet.size > 0) adj.set(EXISTING, new Set());
  const endpoint = (name) => (nameSet.has(name) ? name : existingSet.has(name) ? EXISTING : null);

  // Endpoint tallies drive the hub check: a node's degree undercounts it when the
  // model wires the same pair repeatedly, and the hub is about traffic, not
  // distinct neighbours.
  const endpointCounts = new Map();
  const relationCounts = new Map();
  let countedEdges = 0;

  for (const edge of (edges || [])) {
    const src = endpoint((edge.source || '').toLowerCase().trim());
    const tgt = endpoint((edge.target || '').toLowerCase().trim());
    if (!src || !tgt || (src === EXISTING && tgt === EXISTING)) continue;

    adj.get(src).add(tgt);
    adj.get(tgt).add(src);
    if (src !== EXISTING) endpointCounts.set(src, (endpointCounts.get(src) || 0) + 1);
    if (tgt !== EXISTING) endpointCounts.set(tgt, (endpointCounts.get(tgt) || 0) + 1);
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
    if (name === EXISTING) continue;
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

  // ── Overloaded connection names ───────────────────────────────────────────
  // An edge's own endpoints don't count: only a third Thing is hidden.
  const thingNames = [...nameSet, ...existingSet].map(nameWords);
  const connectionFaults = new Map();
  for (const edge of (edges || [])) {
    const rel = String(edge.type || edge.definitionNode?.name || '').trim();
    if (!rel || connectionFaults.has(rel)) continue;
    const ends = [nameWords(edge.source), nameWords(edge.target)];
    const fault = connectionNameFault(rel, thingNames.filter(t => !ends.includes(t)));
    if (fault) connectionFaults.set(rel, fault);
  }
  const overloadedConnections = [...connectionFaults].map(([name, fault]) => ({ name, fault }));

  // ── Composition ───────────────────────────────────────────────────────────
  const compositionEdges = findCompositionEdges(edges, layers);
  const selfPlaced = findSelfPlaced(opts.definingNames || [], nodes, layers);

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
  // No edges at all is its own question, not a pile of orphans: it can be a set of
  // members, which is right, or a web whose connections were never written.
  const noConnections = !opts.advisory && allNodes.length >= 2 && (edges || []).length === 0;
  if (noConnections) {
    issues.push(
      `NO CONNECTIONS: none of these ${allNodes.length} Things connect to anything. Most webs need connections: `
      + 'if they act on each other, connect them peer to peer by what they do. If this web is a set of members '
      + '(the kinds of a Thing, the items of a collection), leave them unconnected and say so in the description. '
      + 'Do not fill it with "Contains" edges or spokes to one center.'
    );
  }
  if (orphanedNodes.length > 0 && !noConnections) {
    // The trailing imperative belongs to the BUILD callers, which rely on it to
    // finish what they started. It is actively wrong for a caller that is asking
    // a question rather than building: a Thing can be deliberately unconnected —
    // that is the correct answer to "does this connect to anything here?" — and
    // telling the model to connect it manufactures exactly the false yes that
    // answer exists to avoid. `advisory` reports the observation without the
    // instruction.
    const orphanNote = `${orphanedNodes.length} orphaned node(s) with no connections: ${orphanedNodes.join(', ')}.`;
    issues.push(opts.advisory ? orphanNote : `${orphanNote} Connect each to the peers it acts on, or if it belongs inside one of them, move it there.`);
  }
  if (componentCount > 1 && !noConnections) {
    issues.push(`Graph has ${componentCount} disconnected components — should be 1 connected graph. Add edges to bridge them.`);
  }
  if (compositionEdges.length > 0) {
    const listed = compositionEdges.slice(0, MAX_LISTED_COMPOSITION_EDGES)
      .map(e => `"${e.source}" ${e.relation} "${e.target}"`);
    const extra = compositionEdges.length - listed.length;
    const partsByWhole = new Map();
    for (const { whole, part } of compositionEdges.slice(0, MAX_LISTED_COMPOSITION_EDGES)) {
      partsByWhole.set(whole, [...(partsByWhole.get(whole) || []), part]);
    }
    const moves = [...partsByWhole].map(([whole, parts]) => `${parts.join(', ')} inside "${whole}"`).join('; ');
    issues.push(
      `COMPOSITION AS EDGES: ${listed.join('; ')}${extra > 0 ? ` and ${extra} more` : ''}. `
      + `If one end makes up the other, use the structure instead: put ${moves}, as a layer or in its web `
      + '(if this web already is that whole, the parts just belong here), then connect the parts to each other by what they do. '
      + 'Keep an edge only if it is a real relation between peers, neither the other\'s inside, and name what it does ("Sheath Holds Sword").'
    );
  }
  if (selfPlaced.length > 0) {
    issues.push(
      `IN ITS OWN WEB: ${selfPlaced.map(n => `"${n}"`).join(', ')} placed inside the web that already is that Thing seen from inside. `
      + 'Remove it and connect what is here to each other. Keep it only if the recursion is real: a Thing truly made partly of itself.'
    );
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
      + 'Otherwise give each pair the relation that actually describes it, in as few words as it takes.'
    );
  }
  if (overloadedConnections.length > 0) {
    issues.push(
      `CONNECTION NAMES: ${overloadedConnections.map(c => `"${c.name}" ${c.fault}`).join('; ')}. `
      + 'Say only the relation: what a name invokes is a Thing, so add it and connect through it. '
      + 'Leave a name that really is the relation ("Parent Of").'
    );
  }
  if (avgConnectionsPerNode < 1.5 && allNodes.length > 2 && !hub && !noConnections) {
    issues.push(`Low connectivity (avg ${avgConnectionsPerNode} connections/node). Aim for 2-3 connections per node — between peers, not all through one node.`);
  }
  // Flatness fires only when the model has ALREADY found clusters and made them
  // plain visual groups. "Many nodes, no layers" on its own is not a defect — a
  // cast of characters with rich, varied relationships between them is a
  // genuinely flat graph and correctly modelled as one. Complaining there just
  // sends the model back to re-sketch a structure that was right the first time.
  const plainGroups = Array.isArray(opts.groups) ? opts.groups.filter(g => g && g.name) : [];
  if (layers.length === 0 && plainGroups.length > 0 && allNodes.length >= FLATNESS_NODE_THRESHOLD) {
    issues.push(
      `FLAT: ${plainGroups.length} plain group(s) (${plainGroups.map(g => `"${g.name}"`).join(', ')}) `
      + 'but no layers. You already found the clusters — if any of those names is a concept in its '
      + 'own right (something you could point at, or draw an edge to), make it a layer instead so '
      + 'its members live inside it.'
    );
  }

  // Every layer collapsed means nothing is actually spread open on the canvas:
  // the user sees plain nodes and no nesting, however much structure exists
  // behind them. This is the single most common way a composed build still
  // *looks* flat, and nothing else in the report catches it.
  if (allLayersCollapsed(layers)) {
    issues.push(
      `ALL COLLAPSED: all ${layers.length} layer(s) are "collapsed", so none of them open on the `
      + 'canvas — they render exactly like plain nodes and the nesting stays invisible. Set '
      + '`display: "decomposed"` on the ones whose contents are part of the point. Reserve '
      + '"collapsed" for supporting detail the user would have to go looking for anyway.'
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
    decomposedLayerCount: layers.filter(l => l.display !== 'collapsed').length,
    hub,
    dominantRelation,
    overloadedConnections,
    compositionEdges,
    selfPlaced,
    feedback
  };
}
