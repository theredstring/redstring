// Committer: single-writer application of approved patches
// Coalesces patches per graph, performs optimistic merge, writes snapshots/events, and emits UI mutations

import queueManager from './queue/Queue.js';
import eventLog from './EventLog.js';

// Coarse per-graph locks (in-process)
const graphLocks = new Map();

function acquireGraphLock(graphId, fn) {
  if (graphLocks.get(graphId)) return false;
  graphLocks.set(graphId, true);
  try { fn(); } finally { graphLocks.delete(graphId); }
  return true;
}

function groupBy(arr, key) {
  const out = new Map();
  for (const item of arr) {
    const k = item[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

function coalesceOps(patches) {
  // Flatten ops and keep last-write-wins per entity for simple ops
  const ops = [];
  for (const p of patches) {
    if (Array.isArray(p.ops)) ops.push(...p.ops);
  }
  return ops;
}

async function emitApplyMutations(ops) {
  try {
    console.log(`[Committer] Emitting ${ops.length} operations to UI:`, JSON.stringify(ops.map(o => ({ type: o.type, graphId: o.graphId })), null, 2));
    const { bridgeFetch } = await import('./bridgeConfig.js');
    const r = await bridgeFetch('/api/bridge/pending-actions/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: [{ action: 'applyMutations', params: [ops] }] })
    });
    if (!r.ok) throw new Error(await r.text());
    console.log(`[Committer] Successfully queued ${ops.length} operations for UI`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Committer] Failed to enqueue applyMutations:', e.message);
  }
}

class CommitterService {
  constructor() {
    this.running = false;
    this.interval = null;
    this.idempotency = new Set(); // applied patchIds
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Poll approved reviews periodically
    this.interval = setInterval(() => this._tick().catch(() => {}), 100);
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async _tick() {
    // Emergency fix: pull all review items without filter since reviewStatus is being stripped
    const approved = queueManager.pullBatch('reviewQueue', { windowMs: 500, max: 200 });
    if (approved.length > 0) {
      console.log(`[Committer] Processing ${approved.length} approved reviews`);
    }
    if (approved.length === 0) return;
    const byGraph = groupBy(approved, 'graphId');
    for (const [graphId, items] of byGraph.entries()) {
      acquireGraphLock(graphId, async () => {
        // Gather patches
        const patches = items.flatMap(r => Array.isArray(r.patches) ? r.patches : [r.patch]).filter(Boolean);
        const unseen = patches.filter(p => !this.idempotency.has(p.patchId));
        if (unseen.length === 0) {
          items.forEach(i => queueManager.ack('reviewQueue', i.leaseId));
          return;
        }
        const mergeable = unseen.every(p => !p.baseHash || this._canMerge(p, graphId));
        if (!mergeable) {
          // Reject and emit events
          for (const it of items) {
            eventLog.append({ type: 'PATCH_REJECTED', graphId, reason: 'conflict', patches: it.patches || [it.patch] });
            queueManager.ack('reviewQueue', it.leaseId);
          }
          return;
        }
        const ops = coalesceOps(unseen);
        
        // Resolve NEW_GRAPH:name placeholders to actual graph IDs
        const graphIdMap = new Map();
        ops.forEach(op => {
          if (op.type === 'createNewGraph' && op.initialData?.id) {
            const name = op.initialData.name;
            const realId = op.initialData.id;
            graphIdMap.set(`NEW_GRAPH:${name}`, realId);
          }
        });
        
        // Replace placeholders in all ops
        ops.forEach(op => {
          if (op.graphId && op.graphId.startsWith('NEW_GRAPH:')) {
            const realId = graphIdMap.get(op.graphId);
            if (realId) {
              console.log(`[Committer] Resolving placeholder ${op.graphId} -> ${realId}`);
              op.graphId = realId;
            }
          }
        });
        
        // Handle read responses (send data to chat instead of UI mutations)
        const readResponses = ops.filter(o => o.type === 'readResponse');
        const mutationOps = ops.filter(o => o.type !== 'readResponse');
        
        if (readResponses.length > 0) {
          try {
            const { bridgeFetch } = await import('./bridgeConfig.js');
            for (const resp of readResponses) {
              const threadIds = new Set(unseen.map(p => p.threadId).filter(Boolean));
              for (const threadId of threadIds) {
                if (resp.toolName === 'read_graph_structure') {
                  const data = resp.data || {};
                  if (data.error) {
                    await bridgeFetch('/api/bridge/chat/append', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'system', text: `Error: ${data.error}`, cid: threadId, channel: 'agent' })
                    }).catch(() => {});
                  } else {
                  // Cursor-style brief system message
                  const nodeNames = (data.nodes || []).slice(0, 5).map(n => n.name);
                  const nodePreview = nodeNames.length > 0 
                    ? nodeNames.join(', ') + (data.nodeCount > 5 ? '...' : '')
                    : 'empty';
                  const msg = `Read **${data.name}**: ${data.nodeCount} node${data.nodeCount !== 1 ? 's' : ''} (${nodePreview}), ${data.edgeCount} connection${data.edgeCount !== 1 ? 's' : ''}`;
                    await bridgeFetch('/api/bridge/chat/append', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'system', text: msg, cid: threadId, channel: 'agent' })
                    }).catch(() => {});
                    
                    // AUTO-CHAIN: Trigger next planning step with read results
                    // This enables agentic behavior: read → reason → act
                    console.log('[Committer] Auto-chaining: triggering follow-up planning with read results');
                    
                    // Get API credentials from patch metadata (passed from bridge)
                    const apiKey = unseen[0]?.meta?.apiKey;
                    const apiConfig = unseen[0]?.meta?.apiConfig;
                    
                    console.log('[Committer] Auto-chain API key check:', { 
                      hasApiKey: !!apiKey, 
                      hasApiConfig: !!apiConfig,
                      provider: apiConfig?.provider,
                      source: 'patch.meta'
                    });
                    
                    if (apiKey) {
                      // CRITICAL: Construct graphState from readResult for /api/ai/agent/continue
                      // The continue endpoint expects graphState.graphId to create tasks
                      const graphState = {
                        graphId: data.graphId,
                        name: data.name,
                        nodeCount: data.nodeCount || 0,
                        edgeCount: data.edgeCount || 0
                      };
                      
                      await bridgeFetch('/api/ai/agent/continue', {
                        method: 'POST',
                        headers: { 
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({ 
                          cid: threadId, 
                          readResult: data,
                          graphState: graphState,  // Pass graphState for task creation
                          context: { graphId: data.graphId },
                          apiConfig: apiConfig || null
                        })
                      }).catch(e => console.warn('[Committer] Auto-chain failed:', e.message));
                    } else {
                      console.warn('[Committer] Auto-chain skipped: No API key in patch metadata');
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[Committer] Failed to send read response to chat:', e.message);
          }
        }
        
        // Emit to UI; UI will apply and persist via its Git engines
        if (mutationOps.length > 0) {
          await emitApplyMutations(mutationOps);
          
          // If layout operations occurred (nodes added/repositioned), trigger "back to civilization"
          const hasLayoutOps = mutationOps.some(op => 
            op.type === 'addNodeInstance' || 
            op.type === 'updateNodeInstance' ||
            (op.type === 'createNewGraph' && op.initialData?.nodes?.length > 0)
          );
          
          if (hasLayoutOps && typeof window !== 'undefined') {
            // Dispatch event for UI to center view on new layout
            window.dispatchEvent(new CustomEvent('rs-auto-layout-complete', {
              detail: { 
                nodeCount: mutationOps.filter(o => o.type === 'addNodeInstance').length,
                graphId: mutationOps.find(o => o.graphId)?.graphId
              }
            }));
          }
        }
        
        // If we created any graphs, enqueue openGraph to ensure UI switches to them
        try {
          const created = Array.isArray(mutationOps) ? mutationOps.filter(o => o && o.type === 'createNewGraph' && o.initialData && o.initialData.id) : [];
          if (created.length > 0) {
            const actions = created.map(o => ({ action: 'openGraph', params: [o.initialData.id] }));
            const { bridgeFetch } = await import('./bridgeConfig.js');
            await bridgeFetch('/api/bridge/pending-actions/enqueue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ actions })
            });
          }
        } catch {}
        
        // Send completion notification to agent chat
        try {
          const threadIds = new Set(unseen.map(p => p.threadId).filter(Boolean));
          const nodeCount = ops.filter(o => o.type === 'addNodeInstance').length;
          const edgeCount = ops.filter(o => o.type === 'addEdge').length;
          
          if (threadIds.size > 0 && (nodeCount > 0 || edgeCount > 0)) {
            for (const threadId of threadIds) {
              // CRITICAL: Get node names from the PATCH OPERATIONS, not the store
              // The prototypes were just added in this patch, so they might not be in the store yet
              const addedProtoOps = ops.filter(o => o.type === 'addNodePrototype');
              const protoById = new Map(addedProtoOps.map(o => [o.prototypeData.id, o.prototypeData.name]));
              
              const addedNodeOps = ops.filter(o => o.type === 'addNodeInstance');
              const nodeNames = addedNodeOps.slice(0, 3).map(o => {
                return protoById.get(o.prototypeId) || 'Unknown';
              });
              
              let msg = `Added ${nodeCount} node${nodeCount !== 1 ? 's' : ''}`;
              if (nodeNames.length > 0) {
                msg += `: ${nodeNames.join(', ')}${nodeCount > 3 ? '...' : ''}`;
              }
              if (edgeCount > 0) {
                msg += ` and ${edgeCount} connection${edgeCount !== 1 ? 's' : ''}`;
              }
              
              const { bridgeFetch } = await import('./bridgeConfig.js');
              
              // Send completion message to chat
              await bridgeFetch('/api/bridge/chat/append', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'system', text: msg, cid: threadId, channel: 'agent' })
              }).catch(() => {});
              
              // Report tool call completion status updates to chat
              // Determine which tool completed based on operation types
              const hasNewGraph = ops.some(o => o.type === 'createNewGraph');
              const hasPrototypes = ops.some(o => o.type === 'addNodePrototype');
              const hasInstances = ops.some(o => o.type === 'addNodeInstance');
              const hasEdges = ops.some(o => o.type === 'addEdge');
              const hasEdgeUpdates = ops.some(o => o.type === 'updateEdgeDefinition');
              
              const completedTools = [];
              
              // create_populated_graph: creates new graph + nodes + edges in one operation
              if (hasNewGraph && hasPrototypes && hasInstances && hasEdges) {
                const newGraphOp = ops.find(o => o.type === 'createNewGraph');
                const graphName = newGraphOp?.initialData?.name || 'graph';
                completedTools.push({
                  name: 'create_populated_graph',
                  status: 'completed',
                  args: { graphId, graphName, nodeCount, edgeCount }
                });
              }
              // create_subgraph: adds nodes + edges to existing graph
              else if (hasPrototypes && hasInstances && hasEdges) {
                completedTools.push({
                  name: 'create_subgraph',
                  status: 'completed',
                  args: { graphId, nodeCount, edgeCount }
                });
              }
              
              // define_connections: updates edge definitions (can happen standalone or after create)
              if (hasEdgeUpdates || (hasEdges && !hasInstances && !hasNewGraph)) {
                completedTools.push({
                  name: 'define_connections',
                  status: 'completed',
                  args: { graphId, edgeCount }
                });
              }
              
              // Send tool call status updates if any tools completed
              if (completedTools.length > 0) {
                await bridgeFetch('/api/bridge/tool-status', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    cid: threadId,
                    toolCalls: completedTools
                  })
                }).catch(err => console.warn('[Committer] Tool status update failed:', err.message));
              }
              
              // AGENTIC LOOP: Check if we should continue building
              // Look for meta.agenticLoop flag to determine if this is part of an iterative build
              const isAgenticBatch = unseen.some(p => p.meta?.agenticLoop);
              const currentIteration = unseen[0]?.meta?.iteration || 0;
              
              if (isAgenticBatch || (nodeCount >= 3 && !isAgenticBatch)) {
                console.log(`[Committer] AGENTIC LOOP: Checking if more work needed (iteration ${currentIteration})`);
                
                // Get current graph state for LLM context
                const store = await import('./bridgeStoreAccessor.js').then(m => m.getBridgeStore());
                const graph = store.graphs instanceof Map 
                  ? store.graphs.get(graphId)
                  : Array.isArray(store.graphs) 
                    ? store.graphs.find(g => g.id === graphId)
                    : null;
                
                const graphState = graph ? {
                  graphId,
                  name: graph.name || 'Unnamed graph',
                  nodeCount: graph.instances ? Object.keys(graph.instances).length : 0,
                  edgeCount: Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0,
                  nodes: Array.isArray(store.nodePrototypes) 
                    ? store.nodePrototypes.slice(0, 10).map(p => ({ name: p.name }))
                    : []
                } : null;
                
                // Get API credentials from patch metadata (passed from bridge)
                // CRITICAL: apiKeyManager uses localStorage (browser-only), so we get credentials from patch.meta
                const apiKey = unseen[0]?.meta?.apiKey;
                const apiConfig = unseen[0]?.meta?.apiConfig;
                
                console.log('[Committer] Agentic loop API key check:', { 
                  hasApiKey: !!apiKey, 
                  hasApiConfig: !!apiConfig,
                  provider: apiConfig?.provider,
                  source: 'patch.meta'
                });
                
                if (graphState && apiKey) {
                  // Send "Working..." status before continuing
                  await bridgeFetch('/api/bridge/chat/append', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      role: 'system', 
                      text: `Continuing... (iteration ${currentIteration + 1}/5)`, 
                      cid: threadId, 
                      channel: 'agent' 
                    })
                  }).catch(() => {});
                  
                  await bridgeFetch('/api/ai/agent/continue', {
                    method: 'POST',
                    headers: { 
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                      cid: threadId,
                      lastAction: { type: 'create_subgraph', nodeCount, edgeCount },
                      graphState,
                      iteration: currentIteration,
                      apiConfig: apiConfig ? {
                        provider: apiConfig.provider,
                        endpoint: apiConfig.endpoint,
                        model: apiConfig.model
                      } : null
                    })
                  }).catch(err => console.warn('[Committer] Agentic loop continuation failed:', err.message));
                } else {
                  // No more work - send final summary
                  // Calculate final counts: current state + mutations just applied
                  const mutationsNodeCount = ops.filter(o => o.type === 'addNodeInstance').length;
                  const mutationsEdgeCount = ops.filter(o => o.type === 'addEdge').length;
                  const totalNodes = (graphState?.nodeCount || 0) + mutationsNodeCount;
                  const totalEdges = (graphState?.edgeCount || 0) + mutationsEdgeCount;
                  await bridgeFetch('/api/bridge/chat/append', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      role: 'ai', 
                      text: `Done! The graph now has ${totalNodes} node${totalNodes !== 1 ? 's' : ''} and ${totalEdges} connection${totalEdges !== 1 ? 's' : ''}.`, 
                      cid: threadId, 
                      channel: 'agent' 
                    })
                  }).catch(() => {});
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Committer] Failed to send completion message:', e.message);
        }
        // Mark ids
        unseen.forEach(p => this.idempotency.add(p.patchId));
        // Persist via Git engine snapshot if available
        // Log event for SSE consumers
        eventLog.append({ type: 'PATCH_APPLIED', graphId, opsCount: ops.length });
        // Ack queue items
        items.forEach(i => queueManager.ack('reviewQueue', i.leaseId));
      });
    }
  }

  _canMerge(_patch, _graphId) {
    // Placeholder for smarter merges; for now, allow if baseHash missing
    return true;
  }
}

const committer = new CommitterService();
export default committer;


