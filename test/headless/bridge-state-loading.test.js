// @vitest-environment node
/**
 * The agent server (wizard-server.js) keeps the last loaded bridge state: a
 * snapshot the app took before its universe loaded is the empty initial store
 * and must not replace it, or the MCP server reads an empty workspace.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, rawRequest, waitFor, tmpDir, spawnNode, readAgentJson, killChild } from '../security/servers/helpers.js';

let port;
let home;
let child;
let token;

const auth = () => ({ 'x-redstring-token': token });
const json = { 'content-type': 'application/json' };
const getState = async () => JSON.parse((await rawRequest({ port, path: '/api/bridge/state', headers: auth() })).body);
const postState = async (body) => JSON.parse((await rawRequest({ port, method: 'POST', path: '/api/bridge/state', headers: { ...auth(), ...json }, body: JSON.stringify(body) })).body);

beforeAll(async () => {
  port = await freePort();
  home = path.join(tmpDir('rs-bridge-loading-'), 'home');
  child = spawnNode('wizard-server.js', { env: { WIZARD_PORT: String(port), REDSTRING_HOME: home } });
  token = await waitFor(() => readAgentJson(home)?.agents?.[String(port)]?.token, { timeoutMs: 30000 });
  await waitFor(async () => (await rawRequest({ port, path: '/health', headers: auth() })).status === 200);
}, 45000);

afterAll(async () => {
  await killChild(child);
  try { fs.rmSync(path.dirname(home), { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('bridge state while a universe loads', () => {
  it('says not loaded before the app has sent anything', async () => {
    expect((await getState()).isUniverseLoaded).toBe(false);
  });

  it('keeps a loaded state over a later not-loaded one', async () => {
    expect((await postState({ graphs: [{ id: 'g-1', name: 'Loaded' }], isUniverseLoaded: true })).ok).toBe(true);
    const refused = await postState({ graphs: [], isUniverseLoaded: false, isUniverseLoading: true });
    expect(refused.ignored).toBe(true);
    const state = await getState();
    expect(state.isUniverseLoaded).toBe(true);
    expect(state.graphs.map(g => g.id)).toEqual(['g-1']);
  });

  it('takes the next loaded state', async () => {
    await postState({ graphs: [{ id: 'g-2', name: 'Next' }], isUniverseLoaded: true });
    expect((await getState()).graphs.map(g => g.id)).toEqual(['g-2']);
  });
});
