import { resolveGraphId, describeGraphAmbiguity } from './resolveGraphId.js';
import { estimateTokens } from '../tokenEstimate.js';

/**
 * inspectWorkspace - How the model sees a whole universe without loading one.
 *
 * This tool has been wrong twice in opposite directions. It began by returning
 * every node, edge and group of every graph, which on a 75-graph universe
 * produced a dump large enough to crowd out the conversation it was meant to
 * inform. The fix was a flat census — every graph reduced to a name and three
 * counts — which was small but told the model almost nothing, because it threw
 * away the one thing that makes a Redstring universe navigable.
 *
 * A universe is not a list of graphs. It is a composition structure: a Thing has
 * a web inside it, that web contains other Things, and those have webs of their
 * own. Flattening it to an alphabetical roster destroys exactly the relationships
 * the model needs to decide where something belongs, and leaves it re-authoring
 * webs that already exist three levels down because it had no way to see them.
 *
 * So the tool now answers the three questions actually worth asking, and the
 * caller picks one rather than getting an undifferentiated dump:
 *
 *   mode: 'map'      Where does everything sit relative to everything else?
 *   mode: 'graph'    What are the IDs inside this one graph?
 *   mode: 'reusable' What already exists that I should invoke instead of rebuild?
 *
 * Every mode is token-budgeted and says so when it truncates. A model that
 * believes it has seen the whole universe will confidently act as though the
 * parts it wasn't shown do not exist.
 */

/** Cap on nodes/edges listed for a single graph before the list is summarized. */
const MAX_NODES_PER_GRAPH = 60;
const MAX_EDGES_PER_GRAPH = 60;

/**
 * Token ceiling for the map. Small on purpose: this is orientation, not content,
 * and it competes for the same window as the work itself.
 */
const MAP_TOKEN_BUDGET = 1500;

/** How deep the map descends before summarizing, unless asked for more. */
const DEFAULT_MAP_DEPTH = 3;
const MAX_MAP_DEPTH = 6;

/** Cap on entries in the reusable-webs index. */
const MAX_REUSABLE = 40;

function getInstances(graph) {
  if (!graph?.instances) return [];
  if (graph.instances instanceof Map) return Array.from(graph.instances.values());
  if (Array.isArray(graph.instances)) return graph.instances;
  return Object.values(graph.instances || {});
}

/**
 * Index the composition structure once.
 *
 * Two directions matter and neither is stored on the objects themselves:
 *   graph → the prototypes it defines (a graph is "inside" those Things)
 *   prototype → the graphs it is instanced in (where that Thing appears)
 *
 * Building both up front is what lets the map walk down and the breadcrumb walk
 * up without re-scanning the universe at every step.
 */
function indexComposition(graphs, nodePrototypes) {
  const protoById = new Map();
  for (const p of nodePrototypes) {
    if (p?.id) protoById.set(p.id, p);
  }

  const graphById = new Map();
  for (const g of graphs) {
    if (g?.id) graphById.set(g.id, g);
  }

  // graphId → [{ protoId, name }] : the Things this graph is the inside of.
  const definedBy = new Map();
  // protoId → definition graph ids
  const definitionsOf = new Map();
  for (const p of nodePrototypes) {
    const defs = Array.isArray(p?.definitionGraphIds) ? p.definitionGraphIds : [];
    if (defs.length > 0) definitionsOf.set(p.id, defs);
    for (const gid of defs) {
      if (!definedBy.has(gid)) definedBy.set(gid, []);
      definedBy.get(gid).push({ protoId: p.id, name: p.name || 'Unnamed' });
    }
  }

  // protoId → Set(graphId) : every graph this Thing appears in.
  const instancedIn = new Map();
  for (const g of graphs) {
    for (const inst of getInstances(g)) {
      if (!inst?.prototypeId) continue;
      if (!instancedIn.has(inst.prototypeId)) instancedIn.set(inst.prototypeId, new Set());
      instancedIn.get(inst.prototypeId).add(g.id);
    }
  }

  // graphId → child graph ids, via the prototypes instanced inside it.
  const childGraphs = new Map();
  for (const g of graphs) {
    const kids = [];
    const seen = new Set();
    for (const inst of getInstances(g)) {
      const defs = definitionsOf.get(inst?.prototypeId);
      if (!defs) continue;
      for (const gid of defs) {
        if (gid === g.id || seen.has(gid)) continue;
        seen.add(gid);
        kids.push({ graphId: gid, viaProtoId: inst.prototypeId });
      }
    }
    childGraphs.set(g.id, kids);
  }

  return { protoById, graphById, definedBy, definitionsOf, instancedIn, childGraphs };
}

/**
 * Graphs nothing else contains. These are the tops of the composition structure
 * and the natural roots of the map.
 *
 * A graph is a root when the Thing it defines appears nowhere else — nobody has
 * placed that Thing inside another web, so there is no path down to it.
 */
function findRoots(graphs, idx) {
  const roots = [];
  for (const g of graphs) {
    const definers = idx.definedBy.get(g.id) || [];
    if (definers.length === 0) { roots.push(g); continue; }
    // "Placed somewhere" has to mean somewhere ELSE. A Thing that appears only
    // inside its own web — a legitimate recursive composition — has no parent
    // above it, so treating that self-reference as a home would drop the graph
    // out of the map entirely rather than rooting it.
    const placedSomewhere = definers.some(d => {
      const homes = idx.instancedIn.get(d.protoId);
      if (!homes) return false;
      for (const home of homes) {
        if (home !== g.id) return true;
      }
      return false;
    });
    if (!placedSomewhere) roots.push(g);
  }
  return roots;
}

/**
 * Walk up from a graph to a root, following "the Thing this defines lives in
 * that graph". Gives the model its position without it having to ask.
 */
function ancestryPath(graphId, idx, limit = 12) {
  const path = [];
  const seen = new Set();
  let current = graphId;

  while (current && !seen.has(current) && path.length < limit) {
    seen.add(current);
    const g = idx.graphById.get(current);
    if (!g) break;
    path.unshift({ graphId: g.id, name: g.name || 'Unnamed' });

    const definers = idx.definedBy.get(current) || [];
    let next = null;
    for (const d of definers) {
      const homes = idx.instancedIn.get(d.protoId);
      if (!homes) continue;
      for (const gid of homes) {
        // A web that contains the Thing it defines is a legitimate recursive
        // structure, but following that link walks in a circle forever.
        if (gid !== current && !seen.has(gid)) { next = gid; break; }
      }
      if (next) break;
    }
    current = next;
  }

  return path;
}

/**
 * Render the composition structure as an indented tree, spending its budget on
 * what is nearest the user's attention.
 */
function renderMap(roots, idx, { activeGraphId, openIds, maxDepth, budget }) {
  const lines = [];
  let spent = 0;
  let omitted = 0;
  const visited = new Set();

  // The active graph's ancestors are always expanded regardless of depth: a map
  // that stops short of where the user actually is has failed at its one job.
  const mustExpand = new Set(
    activeGraphId ? ancestryPath(activeGraphId, idx).map(p => p.graphId) : []
  );

  const push = (line) => {
    const cost = estimateTokens(line);
    if (spent + cost > budget) { omitted++; return false; }
    lines.push(line);
    spent += cost;
    return true;
  };

  const walk = (graphId, depth, viaName) => {
    const g = idx.graphById.get(graphId);
    if (!g) return;

    // A Thing can appear in several webs; showing its whole subtree at each one
    // multiplies the map by its own reuse.
    if (visited.has(graphId)) {
      push(`${'  '.repeat(depth)}- ${viaName || g.name} → (see "${g.name}" above)`);
      return;
    }
    visited.add(graphId);

    const instances = getInstances(g);
    const edgeCount = Array.isArray(g.edgeIds) ? g.edgeIds.length : 0;
    const marks = [];
    if (g.id === activeGraphId) marks.push('ACTIVE');
    else if (openIds.includes(g.id)) marks.push('open');

    const label = viaName && viaName !== g.name ? `${viaName} :: ${g.name}` : (g.name || 'Unnamed');
    const line = `${'  '.repeat(depth)}- ${label} (${instances.length}n/${edgeCount}e)`
      + (marks.length ? ` [${marks.join(', ')}]` : '')
      + ` {${g.id}}`;
    if (!push(line)) return;

    const kids = idx.childGraphs.get(graphId) || [];
    if (kids.length === 0) return;

    const beyondDepth = depth + 1 > maxDepth && !mustExpand.has(graphId);
    if (beyondDepth) {
      push(`${'  '.repeat(depth + 1)}… ${kids.length} nested web${kids.length !== 1 ? 's' : ''} (raise depth or inspect directly)`);
      return;
    }

    for (const kid of kids) {
      const proto = idx.protoById.get(kid.viaProtoId);
      walk(kid.graphId, depth + 1, proto?.name || null);
    }
  };

  for (const root of roots) walk(root.id, 0, null);

  return { text: lines.join('\n'), omitted, visited };
}

/**
 * Get a fast, comprehensive overview of the workspace.
 *
 * @param {Object} args - { mode?, graphId?, depth?, query?, includeAllGraphs? }
 * @param {Object} graphState - Current state
 */
export async function inspectWorkspace(args, graphState) {
  const { graphId, includeAllGraphs, depth, query } = args || {};

  const { graphs = [], nodePrototypes = [], edges = [], activeGraphId, openGraphIds = [] } = graphState;
  const openIds = Array.isArray(openGraphIds) ? openGraphIds : [];

  // `includeAllGraphs` predates the modes and still appears in saved
  // conversations, so it keeps working — it always meant "show me everything",
  // which is what the map does properly.
  const mode = args?.mode || (includeAllGraphs ? 'map' : 'graph');

  const idx = indexComposition(graphs, nodePrototypes);

  // Every mode carries the breadcrumb. It is a handful of tokens and it answers
  // "where am I" — which the model otherwise has to infer from the active
  // graph's name alone, and frequently infers wrongly.
  const activeGraphPath = activeGraphId
    ? ancestryPath(activeGraphId, idx).map(p => p.name)
    : [];

  if (mode === 'map') {
    const roots = findRoots(graphs, idx);
    const maxDepth = Math.min(
      Math.max(1, Number.isFinite(Number(depth)) ? Math.floor(Number(depth)) : DEFAULT_MAP_DEPTH),
      MAX_MAP_DEPTH
    );
    const { text, omitted, visited } = renderMap(roots, idx, {
      activeGraphId, openIds, maxDepth, budget: MAP_TOKEN_BUDGET
    });

    // Graphs no root reaches — orphaned webs whose defining Thing was deleted,
    // or standalone webs never placed anywhere. They are real and reachable, so
    // leaving them off the map entirely would be a lie.
    const unreached = graphs.filter(g => g?.id && !visited.has(g.id));

    const result = {
      mode: 'map',
      totalGraphs: graphs.length,
      totalPrototypes: nodePrototypes.length,
      activeGraphId,
      activeGraphPath,
      map: text,
      legend: 'Indentation is composition: a nested line is a web living inside the Thing above it. '
        + '(Nn/Ne) is node and connection counts; {id} is the graphId to pass to other tools.',
      note: 'Structure only. For a graph\'s contents call inspectWorkspace with mode "graph", '
        + 'or readGraph. To find webs you can reuse instead of re-authoring, use mode "reusable".'
    };

    if (unreached.length > 0) {
      result.unreachedGraphs = unreached.slice(0, 20).map(g => ({ graphId: g.id, name: g.name || 'Unnamed' }));
      result.unreachedNote = `${unreached.length} web(s) are not nested under any root — standalone or orphaned.`;
    }
    if (omitted > 0) {
      result.truncated = true;
      result.truncationNote = `${omitted} line(s) omitted to stay within the map's size budget. `
        + 'Pass a smaller depth, or inspect a specific graphId.';
    }
    return result;
  }

  if (mode === 'reusable') {
    // Things that already have a web. This is the index that makes buildComposition's
    // `use:` practical — without it the model has no way to discover that the web
    // it is about to author already exists somewhere in the universe.
    const q = String(query || '').toLowerCase().trim();
    const entries = [];
    for (const [protoId, defs] of idx.definitionsOf) {
      const proto = idx.protoById.get(protoId);
      if (!proto?.name) continue;
      if (q && !proto.name.toLowerCase().includes(q)) continue;

      const defGraph = idx.graphById.get(defs[0]);
      const componentCount = defGraph ? getInstances(defGraph).length : 0;
      const homes = idx.instancedIn.get(protoId);
      entries.push({
        name: proto.name,
        prototypeId: protoId,
        definitionGraphId: defs[0],
        componentCount,
        usedInGraphs: homes ? homes.size : 0,
        description: (proto.description || '').slice(0, 100)
      });
    }

    // Richest webs first: a Thing with a substantial web is worth reusing, an
    // empty one is not.
    entries.sort((a, b) => b.componentCount - a.componentCount);
    const shown = entries.slice(0, MAX_REUSABLE);

    return {
      mode: 'reusable',
      activeGraphPath,
      totalReusable: entries.length,
      things: shown,
      note: 'These Things already have webs. To place one inside the current graph, '
        + 'call buildComposition with { "name": "<name>", "use": "<name>" } rather than authoring its contents again.',
      ...(entries.length > shown.length
        ? { truncated: true, truncationNote: `Showing ${shown.length} of ${entries.length}. Pass a query to narrow.` }
        : {})
    };
  }

  // ── mode: 'graph' — structure and identifiers for one graph ────────────────
  const targetGraphId = resolveGraphId(graphId, graphs, { activeGraphId, openGraphIds }) || activeGraphId;
  const ambiguityNote = describeGraphAmbiguity(graphId, graphs, targetGraphId);

  const graph = graphs.find(g => g.id === targetGraphId);
  if (!graph) {
    return `Graph ${targetGraphId || '(none)'} not found. Call inspectWorkspace with mode "map" to see what exists.`;
  }

  const edgesById = new Map();
  for (const e of edges) {
    if (e?.id) edgesById.set(e.id, e);
  }

  const instances = getInstances(graph);
  const graphEdges = [];
  for (const eid of (Array.isArray(graph.edgeIds) ? graph.edgeIds : [])) {
    const e = edgesById.get(eid);
    if (e) graphEdges.push(e);
  }
  const groups = Array.isArray(graph.groups) ? graph.groups : [];

  const nodeOverflow = Math.max(0, instances.length - MAX_NODES_PER_GRAPH);
  const edgeOverflow = Math.max(0, graphEdges.length - MAX_EDGES_PER_GRAPH);

  const nodes = instances.slice(0, MAX_NODES_PER_GRAPH).map(inst => {
    const proto = idx.protoById.get(inst.prototypeId);
    return {
      instanceId: inst.id,
      prototypeId: inst.prototypeId,
      name: proto?.name || inst.name || 'Unknown',
      color: proto?.color || '',
      type: proto?.typeNodeId ? (idx.protoById.get(proto.typeNodeId)?.name || proto.typeNodeId) : null,
      hasDefinitionGraphs: (proto?.definitionGraphIds?.length || 0) > 0,
      definitionGraphCount: proto?.definitionGraphIds?.length || 0
    };
  });

  const edgeList = graphEdges.slice(0, MAX_EDGES_PER_GRAPH).map(e => {
    const srcProto = idx.protoById.get(e.sourceId);
    const dstProto = idx.protoById.get(e.destinationId);
    const typeProto = e.typeNodeId ? idx.protoById.get(e.typeNodeId) : null;
    return {
      edgeId: e.id,
      source: srcProto?.name || e.sourceId,
      sourceId: e.sourceId,
      target: dstProto?.name || e.destinationId,
      targetId: e.destinationId,
      type: typeProto?.name || e.type || e.name || ''
    };
  });

  const groupList = groups.map(g => ({
    groupId: g.id,
    name: g.name || 'Unnamed',
    memberCount: g.memberInstanceIds?.length || 0,
    // linkedNodePrototypeId is THE discriminator (definingNodeId/definedByNodeId
    // are not fields on a group, so this always reported false).
    isThingGroup: !!g.linkedNodePrototypeId
  }));

  const result = {
    mode: 'graph',
    graphId: graph.id,
    name: graph.name || 'Unnamed',
    isActive: graph.id === activeGraphId,
    path: ancestryPath(graph.id, idx).map(p => p.name),
    nodes,
    edges: edgeList,
    groups: groupList,
    counts: {
      nodes: instances.length,
      edges: graphEdges.length,
      groups: groupList.length,
      nestedWebs: (idx.childGraphs.get(graph.id) || []).length
    }
  };

  if (nodeOverflow > 0 || edgeOverflow > 0) {
    result.truncated = true;
    result.truncationNote =
      `Listing capped: showing ${nodes.length} of ${instances.length} nodes and `
      + `${edgeList.length} of ${graphEdges.length} connections. `
      + 'Use searchNodes or searchConnections with a query to reach the rest.';
  }

  if (ambiguityNote) result.ambiguity = ambiguityNote;

  if (graph.id === activeGraphId) {
    result.note =
      'This is the active graph — its names, types, descriptions and connection '
      + 'triplets are already in your context header. Use the IDs here for tools '
      + 'that need them; do not re-read this graph just to see its contents.';
  }

  return result;
}
