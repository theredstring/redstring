// @vitest-environment node
/**
 * S-51 / C-6: the REAL agent server (wizard-server.js), started as a child on a
 * random port with an isolated ~/.redstring (REDSTRING_HOME).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, rawRequest, firstChunk, waitFor, tmpDir, spawnNode, readAgentJson, killChild } from './helpers.js';

let port;
let home;
let child;
let token;

const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  port = await freePort();
  home = path.join(tmpDir('rs-sec-wizard-'), 'home');
  // No REDSTRING_AGENT_TOKEN: standalone/CLI mode mints one and records it.
  child = spawnNode('wizard-server.js', { env: { WIZARD_PORT: String(port), REDSTRING_HOME: home } });
  token = await waitFor(() => readAgentJson(home)?.agents?.[String(port)]?.token, { timeoutMs: 30000 });
  await waitFor(async () => (await rawRequest({ port, path: '/health', headers: { 'x-redstring-token': token } })).status === 200);
}, 45000);

afterAll(async () => {
  await killChild(child);
  try { fs.rmSync(path.dirname(home), { recursive: true, force: true }); } catch { /* ignore */ }
});

const auth = () => ({ 'x-redstring-token': token });

describe('wizard-server access guard', () => {
  it('records its token in agent.json with owner-only permissions', () => {
    const file = path.join(home, 'agent.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readAgentJson(home).agents[String(port)].pid).toBe(child.pid);
  });

  it('401s every route without the token', async () => {
    for (const p of ['/health', '/api/bridge/health', '/api/bridge/state', '/api/bridge/telemetry', '/api/store/export', '/api/wizard/tools']) {
      expect((await rawRequest({ port, path: p })).status, p).toBe(401);
    }
    const post = await rawRequest({ port, method: 'POST', path: '/api/bridge/pending-actions/enqueue', headers: json, body: JSON.stringify({ actions: [{ action: 'noop', params: [] }] }) });
    expect(post.status).toBe(401);
  });

  it('403s a foreign Host (DNS rebinding) even with the token', async () => {
    const res = await rawRequest({ port, path: '/api/bridge/state', headers: { ...auth(), host: `attacker.example:${port}` } });
    expect(res.status).toBe(403);
  });

  it('403s evil and "null" Origins', async () => {
    for (const origin of ['https://evil.example', 'null']) {
      const res = await rawRequest({ port, path: '/api/bridge/state', headers: { ...auth(), origin } });
      expect(res.status, origin).toBe(403);
    }
  });

  it('accepts the packaged app origin app://redstring (was broken as Origin:null)', async () => {
    const res = await rawRequest({ port, path: '/api/bridge/health', headers: { ...auth(), origin: 'app://redstring' } });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('app://redstring');
    const pre = await rawRequest({ port, method: 'OPTIONS', path: '/api/bridge/state', headers: { origin: 'app://redstring', 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
  });

  it('415s a text/plain POST (the CSRF simple-request shape) even with the token', async () => {
    const res = await rawRequest({ port, method: 'POST', path: '/api/bridge/chat/append', headers: { ...auth(), 'content-type': 'text/plain' }, body: JSON.stringify({ text: 'x' }) });
    expect(res.status).toBe(415);
  });

  it('serves a valid request', async () => {
    const res = await rawRequest({ port, path: '/api/bridge/health', headers: auth() });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });

  it('opens the event stream with ?rs_token= (EventSource) and 401s it without', async () => {
    expect((await firstChunk({ port, path: '/events/stream' })).status).toBe(401);
    const ok = await firstChunk({ port, path: `/events/stream?rs_token=${token}` });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('connected');
  });

  it('GET /api/bridge/pending-actions no longer leases (405); POST does', async () => {
    const enq = await rawRequest({ port, method: 'POST', path: '/api/bridge/pending-actions/enqueue', headers: { ...auth(), ...json }, body: JSON.stringify({ actions: [{ action: 'openGraph', params: ['g-sec'] }] }) });
    expect(enq.status).toBe(200);
    const [actionId] = JSON.parse(enq.body).actionIds;

    const get1 = await rawRequest({ port, path: '/api/bridge/pending-actions', headers: auth() });
    expect(get1.status).toBe(405);
    // The GET must not have leased it: status is still "pending", not "running".
    const status = await rawRequest({ port, path: `/api/bridge/action-status/${actionId}`, headers: auth() });
    expect(JSON.parse(status.body).status).toBe('pending');

    const post = await rawRequest({ port, method: 'POST', path: '/api/bridge/pending-actions', headers: { ...auth(), ...json }, body: '{}' });
    expect(post.status).toBe(200);
    expect(JSON.parse(post.body).pendingActions.map((a) => a.id)).toContain(actionId);
    const after = await rawRequest({ port, path: `/api/bridge/action-status/${actionId}`, headers: auth() });
    expect(JSON.parse(after.body).status).toBe('running');
  });

  it('caps ordinary JSON bodies at 5 MB (413) but keeps 20 MB for bridge state', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(6 * 1024 * 1024) });
    const small = await rawRequest({ port, method: 'POST', path: '/api/bridge/chat/append', headers: { ...auth(), ...json }, body: big, timeoutMs: 15000 });
    expect(small.status).toBe(413);
    const state = await rawRequest({ port, method: 'POST', path: '/api/bridge/state', headers: { ...auth(), ...json }, body: JSON.stringify({ graphs: [], pad: 'x'.repeat(6 * 1024 * 1024) }), timeoutMs: 15000 });
    expect(state.status).toBe(200);
  });
});

describe('wizard-server with an Electron-provided token', () => {
  let port2;
  let home2;
  let child2;
  const ELECTRON_TOKEN = 'e'.repeat(64);

  beforeAll(async () => {
    port2 = await freePort();
    home2 = path.join(tmpDir('rs-sec-wizard2-'), 'home');
    child2 = spawnNode('wizard-server.js', {
      env: { REDSTRING_AGENT_PORT: String(port2), REDSTRING_AGENT_TOKEN: ELECTRON_TOKEN, REDSTRING_HOME: home2 },
    });
    await waitFor(async () => (await rawRequest({ port: port2, path: '/health', headers: { 'x-redstring-token': ELECTRON_TOKEN } })).status === 200, { timeoutMs: 30000 });
  }, 45000);

  afterAll(async () => {
    await killChild(child2);
    try { fs.rmSync(path.dirname(home2), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('uses REDSTRING_AGENT_PORT / REDSTRING_AGENT_TOKEN and publishes that token for the MCP server', async () => {
    expect((await rawRequest({ port: port2, path: '/health', headers: { 'x-redstring-token': 'f'.repeat(64) } })).status).toBe(401);
    expect(readAgentJson(home2).agents[String(port2)].token).toBe(ELECTRON_TOKEN);
  });
});
