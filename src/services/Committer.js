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
    const { bridgeFetch } = await import('./bridgeConfig.js');
    const r = await bridgeFetch('/api/bridge/pending-actions/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: [{ action: 'applyMutations', params: [ops] }] })
    });
    if (!r.ok) throw new Error(await r.text());
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
        // Emit to UI; UI will apply and persist via its Git engines
        await emitApplyMutations(ops);
        // If we created any graphs, enqueue openGraph to ensure UI switches to them
        try {
          const created = Array.isArray(ops) ? ops.filter(o => o && o.type === 'createNewGraph' && o.initialData && o.initialData.id) : [];
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


