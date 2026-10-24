import { resolveGraphId } from './resolveGraphId.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';
import { suggestRelationKind, suggestArrowDirection } from './utils/suggestionCalls.js';
import { newBuildId } from '../../services/oneShot.js';
import { readWeb, findPlace } from './utils/webView.js';

/**
 * createEdge - Connect two nodes by name
 */

/** A Thing-group by its group's name, which can differ from its Thing's. */
function groupAliases(graph) {
  const groups = graph?.groups instanceof Map ? Array.from(graph.groups.values())
    : Array.isArray(graph?.groups) ? graph.groups : Object.values(graph?.groups || {});
  return groups
    .filter(g => g.linkedNodePrototypeId && g.anchorInstanceId)
    .map(g => ({ instanceId: g.anchorInstanceId, prototypeId: g.linkedNodePrototypeId, name: g.name || '' }));
}

/**
 * Resolve a node reference: an id, or a name as the web was shown to the
 * wizard (webView.js), then a Thing-group's own name, then the shared smart
 * resolver (model, substring).
 *
 * The arguments are called sourceId/targetId and readGraph hands out instance
 * ids, so a model that takes the parameter names at their word passes an id.
 * Name-only resolution failed every such call with "not found in graph" while
 * listing the very node it was given — a small local model retried that five
 * times in a row before giving up.
 */
async function resolveNodeRef(ref, web, aliases) {
  const place = findPlace(web, ref);
  if (place) return place;
  const k = String(ref || '').trim().toLowerCase();
  const alias = aliases.filter(a => a.name.trim().toLowerCase() === k).pop();
  if (alias) return web.byId.get(alias.instanceId) || alias;
  const { match } = await resolveNodeSmart(ref, [...web.places, ...aliases], { callSite: 'createEdge' });
  return match;
}

/**
 * Create an edge between two nodes
 * @param {Object} args - { sourceId, targetId, type, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Edge spec for UI application
 */
export async function createEdge(args, graphState, cid, ensureSchedulerStarted) {
  const { sourceId, targetId, type, targetGraphId } = args;
  if (!sourceId || !targetId) {
    throw new Error('sourceId and targetId are required');
  }

  const { graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Source and target by id, else by the names the web was shown under
  const web = readWeb(graphState, graphId);
  const { cover } = web;
  const aliases = groupAliases(web.graph);
  const candidates = [...web.places, ...aliases];
  const resolvedSource = await resolveNodeRef(sourceId, web, aliases);
  const resolvedTarget = await resolveNodeRef(targetId, web, aliases);

  if (!resolvedSource) {
    const available = candidates.map(c => c.name).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`Source node "${sourceId}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
  }

  if (!resolvedTarget) {
    const available = candidates.map(c => c.name).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`Target node "${targetId}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
  }

  // A formula and its own symbol, or two symbols of one formula: that
  // connection is drawn inside the formula, where it reads as an operation.
  const edgeEnds = { sourceId: resolvedSource.instanceId, destinationId: resolvedTarget.instanceId };
  if (cover.internal(edgeEnds)) {
    const f = cover.of(resolvedSource.instanceId);
    throw new Error(`"${resolvedSource.name}" and "${resolvedTarget.name}" are both inside the formula "${f.title}", so a connection between them would be drawn as part of it. Connect "${f.title}" to Things outside it.`);
  }

  console.error('[createEdge] Resolved source:', sourceId, '→', resolvedSource.instanceId);
  console.error('[createEdge] Resolved target:', targetId, '→', resolvedTarget.instanceId);

  const buildId = args.buildId || newBuildId();

  // C3 — relation kind. "kind of" is an is-a relation that belongs on the
  // abstraction axis. We NEVER silently convert the requested edge; we surface a
  // suggestion alongside it. No model → null → plain edge, as before.
  let abstractionSuggestion = null;
  try {
    const rel = await suggestRelationKind({ sourceName: resolvedSource.name, targetName: resolvedTarget.name, buildId });
    if (rel && rel.kind === 'kind-of') {
      abstractionSuggestion = {
        sourceName: resolvedSource.name,
        targetName: resolvedTarget.name,
        note: `"${resolvedSource.name}" may be a KIND of "${resolvedTarget.name}". Consider the abstraction axis (editAbstractionChain) instead of, or in addition to, this connection.`,
        callId: rel.callId
      };
    }
  } catch { abstractionSuggestion = null; }

  // C4 — arrow direction for a verb-phrase label. Default keeps source→target;
  // 'reverse' points the arrow back at the source. No model → default.
  let directionality = 'unidirectional';
  let arrowSuggested = false;
  if (type && String(type).trim()) {
    try {
      const dir = await suggestArrowDirection({ sourceName: resolvedSource.name, targetName: resolvedTarget.name, label: type, buildId });
      if (dir) {
        arrowSuggested = true;
        directionality = dir.arrowsToward === 'source' ? 'reverse' : 'unidirectional';
      }
    } catch { /* keep default */ }
  }

  return {
    action: 'createEdge',
    graphId,
    // The store falls back to these names when an id made this ask is only
    // predicted: a symbol by its Thing's own name, which it knows.
    sourceName: resolvedSource.thing || resolvedSource.name,
    targetName: resolvedTarget.thing || resolvedTarget.name,
    sourceInstanceId: resolvedSource.instanceId,
    targetInstanceId: resolvedTarget.instanceId,
    type: type || '',
    // C4 direction (applier honors it); C3 abstraction suggestion for the agent.
    directionality,
    arrowSuggested,
    abstractionSuggestion,
    buildId,
    created: true
  };
}
