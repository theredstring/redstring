import { resolveGraphId } from './resolveGraphId.js';
import { resolveNodeSmart } from './utils/resolveNodeSmart.js';
import { suggestRelationKind, suggestArrowDirection } from './utils/suggestionCalls.js';
import { newBuildId } from '../../services/oneShot.js';

/**
 * createEdge - Connect two nodes by name
 */

/**
 * Build the candidate list (instances + thing-groups) for a graph.
 */
function buildCandidates(nodePrototypes, graphs, graphId) {
  const targetGraph = graphs.find(g => g.id === graphId);
  if (!targetGraph) return [];

  const instances = Array.isArray(targetGraph.instances)
    ? targetGraph.instances
    : targetGraph.instances instanceof Map
      ? Array.from(targetGraph.instances.values())
      : Object.values(targetGraph.instances || {});

  const candidates = instances.map(inst => {
    const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
    return {
      instanceId: inst.id,
      prototypeId: inst.prototypeId,
      name: inst.name || proto?.name || '',
      description: inst.description || proto?.description || ''
    };
  });

  const groups = Array.isArray(targetGraph.groups)
    ? targetGraph.groups
    : targetGraph.groups instanceof Map
      ? Array.from(targetGraph.groups.values())
      : Object.values(targetGraph.groups || {});

  for (const group of groups) {
    if (!group.linkedNodePrototypeId || !group.anchorInstanceId) continue;
    candidates.push({
      instanceId: group.anchorInstanceId,
      prototypeId: group.linkedNodePrototypeId,
      name: group.name || ''
    });
  }

  return candidates;
}

/**
 * Resolve a node by name via the shared smart resolver (exact → model → substring).
 */
async function resolveNodeByName(name, candidates) {
  const { match } = await resolveNodeSmart(name, candidates, { callSite: 'createEdge' });
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

  const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

  if (!graphId) {
    throw new Error('No target graph specified and no active graph available.');
  }

  // Resolve source and target by name (exact → model → substring)
  const candidates = buildCandidates(nodePrototypes, graphs, graphId);
  const resolvedSource = await resolveNodeByName(sourceId, candidates);
  const resolvedTarget = await resolveNodeByName(targetId, candidates);

  if (!resolvedSource) {
    const available = candidates.map(c => c.name).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`Source node "${sourceId}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
  }

  if (!resolvedTarget) {
    const available = candidates.map(c => c.name).filter(Boolean).slice(0, 8).join(', ');
    throw new Error(`Target node "${targetId}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
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
    sourceName: resolvedSource.name,
    targetName: resolvedTarget.name,
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
