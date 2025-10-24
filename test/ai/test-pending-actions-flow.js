#!/usr/bin/env node

/**
 * Pending Actions E2E Runner and Verifier
 * - Seeds a clean graph projection
 * - Enqueues actions to add two concepts and an edge between them
 * - Leases/drains pending actions (simulating the UI runner)
 * - Applies effects to the bridge projection (/api/bridge/state)
 * - Verifies via the store projection that graph, nodes, and edge exist
 */

import assert from 'node:assert/strict';

const BASE = 'http://localhost:3001';

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  const text = await r.text();
  assert.equal(r.ok, true, `GET ${path} failed: ${r.status} ${text.slice(0,200)}`);
  return text ? JSON.parse(text) : {};
}

async function post(path, body, headers = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body || {})
  });
  const text = await r.text();
  assert.equal(r.ok, true, `POST ${path} failed: ${r.status} ${text.slice(0,200)}`);
  return text ? JSON.parse(text) : {};
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getState() { return await get('/api/bridge/state'); }
async function setState(state) { return await post('/api/bridge/state', state); }
async function leasePending() { return await get('/api/bridge/pending-actions'); }
async function completeAction(id, result) {
  return await post('/api/bridge/action-completed', { actionId: id, result });
}

function ensureInstancesObject(graph) {
  if (!graph.instances) graph.instances = {};
}

function ensureEdgesObject(graph) {
  if (!graph.edges) graph.edges = {};
}

async function drainAndApplyAll() {
  let iterations = 0;
  while (iterations < 200) {
    iterations++;
    const leased = await leasePending();
    const list = Array.isArray(leased.pendingActions) ? leased.pendingActions : [];
    if (list.length === 0) break;

    // Load current projection once per batch
    let state = await getState();
    const graphsArray = Array.isArray(state.graphs) ? state.graphs : [];
    const activeGraphId = state.activeGraphId || (Array.isArray(state.openGraphIds) && state.openGraphIds[0]) || (graphsArray[0] && graphsArray[0].id) || null;

    for (const a of list) {
      try {
        switch (a.action) {
          case 'openGraph': {
            const gid = Array.isArray(a.params) ? a.params[0] : a.params;
            if (gid && !state.openGraphIds?.includes(gid)) {
              state.openGraphIds = Array.isArray(state.openGraphIds) ? [gid, ...state.openGraphIds] : [gid];
            }
            state.activeGraphId = gid || state.activeGraphId;
            state.activeGraphName = (graphsArray.find(g => g.id === state.activeGraphId)?.name) || state.activeGraphName || null;
            break;
          }
          case 'addNodePrototype': {
            const proto = Array.isArray(a.params) ? a.params[0] : a.params;
            state.nodePrototypes = Array.isArray(state.nodePrototypes) ? state.nodePrototypes : [];
            // Upsert by id
            if (proto && proto.id && !state.nodePrototypes.find(p => p.id === proto.id)) {
              state.nodePrototypes.push({ id: proto.id, name: proto.name, description: proto.description || '', color: proto.color || '#3B82F6' });
            }
            break;
          }
          case 'applyMutations': {
            const ops = Array.isArray(a.params?.[0]) ? a.params[0] : [];
            for (const op of ops) {
              if (!op) continue;
              if (op.type === 'createNewGraph') {
                const g = op.initialData || {};
                state.graphs = Array.isArray(state.graphs) ? state.graphs : [];
                if (!state.graphs.find(x => x.id === g.id)) {
                  state.graphs.push({ id: g.id, name: g.name || 'New Graph', description: g.description || '', instances: {} });
                }
                state.openGraphIds = Array.isArray(state.openGraphIds) ? [g.id, ...state.openGraphIds] : [g.id];
                state.activeGraphId = g.id;
                state.activeGraphName = g.name || 'New Graph';
              } else if (op.type === 'addNodeInstance') {
                const gid = op.graphId || activeGraphId;
                const graph = (Array.isArray(state.graphs) ? state.graphs : []).find(g => g.id === gid);
                if (graph) {
                  ensureInstancesObject(graph);
                  graph.instances[op.instanceId] = {
                    id: op.instanceId,
                    prototypeId: op.prototypeId,
                    x: op.position?.x ?? 400,
                    y: op.position?.y ?? 200,
                    scale: 1
                  };
                }
              } else if (op.type === 'addEdge' || op.type === 'createEdge') {
                const gid = op.graphId || activeGraphId;
                const graph = (Array.isArray(state.graphs) ? state.graphs : []).find(g => g.id === gid);
                if (graph) {
                  ensureEdgesObject(graph);
                  const edgeId = op.edgeData?.id || op.id || `edge-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
                  const src = op.edgeData?.sourceId || op.sourceId;
                  const dst = op.edgeData?.destinationId || op.targetId;
                  graph.edges[edgeId] = { id: edgeId, sourceInstanceId: src, targetInstanceId: dst, prototypeId: op.edgeData?.prototypeId || op.edgeType || 'base-connection-prototype', weight: op.edgeData?.weight || op.weight || 1 };
                }
              } else if (op.type === 'updateGraph') {
                const g = (state.graphs || []).find(x => x.id === op.graphId);
                if (g && op.updates?.name) g.name = op.updates.name;
              } else if (op.type === 'updateNodePrototype') {
                const p = Array.isArray(state.nodePrototypes) ? state.nodePrototypes.find(x => x.id === op.prototypeId) : null;
                if (p && op.updates?.name) p.name = op.updates.name;
              }
            }
            break;
          }
          default:
            // No-op for this runner
            break;
        }
        await setState(state);
        await completeAction(a.id, { ok: true });
      } catch (e) {
        // Best-effort; continue draining
        await completeAction(a.id, { ok: false, error: String(e?.message || e) });
      }
    }
    // brief pause before next lease batch
    await sleep(50);
  }
}

(async function main() {
  console.log('🧪 Pending Actions E2E Flow');

  // 1) Health
  const health = await get('/health');
  assert.equal(health.status, 'ok', 'Bridge not healthy');

  // 2) Seed clean projection with a new active graph
  const gid = `graph-e2e-${Date.now()}`;
  await setState({
    graphs: [ { id: gid, name: 'E2E Graph', instances: {} } ],
    nodePrototypes: [],
    activeGraphId: gid,
    activeGraphName: 'E2E Graph',
    openGraphIds: [gid]
  });

  // 3) Enqueue actions: two concepts, two instances, and an edge
  const protoA = `prototype-${Date.now()}-A`;
  const protoB = `prototype-${Date.now()}-B`;
  const instA = `inst-${Date.now()}-A`;
  const instB = `inst-${Date.now()}-B`;
  const edgeId = `edge-${Date.now()}-AB`;

  await post('/api/bridge/pending-actions/enqueue', {
    actions: [
      { action: 'openGraph', params: [gid] },
      { action: 'addNodePrototype', params: [ { id: protoA, name: 'Concept A', description: '', color: '#ff6b6b', typeNodeId: null, definitionGraphIds: [] } ] },
      { action: 'addNodePrototype', params: [ { id: protoB, name: 'Concept B', description: '', color: '#4ecdc4', typeNodeId: null, definitionGraphIds: [] } ] },
      { action: 'applyMutations', params: [[
        { type: 'addNodeInstance', graphId: gid, prototypeId: protoA, position: { x: 300, y: 180 }, instanceId: instA },
        { type: 'addNodeInstance', graphId: gid, prototypeId: protoB, position: { x: 520, y: 180 }, instanceId: instB }
      ]]},
      { action: 'applyMutations', params: [[
        { type: 'addEdge', graphId: gid, edgeData: { id: edgeId, sourceId: instA, destinationId: instB, prototypeId: 'base-connection-prototype', weight: 1 } }
      ]]}]
  });

  // 4) Drain and apply to projection
  await drainAndApplyAll();

  // 5) Verify from store projection
  const state = await getState();
  assert.equal(state.activeGraphId, gid, 'Active graph mismatch after drain');
  const g = (state.graphs || []).find(x => x.id === gid);
  assert.ok(g, 'Graph not found in projection');

  // Verify instances
  assert.ok(g.instances && g.instances[instA] && g.instances[instB], 'Instances not present in projection');
  assert.equal(g.instances[instA].prototypeId, protoA, 'Instance A prototype mismatch');
  assert.equal(g.instances[instB].prototypeId, protoB, 'Instance B prototype mismatch');

  // Verify edge
  assert.ok(g.edges && g.edges[edgeId], 'Edge not present in projection');
  assert.equal(g.edges[edgeId].sourceInstanceId, instA, 'Edge source mismatch');
  assert.equal(g.edges[edgeId].targetInstanceId, instB, 'Edge target mismatch');

  console.log('✅ Pending actions applied and verified: graph, nodes, and edge present');
})().catch((err) => {
  console.error('❌ Test failed:', err?.message || err);
  process.exit(1);
});


