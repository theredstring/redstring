// @vitest-environment node
/**
 * Phase 6 coexistence controller, integration-tested in Node against a REAL
 * daemon subprocess. The test's own headless store stands in for the browser.
 * Verifies: hydrate-on-engage, forward local edits → daemon, re-hydrate when the
 * daemon advances externally (simulating an MCP/CLI mutation), and disengage
 * (resume standalone) when the daemon disappears.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const PORT = process.env.WIZARD_PORT || '3019';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let daemon, tmpDir, useGraphStore, controller, exportToRedstring;
let fetchImpl;                 // swappable so we can simulate the daemon vanishing
const saveEnabledLog = [];

async function http(path, options) { return fetchImpl(`${BASE}${path}`, options); }
async function daemonState() { return (await fetch(`${BASE}/api/bridge/state`)).json(); }
async function enqueueOnDaemon(actions) {
  const r = await fetch(`${BASE}/api/bridge/pending-actions/enqueue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions })
  });
  const { actionIds } = await r.json();
  for (const id of actionIds) {
    for (let i = 0; i < 50; i++) {
      const s = await (await fetch(`${BASE}/api/bridge/action-status/${id}`)).json();
      if (s.status === 'completed') break;
      await sleep(60);
    }
  }
}

beforeAll(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rs-coexist-'));
  const universe = path.join(tmpDir, 'u.redstring');
  daemon = spawn('node', ['wizard-server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, REDSTRING_UNIVERSE: universe, WIZARD_PORT: PORT },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  // wait for health
  let up = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/api/bridge/health`)).ok) { up = true; break; } } catch {}
    await sleep(150);
  }
  if (!up) throw new Error('daemon never became healthy');

  // seed a graph on the daemon before the browser engages
  await enqueueOnDaemon([{ action: 'createNewGraph', params: [{ id: 'g-seed', name: 'Daemon Seed' }] }]);

  // the "browser" store + controller
  const { createHeadlessStore, __resetHeadlessStoreCache } = await import('../../src/headless/createHeadlessStore.js');
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ exportToRedstring } = await import('../../src/formats/redstringFormat.js'));
  const { createDaemonCoexistence } = await import('../../src/services/daemonCoexistence.js');

  fetchImpl = (u, o) => fetch(u, o);
  controller = createDaemonCoexistence({
    useGraphStore,
    saveCoordinator: { setEnabled: (b) => saveEnabledLog.push(b) },
    bridgeFetch: (p, o) => http(p, o),
    exportToRedstring,
    debounceMs: 50,
    pollMs: 999999, // we drive tick() manually for determinism
    log: () => {}
  });
});

afterAll(async () => {
  try { controller?.stop(); } catch {}
  try { daemon?.kill('SIGKILL'); } catch {}
  try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('daemon coexistence controller (Node integration vs real daemon)', () => {
  it('engages and hydrates the browser store from the daemon', async () => {
    await controller.tick();
    expect(controller.isEngaged()).toBe(true);
    const g = Array.from(useGraphStore.getState().graphs.values()).find(x => x.name === 'Daemon Seed');
    expect(g).toBeTruthy();
    // Suspended local saves on engage.
    expect(saveEnabledLog).toContain(false);
  });

  it('forwards a local browser edit to the daemon', async () => {
    useGraphStore.getState().createNewGraph({ id: 'g-browser', name: 'Browser Made' });
    await sleep(250); // let the debounced forward fire
    const state = await daemonState();
    expect(state.graphs.some(x => x.id === 'g-browser')).toBe(true);
  });

  it('re-hydrates when the daemon advances externally (MCP/CLI mutation)', async () => {
    await enqueueOnDaemon([{ action: 'createNewGraph', params: [{ id: 'g-external', name: 'External Made' }] }]);
    await controller.tick();
    const g = useGraphStore.getState().graphs.get('g-external');
    expect(g).toBeTruthy();
    expect(g.name).toBe('External Made');
  });

  it('disengages and resumes standalone when the daemon disappears', async () => {
    saveEnabledLog.length = 0;
    fetchImpl = async () => { throw new Error('ECONNREFUSED (simulated daemon down)'); };
    await controller.tick();
    expect(controller.isEngaged()).toBe(false);
    expect(saveEnabledLog).toContain(true); // saves resumed
  });
});
