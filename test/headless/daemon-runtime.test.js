// @vitest-environment node
/**
 * daemonRuntime: the headless store + universe + executor the wizard-server
 * mounts. Verifies executeAction runs both dispatch paths (storeActions and the
 * applyToolResultToStore fallback), persists to disk, and builds the daemon
 * bridge-state payload.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let runtime;
let tmpDir;
let universePath;

beforeAll(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rs-daemon-'));
  universePath = path.join(tmpDir, 'daemon.redstring');
  const { initDaemonRuntime } = await import('../../src/headless/daemonRuntime.js');
  runtime = await initDaemonRuntime({ universePath, debounceMs: 20, log: () => {} });
});

afterAll(async () => {
  if (runtime) await runtime.shutdown();
  try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('daemonRuntime.executeAction — storeActions path', () => {
  it('creates a graph, prototype, and instance via storeActions', async () => {
    await runtime.executeAction('createNewGraph', [{ id: 'g-d', name: 'Daemon Graph' }]);
    await runtime.executeAction('addNodePrototype', [{ id: 'p-d', name: 'Daemon Node', color: '#333' }]);
    await runtime.executeAction('applyMutations', [[
      { type: 'addNodeInstance', graphId: 'g-d', prototypeId: 'p-d', position: { x: 10, y: 10 }, instanceId: 'i-d' }
    ]]);

    const st = runtime.getState();
    expect(st.graphs.has('g-d')).toBe(true);
    expect(st.nodePrototypes.has('p-d')).toBe(true);
    expect(st.graphs.get('g-d').instances.has('i-d')).toBe(true);
  });
});

describe('daemonRuntime.executeAction — applier fallback path', () => {
  it("routes an action absent from storeActions through applyToolResultToStore", async () => {
    // 'createGraph' is a toolResultApplier action; storeActions has 'createNewGraph'.
    const res = await runtime.executeAction('createGraph', [{ graphId: 'g-fb', graphName: 'Fallback Graph' }]);
    expect(res.viaApplier).toBe(true);
    expect(runtime.getState().graphs.has('g-fb')).toBe(true);
  });
});

describe('daemonRuntime persistence + payload', () => {
  it('persists the universe to disk', async () => {
    await runtime.flush();
    expect(fs.existsSync(universePath)).toBe(true);
    const json = JSON.parse(await fsp.readFile(universePath, 'utf8'));
    expect(JSON.stringify(json)).toContain('Daemon Graph');
  });

  it('builds a daemon-tagged bridge-state payload', () => {
    const payload = runtime.buildBridgeStatePayload();
    expect(payload.storeMode).toBe('daemon');
    expect(typeof payload.stateVersion).toBe('number');
    expect(Array.isArray(payload.graphs)).toBe(true);
    expect(payload.graphs.some(g => g.id === 'g-d')).toBe(true);
    // MCP-contract fields present.
    expect(payload).toHaveProperty('nodePrototypes');
    expect(payload).toHaveProperty('graphLayouts');
    expect(payload).toHaveProperty('graphEdges');
  });
});
