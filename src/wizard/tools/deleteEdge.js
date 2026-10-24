/**
 * deleteEdge - Remove a connection between nodes
 *
 * An edgeId that is a real connection is used as given, in whichever web holds
 * it. Otherwise the names pick the connection: they must match exactly one
 * (case/spacing aside), counting connections that reach into a definition
 * opened in place in this web, whose ends live in the definition's own web.
 * Several matches or none return no action and the candidate connections, so
 * the next call can pass the edgeId.
 */

import { resolveGraphId } from './resolveGraphId.js';
import { calculateStringSimilarity } from './utils/stringSimilarity.js';

const listOf = (c) => (Array.isArray(c)
  ? c
  : c instanceof Map ? Array.from(c.values()) : Object.values(c || {}));

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const SEARCH_HINT = "Pass edgeId from search (searchType: 'connections').";

/** The names nearest to one that matched nothing. */
function closestNames(raw, names, max = 5) {
  const q = norm(raw);
  return Array.from(new Set(names))
    .map((name) => {
      const n = norm(name);
      const contains = q && n && (n.includes(q) || q.includes(n)) ? 0.5 : 0;
      return { name, score: calculateStringSimilarity(q, n) + contains };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((e) => e.name);
}

/**
 * Delete an edge
 * @param {Object} args - { edgeId?, sourceName?, targetName?, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Delete spec for UI application, or candidates with no action
 */
export async function deleteEdge(args, graphState) {
  const { edgeId, sourceName, targetName, targetGraphId } = args || {};
  if (!edgeId && !sourceName && !targetName) {
    throw new Error('edgeId or sourceName/targetName is required');
  }

  const { activeGraphId } = graphState || {};
  const graphs = listOf(graphState?.graphs);
  const edges = listOf(graphState?.edges);
  const protoById = new Map(listOf(graphState?.nodePrototypes).map((p) => [p.id, p]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const edgeIdsOf = (g) => listOf(g?.edgeIds);

  // Every instance by id, across webs: an end of a connection into an open
  // definition lives in the definition's web, not the one the edge is in.
  const instanceById = new Map();
  for (const g of graphs) {
    for (const inst of listOf(g.instances)) {
      if (inst?.id) instanceById.set(inst.id, { inst, graphId: g.id });
    }
  }
  const nameOfInstance = (inst) => inst?.name || protoById.get(inst?.prototypeId)?.name || '';
  const endName = (id) => nameOfInstance(instanceById.get(id)?.inst) || id;
  const webName = (id) => graphs.find((g) => g.id === id)?.name || id;
  const typeOf = (e) => e.name || protoById.get(listOf(e.definitionNodeIds)[0])?.name || e.type || 'Connection';
  const describe = (e, homeGraphId) => ({
    id: e.id,
    sourceName: endName(e.sourceId),
    targetName: endName(e.destinationId || e.targetId),
    type: typeOf(e),
    web: webName(homeGraphId)
  });

  // 1. A real edge id: use it, in the web that holds it.
  if (edgeId && edgeById.has(edgeId)) {
    const home = graphs.find((g) => edgeIdsOf(g).includes(edgeId));
    if (home) {
      const e = edgeById.get(edgeId);
      return {
        action: 'deleteEdge',
        graphId: home.id,
        edgeId,
        sourceName: endName(e.sourceId),
        targetName: endName(e.destinationId || e.targetId),
        deleted: true
      };
    }
  }

  const graphId = targetGraphId
    ? resolveGraphId(targetGraphId, graphs, { activeGraphId, openGraphIds: graphState?.openGraphIds })
    : activeGraphId;
  if (targetGraphId && graphs.length > 0 && !graphs.some((g) => g.id === graphId)) {
    const available = graphs.map((g) => g.name).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`No web named or with id "${targetGraphId}". Available webs: ${available || '(none)'}. Omit targetGraphId to use the active web.`);
  }
  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  if (!sourceName && !targetName) {
    return {
      deleted: false,
      notFound: true,
      edgeId,
      message: `"${edgeId}" is not a connection in any web, so nothing was deleted. Pass sourceName and targetName, or a real edgeId from search (searchType: 'connections').`
    };
  }

  // 2. The connections in reach: this web's, and those of every definition
  // opened in place in it (when the state says which are open).
  const graph = graphs.find((g) => g.id === graphId);
  const scoped = [];
  const knownNames = [];
  const seenWebs = new Set();
  const collect = (g) => {
    if (!g || seenWebs.has(g.id)) return;
    seenWebs.add(g.id);
    for (const id of edgeIdsOf(g)) {
      const e = edgeById.get(id);
      if (!e) continue;
      scoped.push({ edge: e, homeGraphId: g.id });
      knownNames.push(endName(e.sourceId), endName(e.destinationId || e.targetId));
    }
    for (const inst of listOf(g.instances)) {
      knownNames.push(nameOfInstance(inst));
      if (!inst?.openDefinition) continue;
      const defId = listOf(protoById.get(inst.prototypeId)?.definitionGraphIds)[inst.openDefinition.index ?? 0];
      collect(graphs.find((d) => d.id === defId));
    }
  };
  collect(graph);
  const nodeCount = listOf(graph?.instances).length;

  const s = sourceName ? norm(sourceName) : null;
  const t = targetName ? norm(targetName) : null;
  const ends = ({ edge }) => [norm(endName(edge.sourceId)), norm(endName(edge.destinationId || edge.targetId))];
  const matches = scoped.filter((entry) => {
    const [a, b] = ends(entry);
    if (s && t) return (a === s && b === t) || (a === t && b === s);
    const q = s || t;
    return a === q || b === q;
  });

  if (matches.length === 1) {
    const { edge, homeGraphId } = matches[0];
    return {
      action: 'deleteEdge',
      graphId: homeGraphId,
      edgeId: edge.id,
      sourceName: endName(edge.sourceId),
      targetName: endName(edge.destinationId || edge.targetId),
      deleted: true
    };
  }

  const asked = [sourceName, targetName].filter(Boolean).map((n) => `"${n}"`).join(' and ');

  if (matches.length > 1) {
    return {
      deleted: false,
      ambiguous: true,
      graphId,
      candidates: matches.map(({ edge, homeGraphId }) => describe(edge, homeGraphId)),
      message: `${matches.length} connections match ${asked}. Nothing was deleted. Call deleteEdge again with the edgeId of the one to remove.`
    };
  }

  // 3. None. Name what is near: the closest node names, or the connections the
  // named nodes do have.
  const known = new Set(knownNames.filter(Boolean).map(norm));
  const unknown = [sourceName, targetName].filter((n) => n && !known.has(norm(n)));
  const touching = scoped
    .filter((entry) => {
      const [a, b] = ends(entry);
      return (s && (a === s || b === s)) || (t && (a === t || b === t));
    })
    .slice(0, 8)
    .map(({ edge, homeGraphId }) => describe(edge, homeGraphId));

  let message;
  if (unknown.length > 0) {
    const near = closestNames(unknown[0], knownNames.filter(Boolean));
    message = `No node named ${unknown.map((n) => `"${n}"`).join(' or ')} in web "${webName(graphId)}" (${nodeCount} nodes)`
      + (near.length > 0 ? `; closest: ${near.map((n) => `"${n}"`).join(', ')}` : '')
      + `. Nothing was deleted. ${SEARCH_HINT}`;
  } else {
    message = `No connection ${s && t ? `between "${sourceName}" and "${targetName}"` : `touching ${asked}`} in web "${webName(graphId)}". Nothing was deleted. ${SEARCH_HINT}`;
  }

  return {
    deleted: false,
    notFound: true,
    graphId,
    ...(touching.length > 0 ? { candidates: touching } : {}),
    message
  };
}
