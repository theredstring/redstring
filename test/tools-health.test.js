import { describe, it, expect } from 'vitest';

// Same port resolution as wizard-server.js, so a second wizard can be pointed at.
const BASE = `http://localhost:${process.env.WIZARD_PORT || process.env.BRIDGE_PORT || '3001'}`;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

async function waitFor(fn, { timeoutMs = 6000, intervalMs = 120 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await fn().catch(() => false);
    if (ok) return true;
    if (Date.now() - start > timeoutMs) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function isUIProjectionActive({ recentMs = 4000 } = {}) {
  try {
    const tel = await get('/api/bridge/telemetry');
    const now = Date.now();
    const telemetry = Array.isArray(tel?.telemetry) ? tel.telemetry : [];
    const hasRecentBridgeState = telemetry.some(e => e?.type === 'bridge_state' && typeof e?.ts === 'number' && now - e.ts <= recentMs);
    const hasRecentLease = telemetry.some(e => e?.type === 'tool_call' && e?.leased === true && typeof e?.ts === 'number' && now - e.ts <= recentMs);
    return hasRecentBridgeState && hasRecentLease;
  } catch {
    return false;
  }
}

async function getHealth() {
  try {
    return await get('/api/bridge/health');
  } catch {
    return null;
  }
}

describe('Tools layer healthcheck (daemon HTTP)', () => {
  // `/test/commit-ops` went with bridge-daemon-legacy.js (73f4f43d). Applying
  // actions with no UI is now the headless wizard's job: with a workspace
  // configured, /api/bridge/pending-actions/enqueue executes in-process.
  it('fast-path: a headless wizard applies actions without UI (create graph only)', async (ctx) => {
    // Skip unless a HEADLESS wizard answers. In browser-relay mode (the
    // Electron app's bridge) enqueued actions land in the user's open universe.
    const health = await getHealth();
    if (!health?.headless) ctx.skip();

    const gid = `graph-fast-${Date.now()}`;
    const resp = await post('/api/bridge/pending-actions/enqueue', {
      actions: [ { action: 'createNewGraph', params: [ { id: gid, name: 'Fast Path', color: '#5B6CFF' } ] } ]
    });
    expect(resp.ok).toBe(true);
    expect(resp.storeMode).toBe('runtime');
    expect(resp.actionIds).toHaveLength(1);

    let status = null;
    const done = await waitFor(async () => {
      status = await get(`/api/bridge/action-status/${resp.actionIds[0]}`);
      return status.status === 'completed';
    });
    expect(done).toBe(true);
    expect(status.result?.success).not.toBe(false);

    const state = await get('/api/bridge/state');
    expect(state.graphs.some(g => g.id === gid)).toBe(true);
  }, 10000);

  it('pending-actions: opens graph, adds/moves nodes, updates prototype (requires UI projection)', async () => {
    const hasUIProjection = await isUIProjectionActive({ recentMs: 5000 });
    if (!hasUIProjection) {
      // Skip when UI is not actively posting state and leasing pending actions
      expect(true).toBe(true);
      return;
    }

    const gid = `graph-tools-${Date.now()}`;
    const pid = `prototype-tools-${Math.random().toString(36).slice(2,8)}`;
    const instA = `inst-${Math.random().toString(36).slice(2,8)}`;
    const instB = `inst-${Math.random().toString(36).slice(2,8)}`;
    const instC = `inst-${Math.random().toString(36).slice(2,8)}`;

    // 1) Create graph via fast path (approved patch)
    await post('/test/commit-ops', {
      graphId: 'unknown',
      ops: [ { type: 'createNewGraph', initialData: { id: gid, name: 'Tools Health', color: '#5B6CFF' } } ],
      threadId: 'tools-health'
    });

    // 2) Open graph and add prototype + instances
    await post('/api/bridge/pending-actions/enqueue', {
      actions: [
        { action: 'openGraph', params: [gid] },
        { action: 'addNodePrototype', params: [ { id: pid, name: 'Tool Item', description: '', color: '#3B82F6', typeNodeId: null, definitionGraphIds: [] } ] },
        { action: 'applyMutations', params: [[
          { type: 'addNodeInstance', graphId: gid, prototypeId: pid, position: { x: 420, y: 260 }, instanceId: instA },
          { type: 'addNodeInstance', graphId: gid, prototypeId: pid, position: { x: 560, y: 260 }, instanceId: instB },
          { type: 'addNodeInstance', graphId: gid, prototypeId: pid, position: { x: 490, y: 360 }, instanceId: instC }
        ]]} 
      ]
    });

    // 3) Move an instance and recolor prototype
    await post('/api/bridge/pending-actions/enqueue', {
      actions: [
        { action: 'applyMutations', params: [[ { type: 'moveNodeInstance', graphId: gid, instanceId: instC, position: { x: 600, y: 360 } } ]] },
        { action: 'applyMutations', params: [[ { type: 'updateNodePrototype', prototypeId: pid, updates: { color: '#10B981' } } ]] }
      ]
    });

    // While waiting, periodically nudge openGraph to help projection settle on the test graph
    const nudgeInterval = setInterval(() => {
      post('/api/bridge/pending-actions/enqueue', { actions: [ { action: 'openGraph', params: [gid] } ] }).catch(() => {});
    }, 500);

    const ok = await waitFor(async () => {
      const s = await get('/api/bridge/state');
      const g = Array.isArray(s.graphs) ? s.graphs.find(x => x.id === gid) : null;
      // Projection only includes instances for the active graph
      if (s.activeGraphId !== gid) return false;
      if (!g || !g.instances) return false;
      return Boolean(g.instances[instA] && g.instances[instB] && g.instances[instC]);
    }, { timeoutMs: 20000 });

    clearInterval(nudgeInterval);

    expect(ok).toBe(true);

    // 5) Verify the moved instance position
    const s2 = await get('/api/bridge/state');
    const g2 = s2.graphs.find(x => x.id === gid);
    expect(g2.instances[instC].x).toBe(600);
    expect(g2.instances[instC].y).toBe(360);
  }, 30000);
});


