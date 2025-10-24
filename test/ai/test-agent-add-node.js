#!/usr/bin/env node

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

(async function main() {
  console.log('🤖 Agent Add-Node Test');

  // 0) Drain any existing pending actions to avoid cross-test leakage
  for (let i = 0; i < 10; i++) {
    const leased = await get('/api/bridge/pending-actions');
    if (!leased.pendingActions || leased.pendingActions.length === 0) break;
    await sleep(100);
  }

  // 1) Create a target graph via fast path
  const gid = `graph-agent-${Date.now()}`;
  await post('/test/commit-ops', {
    graphId: 'unknown',
    ops: [ { type: 'createNewGraph', initialData: { id: gid, name: 'Agent Test', color: '#5B6CFF' } } ],
    threadId: 'agent-add-node'
  });

  // 2) Seed minimal UI projection
  await post('/api/bridge/state', {
    graphs: [ { id: gid, name: 'Agent Test', instances: {} } ],
    nodePrototypes: [],
    activeGraphId: gid,
    activeGraphName: 'Agent Test',
    openGraphIds: [gid]
  });

  // 3) Call agent to add a node
  const message = 'please add a node called Paul to the current active graph';
  const resp = await post('/api/ai/agent', { message });
  assert.equal(resp.success, true);

  // 4) Lease pending actions and inspect
  const actions = await get('/api/bridge/pending-actions');
  const list = actions.pendingActions || [];
  assert.ok(list.length > 0, 'No pending actions leased');

  const hasAddProto = list.some(a => a.action === 'addNodePrototype');
  const hasApplyAddInst = list.some(a => a.action === 'applyMutations' && Array.isArray(a.params?.[0]) && a.params[0].some(op => op?.type === 'addNodeInstance'));
  assert.ok(hasAddProto || hasApplyAddInst, 'Expected prototype or addNodeInstance actions');

  // 5) Verify the parsed name "Paul" is present in prototype enqueue or implied in follow-up addNodeInstance
  const protoName = list.find(a => a.action === 'addNodePrototype')?.params?.[0]?.name;
  if (protoName) assert.equal(protoName, 'Paul');

  console.log('✅ Agent add node enqueued successfully');
})();
