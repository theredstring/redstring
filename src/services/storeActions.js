/**
 * storeActions.js
 *
 * The store-mutation action handlers that back the bridge's applyMutations /
 * pending-action executor. Extracted from BridgeClient's
 * `window.redstringStoreActions` object so the browser and the Node daemon
 * execute the SAME handlers.
 *
 * Environment coupling is injected via createStoreActions(deps):
 *  - useGraphStore    the store singleton (same module in both hosts).
 *  - emitEvent(evt)   browser: (evt) => window.dispatchEvent(evt); node: no-op.
 *                     Handlers build `new CustomEvent(...)` (global in browsers
 *                     and Node >= 22) and hand it to emitEvent; node drops it.
 *  - markActive()     browser: bumps the connection activity ref; node: no-op.
 *  - navigate(gid)    browser: canvas navigation; node: no-op.
 *  - syncState()      browser: POST current store to the bridge; node: no-op.
 *                     Replaces the old inline self-sync payloads.
 *  - bridgeStateFetch() browser: GET /api/bridge/state; node: -> {ok:false}.
 *  - uiCallbacks      browser wiring for wizard/chat UI reads (getTabs,
 *                     getWizardStatus); absent in node -> handlers report the
 *                     UI is unavailable.
 *
 * STALE-STATE FIX: the original captured `const state = getState()` once at
 * registration and reused it across every later handler call. All those
 * `state.*` accesses are rewritten to `useGraphStore.getState().*` so each
 * handler reads the CURRENT store at call time.
 */
import { NODE_DEFAULT_COLOR } from '../constants.js';
import { applyOffscreenLayout } from './offscreenLayout.js';

// Coerce a raw id (string or wrapping object) to a string id. Pure — safe in
// any host. Exported so BridgeClient's pending-action loop can reuse it.
export const normalizeId = (val, keyHint) => {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    return val.id || (keyHint && val[keyHint]) || val.graphId || val.prototypeId || val.instanceId || val.nodeId || val.edgeId;
  }
  return val;
};

// Ordering priority for pending actions: graph creation before prototypes
// before instances/edges, so dependencies exist when referenced. Exported so
// both the browser bridge loop and the headless daemon executor sort the same.
export const priority = (act) => {
  if (act.action === 'applyMutations') {
    const ops = Array.isArray(act.params?.[0]) ? act.params[0] : [];
    const creates = ops.some(o => o && o.type === 'createNewGraph');
    return creates ? 1 : 4;
  }
  switch (act.action) {
    case 'createNewGraph': return 0;
    case 'addNodePrototype': return 1;
    case 'openGraph': return 2;
    case 'setActiveGraph': return 3;
    default: return 5;
  }
};

/**
 * Build the store-action handler map. Returns the object formerly assigned to
 * window.redstringStoreActions.
 */
export function createStoreActions({
  useGraphStore,
  emitEvent = () => {},
  markActive = () => {},
  navigate = () => {},
  syncState = async () => {},
  bridgeStateFetch = async () => ({ ok: false }),
  uiCallbacks = {}
} = {}) {
  return {
            // Helper to mark activity
            _markActive: () => { markActive(); },

            ensureGraph: async (rawId, initialData) => {
              markActive();
              const graphId = normalizeId(rawId, 'graphId');
              console.log('MCPBridge: Calling ensureGraph', graphId, initialData);
              const st = useGraphStore.getState();
              if (!st.graphs.has(graphId)) {
                st.createGraphWithId(graphId, initialData || {});
              }
              return { success: true, graphId };
            },
            addNodePrototype: async (arg1, arg2) => {
              const data = (arg2 || (arg1 && typeof arg1 === 'object' ? arg1 : {}));
              const prototypeId = normalizeId(arg1, 'id') || data.id || data.prototypeId;
              console.log('MCPBridge: Calling addNodePrototype', prototypeId, data);

              const dataWithId = { ...data, id: prototypeId };
              useGraphStore.getState().addNodePrototype(dataWithId);
              try {
                const protoName = String(dataWithId?.name || 'Concept');
                const evt = [{ ts: Date.now(), type: 'info', name: 'addNodePrototype', message: `Created concept "${protoName}"` }];
                emitEvent(new CustomEvent('rs-telemetry', { detail: evt }));
              } catch { }
              return { success: true, prototypeId };
            },
            addNodeInstance: async (arg1, arg2, arg3, arg4) => {
              const graphId = normalizeId(arg1, 'graphId');
              const prototypeId = normalizeId(arg2 || arg1, 'prototypeId');
              const position = arg3 || (arg1 && typeof arg1 === 'object' ? arg1.position : undefined);
              const instanceId = normalizeId(arg4 || arg1, 'instanceId');

              console.log('MCPBridge: Calling addNodeInstance', { graphId, prototypeId, position, instanceId });
              useGraphStore.getState().addNodeInstance(graphId, prototypeId, position, instanceId);
              return { success: true, instanceId };
            },
            removeNodeInstance: async (arg1, arg2) => {
              const graphId = normalizeId(arg1, 'graphId');
              const instanceId = normalizeId(arg2 || arg1, 'instanceId');

              console.log('MCPBridge: Calling removeNodeInstance', graphId, instanceId);
              useGraphStore.getState().removeNodeInstance(graphId, instanceId);
              return { success: true, instanceId };
            },
            updateNodePrototype: async (arg1, arg2) => {
              const prototypeId = normalizeId(arg1, 'id');
              const updates = arg2 || (arg1 && typeof arg1 === 'object' ? arg1.updates || arg1 : {});
              console.log('MCPBridge: Calling updateNodePrototype', prototypeId, updates);
              useGraphStore.getState().updateNodePrototype(prototypeId, (prototype) => {
                Object.assign(prototype, updates);
              });
              return { success: true, prototypeId };
            },
            setActiveGraph: async (rawId) => {
              const graphId = normalizeId(rawId, 'graphId');
              console.log('MCPBridge: Calling setActiveGraph', graphId);
              useGraphStore.getState().setActiveGraph(graphId);
              try {
                const s = useGraphStore.getState();
                const g = s.graphs.get(graphId);
                const friendly = `Switched to graph "${g?.name || graphId}"`;
                emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'setActiveGraph', message: friendly }] }));
                // Navigate to show the switched graph
                navigate(graphId);
              } catch { }
              return { success: true, graphId };
            },
            openGraph: async (rawId) => {
              const graphId = normalizeId(rawId, 'graphId');
              console.log('MCPBridge: Calling openGraphTab', graphId);
              useGraphStore.getState().openGraphTab(graphId);
              try {
                const s = useGraphStore.getState();
                const g = s.graphs.get(graphId);
                const friendly = `Opened graph "${g?.name || graphId}"`;
                emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'openGraph', message: friendly }] }));
                // Immediately sync store to the bridge so /api/ai/agent sees the
                // active graph without delay (no-op headless — daemon IS the store).
                try {
                  await syncState();
                  // Navigate to show the opened graph
                  navigate(graphId);
                } catch { }
              } catch { }
              return { success: true, graphId };
            },
            createNewGraph: async (initialData) => {
              console.log('MCPBridge: Calling createNewGraph', initialData);
              const beforeId = useGraphStore.getState().activeGraphId;
              useGraphStore.getState().createNewGraph(initialData || {});
              const afterId = useGraphStore.getState().activeGraphId;
              try {
                const s2 = useGraphStore.getState();
                const g = afterId ? s2.graphs.get(afterId) : null;
                const friendly = `Created graph "${g?.name || 'New Thing'}" (${afterId || 'unknown'})`;
                emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'createNewGraph', message: friendly, graphId: afterId }] }));

                // CRITICAL: Sync new graph to the bridge immediately so AI can
                // see it (no-op headless — daemon IS the store).
                await syncState();

                // Navigate to show the new graph
                if (afterId && afterId !== beforeId) {
                  navigate(afterId);
                }
              } catch { }
              return { success: true, graphId: afterId || beforeId };
            },
            createAndAssignGraphDefinition: async (prototypeId) => {
              console.log('MCPBridge: Calling createAndAssignGraphDefinition', prototypeId);
              const graphId = useGraphStore.getState().createAndAssignGraphDefinition(prototypeId);
              return { success: true, graphId, prototypeId };
            },
            openRightPanelNodeTab: async (nodeId) => {
              console.log('MCPBridge: Calling openRightPanelNodeTab', nodeId);
              useGraphStore.getState().openRightPanelNodeTab(nodeId);
              return { success: true, nodeId };
            },
            addEdge: async (arg1, arg2) => {
              const graphId = normalizeId(arg1, 'graphId');
              const edgeData = arg2 || (arg1 && typeof arg1 === 'object' ? arg1.edgeData : undefined);
              console.log('MCPBridge: Calling addEdge', graphId, edgeData);
              useGraphStore.getState().addEdge(graphId, edgeData);
              return { success: true, edgeId: edgeData?.id };
            },
            updateEdgeDirectionality: async (edgeId, arrowsToward) => {
              console.log('MCPBridge: Calling updateEdgeDirectionality', edgeId, arrowsToward);
              useGraphStore.getState().updateEdge(edgeId, (edge) => {
                edge.directionality = {
                  arrowsToward: new Set(Array.isArray(arrowsToward) ? arrowsToward : [])
                };
              });
              return { success: true, edgeId };
            },
            addToAbstractionChain: async (nodeId, dimension, direction, newNodeId, insertRelativeToNodeId) => {
              console.log('MCPBridge: Calling addToAbstractionChain', { nodeId, dimension, direction, newNodeId, insertRelativeToNodeId });
              useGraphStore.getState().addToAbstractionChain(nodeId, dimension, direction, newNodeId, insertRelativeToNodeId);
              return { success: true };
            },
            removeFromAbstractionChain: async (nodeId, dimension, nodeToRemove) => {
              console.log('MCPBridge: Calling removeFromAbstractionChain', { nodeId, dimension, nodeToRemove });
              useGraphStore.getState().removeFromAbstractionChain(nodeId, dimension, nodeToRemove);
              return { success: true };
            },
            swapNodeInChain: async (currentNodeId, newNodeId) => {
              console.log('MCPBridge: Calling swapNodeInChain', currentNodeId, newNodeId);
              useGraphStore.getState().swapNodeInChain(currentNodeId, newNodeId);
              return { success: true };
            },
            setNodeType: async (nodeIdOrResult, typeNodeId) => {
              // Handle both direct calls (nodeId, typeNodeId) and wizard result objects ({nodeId, typeNodeId, autoCreate?})
              const nId = typeof nodeIdOrResult === 'object' ? nodeIdOrResult.nodeId : nodeIdOrResult;
              let tId = typeof nodeIdOrResult === 'object' ? nodeIdOrResult.typeNodeId : typeNodeId;
              const msg = typeof nodeIdOrResult === 'object' ? nodeIdOrResult.message : undefined;
              const autoCreate = typeof nodeIdOrResult === 'object' ? nodeIdOrResult.autoCreate : undefined;

              const st = useGraphStore.getState();
              if (!st.nodePrototypes.has(nId)) {
                return { success: false, error: `Node ${nId} not found` };
              }

              // Auto-create the type node if needed
              if (autoCreate && !tId) {
                const newProtoId = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

                st.addNodePrototype({
                  id: newProtoId,
                  name: autoCreate.name,
                  color: autoCreate.color || '#A0A0A0',
                  description: autoCreate.description || '',
                  typeNodeId: null,
                  definitionGraphIds: []
                });

                tId = newProtoId;
                console.log('MCPBridge: Auto-created type node (prototype only):', autoCreate.name, '→', newProtoId);
              }

              console.log('MCPBridge: Calling setNodeType', nId, '→', tId);
              st.setNodeType(nId, tId);
              return { success: true, nodeId: nId, typeNodeId: tId, ...(msg ? { message: msg } : {}) };
            },
            closeGraphTab: async (rawId) => {
              const graphId = normalizeId(rawId, 'graphId');
              console.log('MCPBridge: Calling closeGraphTab', graphId);
              useGraphStore.getState().closeGraphTab(graphId);
              return { success: true };
            },
            sendWizardMessage: async (message) => {
              try {
                emitEvent(new CustomEvent('rs-send-wizard-message', { detail: { message } }));
                return { success: true };
              } catch (e) {
                return { error: String(e) };
              }
            },
            getWizardTabs: async () => {
              try {
                if (typeof uiCallbacks.getTabs === 'function') {
                  const data = uiCallbacks.getTabs();
                  return { success: true, ...data };
                }
                return { error: 'Global tab getter not found' };
              } catch (e) {
                return { error: String(e) };
              }
            },
            getWizardStatus: async () => {
              try {
                if (typeof uiCallbacks.getWizardStatus === 'function') {
                  const data = uiCallbacks.getWizardStatus();
                  return { success: true, ...data };
                }
                return { error: 'Global status getter not found' };
              } catch (e) {
                return { error: String(e) };
              }
            },
            switchWizardTab: async (conversationId) => {
              try {
                emitEvent(new CustomEvent('rs-switch-wizard-tab', { detail: { id: conversationId } }));
                return { success: true };
              } catch (e) {
                return { error: String(e) };
              }
            },
            createWizardTab: async () => {
              try {
                emitEvent(new CustomEvent('rs-new-wizard-tab'));
                return { success: true };
              } catch (e) {
                return { error: String(e) };
              }
            },
            chat: async (message, context) => {
              markActive();
              console.log('MCPBridge: Forwarding chat message to AI model', { message, context });
              // The actual chat handling happens in the MCP server
              return { success: true, message, context };
            },

            // --- WIZARD ACTIONS DELETED, SEE FALLBACK HANDLER AROUND LINE 2750 ---

            applyMutations: async (operations) => {
              console.groupCollapsed('MCPBridge: Applying batch mutations');
              console.log('Operation count:', operations?.length || 0);
              console.log('Operations:', operations);
              const store = useGraphStore.getState();
              const results = [];
              // Helper: sync prototype from bridge state if missing
              const ensurePrototype = async (prototypeId) => {
                const st = useGraphStore.getState();
                if (st.nodePrototypes.has(prototypeId)) return true;
                try {
                  const resp = await bridgeStateFetch();
                  if (!resp.ok) return false;
                  const b = await resp.json();
                  const p = Array.isArray(b.nodePrototypes) ? b.nodePrototypes.find(x => x.id === prototypeId) : null;
                  if (p) {
                    st.addNodePrototype({
                      id: prototypeId,
                      name: p.name,
                      description: p.description || '',
                      color: p.color || NODE_DEFAULT_COLOR,
                      typeNodeId: p.typeNodeId || null,
                      definitionGraphIds: p.definitionGraphIds || []
                    });
                    console.log('MCPBridge: ensurePrototype added missing prototype', p.name, prototypeId);
                    return true;
                  }
                } catch { }
                return false;
              };
              for (const op of (operations || [])) {
                try {
                  switch (op.type) {
                    case 'addNodePrototype': {
                      const st = useGraphStore.getState();
                      if (st.nodePrototypes.has(op.prototypeData?.id)) {
                        console.log('MCPBridge: Prototype already exists, skipping', op.prototypeData?.id);
                        results.push({ type: op.type, ok: true, id: op.prototypeData?.id, skipped: true });
                        break;
                      }
                      st.addNodePrototype({
                        id: op.prototypeData.id,
                        name: op.prototypeData.name || 'Unnamed',
                        description: op.prototypeData.description || '',
                        color: op.prototypeData.color || NODE_DEFAULT_COLOR,
                        typeNodeId: op.prototypeData.typeNodeId || null,
                        definitionGraphIds: op.prototypeData.definitionGraphIds || []
                      });
                      console.log('MCPBridge: addNodePrototype created', op.prototypeData.name, op.prototypeData.id);
                      results.push({ type: op.type, ok: true, id: op.prototypeData.id });
                      break;
                    }
                    case 'addNodeInstance': {
                      const st = useGraphStore.getState();
                      let graph = st.graphs.get(op.graphId);
                      let protoExists = st.nodePrototypes.has(op.prototypeId);
                      if (!protoExists) {
                        protoExists = await ensurePrototype(op.prototypeId);
                      }
                      if (!graph || !protoExists) {
                        console.warn('MCPBridge: Skipping addNodeInstance due to missing graph/prototype', { graphExists: !!graph, protoExists, graphId: op.graphId, prototypeId: op.prototypeId });
                        results.push({ type: op.type, ok: false, id: op.instanceId, error: 'Missing graph/prototype' });
                        break;
                      }
                      const beforeCount = (st.graphs.get(op.graphId)?.instances?.size) || 0;
                      st.addNodeInstance(op.graphId, op.prototypeId, op.position, op.instanceId);
                      try {
                        const s2 = useGraphStore.getState();
                        const g = s2.graphs.get(op.graphId);
                        const proto = s2.nodePrototypes.get(op.prototypeId);
                        const friendly = `Added "${proto?.name || 'Concept'}" to "${g?.name || 'Graph'}" at (${Math.round(op.position?.x ?? 0)}, ${Math.round(op.position?.y ?? 0)})`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        const afterCount = (g?.instances?.size) || 0;
                        console.log('MCPBridge: addNodeInstance applied', { graphId: op.graphId, instanceId: op.instanceId, position: op.position, instanceCountBefore: beforeCount, instanceCountAfter: afterCount });
                      } catch { }
                      results.push({ type: op.type, ok: true, id: op.instanceId });
                      break;
                    }
                    case 'addEdge': {
                      const st = useGraphStore.getState();
                      const g = st.graphs.get(op.graphId);
                      const ok = !!(g && g.instances && g.instances.has(op.edgeData?.sourceId) && g.instances.has(op.edgeData?.destinationId));
                      if (!ok) {
                        results.push({ type: op.type, ok: false, id: op.edgeData?.id, error: 'Missing instances/graph' });
                        break;
                      }
                      // Auto-create a connection-type prototype when connectionName is given
                      // (mirrors how the UI creates a defining node for each edge type).
                      const edgeData = { ...op.edgeData };
                      const connName = edgeData.connectionName;
                      if (connName && !(edgeData.definitionNodeIds?.length)) {
                        let connProtoId = null;
                        for (const [pid, proto] of useGraphStore.getState().nodePrototypes) {
                          if ((proto.name || '').toLowerCase() === connName.toLowerCase()) connProtoId = pid;
                        }
                        if (!connProtoId) {
                          connProtoId = `conn-${connName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
                          useGraphStore.getState().addNodePrototype({ id: connProtoId, name: connName, color: NODE_DEFAULT_COLOR, definitionGraphIds: [] });
                        }
                        edgeData.definitionNodeIds = [connProtoId];
                        delete edgeData.connectionName;
                      }
                      st.addEdge(op.graphId, edgeData);
                      try {
                        const s2 = useGraphStore.getState();
                        const gi = s2.graphs.get(op.graphId);
                        const srcInst = gi?.instances?.get(edgeData?.sourceId);
                        const dstInst = gi?.instances?.get(edgeData?.destinationId);
                        const srcProto = srcInst ? s2.nodePrototypes.get(srcInst.prototypeId) : null;
                        const dstProto = dstInst ? s2.nodePrototypes.get(dstInst.prototypeId) : null;
                        const connLabel = edgeData.definitionNodeIds?.length
                          ? s2.nodePrototypes.get(edgeData.definitionNodeIds[0])?.name || ''
                          : '';
                        const friendly = `Connected "${srcProto?.name || 'A'}" ${connLabel ? `—[${connLabel}]→` : '→'} "${dstProto?.name || 'B'}"`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                      } catch { }
                      results.push({ type: op.type, ok: true, id: edgeData?.id, connectionName: connName || null });
                      break;
                    }
                    case 'moveNodeInstance': {
                      const st = useGraphStore.getState();
                      const g = st.graphs.get(op.graphId);
                      const exists = !!(g && g.instances && g.instances.get(op.instanceId));
                      if (!exists) {
                        results.push({ type: op.type, ok: false, id: op.instanceId, error: 'Missing instance/graph' });
                        break;
                      }
                      st.updateNodeInstance(op.graphId, op.instanceId, (inst) => { inst.x = op.position.x; inst.y = op.position.y; });
                      try {
                        const s2 = useGraphStore.getState();
                        const g2 = s2.graphs.get(op.graphId);
                        const inst2 = g2?.instances?.get(op.instanceId);
                        const proto = inst2 ? s2.nodePrototypes.get(inst2.prototypeId) : null;
                        const friendly = `Moved "${proto?.name || 'Concept'}" to (${Math.round(op.position?.x ?? 0)}, ${Math.round(op.position?.y ?? 0)})`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        console.log('MCPBridge: moveNodeInstance applied', { graphId: op.graphId, instanceId: op.instanceId, position: op.position, instanceCount: g2?.instances?.size });
                      } catch { }
                      results.push({ type: op.type, ok: true, id: op.instanceId });
                      break;
                    }
                    case 'updateEdgeDirectionality': {
                      const st = useGraphStore.getState();
                      const edgeExists = st.edges.has(op.edgeId);
                      if (!edgeExists) {
                        results.push({ type: op.type, ok: false, id: op.edgeId, error: 'Missing edge' });
                        break;
                      }
                      st.updateEdge(op.edgeId, (edge) => {
                        edge.directionality = { arrowsToward: new Set(Array.isArray(op.arrowsToward) ? op.arrowsToward : []) };
                      });
                      try {
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: 'Updated connection direction' }] }));
                      } catch { }
                      results.push({ type: op.type, ok: true, id: op.edgeId });
                      break;
                    }
                    case 'updateEdgeDefinition': {
                      const st = useGraphStore.getState();
                      const edgeExists = st.edges.has(op.edgeId);
                      if (!edgeExists) {
                        results.push({ type: op.type, ok: false, id: op.edgeId, error: 'Missing edge' });
                        break;
                      }
                      st.updateEdge(op.edgeId, (edge) => {
                        edge.definitionNodeIds = Array.isArray(op.definitionNodeIds) ? [...op.definitionNodeIds] : [];
                      });
                      try {
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: 'Defined connections for an edge' }] }));
                      } catch { }
                      results.push({ type: op.type, ok: true, id: op.edgeId });
                      break;
                    }
                    case 'updateGraph': {
                      const st = useGraphStore.getState();
                      const g = st.graphs.get(op.graphId);
                      if (!g) {
                        results.push({ type: op.type, ok: false, id: op.graphId, error: 'Missing graph' });
                        break;
                      }
                      st.updateGraph(op.graphId, (graph) => {
                        if (typeof op.updates?.name === 'string') graph.name = op.updates.name;
                        if (typeof op.updates?.color === 'string') graph.color = op.updates.color;
                      });
                      try {
                        const s2 = useGraphStore.getState();
                        const g2 = s2.graphs.get(op.graphId);
                        const friendly = `Updated graph "${g2?.name || op.graphId}"`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                      } catch { }
                      results.push({ type: op.type, ok: true, id: op.graphId });
                      break;
                    }
                    case 'updateNodePrototype': {
                      const st = useGraphStore.getState();
                      const exists = st.nodePrototypes.has(op.prototypeId);
                      if (!exists) {
                        results.push({ type: op.type, ok: false, id: op.prototypeId, error: 'Missing prototype' });
                        break;
                      }
                      st.updateNodePrototype(op.prototypeId, (prototype) => {
                        if (typeof op.updates?.name === 'string') prototype.name = op.updates.name;
                        if (typeof op.updates?.color === 'string') prototype.color = op.updates.color;
                        if (typeof op.updates?.description === 'string') prototype.description = op.updates.description;
                      });
                      try {
                        const s2 = useGraphStore.getState();
                        const p2 = s2.nodePrototypes.get(op.prototypeId);
                        const friendly = `Updated concept "${p2?.name || op.prototypeId}"`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                      } catch { }
                      results.push({ type: op.type, ok: true, id: op.prototypeId });
                      break;
                    }
                    case 'openRightPanelNodeTab':
                      store.openRightPanelNodeTab(op.nodeId);
                      results.push({ type: op.type, ok: true, id: op.nodeId });
                      break;
                    case 'addToAbstractionChain':
                      store.addToAbstractionChain(op.nodeId, op.dimension, op.direction, op.newNodeId, op.insertRelativeToNodeId);
                      results.push({ type: op.type, ok: true });
                      break;
                    case 'removeFromAbstractionChain':
                      store.removeFromAbstractionChain(op.nodeId, op.dimension, op.nodeToRemove);
                      results.push({ type: op.type, ok: true });
                      break;
                    case 'swapNodeInChain':
                      store.swapNodeInChain(op.currentNodeId, op.newNodeId);
                      results.push({ type: op.type, ok: true });
                      break;
                    case 'setNodeType':
                      store.setNodeType(op.nodeId, op.typeNodeId);
                      results.push({ type: op.type, ok: true });
                      break;
                    case 'closeGraphTab':
                      store.closeGraphTab(op.graphId);
                      results.push({ type: op.type, ok: true });
                      break;
                    case 'createNewGraph': {
                      const init = op.initialData || {};
                      let newGraphId = null;
                      if (init.id) {
                        store.createGraphWithId(init.id, init);
                        try { store.openGraphTab(init.id); } catch { }
                        newGraphId = init.id;
                      } else {
                        store.createNewGraph(init);
                        newGraphId = useGraphStore.getState().activeGraphId;
                      }
                      try {
                        const s2 = useGraphStore.getState();
                        const gid = s2.activeGraphId;
                        const g = gid ? s2.graphs.get(gid) : null;
                        const friendly = `Created graph "${g?.name || 'New Graph'}"`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        // Navigate to show the new graph
                        if (newGraphId) {
                          navigate(newGraphId);
                        }
                      } catch { }
                      results.push({ type: op.type, ok: true });
                      break;
                    }
                    case 'createAndAssignGraphDefinition':
                      store.createAndAssignGraphDefinition(op.prototypeId);
                      results.push({ type: op.type, ok: true, id: op.prototypeId });
                      break;
                    case 'deleteEdge':
                      store.removeEdge(op.edgeId);
                      results.push({ type: op.type, ok: true, id: op.edgeId });
                      break;
                    case 'deleteNodePrototype':
                      store.deleteNodePrototype(op.prototypeId);
                      results.push({ type: op.type, ok: true, id: op.prototypeId });
                      break;
                    case 'createGroup':
                      store.createGroup(op.graphId, op.groupData || {
                        name: op.name,
                        color: op.color,
                        memberInstanceIds: op.memberInstanceIds,
                      });
                      results.push({ type: op.type, ok: true, graphId: op.graphId });
                      break;
                    case 'convertToNodeGroup':
                      store.convertGroupToNodeGroup(
                        op.graphId,
                        op.groupId,
                        op.nodePrototypeId,
                        op.createNewPrototype,
                        op.newPrototypeName,
                        op.newPrototypeColor
                      );
                      results.push({ type: op.type, ok: true, graphId: op.graphId, groupId: op.groupId });
                      break;
                    case 'updateGroup':
                      store.updateGroup(op.graphId, op.groupId, (group) => {
                        if (op.updates.newName) group.name = op.updates.newName;
                        if (op.updates.newColor) group.color = op.updates.newColor;
                        if (op.updates.addMemberIds && op.updates.addMemberIds.length > 0) {
                          group.memberInstanceIds = [...new Set([...group.memberInstanceIds, ...op.updates.addMemberIds])];
                        }
                        if (op.updates.removeMemberIds && op.updates.removeMemberIds.length > 0) {
                          group.memberInstanceIds = group.memberInstanceIds.filter(id => !op.updates.removeMemberIds.includes(id));
                        }
                      });
                      results.push({ type: op.type, ok: true, groupId: op.groupId });
                      break;
                    case 'deleteGroup':
                      store.deleteGroup(op.graphId, op.groupId);
                      results.push({ type: op.type, ok: true, groupId: op.groupId });
                      break;
                    case 'combineNodeGroup':
                      store.combineNodeGroup(op.graphId, op.groupId);
                      results.push({ type: op.type, ok: true, groupId: op.groupId });
                      break;
                    case 'setActiveGraph':
                      store.setActiveGraph(op.graphId);
                      navigate(op.graphId);
                      results.push({ type: op.type, ok: true, graphId: op.graphId });
                      break;
                    case 'deleteNodeInstance':
                      store.removeNodeInstance(op.graphId, op.instanceId);
                      results.push({ type: op.type, ok: true, id: op.instanceId });
                      break;
                    case 'deleteGraph':
                      store.deleteGraph(op.graphId);
                      results.push({ type: op.type, ok: true, id: op.graphId });
                      break;
                    case 'addDefinitionGraph': {
                      // Resolve prototype by NAME — take LAST match (most recently created)
                      let realProtoId = op.prototypeId;
                      const nameSearch = (op.nodeName || '').toLowerCase().trim();
                      if (nameSearch) {
                        for (const [pid, proto] of store.nodePrototypes) {
                          if ((proto.name || '').toLowerCase().trim() === nameSearch) {
                            realProtoId = pid;
                          }
                        }
                      }

                      store.createDefinitionGraphWithId(op.graphId, realProtoId);

                      const created = useGraphStore.getState().graphs.has(op.graphId);
                      console.error('[BridgeClient] addDefinitionGraph (applyMutations):', created ? 'SUCCESS' : 'FAILED', '| graphId:', op.graphId, '| resolvedProto:', realProtoId);

                      try {
                        const proto = useGraphStore.getState().nodePrototypes.get(realProtoId);
                        const friendly = `Created definition graph for "${proto?.name || op.nodeName}"`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                      } catch { }
                      results.push({ type: op.type, ok: created, prototypeId: realProtoId, graphId: op.graphId });
                      break;
                    }
                    case 'removeDefinitionGraph': {
                      // Remove a definition graph from a node's definitionGraphIds array
                      const st = useGraphStore.getState();
                      const proto = st.nodePrototypes.get(op.prototypeId);
                      if (!proto) {
                        results.push({ type: op.type, ok: false, error: 'Prototype not found' });
                        break;
                      }
                      // Filter out the graphId from definitionGraphIds
                      const newDefIds = (proto.definitionGraphIds || []).filter(id => id !== op.graphId);
                      st.updateNodePrototype(op.prototypeId, { definitionGraphIds: newDefIds });
                      // Delete the graph itself
                      st.deleteGraph(op.graphId);
                      try {
                        const friendly = `Removed definition graph from "${proto?.name || op.nodeName}"`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        console.error('[BridgeClient] removeDefinitionGraph: Removed graph', op.graphId, 'from prototype', op.prototypeId);
                      } catch { }
                      results.push({ type: op.type, ok: true, prototypeId: op.prototypeId, graphId: op.graphId });
                      break;
                    }
                    case 'switchToGraph': {
                      // Explicit navigation to a graph (changes activeGraphId)
                      store.openGraphTabAndBringToTop(op.graphId);
                      navigate(op.graphId);
                      try {
                        const s2 = useGraphStore.getState();
                        const g = s2.graphs.get(op.graphId);
                        const friendly = `Switched to graph "${g?.name || op.graphName || op.graphId}"`;
                        emitEvent(new CustomEvent('rs-telemetry', { detail: [{ ts: Date.now(), type: 'info', name: 'applyMutations', message: friendly }] }));
                        console.error('[BridgeClient] switchToGraph: Navigated to', op.graphId);
                      } catch { }
                      results.push({ type: op.type, ok: true, graphId: op.graphId });
                      break;
                    }
                    default:
                      results.push({ type: op.type, ok: false, error: 'Unknown operation type' });
                  }
                } catch (err) {
                  results.push({ type: op.type, ok: false, error: String(err?.message || err) });
                }
              }
              try {
                const s = useGraphStore.getState();
                const a = s.activeGraphId;
                const g = a ? s.graphs.get(a) : null;
                console.log('MCPBridge: applyMutations summary', { activeGraphId: a, activeInstanceCount: g?.instances?.size, totalGraphs: s.graphs.size });

                // Detect structural changes and collect affected graph IDs
                const structuralTypes = new Set([
                  'addNodeInstance', 'deleteNodeInstance',
                  'addEdge', 'deleteEdge'
                ]);
                const affectedGraphIds = new Set();
                (operations || []).forEach((op, i) => {
                  if (results[i]?.ok && structuralTypes.has(op.type) && op.graphId) {
                    affectedGraphIds.add(op.graphId);
                  }
                });

                if (affectedGraphIds.size > 0) {
                  console.log(`MCPBridge: Triggering auto-layout for ${affectedGraphIds.size} affected graph(s):`, [...affectedGraphIds]);
                  for (const gid of affectedGraphIds) {
                    try { applyOffscreenLayout(gid); } catch (e) { console.error('[BridgeClient] Offscreen layout failed for graph', gid, ':', e); }
                    if (typeof window !== 'undefined') {
                      emitEvent(new CustomEvent('rs-trigger-auto-layout', {
                        detail: { graphId: gid }
                      }));
                    }
                  }
                }
              } catch { }
              console.groupEnd();
              return { success: true, results };
            }
  };
}
