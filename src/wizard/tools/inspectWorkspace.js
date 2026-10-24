import { resolveGraphId, describeGraphAmbiguity } from './resolveGraphId.js';
import { estimateTokens } from '../tokenEstimate.js';
import { OPERATORS } from '../../components/canvas/formats/formula/formulaNotation.js';

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

/** Formulas a web holds listed by name up to this many; past it, a count and the first few. */
const MAX_FORMULAS_LISTED = 3;

/** A web this large is not one formula (formulaSnapshot's MAX_EQUATION_WEB). */
const MAX_EQUATION_WEB = 200;

const OPERATOR_NAMES = new Set(Object.values(OPERATORS).map(op => op.name.toLowerCase()));

function getGroups(graph) {
  if (!graph?.groups) return [];
  if (graph.groups instanceof Map) return Array.from(graph.groups.values());
  if (Array.isArray(graph.groups)) return graph.groups;
  return Object.values(graph.groups || {});
}

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
 * The webs that are formulas' insides: an equation's definition, and each of
 * its parts' (the parentheses, Thing-groups in it with webs of their own). In
 * a universe with the formula bank these are most of the webs, and listing
 * them would spend the whole map on formula internals. The map shows an
 * equation as one formula and never descends into it.
 *
 * Equations are known exactly from the snapshot when it carries them
 * (formulaSnapshot.js: universeEquations, formulas) and from formula groups.
 * The MCP bridge's state carries neither, so a web also reads as an equation
 * when every connection in it is an operation (Equality, Multiplication...),
 * as buildFormula writes them, and no formula group holds them (a web that
 * shows a formula and nothing else is still a web).
 *
 * @returns {{ equations: Set<string>, parts: Set<string>, webs: Set<string> }} graph ids
 */
function indexFormulas(graphs, edges, idx, graphState) {
  const edgeById = new Map();
  for (const e of edges) {
    if (e?.id) edgeById.set(e.id, e);
  }

  // A web showing formulas holds them in formula groups; an equation's inside is bare.
  const showsFormulas = (graph) => getGroups(graph).some(g => g?.format === 'formula');

  const readsAsOperations = (graph) => {
    const size = getInstances(graph).length;
    const edgeIds = Array.isArray(graph?.edgeIds) ? graph.edgeIds : [];
    if (size < 2 || size > MAX_EQUATION_WEB || edgeIds.length === 0 || showsFormulas(graph)) return false;
    return edgeIds.every((id) => {
      const defId = edgeById.get(id)?.definitionNodeIds?.[0];
      const name = defId ? idx.protoById.get(defId)?.name : null;
      return !!name && OPERATOR_NAMES.has(String(name).toLowerCase());
    });
  };

  const known = new Set();
  for (const e of graphState?.universeEquations || []) if (e?.protoId) known.add(e.protoId);
  for (const e of graphState?.equations || []) if (e?.protoId) known.add(e.protoId);
  for (const f of graphState?.formulas || []) if (f?.equationProtoId) known.add(f.equationProtoId);

  // Formula groups: the equation is their Thing; Thing-groups inside one are its parts.
  const partProtos = new Set();
  for (const g of graphs) {
    const groups = getGroups(g);
    for (const fg of groups) {
      if (fg?.format !== 'formula') continue;
      if (fg.linkedNodePrototypeId) known.add(fg.linkedNodePrototypeId);
      const members = new Set(fg.memberInstanceIds || []);
      for (const part of groups) {
        if (part === fg || !part?.linkedNodePrototypeId) continue;
        const ids = part.memberInstanceIds || [];
        const inside = members.has(part.anchorInstanceId) || (ids.length > 0 && ids.every(id => members.has(id)));
        if (inside) partProtos.add(part.linkedNodePrototypeId);
      }
    }
  }

  const equations = new Set();
  for (const [protoId, defs] of idx.definitionsOf) {
    const readable = defs.filter(gid => readsAsOperations(idx.graphById.get(gid)));
    if (readable.length > 0) readable.forEach(gid => equations.add(gid));
    else if (known.has(protoId) && idx.graphById.has(defs[0]) && !showsFormulas(idx.graphById.get(defs[0]))) equations.add(defs[0]);
  }

  // Parts, and parts of parts: every Thing-group inside a formula's web.
  const parts = new Set();
  const queue = [...equations];
  const addPart = (protoId) => {
    for (const gid of idx.definitionsOf.get(protoId) || []) {
      if (parts.has(gid) || !idx.graphById.has(gid)) continue;
      parts.add(gid);
      queue.push(gid);
    }
  };
  partProtos.forEach(addPart);
  while (queue.length > 0) {
    const gid = queue.pop();
    for (const g of getGroups(idx.graphById.get(gid))) {
      if (g?.linkedNodePrototypeId) addPart(g.linkedNodePrototypeId);
    }
  }
  // A part's web reads as operations too; a part is never listed as an equation.
  for (const gid of parts) equations.delete(gid);

  return { equations, parts, webs: new Set([...equations, ...parts]) };
}

/**
 * Every web reachable from a root, however deep. What the map leaves out for
 * depth or size is still reachable; only what this misses is unplaced.
 */
function reachableFrom(roots, idx) {
  const seen = new Set();
  const stack = roots.map(r => r.id);
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id) || !idx.graphById.has(id)) continue;
    seen.add(id);
    for (const kid of idx.childGraphs.get(id) || []) {
      if (!seen.has(kid.graphId)) stack.push(kid.graphId);
    }
  }
  return seen;
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
function renderMap(roots, idx, { activeGraphId, openIds, maxDepth, budget, formulas }) {
  const lines = [];
  let spent = 0;
  let omitted = 0;
  const visited = new Set();
  // What made it onto the map: a web walked past the budget is visited, not shown.
  const shown = new Set();

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

  const marksOf = (graphId) => {
    if (graphId === activeGraphId) return ['ACTIVE'];
    return openIds.includes(graphId) ? ['open'] : [];
  };

  // Equations as formulas, not webs: each by name, or past a few, a count.
  const pushFormulas = (items, depth) => {
    const indent = '  '.repeat(depth);
    if (items.length <= MAX_FORMULAS_LISTED) {
      for (const item of items) {
        if (push(`${indent}- ${item.name} [${['formula', ...marksOf(item.graphId)].join(', ')}] {${item.graphId}}`)) shown.add(item.graphId);
      }
      return;
    }
    const names = items.slice(0, MAX_FORMULAS_LISTED).map(item => item.name).join(', ');
    if (push(`${indent}- ${items.length} formulas: ${names}, … (inspect this web for the rest)`)) {
      items.forEach(item => shown.add(item.graphId));
    }
  };

  // A formula's inside is walked only on the way to the active graph.
  const asFormula = (kid) => formulas.webs.has(kid.graphId) && !mustExpand.has(kid.graphId);
  const nameOf = (kid) => idx.protoById.get(kid.viaProtoId)?.name || idx.graphById.get(kid.graphId)?.name || 'Unnamed';

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
    const marks = marksOf(g.id);
    if (formulas.webs.has(g.id)) marks.unshift('formula');

    const label = viaName && viaName !== g.name ? `${viaName} :: ${g.name}` : (g.name || 'Unnamed');
    const line = `${'  '.repeat(depth)}- ${label} (${instances.length}n/${edgeCount}e)`
      + (marks.length ? ` [${marks.join(', ')}]` : '')
      + ` {${g.id}}`;
    if (!push(line)) return;
    shown.add(graphId);

    // A formula's parts are drawn in it, not nested webs of their own.
    const kids = (idx.childGraphs.get(graphId) || [])
      .filter(kid => !formulas.parts.has(kid.graphId) || mustExpand.has(kid.graphId));
    if (kids.length === 0) return;

    const beyondDepth = depth + 1 > maxDepth && !mustExpand.has(graphId);
    if (beyondDepth) {
      push(`${'  '.repeat(depth + 1)}… ${kids.length} nested web${kids.length !== 1 ? 's' : ''} (raise depth or inspect directly)`);
      return;
    }

    for (const kid of kids) {
      if (asFormula(kid)) continue;
      const proto = idx.protoById.get(kid.viaProtoId);
      walk(kid.graphId, depth + 1, proto?.name || null);
    }
    const shownAsFormulas = kids.filter(asFormula).map(kid => ({ graphId: kid.graphId, name: nameOf(kid) }));
    if (shownAsFormulas.length > 0) pushFormulas(shownAsFormulas, depth + 1);
  };

  // An equation placed in no web is still listed, as a formula; a part never is.
  const formulaRoots = [];
  for (const root of roots) {
    if (formulas.webs.has(root.id) && !mustExpand.has(root.id)) {
      if (formulas.equations.has(root.id)) formulaRoots.push({ graphId: root.id, name: root.name || 'Unnamed' });
      continue;
    }
    walk(root.id, 0, null);
  }
  if (formulaRoots.length > 0) pushFormulas(formulaRoots, 0);

  return { text: lines.join('\n'), omitted, shown };
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
    const formulas = indexFormulas(graphs, edges, idx, graphState);
    const { text, omitted, shown } = renderMap(roots, idx, {
      activeGraphId, openIds, maxDepth, budget: MAP_TOKEN_BUDGET, formulas
    });

    // Graphs no root reaches — orphaned webs whose defining Thing was deleted,
    // or standalone webs never placed anywhere. They are real and reachable, so
    // leaving them off the map entirely would be a lie. Reach is a full walk:
    // what the map cut for depth or size is nested, not orphaned.
    const reached = reachableFrom(roots, idx);
    const unreached = graphs.filter(g => g?.id && !reached.has(g.id));
    const notShown = graphs.filter(g => g?.id && reached.has(g.id) && !shown.has(g.id));
    const insideFormulas = notShown.filter(g => formulas.webs.has(g.id)).length;
    const beyond = notShown.length - insideFormulas;

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
    if (beyond > 0) {
      result.beyondGraphs = beyond;
      result.beyondNote = `${beyond} web(s) are nested past the depth or size budget the map shows — placed, not orphaned. `
        + 'Raise depth, or inspect a graphId.';
    }
    if (insideFormulas > 0) {
      result.formulaWebs = insideFormulas;
      result.formulaNote = `${insideFormulas} web(s) are formulas' insides (equations' and their parts' definitions), not listed: `
        + 'the map names a web\'s formulas, or counts them, and never opens one.';
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
