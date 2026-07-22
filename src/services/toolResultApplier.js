/**
 * toolResultApplier.js
 *
 * Applies wizard/MCP tool results to the Redstring store. Extracted verbatim
 * from LeftAIView.jsx so the browser and the Node daemon (wizard-server
 * headless mode) apply mutations through the identical code path — including
 * the critical resolve-by-name-take-LAST semantics (see MEMORY.md: predictive
 * IDs from AgentLoop never match real store IDs, so handlers resolve entities
 * by name and take the LAST match).
 *
 * Environment handling:
 *  - Browser globals (window.dispatchEvent / CustomEvent) are all
 *    `typeof window` guarded in the moved code, so they are automatic no-ops
 *    in Node — exactly the "no-op emit headless" behavior we want.
 *  - Wikipedia enrichment is browser-specific (fetch + thumbnail cache), so it
 *    is INJECTED: the browser calls configureToolResultApplier() with the real
 *    enrichNodeWithWikipedia / enrichMultipleNodes; a headless host leaves the
 *    no-op defaults (or supplies its own later).
 *  - useGraphStore is the same module singleton in both hosts (the daemon's
 *    createHeadlessStore imports the very same module), so it is imported
 *    directly rather than injected.
 */
import useGraphStore from '../store/graphStore.js';
import { resolveGraphId } from '../wizard/tools/resolveGraphId.js';
import { applyOffscreenLayout } from './offscreenLayout.js';
import { NODE_DEFAULT_COLOR } from '../constants.js';
import { attachOneShotOutcome } from './oneShot.js';

// Part B — structure-review follow-through. The most recent build's group/fold
// suggestions (with their one-shot callIds) are held here; when the user's next
// action creates a matching group/fold, we attach an 'accepted' outcome to the
// suggestion's call so the training log records the follow-through. Suggestions
// are NEVER auto-applied — this only observes what the user chose to do.
let __pendingStructureSuggestions = [];
function noteStructureFollowThrough(groupName, memberNames) {
  if (!__pendingStructureSuggestions.length) return;
  const nl = String(groupName || '').toLowerCase().trim();
  const memberSet = new Set((memberNames || []).map((m) => String(m || '').toLowerCase().trim()));
  for (let i = 0; i < __pendingStructureSuggestions.length; i++) {
    const s = __pendingStructureSuggestions[i];
    const nameMatch = s.suggestedName && String(s.suggestedName).toLowerCase().trim() === nl;
    const membersMatch = Array.isArray(s.nodeNames) && s.nodeNames.length > 0 &&
      s.nodeNames.every((n) => memberSet.has(String(n || '').toLowerCase().trim()));
    if (nameMatch || membersMatch) {
      if (s.structureCallId) attachOneShotOutcome(s.structureCallId, 'accepted');
      __pendingStructureSuggestions.splice(i, 1);
      return;
    }
  }
}

/**
 * Lay out a graph the wizard just mutated.
 *
 * Background graphs are laid out immediately and silently — nobody is
 * watching, so a snap is fine. The ACTIVE graph is skipped here on purpose:
 * the rs-trigger-auto-layout handler in NodeCanvas runs the animated tween
 * for it, and pre-applying positions here would teleport the nodes to their
 * final spots, leaving nothing to animate. (Headless hosts have no canvas
 * listener; they run applyOffscreenLayout themselves via the runtime.)
 */
function layoutAfterWizardMutation(graphId) {
  try {
    if (typeof window !== 'undefined' && useGraphStore.getState().activeGraphId === graphId) {
      return; // animated path in NodeCanvas handles the active graph
    }
    applyOffscreenLayout(graphId);
  } catch (e) {
    console.warn('[Wizard] Offscreen layout failed:', e);
  }
}

/**
 * Execute an A3 unfold plan (from createPopulatedGraph's spec.unfoldPlan): for
 * each member, create a definition graph and populate it with the member's
 * contents. The tool decided the plan (all one-off calls, correlated by buildId);
 * this is the store-side executor. Runs after the top graph is populated.
 *
 * Members are resolved by NAME against the live store (predictive IDs never
 * match) — take the LAST match, since old prototypes accumulate in the Maps.
 * Returns an array describing what was unfolded (member → def graph id + shape).
 */
function applyUnfoldPlan(unfoldPlan, { enrich = true, overwriteDescription = false } = {}) {
  const applied = [];
  const members = (unfoldPlan && Array.isArray(unfoldPlan.members)) ? unfoldPlan.members : [];
  for (let idx = 0; idx < members.length; idx++) {
    const member = members[idx];
    if (!member || !member.memberName || !Array.isArray(member.nodes) || member.nodes.length === 0) continue;
    try {
      // Re-fetch fresh state each iteration — earlier iterations mutated the store.
      const st = useGraphStore.getState();
      const nameLower = member.memberName.toLowerCase().trim();

      let realProtoId = null;
      for (const [pid, proto] of st.nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === nameLower) realProtoId = pid; // LAST match
      }
      if (!realProtoId) {
        console.warn('[Wizard] unfold: could not resolve member prototype:', member.memberName);
        continue;
      }

      // Reuse an existing definition graph if the member already has one, else make one.
      const proto = st.nodePrototypes.get(realProtoId);
      let defGraphId = (proto?.definitionGraphIds && proto.definitionGraphIds[0]) || null;
      if (defGraphId && st.graphs.get(defGraphId)?.instances?.size > 0) {
        // Already populated — don't double-fill.
        continue;
      }
      if (!defGraphId) {
        defGraphId = `graph-def-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
        st.createDefinitionGraphWithId(defGraphId, realProtoId);
      }

      const bulkData = {
        nodes: member.nodes.map((n, i) => ({
          name: n.name,
          color: n.color || NODE_DEFAULT_COLOR,
          description: n.description || '',
          prototypeId: `proto-${Date.now()}-${idx}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          instanceId: `inst-${Date.now()}-${idx}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          x: Math.random() * 600 + 200,
          y: Math.random() * 500 + 200,
          semanticMetadata: wizardSemanticMetadata()
        })),
        edges: (member.edges || []).map(e => ({
          source: e.source,
          target: e.target,
          type: e.type || 'relates to',
          directionality: e.directionality || 'unidirectional',
          definitionNode: e.definitionNode || null
        })),
        groups: []
      };

      st.applyBulkGraphUpdates(defGraphId, bulkData);
      try { st.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] unfold cleanup failed:', e); }

      // Non-active graphs need offscreen layout AND the DOM-based event (project
      // convention — rs-trigger-auto-layout only fires for the active graph).
      layoutAfterWizardMutation(defGraphId);
      const gid = defGraphId;
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('rs-trigger-auto-layout', { detail: { graphId: gid } }));
        }
      }, 600);

      if (enrich) {
        const insideNames = member.nodes.map(n => n.name);
        setTimeout(() => {
          _enrichMultiple(insideNames, gid, { overwriteDescription }).catch(err => {
            console.warn('[Auto-Enrich] Unfold enrichment failed:', err);
          });
        }, 1000);
      }

      applied.push({ member: member.memberName, graphId: defGraphId, shape: member.insideShape || null });
      console.log('[Wizard] unfold: populated definition graph for', member.memberName, '→', defGraphId, `(${bulkData.nodes.length} nodes)`);
    } catch (e) {
      console.warn('[Wizard] unfold: failed for member', member?.memberName, e);
    }
  }
  return applied;
}

/**
 * Build a node's abstraction axis (the `ladder` shape) from an ordered list of
 * names. The tool decided the order (specific → general); this resolves names to
 * real prototypes (LAST match) and wires the chain via addToAbstractionChain.
 * Returns a summary, or null if fewer than two members resolved (caller keeps
 * the flat node pile — never a hard error).
 */
function applyAbstractionChain(orderNames, dimension = 'Generalization Axis') {
  const names = Array.isArray(orderNames) ? orderNames.filter(Boolean) : [];
  if (names.length < 2) return null;
  const st = useGraphStore.getState();

  const ids = [];
  for (const name of names) {
    const nl = String(name).toLowerCase().trim();
    let id = null;
    for (const [pid, proto] of st.nodePrototypes) {
      if ((proto.name || '').toLowerCase().trim() === nl) id = pid; // LAST match
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length < 2) return null;

  // Most-specific node owns the chain; each subsequent node is one rung MORE
  // GENERAL ('below'), inserted relative to the previous rung to preserve order.
  const ownerId = ids[0];
  for (let i = 1; i < ids.length; i++) {
    st.addToAbstractionChain(ownerId, dimension, 'below', ids[i], ids[i - 1]);
  }
  console.log('[Wizard] ladder: built abstraction axis for', ids.length, 'rungs (owner:', ownerId, ')');
  return { dimension, ownerId, rungs: ids };
}

// Injectable enrichment hooks. Browser (LeftAIView) supplies the real
// Wikipedia-backed implementations via configureToolResultApplier; a headless
// Node host leaves these no-ops so the applier stays pure and non-blocking.
let _enrich = async () => ({ success: false, skipped: 'enrichment-unavailable' });
let _enrichMultiple = async () => [];

export function configureToolResultApplier({ enrich, enrichMultiple } = {}) {
  if (typeof enrich === 'function') _enrich = enrich;
  if (typeof enrichMultiple === 'function') _enrichMultiple = enrichMultiple;
}

/**
 * Apply wizard tool results to the store.
 * This bridges the gap between server-side tool execution and client-side store.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ADDING A NEW TOOL? You MUST add a handler here! This is step 3 of 4. ║
 * ║  Read .agent/workflows/add-wizard-tool.md for the full checklist.      ║
 * ║  Without a handler here, the tool will appear to work but NOT persist. ║
 * ║  NOTE: The MCP bridge is now automatically proxied — no BridgeClient   ║
 * ║  handler needed! Just add your handler here and it works everywhere.   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
// Deterministic, varied color per connection-type name. Hash → HSL hue with
// fixed saturation/lightness so the same name always produces the same color
// and different names get visually distinct ones. Same algorithm the server-
// side wizard tools use, kept inline so the handler is self-contained.
function generateConnectionColor(name) {
  const s = String(name || '').trim();
  if (!s) return '#708090'; // slategray fallback only when there's literally no name
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

// Surface a wizard tool failure to the UI. Listeners in LeftAIView render an
// inline warning in the active conversation so the user can see when a tool
// call silently no-op'd (e.g., hallucinated edge id, missing source/target).
function dispatchWizardToolFailed(tool, reason, result) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('rs-wizard-tool-failed', {
      detail: {
        tool,
        reason,
        sourceName: result?.sourceName || null,
        targetName: result?.targetName || null,
        edgeId: result?.edgeId || null
      }
    }));
  } catch (err) {
    console.error('[Wizard] Failed to dispatch rs-wizard-tool-failed:', err);
  }
}

// PROV provenance context for wizard-authored entities (P2.6). Set by the
// streaming handler right before tool results are applied (model + conversation
// are in scope there); read when stamping created entities. The format layer
// projects this to prov:wasAttributedTo / prov:generatedAtTime on export.
let __wizardProvenance = null;
export function setWizardProvenanceContext(ctx) {
  __wizardProvenance = ctx
    ? { wasAttributedTo: 'redstring-wizard', generatedAtTime: new Date().toISOString(), ...ctx }
    : null;
}
const wizardSemanticMetadata = () => (__wizardProvenance ? { provenance: { ...__wizardProvenance } } : undefined);

export function applyToolResultToStore(toolName, result, toolCallId, conversationId) {
  console.log('[Wizard] applyToolResultToStore called:', toolName, 'action:', result?.action, 'hasSpec:', !!result?.spec);
  if (!result || result.error) {
    console.warn('[Wizard] applyToolResultToStore: skipping — no result or error:', result?.error);
    return;
  }
  const store = useGraphStore.getState();

  // Remember any structure-review suggestions this build surfaced, so a later
  // matching group/fold can be logged as accepted follow-through.
  if (Array.isArray(result.structureSuggestions) && result.structureSuggestions.length > 0) {
    __pendingStructureSuggestions = result.structureSuggestions.slice(0, 10);
  }

  // Set context for the history stream
  if (toolCallId) {
    store.setChangeContext({ type: 'wizard_action', target: 'wizard', actionId: toolCallId, isWizard: true });
  }

  // Handle planTask — persist plan per conversation/tab so small models can resume
  if (result.action === 'planTask' && result.steps && conversationId) {
    if (result.allComplete) {
      store.clearWizardPlanForConversation(conversationId);
    } else {
      store.setWizardPlanForConversation(conversationId, result.steps, store.activeGraphId);
    }
    return;
  }

  // Handle createGraph (empty graph)
  if (result.action === 'createGraph') {
    console.log('[Wizard] Applying createGraph to store:', result.graphName);
    store.createNewGraph({
      id: result.graphId,
      name: result.graphName,
      description: result.description || '',
      color: result.color || null
    });
    console.log('[Wizard] Successfully created empty graph:', result.graphId);
    return;
  }

  // Handle createNode
  if (result.action === 'createNode') {
    console.log('[Wizard] Applying createNode to store:', result.name);
    const graphId = result.graphId || store.activeGraphId;
    if (!graphId) {
      console.error('[Wizard] createNode: No active graph ID');
      return;
    }
    store.applyBulkGraphUpdates(graphId, {
      nodes: [{
        name: result.name,
        color: result.color || NODE_DEFAULT_COLOR,
        description: result.description || '',
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200,
        // PROV stamp for wizard-authored nodes (P2.6); undefined for none
        semanticMetadata: wizardSemanticMetadata()
      }]
    });
    console.log('[Wizard] Successfully created node:', result.name);

    // Launch Wikipedia enrichment asynchronously (if enrich is not explicitly false)
    if (result.enrich !== false && (!result.description || result.description.trim() === '')) {
      _enrich(result.name, graphId, { overwriteDescription: result.overwriteDescription || false }).catch(err => {
        console.warn('[Auto-Enrich] Wikipedia enrichment failed:', err);
      });
    }

    return;
  }

  // Handle updateNode — resolve by name from actual store (server IDs are synthetic)
  if (result.action === 'updateNode') {
    const lookupName = (result.originalName || '').toLowerCase().trim();
    console.log('[Wizard] Applying updateNode to store, looking up:', lookupName);
    if (!lookupName || !result.updates) {
      console.error('[Wizard] updateNode: Missing originalName or updates');
      return;
    }
    // Find the real prototype by ID first, then fallback to name
    let realProtoId = result.prototypeId && store.nodePrototypes.has(result.prototypeId)
      ? result.prototypeId
      : null;

    if (!realProtoId) {
      // Take LAST match — old prototypes accumulate in Maps and FIRST match would pick a stale one
      for (const [protoId, proto] of store.nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === lookupName) {
          realProtoId = protoId;
        }
      }
    }
    if (!realProtoId) {
      console.error('[Wizard] updateNode: Could not find prototype for name:', lookupName);
      return;
    }
    store.updateNodePrototype(realProtoId, (prototype) => {
      if (result.updates.name !== undefined) prototype.name = result.updates.name;
      if (result.updates.color !== undefined) prototype.color = result.updates.color;
      if (result.updates.description !== undefined) prototype.description = result.updates.description;
    });
    console.log('[Wizard] Successfully updated node:', realProtoId);
    return;
  }

  // Handle deleteNode — resolve by name from actual store (server IDs are synthetic)
  if (result.action === 'deleteNode') {
    const graphId = result.graphId || store.activeGraphId;
    const lookupName = (result.name || '').toLowerCase().trim();
    console.log('[Wizard] Applying deleteNode to store, looking up:', lookupName);
    if (!graphId || !lookupName) {
      console.error('[Wizard] deleteNode: Missing graphId or name');
      return;
    }
    const graph = store.graphs.get(graphId);
    if (!graph) {
      console.error('[Wizard] deleteNode: Graph not found:', graphId);
      return;
    }
    // Find the real instance by ID first, then fallback to name
    let realInstanceId = result.instanceId && graph.instances.has(result.instanceId)
      ? result.instanceId
      : null;

    if (!realInstanceId) {
      for (const [instId, inst] of graph.instances) {
        const proto = store.nodePrototypes.get(inst.prototypeId);
        const nodeName = (proto?.name || '').toLowerCase().trim();
        if (nodeName === lookupName) {
          realInstanceId = instId;
          break;
        }
      }
    }
    if (!realInstanceId) {
      console.error('[Wizard] deleteNode: Could not find instance for name:', lookupName);
      return;
    }
    store.removeNodeInstance(graphId, realInstanceId);
    console.log('[Wizard] Successfully deleted node:', lookupName, realInstanceId);
    return;
  }

  // Handle createEdge — use applyBulkGraphUpdates for name-based resolution
  if (result.action === 'createEdge') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying createEdge to store:', result.sourceName, '→', result.targetName);
    if (!graphId) {
      console.error('[Wizard] createEdge: No active graph ID');
      return;
    }
    store.applyBulkGraphUpdates(graphId, {
      nodes: [],
      edges: [{
        sourceId: result.sourceInstanceId,
        targetId: result.targetInstanceId,
        source: result.sourceName,
        target: result.targetName,
        type: result.type || 'relates to',
        // C4 — honor the suggested arrow direction ('reverse' points at source);
        // defaults to source→target when no suggestion was made.
        directionality: result.directionality || 'unidirectional',
        definitionNode: result.type ? { name: result.type, color: generateConnectionColor(result.type) } : null
      }]
    });
    console.log('[Wizard] Successfully created edge:', result.sourceName, '→', result.targetName);
    try { store.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] cleanupOrphanedData failed:', e); }
    return;
  }

  // Handle updateEdge — resolve by source/target names
  if (result.action === 'updateEdge') {
    let graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying updateEdge to store:', result.sourceName, '→', result.targetName);
    if (!graphId) {
      console.error('[Wizard] FAILED: updateEdge: No active graph ID');
      dispatchWizardToolFailed('updateEdge', 'No active graph ID', result);
      return;
    }
    let graph = store.graphs.get(graphId);
    if (!graph && result.graphId) {
      // The model may have passed a graph NAME instead of an ID — try a name-based
      // fallback that prefers the active graph and parent-graph lineage.
      const resolved = resolveGraphId(result.graphId, store.graphs, { activeGraphId: store.activeGraphId });
      if (resolved && resolved !== graphId) {
        graphId = resolved;
        graph = store.graphs.get(graphId);
      }
    }
    if (!graph) {
      console.error('[Wizard] FAILED: updateEdge: Graph not found:', graphId);
      dispatchWizardToolFailed('updateEdge', `Graph not found: ${graphId}`, result);
      return;
    }

    let sourceInstId = result.sourceId && graph.instances.has(result.sourceId) ? result.sourceId : null;
    let targetInstId = result.targetId && graph.instances.has(result.targetId) ? result.targetId : null;

    if (!sourceInstId || !targetInstId) {
      const sourceNameLookup = (result.sourceName || '').toLowerCase().trim();
      const targetNameLookup = (result.targetName || '').toLowerCase().trim();

      for (const [instId, inst] of graph.instances) {
        const p = store.nodePrototypes.get(inst.prototypeId);
        const n = (p?.name || '').toLowerCase().trim();
        if (!sourceInstId && n === sourceNameLookup) sourceInstId = instId;
        if (!targetInstId && n === targetNameLookup) targetInstId = instId;
      }
    }

    if (!sourceInstId || !targetInstId) {
      console.error('[Wizard] FAILED: updateEdge: Could not resolve source/target instances:', result.sourceName, result.targetName);
      dispatchWizardToolFailed(
        'updateEdge',
        `Could not find nodes "${result.sourceName || '?'}" and "${result.targetName || '?'}" in the active graph.`,
        result
      );
      return;
    }

    let realEdgeId = null;
    let actualEdge = null;
    for (const edgeId of graph.edgeIds) {
      const edge = store.edges.get(edgeId);
      if (!edge) continue;
      if ((edge.sourceId === sourceInstId && edge.destinationId === targetInstId) ||
        (edge.sourceId === targetInstId && edge.destinationId === sourceInstId)) {
        realEdgeId = edgeId;
        actualEdge = edge;
        break;
      }
    }

    if (!realEdgeId) {
      console.error('[Wizard] FAILED: updateEdge: Edge not found between instances:', sourceInstId, targetInstId);
      dispatchWizardToolFailed(
        'updateEdge',
        `No connection exists between "${result.sourceName || sourceInstId}" and "${result.targetName || targetInstId}". Create one first or pick a different pair of nodes.`,
        result
      );
      return;
    }

    let protoIdToLink = null;
    if (result.updates.type) {
      const typeLookup = result.updates.type.toLowerCase().trim();
      // Take LAST match — old prototypes accumulate in Maps and FIRST match would pick a stale one
      for (const [id, proto] of store.nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === typeLookup) {
          protoIdToLink = id;
        }
      }

      if (!protoIdToLink) {
        protoIdToLink = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        store.addNodePrototype({
          id: protoIdToLink,
          name: result.updates.type,
          color: generateConnectionColor(result.updates.type),
          description: '',
          typeNodeId: null,
          definitionGraphIds: []
        });
        console.log('[Wizard] updateEdge: Created new type prototype for:', result.updates.type);
      }
    }

    store.updateEdge(realEdgeId, (draft) => {
      if (result.updates.directionality) {
        // Redstring directionality translates to arrowsToward array
        if (result.updates.directionality === 'bidirectional') {
          draft.directionality.arrowsToward = new Set([actualEdge.sourceId, actualEdge.destinationId]);
        } else if (result.updates.directionality === 'unidirectional') {
          // Pointing to target
          draft.directionality.arrowsToward = new Set([actualEdge.sourceId === sourceInstId ? actualEdge.destinationId : actualEdge.sourceId]);
        } else if (result.updates.directionality === 'reverse') {
          // Pointing to source
          draft.directionality.arrowsToward = new Set([actualEdge.sourceId === sourceInstId ? actualEdge.sourceId : actualEdge.destinationId]);
        } else if (result.updates.directionality === 'none') {
          draft.directionality.arrowsToward = new Set();
        }
      }
      if (protoIdToLink) {
        draft.definitionNodeIds = [protoIdToLink];
      }
    });
    console.log('[Wizard] Successfully updated edge:', realEdgeId);
    return;
  }

  // Handle deleteEdge — verify edgeId, then fall through to source/target name resolution
  if (result.action === 'deleteEdge') {
    let graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying deleteEdge to store');
    if (!graphId) {
      console.error('[Wizard] deleteEdge: No active graph ID');
      dispatchWizardToolFailed('deleteEdge', 'No active graph ID', result);
      return;
    }
    let graph = store.graphs.get(graphId);
    if (!graph && result.graphId) {
      // Model may have passed a graph NAME — fall back to name resolution.
      const resolved = resolveGraphId(result.graphId, store.graphs, { activeGraphId: store.activeGraphId });
      if (resolved && resolved !== graphId) {
        graphId = resolved;
        graph = store.graphs.get(graphId);
      }
    }
    if (!graph) {
      console.error('[Wizard] deleteEdge: Graph not found:', graphId);
      dispatchWizardToolFailed('deleteEdge', `Graph not found: ${graphId}`, result);
      return;
    }

    // Try edge-ID path first, but ONLY if it points at a real edge in this graph.
    // The model frequently hallucinates edge IDs, so we never trust it blindly.
    if (result.edgeId) {
      const edgeIdsList = Array.isArray(graph.edgeIds) ? graph.edgeIds : Array.from(graph.edgeIds || []);
      const edgeExists = !!store.edges.get(result.edgeId) && edgeIdsList.includes(result.edgeId);
      if (edgeExists) {
        store.removeEdge(result.edgeId);
        console.log('[Wizard] Successfully deleted edge by verified ID:', result.edgeId);
        return;
      }
      console.warn('[Wizard] deleteEdge: edgeId did not match a real edge, falling back to name resolution:', result.edgeId);
    }

    // Fall back to source/target name (or instance id) resolution
    if (!result.sourceName && !result.targetName && !result.sourceId && !result.targetId) {
      console.error('[Wizard] FAILED: deleteEdge: No verified edgeId and no sourceName/targetName provided');
      dispatchWizardToolFailed(
        'deleteEdge',
        'No usable edgeId, and no source/target node names were provided. Pass sourceName and targetName for the connection you want to remove.',
        result
      );
      return;
    }

    let srcInstId = result.sourceId && graph.instances.has(result.sourceId) ? result.sourceId : null;
    let tgtInstId = result.targetId && graph.instances.has(result.targetId) ? result.targetId : null;

    if (!srcInstId || !tgtInstId) {
      const srcLower = (result.sourceName || '').toLowerCase().trim();
      const tgtLower = (result.targetName || '').toLowerCase().trim();
      // Build name→instanceId map
      const nameToInstId = new Map();
      for (const [instId, inst] of graph.instances) {
        const proto = store.nodePrototypes.get(inst.prototypeId);
        const name = (proto?.name || '').toLowerCase().trim();
        if (name) nameToInstId.set(name, instId);
      }
      if (!srcInstId) srcInstId = nameToInstId.get(srcLower);
      if (!tgtInstId) tgtInstId = nameToInstId.get(tgtLower);
    }

    if (srcInstId && tgtInstId) {
      for (const edgeId of (graph.edgeIds || [])) {
        const edge = store.edges.get(edgeId);
        if (edge && (
          (edge.sourceId === srcInstId && edge.destinationId === tgtInstId) ||
          (edge.sourceId === tgtInstId && edge.destinationId === srcInstId)
        )) {
          store.removeEdge(edgeId);
          console.log('[Wizard] Successfully deleted edge between:', srcInstId, 'and', tgtInstId);
          return;
        }
      }
      console.error('[Wizard] FAILED: deleteEdge: Source/target instances resolved but no edge exists between them:', result.sourceName, '↔', result.targetName);
      dispatchWizardToolFailed(
        'deleteEdge',
        `No connection exists between "${result.sourceName || srcInstId}" and "${result.targetName || tgtInstId}".`,
        result
      );
      return;
    }

    console.error('[Wizard] FAILED: deleteEdge: Could not resolve nodes:', result.sourceName, result.targetName);
    dispatchWizardToolFailed(
      'deleteEdge',
      `Could not find nodes "${result.sourceName || '?'}" and "${result.targetName || '?'}" in the active graph.`,
      result
    );
    return;
  }

  // Handle replaceEdges — find existing edges and update them, or create new ones
  if (result.action === 'replaceEdges') {
    let graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying replaceEdges to store:', result.edgeCount, 'replacements');
    if (!graphId) {
      console.error('[Wizard] FAILED: replaceEdges: No active graph ID');
      dispatchWizardToolFailed('replaceEdges', 'No active graph ID', result);
      return;
    }
    let graph = store.graphs.get(graphId);
    if (!graph && result.graphId) {
      // Model may have passed a graph NAME — fall back to name resolution that
      // disambiguates toward the active graph and parent-graph lineage.
      const resolved = resolveGraphId(result.graphId, store.graphs, { activeGraphId: store.activeGraphId });
      if (resolved && resolved !== graphId) {
        graphId = resolved;
        graph = store.graphs.get(graphId);
      }
    }
    if (!graph) {
      console.error('[Wizard] FAILED: replaceEdges: Graph not found:', graphId);
      dispatchWizardToolFailed('replaceEdges', `Graph not found: ${graphId}`, result);
      return;
    }

    // Build name → instanceId map
    const nameToInstId = new Map();
    for (const [instId, inst] of graph.instances) {
      const proto = store.nodePrototypes.get(inst.prototypeId);
      const name = (proto?.name || '').toLowerCase().trim();
      if (name) nameToInstId.set(name, instId);
    }

    const newEdges = []; // Edges to create (no existing edge found)
    const unresolvedPairs = []; // Track failures so we can surface them after the loop

    for (const replacement of (result.replacements || [])) {
      let srcInstId = replacement.sourceId && graph.instances.has(replacement.sourceId) ? replacement.sourceId : null;
      let tgtInstId = replacement.targetId && graph.instances.has(replacement.targetId) ? replacement.targetId : null;

      if (!srcInstId || !tgtInstId) {
        const srcLower = (replacement.source || '').toLowerCase().trim();
        const tgtLower = (replacement.target || '').toLowerCase().trim();
        if (!srcInstId) srcInstId = nameToInstId.get(srcLower);
        if (!tgtInstId) tgtInstId = nameToInstId.get(tgtLower);
      }

      if (!srcInstId || !tgtInstId) {
        console.error('[Wizard] FAILED: replaceEdges: Could not resolve:', replacement.source, '→', replacement.target);
        unresolvedPairs.push(`"${replacement.source || '?'}" → "${replacement.target || '?'}"`);
        continue;
      }

      // Find existing edge between these nodes
      let existingEdgeId = null;
      for (const edgeId of (graph.edgeIds || [])) {
        const edge = store.edges.get(edgeId);
        if (edge && (
          (edge.sourceId === srcInstId && edge.destinationId === tgtInstId) ||
          (edge.sourceId === tgtInstId && edge.destinationId === srcInstId)
        )) {
          existingEdgeId = edgeId;
          break;
        }
      }

      if (existingEdgeId) {
        // Update the existing edge's type
        const typeName = replacement.type || 'Connection';

        // Find or create the connection definition prototype
        let protoIdToLink = null;
        const typeLookup = typeName.toLowerCase().trim();
        // Take LAST match — old prototypes accumulate in Maps and FIRST match would pick a stale one
        for (const [id, proto] of store.nodePrototypes) {
          if ((proto.name || '').toLowerCase().trim() === typeLookup) {
            protoIdToLink = id;
          }
        }

        if (!protoIdToLink) {
          protoIdToLink = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          store.addNodePrototype({
            id: protoIdToLink,
            name: typeName,
            color: replacement.definitionNode?.color || generateConnectionColor(typeName),
            description: replacement.definitionNode?.description || '',
            typeNodeId: null,
            definitionGraphIds: []
          });
          console.log('[Wizard] replaceEdges: Created new type prototype for:', typeName);
        }

        const actualEdge = store.edges.get(existingEdgeId);
        store.updateEdge(existingEdgeId, (draft) => {
          // Update directionality
          const dir = replacement.directionality || 'unidirectional';
          if (dir === 'bidirectional') {
            draft.directionality.arrowsToward = new Set([actualEdge.sourceId, actualEdge.destinationId]);
          } else if (dir === 'unidirectional') {
            draft.directionality.arrowsToward = new Set([actualEdge.sourceId === srcInstId ? actualEdge.destinationId : actualEdge.sourceId]);
          } else if (dir === 'reverse') {
            draft.directionality.arrowsToward = new Set([actualEdge.sourceId === srcInstId ? actualEdge.sourceId : actualEdge.destinationId]);
          } else if (dir === 'none') {
            draft.directionality.arrowsToward = new Set();
          }
          // Update definition node
          draft.definitionNodeIds = [protoIdToLink];
          draft.name = typeName;
          draft.type = typeName;
        });
        console.log('[Wizard] replaceEdges: Updated existing edge:', existingEdgeId, '→', typeName);
      } else {
        // No existing edge — queue for creation
        newEdges.push({
          sourceId: replacement.sourceId,
          targetId: replacement.targetId,
          source: replacement.source,
          target: replacement.target,
          type: replacement.type || 'Connection',
          directionality: replacement.directionality || 'unidirectional',
          definitionNode: replacement.definitionNode || null
        });
        console.log('[Wizard] replaceEdges: No existing edge, will create:', replacement.source, '→', replacement.target);
      }
    }

    // Create any new edges via bulk updates
    if (newEdges.length > 0) {
      store.applyBulkGraphUpdates(graphId, {
        nodes: [],
        edges: newEdges,
        groups: []
      });
    }

    console.log('[Wizard] replaceEdges: Completed. Updated existing + created', newEdges.length, 'new edges');
    try { store.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] cleanupOrphanedData failed:', e); }

    if (unresolvedPairs.length > 0) {
      dispatchWizardToolFailed(
        'replaceEdges',
        `Could not resolve ${unresolvedPairs.length} of ${result.edgeCount} pair${result.edgeCount === 1 ? '' : 's'}: ${unresolvedPairs.join(', ')}. Make sure the source and target nodes exist in the active graph.`,
        result
      );
    }
    return;
  }

  // Handle createGroup
  if (result.action === 'createGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying createGroup to store:', result.name);
    if (!graphId) {
      console.error('[Wizard] createGroup: No active graph ID');
      return;
    }
    // Resolve member names to real instance IDs from the store
    const graph = store.graphs.get(graphId);
    const memberInstanceIds = [];
    if (graph && result.memberNames) {
      for (const memberName of result.memberNames) {
        const nameLower = memberName.toLowerCase().trim();
        for (const [instId, inst] of graph.instances) {
          const proto = store.nodePrototypes.get(inst.prototypeId);
          if ((proto?.name || '').toLowerCase().trim() === nameLower) {
            memberInstanceIds.push(instId);
            break;
          }
        }
      }
    }
    // Idempotency: the wizard can emit createGroup for the same group more than
    // once (retries, replays, re-listing an existing group). Creating blindly
    // stacks duplicate groups with the same name/members, showing as overlapping
    // outlines on the canvas. If a group with this name already exists in the
    // graph, merge the resolved members into it instead of making a new one.
    const nameLower = (result.name || '').toLowerCase().trim();
    let existingGroupId = null;
    if (graph?.groups && nameLower) {
      for (const [gId, group] of graph.groups) {
        if ((group.name || '').toLowerCase().trim() === nameLower) {
          existingGroupId = gId;
          break;
        }
      }
    }

    if (existingGroupId) {
      store.updateGroup(graphId, existingGroupId, (group) => {
        if (!Array.isArray(group.memberInstanceIds)) group.memberInstanceIds = [];
        for (const instId of memberInstanceIds) {
          if (!group.memberInstanceIds.includes(instId)) {
            group.memberInstanceIds.push(instId);
          }
        }
        if (result.color) group.color = result.color;
      });
      console.log('[Wizard] Merged into existing group:', result.name, '| members now:', memberInstanceIds.length);
    } else {
      store.createGroup(graphId, {
        name: result.name,
        color: result.color || theme.accent.primary,
        memberInstanceIds
      });
      console.log('[Wizard] Successfully created group:', result.name, '| members:', memberInstanceIds.length);
    }
    noteStructureFollowThrough(result.name, result.memberNames);
    return;
  }

  // Handle deleteGroup — resolve by name from actual store
  if (result.action === 'deleteGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying deleteGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] deleteGroup: No active graph ID');
      return;
    }
    // Always resolve by name from the live store first, since result.groupId
    // may be a synthetic ID from the in-memory graphState (AgentLoop)
    let realGroupId = null;
    if (result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    // Fall back to result.groupId if name resolution didn't find anything
    if (!realGroupId) {
      realGroupId = result.groupId;
    }
    if (realGroupId) {
      store.deleteGroup(graphId, realGroupId);
      console.log('[Wizard] Successfully deleted group:', realGroupId);
    } else {
      console.error('[Wizard] deleteGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle updateGroup — resolve by name from actual store
  if (result.action === 'updateGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying updateGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] updateGroup: No active graph ID');
      return;
    }
    // Always resolve by name from the live store first, since result.groupId
    // may be a synthetic ID from the in-memory graphState (AgentLoop)
    let realGroupId = null;
    if (result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    // Fall back to result.groupId if name resolution didn't find anything
    if (!realGroupId) {
      realGroupId = result.groupId;
    }
    if (realGroupId && result.updates) {
      store.updateGroup(graphId, realGroupId, (group) => {
        if (result.updates.name !== undefined) group.name = result.updates.name;
        if (result.updates.color !== undefined) group.color = result.updates.color;
        // Add/remove members by name
        if (result.updates.addMembers) {
          const graph = store.graphs.get(graphId);
          for (const memberName of result.updates.addMembers) {
            const nameLower = memberName.toLowerCase().trim();
            for (const [instId, inst] of graph.instances) {
              const proto = store.nodePrototypes.get(inst.prototypeId);
              if ((proto?.name || '').toLowerCase().trim() === nameLower) {
                if (!group.memberInstanceIds.includes(instId)) {
                  group.memberInstanceIds.push(instId);
                }
                break;
              }
            }
          }
        }
        if (result.updates.removeMembers) {
          const graph = store.graphs.get(graphId);
          const idsToRemove = new Set();
          for (const memberName of result.updates.removeMembers) {
            const nameLower = memberName.toLowerCase().trim();
            for (const [instId, inst] of graph.instances) {
              const proto = store.nodePrototypes.get(inst.prototypeId);
              if ((proto?.name || '').toLowerCase().trim() === nameLower) {
                idsToRemove.add(instId);
                break;
              }
            }
          }
          group.memberInstanceIds = group.memberInstanceIds.filter(id => !idsToRemove.has(id));
        }
      });
      console.log('[Wizard] Successfully updated group:', realGroupId);
    } else {
      console.error('[Wizard] updateGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle convertToThingGroup — resolve group by name then call store method
  if (result.action === 'convertToThingGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying convertToThingGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] convertToThingGroup: No active graph ID');
      return;
    }
    // Always resolve by name from the live store first, since result.groupId
    // may be a synthetic ID from the in-memory graphState (AgentLoop)
    let realGroupId = null;
    if (result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    // Fall back to result.groupId if name resolution didn't find anything
    if (!realGroupId) {
      realGroupId = result.groupId;
    }
    if (realGroupId) {
      store.convertGroupToNodeGroup(
        graphId,
        realGroupId,
        null,
        result.createNewThing !== false,
        result.thingName || 'Thing Group',
        result.newThingColor // Let store fall back to group.color if not specified
      );
      console.log('[Wizard] Successfully converted group to thing-group:', realGroupId);
    } else {
      console.error('[Wizard] convertToThingGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle combineThingGroup — resolve group by name then call store method
  if (result.action === 'combineThingGroup') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying combineThingGroup to store:', result.groupName || result.groupId);
    if (!graphId) {
      console.error('[Wizard] combineThingGroup: No active graph ID');
      return;
    }
    // Always resolve by name from the live store first, since result.groupId
    // may be a synthetic ID from the in-memory graphState (AgentLoop)
    let realGroupId = null;
    if (result.groupName) {
      const graph = store.graphs.get(graphId);
      if (graph?.groups) {
        const nameLower = result.groupName.toLowerCase().trim();
        for (const [gId, group] of graph.groups) {
          if ((group.name || '').toLowerCase().trim() === nameLower) {
            realGroupId = gId;
            break;
          }
        }
      }
    }
    // Fall back to result.groupId if name resolution didn't find anything
    if (!realGroupId) {
      realGroupId = result.groupId;
    }
    if (realGroupId) {
      store.combineNodeGroup(graphId, realGroupId);
      console.log('[Wizard] Successfully combined thing-group:', realGroupId);
    } else {
      console.error('[Wizard] combineThingGroup: Could not find group:', result.groupName);
    }
    return;
  }

  // Handle decomposeNode — expand a node into a thing-group, keeping original as anchor
  if (result.action === 'decomposeNode') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying decomposeNode:', result.nodeName, 'prototypeId:', result.prototypeId);
    if (!graphId) {
      console.warn('[Wizard] decomposeNode: no graphId');
      return;
    }

    // Resolve the prototype by name (predictive IDs may not match real store)
    let realProtoId = result.prototypeId;
    for (const [pid, proto] of store.nodePrototypes) {
      if (proto.name?.toLowerCase() === result.nodeName?.toLowerCase()) {
        realProtoId = pid; // take LAST match (most recent)
      }
    }

    const createdGroupId = store.decomposeNodeToGroup(graphId, realProtoId, result.definitionIndex ?? 0);
    console.log('[Wizard] decomposeNode result: groupId=', createdGroupId);
    return;
  }

  // Handle condenseToNode — package nodes into a new concept with a definition graph
  if (result.action === 'condenseToNode') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying condenseToNode:', result.nodeName, 'members:', result.memberNames);
    if (!graphId) {
      console.error('[Wizard] condenseToNode: No active graph ID');
      return;
    }
    const graph = store.graphs.get(graphId);
    if (!graph) {
      console.error('[Wizard] condenseToNode: Graph not found:', graphId);
      return;
    }

    // Step 1: Resolve member names to real instance IDs
    const memberInstanceIds = [];
    for (const memberName of (result.memberNames || [])) {
      const nameLower = memberName.toLowerCase().trim();
      for (const [instId, inst] of graph.instances) {
        const proto = store.nodePrototypes.get(inst.prototypeId);
        if ((proto?.name || '').toLowerCase().trim() === nameLower) {
          memberInstanceIds.push(instId);
          break;
        }
      }
    }

    if (memberInstanceIds.length === 0) {
      console.error('[Wizard] condenseToNode: No members resolved from:', result.memberNames);
      return;
    }

    // Step 2: Create a group from the resolved members
    const groupId = store.createGroup(graphId, {
      name: result.nodeName,
      color: result.nodeColor || '#8B0000',
      memberInstanceIds
    });

    // Step 3: Convert group to thing-group (creates prototype + definition graph from members)
    store.convertGroupToNodeGroup(
      graphId,
      groupId,
      null,
      true,
      result.nodeName,
      result.nodeColor || '#8B0000'
    );

    // Step 4: If collapse requested, combine the thing-group into a single node
    if (result.collapse) {
      store.combineNodeGroup(graphId, groupId);
      console.log('[Wizard] condenseToNode: Collapsed group into single node:', result.nodeName);
    } else {
      console.log('[Wizard] condenseToNode: Created thing-group:', result.nodeName);
    }
    noteStructureFollowThrough(result.nodeName, result.memberNames);
    return;
  }

  // Handle addDefinitionGraph — create a definition graph for a node WITHOUT changing activeGraphId
  if (result.action === 'addDefinitionGraph') {
    const graphId = result.graphId;
    const nodeName = (result.nodeName || '').toLowerCase().trim();
    console.log('[Wizard] Applying addDefinitionGraph to store:', result.nodeName, '→', graphId);

    // Resolve prototype by name — take LAST match (most recently created)
    // Resolve prototype by ID if possible, otherwise fallback to name
    let realProtoId = result.prototypeId && store.nodePrototypes.has(result.prototypeId)
      ? result.prototypeId
      : null;

    if (!realProtoId && nodeName) {
      for (const [pid, proto] of store.nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === nodeName) {
          realProtoId = pid;
          // Don't break — take the LAST match (most recently created prototype)
        }
      }
    }

    if (!realProtoId) {
      console.error('[Wizard] addDefinitionGraph: Could not find prototype for:', result.nodeName);
      return;
    }

    store.createDefinitionGraphWithId(graphId, realProtoId);
    console.log('[Wizard] Successfully created definition graph:', graphId, 'for prototype:', realProtoId);
    return;
  }

  // Handle populateDefinitionGraph — create definition graph AND expand it
  if (result.action === 'populateDefinitionGraph' && result.spec) {
    const graphId = result.graphId;
    const nodeName = (result.nodeName || '').toLowerCase().trim();
    console.log('[Wizard] Applying populateDefinitionGraph to store:', result.nodeName, '→', graphId);

    // Resolve prototype by ID if possible, otherwise fallback to name
    let realProtoId = result.prototypeId && store.nodePrototypes.has(result.prototypeId)
      ? result.prototypeId
      : null;

    if (!realProtoId && nodeName) {
      for (const [pid, proto] of store.nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === nodeName) {
          realProtoId = pid;
        }
      }
    }

    if (!realProtoId) {
      console.error('[Wizard] populateDefinitionGraph: Could not find prototype for:', result.nodeName);
      return;
    }

    // 1. Create the definition graph
    store.createDefinitionGraphWithId(graphId, realProtoId);

    // 2. Populate it (like expandGraph)
    const typeMap = new Map();
    (result.spec.nodes || []).forEach(n => {
      if (n.type) {
        const tLower = n.type.toLowerCase().trim();
        if (!typeMap.has(tLower)) {
          // Take LAST match — old prototypes accumulate in Maps and FIRST match would pick a stale one
          let existingProtoId = null;
          for (const [pid, proto] of store.nodePrototypes) {
            if ((proto.name || '').toLowerCase().trim() === tLower) {
              existingProtoId = pid;
            }
          }
          if (existingProtoId) {
            typeMap.set(tLower, existingProtoId);
          } else {
            const newProtoId = `proto-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            typeMap.set(tLower, newProtoId);
            store.addNodePrototype({
              id: newProtoId,
              name: n.type,
              color: n.typeColor || '#A0A0A0',
              description: n.typeDescription || '',
              typeNodeId: null,
              definitionGraphIds: []
            });
            console.log('[Wizard] Auto-created inline type node:', n.type, '→', newProtoId);
          }
        }
      }
    });

    const bulkData = {
      nodes: result.spec.nodes.map((n, idx) => ({
        name: n.name,
        color: n.color,
        description: n.description,
        typeNodeId: n.type ? typeMap.get(n.type.toLowerCase().trim()) : null,
        prototypeId: `proto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId: `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200
      })),
      edges: (result.spec.edges || []).map(e => ({
        source: e.source,
        target: e.target,
        type: e.type || 'relates to',
        directionality: e.directionality || 'unidirectional',
        definitionNode: e.definitionNode || null
      })),
      groups: result.spec.groups || []
    };

    store.applyBulkGraphUpdates(graphId, bulkData);
    console.log('[Wizard] Successfully populated definition graph:', graphId);
    try { store.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] cleanupOrphanedData failed:', e); }

    layoutAfterWizardMutation(graphId);
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rs-trigger-auto-layout', { detail: { graphId } }));
      }
    }, 600);

    if (result.enrich !== false) {
      const newNodeNames = result.spec.nodes.map(n => n.name);

      // Include the defining node in the enrichment batch
      const freshStore = useGraphStore.getState();
      const defGraph = freshStore.graphs.get(graphId);
      if (defGraph?.definingNodeIds?.length > 0) {
        const definingProto = freshStore.nodePrototypes.get(defGraph.definingNodeIds[0]);
        if (definingProto && !newNodeNames.includes(definingProto.name)) {
          newNodeNames.push(definingProto.name);
        }
      }

      setTimeout(() => {
        _enrichMultiple(newNodeNames, graphId, { overwriteDescription: result.overwriteDescription || false }).catch(err => {
          console.warn('[Auto-Enrich] Batch enrichment failed:', err);
        });
      }, 1000);
    }

    return;
  }

  // Handle removeDefinitionGraph — remove a definition graph from a node
  if (result.action === 'removeDefinitionGraph') {
    const nodeName = (result.nodeName || '').toLowerCase().trim();
    console.log('[Wizard] Applying removeDefinitionGraph to store:', result.nodeName);

    // Resolve prototype by name — take LAST match (most recently created)
    let realProtoId = null;
    if (nodeName) {
      for (const [pid, proto] of store.nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === nodeName) {
          realProtoId = pid;
        }
      }
    }

    if (!realProtoId) {
      console.error('[Wizard] removeDefinitionGraph: Could not find prototype for:', result.nodeName);
      return;
    }

    const proto = store.nodePrototypes.get(realProtoId);
    const newDefIds = (proto.definitionGraphIds || []).filter(id => id !== result.graphId);
    store.updateNodePrototype(realProtoId, { definitionGraphIds: newDefIds });
    store.deleteGraph(result.graphId);
    console.log('[Wizard] Successfully removed definition graph:', result.graphId, 'from:', result.nodeName);
    return;
  }

  // Handle switchToGraph — change the active graph (explicit user navigation)
  if (result.action === 'switchToGraph') {
    console.log('[Wizard] Applying switchToGraph to store:', result.graphId, result.graphName);
    const targetGraph = store.graphs.get(result.graphId);
    if (!targetGraph) {
      console.error('[Wizard] switchToGraph: Graph not found:', result.graphId);
      return;
    }
    store.openGraphTabAndBringToTop(result.graphId);
    // Dispatch navigation event for canvas
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rs-navigate-graph', {
          detail: { graphId: result.graphId }
        }));
      }
    }, 100);
    console.log('[Wizard] Successfully switched to graph:', result.graphId);
    return;
  }

  // Handle createPopulatedGraph
  if (result.action === 'createPopulatedGraph' && result.spec) {
    console.log('[Wizard] Applying createPopulatedGraph to store:', result.graphName);
    console.log('[Wizard] Nodes count:', result.spec.nodes?.length || 0);
    console.log('[Wizard] Edges count:', result.spec.edges?.length || 0);
    console.log('[Wizard] Groups count:', result.spec.groups?.length || 0);

    // 1. Create the graph first if it doesn't exist
    let graphId = result.graphId;
    if (!store.graphs.has(graphId)) {
      graphId = store.createNewGraph({
        id: result.graphId,
        name: result.graphName,
        description: result.description || '',
        color: result.color || null
      });
    }

    // Helper to resolve or create type prototypes
    const typeMap = new Map(); // lowercase type name -> protoId

    // First pass: gather all unique types needed
    (result.spec.nodes || []).forEach(n => {
      if (n.type) {
        const tLower = n.type.toLowerCase().trim();
        if (!typeMap.has(tLower)) {
          // Check if it already exists in the store. Take LAST match — old prototypes accumulate
          // in Maps and FIRST match would pick a stale one from a prior session.
          let existingProtoId = null;
          for (const [pid, proto] of store.nodePrototypes) {
            if ((proto.name || '').toLowerCase().trim() === tLower) {
              existingProtoId = pid;
            }
          }
          if (existingProtoId) {
            typeMap.set(tLower, existingProtoId);
          } else {
            const newProtoId = `proto-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            typeMap.set(tLower, newProtoId);

            // Create it!
            store.addNodePrototype({
              id: newProtoId,
              name: n.type,
              color: n.typeColor || '#A0A0A0',
              description: n.typeDescription || '',
              typeNodeId: null,
              definitionGraphIds: []
            });
            console.log('[Wizard] Auto-created inline type node (prototype only):', n.type, '→', newProtoId);
          }
        }
      }
    });

    // 2. Prepare bulk updates - use unique IDs for each node
    const bulkData = {
      nodes: result.spec.nodes.map((n, idx) => ({
        name: n.name,
        color: n.color,
        description: n.description,
        typeNodeId: n.type ? typeMap.get(n.type.toLowerCase().trim()) : null,
        prototypeId: `proto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId: `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200
      })),
      edges: (result.spec.edges || []).map(e => ({
        source: e.source,
        target: e.target,
        type: e.type || 'relates to',
        directionality: e.directionality || 'unidirectional',
        definitionNode: e.definitionNode || null
      })),
      groups: result.spec.groups || []
    };

    // 3. Apply bulk updates in one transaction
    store.applyBulkGraphUpdates(graphId, bulkData);

    console.log('[Wizard] Successfully populated graph:', graphId);
    try { store.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] cleanupOrphanedData failed:', e); }

    // 3b. Ladder → build the abstraction axis instead of a disconnected pile.
    // Falls back silently to the flat nodes if it can't resolve enough rungs.
    if (result.shapeRouting === 'abstraction-axis') {
      try {
        const order = result.spec.abstractionOrder || result.spec.nodes.map(n => n.name);
        applyAbstractionChain(order);
      } catch (e) {
        console.warn('[Wizard] ladder abstraction chain failed:', e);
      }
    }

    // 4. Auto-layout: offscreen layout immediately, then event for DOM-based override
    layoutAfterWizardMutation(graphId);
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rs-trigger-auto-layout', {
          detail: { graphId }
        }));
      }
    }, 600);

    // 5. Launch batch Wikipedia enrichment asynchronously (if enrich is not explicitly false)
    if (result.enrich !== false) {
      const nodeNames = result.spec.nodes.map(n => n.name);

      // Include the defining node in the enrichment batch
      const freshStore = useGraphStore.getState();
      const createdGraph = freshStore.graphs.get(graphId);
      if (createdGraph?.definingNodeIds?.length > 0) {
        const definingProto = freshStore.nodePrototypes.get(createdGraph.definingNodeIds[0]);
        if (definingProto && !nodeNames.includes(definingProto.name)) {
          nodeNames.push(definingProto.name);
        }
      }

      setTimeout(() => {
        _enrichMultiple(nodeNames, graphId, { overwriteDescription: result.overwriteDescription || false }).catch(err => {
          console.warn('[Auto-Enrich] Batch enrichment failed:', err);
        });
      }, 1000);
    }

    // 6. A3 unfold — open each member into its own definition graph of its
    // contents, per the plan the tool built. No plan (no model / no unfold) →
    // no-op, identical to before.
    if (result.spec.unfoldPlan) {
      try {
        applyUnfoldPlan(result.spec.unfoldPlan, {
          enrich: result.enrich !== false,
          overwriteDescription: result.overwriteDescription || false
        });
      } catch (e) {
        console.warn('[Wizard] unfold plan application failed:', e);
      }
    }
  } else if (result.action === 'importTabularAsGraph' && result.spec) {
    // Handle importTabularAsGraph — same pattern as createPopulatedGraph
    console.log('[Wizard] Applying importTabularAsGraph to store:', result.graphName);
    console.log('[Wizard] Nodes count:', result.spec.nodes?.length || 0);
    console.log('[Wizard] Edges count:', result.spec.edges?.length || 0);
    console.log('[Wizard] Groups count:', result.spec.groups?.length || 0);

    // 1. Create the graph if it doesn't exist
    let graphId = result.graphId || result.targetGraphId;
    if (!graphId || !store.graphs.has(graphId)) {
      graphId = store.createNewGraph({
        id: result.graphId,
        name: result.graphName || 'Imported Data',
        description: result.description || '',
      });
    }

    // 2. Resolve or create type prototypes (same as createPopulatedGraph)
    const typeMap = new Map();
    (result.spec.nodes || []).forEach(n => {
      if (n.type) {
        const tLower = n.type.toLowerCase().trim();
        if (!typeMap.has(tLower)) {
          // Take LAST match — old prototypes accumulate in Maps and FIRST match would pick a stale one
          let existingProtoId = null;
          for (const [pid, proto] of store.nodePrototypes) {
            if ((proto.name || '').toLowerCase().trim() === tLower) {
              existingProtoId = pid;
            }
          }
          if (existingProtoId) {
            typeMap.set(tLower, existingProtoId);
          } else {
            const newProtoId = `proto-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            typeMap.set(tLower, newProtoId);
            store.addNodePrototype({
              id: newProtoId,
              name: n.type,
              color: n.typeColor || '#A0A0A0',
              description: n.typeDescription || '',
              typeNodeId: null,
              definitionGraphIds: []
            });
          }
        }
      }
    });

    // 3. Prepare bulk updates
    const bulkData = {
      nodes: result.spec.nodes.map((n, idx) => ({
        name: n.name,
        color: n.color,
        description: n.description,
        typeNodeId: n.type ? typeMap.get(n.type.toLowerCase().trim()) : null,
        prototypeId: `proto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId: `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200
      })),
      edges: (result.spec.edges || []).map(e => ({
        source: e.source,
        target: e.target,
        type: e.type || 'relates to',
        directionality: e.directionality || 'unidirectional',
      })),
      groups: result.spec.groups || []
    };

    store.applyBulkGraphUpdates(graphId, bulkData);
    console.log('[Wizard] Successfully imported tabular data to graph:', graphId);
    try { store.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] cleanupOrphanedData failed:', e); }

    // 4. Auto-layout
    layoutAfterWizardMutation(graphId);
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rs-trigger-auto-layout', { detail: { graphId } }));
      }
    }, 600);

    // 5. Enrichment only if explicitly requested (default false for tabular imports)
    if (result.enrich === true) {
      const nodeNames = result.spec.nodes.map(n => n.name);
      setTimeout(() => {
        _enrichMultiple(nodeNames, graphId, { overwriteDescription: false }).catch(err => {
          console.warn('[Auto-Enrich] Batch enrichment failed:', err);
        });
      }, 1000);
    }

    // Clear tabular data store after successful import
    clearTabularData();
  } else if (result.action === 'expandGraph' && result.spec) {
    // Handle expandGraph — apply nodes and edges to the ACTIVE graph
    console.log('[Wizard] Applying expandGraph to active graph:', result.graphId);
    console.log('[Wizard] New nodes:', result.spec.nodes?.length || 0);
    console.log('[Wizard] New edges:', result.spec.edges?.length || 0);

    const activeGraphId = result.graphId || store.activeGraphId;
    if (!activeGraphId) {
      console.error('[Wizard] expandGraph: No active graph ID');
      return;
    }

    // Validate that the target graph actually exists
    const targetGraph = store.graphs.get(activeGraphId);
    if (!targetGraph) {
      console.error('[Wizard] expandGraph: Graph not found:', activeGraphId);
      console.error('[Wizard] Available graphs:', Array.from(store.graphs.entries()).map(([id, g]) => `${g.name} (${id})`).join(', ') || 'none');
      // Don't proceed with expansion
      return;
    }

    // Helper to resolve or create type prototypes
    const typeMap = new Map(); // lowercase type name -> protoId

    // First pass: gather all unique types needed
    (result.spec.nodes || []).forEach(n => {
      if (n.type) {
        const tLower = n.type.toLowerCase().trim();
        if (!typeMap.has(tLower)) {
          // Check if it already exists in the store. Take LAST match — old prototypes accumulate
          // in Maps and FIRST match would pick a stale one from a prior session.
          let existingProtoId = null;
          for (const [pid, proto] of store.nodePrototypes) {
            if ((proto.name || '').toLowerCase().trim() === tLower) {
              existingProtoId = pid;
            }
          }
          if (existingProtoId) {
            typeMap.set(tLower, existingProtoId);
          } else {
            const newProtoId = `proto-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            typeMap.set(tLower, newProtoId);

            // Create it!
            store.addNodePrototype({
              id: newProtoId,
              name: n.type,
              color: n.typeColor || '#A0A0A0',
              description: n.typeDescription || '',
              typeNodeId: null,
              definitionGraphIds: []
            });
            console.log('[Wizard] Auto-created inline type node (prototype only):', n.type, '→', newProtoId);
          }
        }
      }
    });

    // Prepare bulk updates with unique IDs for each NEW node
    const bulkData = {
      nodes: result.spec.nodes.map((n, idx) => ({
        name: n.name,
        color: n.color,
        description: n.description,
        typeNodeId: n.type ? typeMap.get(n.type.toLowerCase().trim()) : null,
        prototypeId: `proto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId: `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        x: Math.random() * 600 + 200,
        y: Math.random() * 500 + 200
      })),
      edges: (result.spec.edges || []).map(e => ({
        source: e.source,
        target: e.target,
        type: e.type || 'relates to',
        directionality: e.directionality || 'unidirectional',
        definitionNode: e.definitionNode || null
      })),
      groups: result.spec.groups || []
    };

    // Apply bulk updates to the ACTIVE graph (not creating a new one)
    store.applyBulkGraphUpdates(activeGraphId, bulkData);
    try { store.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] cleanupOrphanedData failed:', e); }

    // Verify the operation actually succeeded
    const updatedGraph = store.graphs.get(activeGraphId);
    const actualNodeCount = updatedGraph?.instances?.size || 0;

    if (updatedGraph && actualNodeCount > 0) {
      console.log('[Wizard] Successfully expanded graph:', activeGraphId,
        '| Nodes added:', result.spec.nodes?.length || 0,
        '| Total nodes now:', actualNodeCount);
    } else {
      console.error('[Wizard] expandGraph appeared to succeed but graph state unchanged:', activeGraphId);
    }

    // Auto-layout: offscreen layout immediately, then event for DOM-based override
    layoutAfterWizardMutation(activeGraphId);
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rs-trigger-auto-layout', {
          detail: { graphId: activeGraphId }
        }));
      }
    }, 600);

    // Launch batch Wikipedia enrichment asynchronously (if enrich is not explicitly false)
    if (result.enrich !== false) {
      const nodeNames = result.spec.nodes.map(n => n.name);
      setTimeout(() => {
        _enrichMultiple(nodeNames, activeGraphId, { overwriteDescription: result.overwriteDescription || false }).catch(err => {
          console.warn('[Auto-Enrich] Batch enrichment failed:', err);
        });
      }, 1000);
    }
  }

  // Handle setNodeType — set or clear a node's type, auto-creating the type node if needed
  if (result.action === 'setNodeType') {
    console.log('[Wizard] Applying setNodeType to store:', result.nodeId, '→', result.typeNodeId, 'autoCreate:', !!result.autoCreate);

    let typeNodeId = result.typeNodeId;

    // Auto-create the type node if needed
    if (result.autoCreate && !typeNodeId) {
      const newProtoId = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      store.addNodePrototype({
        id: newProtoId,
        name: result.autoCreate.name,
        color: result.autoCreate.color || '#A0A0A0',
        description: result.autoCreate.description || '',
        typeNodeId: null,
        definitionGraphIds: []
      });

      typeNodeId = newProtoId;
      console.log('[Wizard] Auto-created type node (prototype only):', result.autoCreate.name, '→', newProtoId);
    }

    if (result.nodeId && store.nodePrototypes.has(result.nodeId)) {
      store.setNodeType(result.nodeId, typeNodeId);
      console.log('[Wizard] Successfully set node type:', result.nodeId, '→', typeNodeId);
    } else {
      console.error('[Wizard] setNodeType: Node not found:', result.nodeId);
    }
    return;
  }

  // Handle editAbstractionChain — add or remove nodes from abstraction chains
  if (result.action === 'editAbstractionChain') {
    console.log('[Wizard] Applying editAbstractionChain to store:', result.operationType, result.nodeId);

    if (!result.nodeId || !store.nodePrototypes.has(result.nodeId)) {
      console.error('[Wizard] editAbstractionChain: Node not found:', result.nodeId);
      return;
    }

    if (result.operationType === 'addToAbstractionChain') {
      store.addToAbstractionChain(
        result.nodeId,
        result.dimension,
        result.direction,
        result.newNodeId,
        result.insertRelativeToNodeId
      );
      console.log('[Wizard] Successfully added to abstraction chain:', result.dimension);
    } else if (result.operationType === 'removeFromAbstractionChain') {
      store.removeFromAbstractionChain(
        result.nodeId,
        result.dimension,
        result.nodeToRemove
      );
      console.log('[Wizard] Successfully removed from abstraction chain:', result.dimension);
    } else {
      console.error('[Wizard] editAbstractionChain: Unknown operation type:', result.operationType);
    }
    return;
  }

  if (result.action === 'selectNode' && result.found && result.node) {
    // Dispatch event for NodeCanvas to select and focus on the node
    console.log(`[Wizard] Selecting node: "${result.node.name}" (${result.node.instanceId})`);
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rs-select-node', {
          detail: {
            instanceId: result.node.instanceId,
            prototypeId: result.node.prototypeId,
            name: result.node.name
          }
        }));
      }
    }, 100);
  } else if (result.action === 'themeGraph') {
    const graphId = result.graphId || store.activeGraphId;
    console.log('[Wizard] Applying themeGraph to store:', graphId);
    if (!graphId) return;

    for (const update of (result.updates || [])) {
      store.updateNodePrototype(update.prototypeId, (draft) => {
        draft.color = update.color;
      });
    }
    console.log('[Wizard] Successfully themed graph:', graphId, 'with', (result.updates || []).length, 'updates');
  } else if (result.action === 'enrichFromWikipedia') {
    // Async client-side enrichment — kick off Wikipedia fetch in browser context
    const nodeName = result.nodeName;
    const graphId = result.graphId || store.activeGraphId;
    const overwriteDescription = result.overwriteDescription || false;
    console.log('[Wizard] Applying enrichFromWikipedia for:', nodeName, overwriteDescription ? '(overwrite description)' : '(preserve description)');

    // Run async enrichment (don't block — fire and forget)
    _enrich(nodeName, graphId, { minConfidence: 0.0, overwriteDescription }).then(enrichResult => {
      if (enrichResult?.success) {
        console.log(`[Wizard] ✅ Wikipedia enrichment succeeded for "${nodeName}"`);
      } else {
        console.warn(`[Wizard] ⚠️ Wikipedia enrichment returned no result for "${nodeName}"`);
      }
    }).catch(err => {
      console.error(`[Wizard] ❌ Wikipedia enrichment failed for "${nodeName}":`, err);
    });
  } else if (result.action === 'mergeNodes') {
    // Handle mergeNodes — resolve by ID if available, fall back to name
    const primaryName = (result.primaryName || '').toLowerCase().trim();
    const secondaryName = (result.secondaryName || '').toLowerCase().trim();
    console.log('[Wizard] Applying mergeNodes to store:', secondaryName || result.secondaryProtoId, '→', primaryName || result.primaryProtoId);

    // Try ID-based resolution first (IDs from agent via findDuplicates/inspectPrototype)
    let primaryId = null;
    let secondaryId = null;

    if (result.primaryProtoId && store.nodePrototypes.has(result.primaryProtoId)) {
      primaryId = result.primaryProtoId;
    }
    if (result.secondaryProtoId && store.nodePrototypes.has(result.secondaryProtoId)) {
      secondaryId = result.secondaryProtoId;
    }

    // Fall back to name resolution for any that didn't resolve by ID
    // Take LAST match (old prototypes accumulate in Maps)
    if (!primaryId || !secondaryId) {
      for (const [pid, proto] of store.nodePrototypes) {
        const pName = (proto.name || '').toLowerCase().trim();
        if (!primaryId && pName === primaryName) { primaryId = pid; /* no break */ }
        if (!secondaryId && pName === secondaryName) { secondaryId = pid; /* no break */ }
      }
    }

    if (!primaryId) {
      console.error('[Wizard] mergeNodes: Could not find primary node:', result.primaryProtoId || primaryName);
      return;
    }
    if (!secondaryId) {
      console.error('[Wizard] mergeNodes: Could not find secondary node:', result.secondaryProtoId || secondaryName);
      return;
    }
    if (primaryId === secondaryId) {
      console.error('[Wizard] mergeNodes: Primary and secondary resolved to the same node:', primaryId);
      return;
    }

    store.mergeDefinitionGraphs(primaryId, secondaryId, { strategy: 'combine' });
    store.mergeNodePrototypes(primaryId, secondaryId);
    console.log('[Wizard] Successfully merged node:', secondaryName || secondaryId, '→', primaryName || primaryId);
    return;

  } else if (result.action === 'mergeGraphs') {
    // Handle mergeGraphs — merge duplicate prototypes, move all content to target, delete source
    const pairs = result.pairs || [];
    const sourceGraphId = result.sourceGraphId;
    const targetGraphId = result.targetGraphId;
    console.log('[Wizard] Applying mergeGraphs to store:', pairs.length, 'pairs, source:', sourceGraphId, '→ target:', targetGraphId);

    if (!sourceGraphId || !targetGraphId) {
      console.error('[Wizard] mergeGraphs: Missing sourceGraphId or targetGraphId');
      return;
    }

    // Step 1: Merge duplicate node prototypes
    let mergedCount = 0;
    for (const pair of pairs) {
      const primaryName = (pair.primary?.name || '').toLowerCase().trim();
      const secondaryName = (pair.secondary?.name || '').toLowerCase().trim();

      let primaryId = null;
      let secondaryId = null;
      for (const [pid, proto] of store.nodePrototypes) {
        const pName = (proto.name || '').toLowerCase().trim();
        if (pName === primaryName) { primaryId = pid; }
        if (pName === secondaryName) { secondaryId = pid; }
      }

      if (!primaryId || !secondaryId || primaryId === secondaryId) {
        console.error('[Wizard] mergeGraphs: Skipping pair, could not resolve:', primaryName, secondaryName);
        continue;
      }

      store.mergeDefinitionGraphs(primaryId, secondaryId, { strategy: 'combine' });
      store.mergeNodePrototypes(primaryId, secondaryId);
      mergedCount++;
    }
    console.log('[Wizard] Merged', mergedCount, 'duplicate prototype pairs');

    // Step 2: Move instances and edges from source to target via applyBulkGraphUpdates
    // Re-read store after prototype merges (state may have changed)
    const freshStore = useGraphStore.getState();
    const sourceGraph = freshStore.graphs.get(sourceGraphId);
    if (!sourceGraph) {
      console.error('[Wizard] mergeGraphs: Source graph not found after merge:', sourceGraphId);
      return;
    }

    const nodes = [];
    const edges = [];
    const instanceIdToName = new Map();

    // Build nodes from source graph instances
    for (const [instId, inst] of sourceGraph.instances) {
      const proto = freshStore.nodePrototypes.get(inst.prototypeId);
      if (!proto) continue;
      instanceIdToName.set(instId, proto.name);
      nodes.push({ name: proto.name, color: proto.color });
    }

    // Build edges from source graph
    for (const edgeId of (sourceGraph.edgeIds || [])) {
      const edge = freshStore.edges.get(edgeId);
      if (!edge) continue;
      const sourceName = instanceIdToName.get(edge.sourceId);
      const targetName = instanceIdToName.get(edge.destinationId);
      if (!sourceName || !targetName) continue;
      edges.push({
        source: sourceName,
        target: targetName,
        type: edge.name || edge.type || '',
        directionality: edge.directionality?.arrowsToward?.has(edge.destinationId)
          ? 'unidirectional' : 'none'
      });
    }

    console.log('[Wizard] Moving', nodes.length, 'nodes and', edges.length, 'edges from source to target');

    // Apply to target graph (applyBulkGraphUpdates deduplicates by name)
    freshStore.applyBulkGraphUpdates(targetGraphId, { nodes, edges });
    try { freshStore.cleanupOrphanedData(); } catch (e) { console.warn('[Wizard] cleanupOrphanedData failed:', e); }

    // Step 3: Delete source graph
    freshStore.deleteGraph(sourceGraphId);

    console.log('[Wizard] Successfully merged graphs. Source graph deleted.');
    return;

  } else if (result.goalId || toolName === 'updateGroup' || toolName === 'deleteGroup') {
    // Other mutating tools that go through the goal queue
    // We trigger a re-fetch of the graph state to ensure the UI is in sync
    console.log(`[Wizard] Applying ${toolName} to store, triggering refresh.`);

    // Slight delay to allow backend to finish committing
    setTimeout(() => {
      if (typeof window !== 'undefined' && window.redstringStoreActions && window.redstringStoreActions._triggerGraphRefresh) {
        window.redstringStoreActions._triggerGraphRefresh();
      }
    }, 500);
  }
}

// Export raw store pipeline for MCP bridge to use as a fallback handler
// (browser only — headless hosts import applyToolResultToStore directly).
if (typeof window !== 'undefined') {
  window.__rs_applyToolResultToStore = applyToolResultToStore;
}
