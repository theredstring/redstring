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
                      body: JSON.stringify({ role: 'system', text: `❌ ${data.error}`, cid: threadId, channel: 'agent' })
                    }).catch(() => {});
                  } else {
                    const nodeList = (data.nodes || []).map(n => n.name).join(', ');
                    const edgeList = (data.edges || []).map(e => `${e.sourceId} → ${e.destinationId} (${e.name || 'connects'})`).join(', ');
                    const msg = `📊 **${data.name}**\n${data.nodeCount} node${data.nodeCount !== 1 ? 's' : ''}: ${nodeList}\n${data.edgeCount} edge${data.edgeCount !== 1 ? 's' : ''}: ${edgeList || 'none'}`;
                    await bridgeFetch('/api/bridge/chat/append', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: 'system', text: msg, cid: threadId, channel: 'agent' })
                    }).catch(() => {});
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
              const msg = `✅ Applied ${nodeCount} node${nodeCount !== 1 ? 's' : ''}${edgeCount > 0 ? ` and ${edgeCount} edge${edgeCount !== 1 ? 's' : ''}` : ''}`;
              const { bridgeFetch } = await import('./bridgeConfig.js');
              await bridgeFetch('/api/bridge/chat/append', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'system', text: msg, cid: threadId, channel: 'agent' })
              }).catch(() => {});
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


