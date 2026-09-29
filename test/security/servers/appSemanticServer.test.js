// @vitest-environment node
/**
 * S-53: deployment/app-semantic-server.js (legacy GCP server, still runnable
 * via `npm run server`): universe writes fail closed, analytics reads need an
 * admin token, OAuth proxies forward the caller's Authorization, the public
 * → local-agent proxies are gone, and it binds loopback unless HOST is set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, rawRequest, waitFor, spawnNode, killChild, ROOT } from './helpers.js';

let fake; let fakePort; const seen = [];
const servers = [];

async function startApp(env) {
  const port = await freePort();
  const child = spawnNode('deployment/app-semantic-server.js', {
    cwd: undefined,
    env: { PORT: String(port), OAUTH_HOST: `http://127.0.0.1:${fakePort}`, NODE_ENV: 'test', LOG_LEVEL: 'error', HOST: '', ...env },
  });
  servers.push(child);
  await waitFor(async () => (await rawRequest({ port, path: '/health' })).status === 200, { timeoutMs: 40000 });
  return { port, child };
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization || null });
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakePort = fake.address().port;
});

afterAll(async () => {
  for (const c of servers) await killChild(c);
  await new Promise((r) => fake.close(r));
});

describe('app-semantic-server without secrets configured', () => {
  let port;
  beforeAll(async () => { ({ port } = await startApp({ UNIVERSE_WRITE_TOKEN: '', ANALYTICS_ADMIN_TOKEN: '' })); }, 60000);

  it('refuses universe writes when UNIVERSE_WRITE_TOKEN is unset (fail closed)', async () => {
    const res = await rawRequest({ port, method: 'POST', path: '/semantic/victim/universe.jsonld', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ '@context': {} }) });
    expect(res.status).toBe(503);
  });

  it('does not serve analytics reads publicly', async () => {
    for (const p of ['/api/analytics/stats', '/api/analytics/active-users', '/api/analytics/user/u1', '/api/analytics/activity']) {
      expect((await rawRequest({ port, path: p })).status, p).toBe(404);
    }
  });

  it('forwards the caller Authorization on installation-token / installation / create-repository proxies', async () => {
    seen.length = 0;
    const authz = 'token gho_callers_token';
    await rawRequest({ port, method: 'POST', path: '/api/github/app/installation-token', headers: { 'content-type': 'application/json', authorization: authz }, body: '{"installation_id":"1"}' });
    await rawRequest({ port, path: '/api/github/app/installation/1', headers: { authorization: authz } });
    await rawRequest({ port, method: 'POST', path: '/api/github/app/create-repository', headers: { 'content-type': 'application/json', authorization: authz }, body: '{}' });
    const byPath = Object.fromEntries(seen.map((s) => [s.url, s.authorization]));
    expect(byPath['/api/github/app/installation-token']).toBe(authz);
    expect(byPath['/api/github/app/installation/1']).toBe(authz);
    expect(byPath['/api/github/app/create-repository']).toBe(authz);
  });

  it('no longer relays internet requests into the local agent server', async () => {
    const res = await rawRequest({ port, method: 'POST', path: '/api/mcp/request', headers: { 'content-type': 'application/json' }, body: '{"method":"tools/list"}' });
    expect([404, 429]).toContain(res.status);
    const src = fs.readFileSync(path.join(ROOT, 'deployment/app-semantic-server.js'), 'utf8');
    expect(src).not.toMatch(/\$\{BRIDGE_INTERNAL_URL\}\/api\/(mcp\/request|bridge\/state|bridge\/actions)/);
  });

  it('listens on loopback only by default', async () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!lan) return; // no LAN interface on this machine
    const reachable = await new Promise((resolve) => {
      const s = net.connect({ host: lan.address, port }, () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
    });
    expect(reachable).toBe(false);
  });
});

describe('app-semantic-server with secrets configured', () => {
  let port;
  const WRITE = 'w'.repeat(40);
  const ADMIN = 'a'.repeat(40);
  beforeAll(async () => { ({ port } = await startApp({ UNIVERSE_WRITE_TOKEN: WRITE, ANALYTICS_ADMIN_TOKEN: ADMIN })); }, 60000);

  it('rejects a wrong universe write token and analytics without the admin token', async () => {
    const res = await rawRequest({ port, method: 'POST', path: '/semantic/victim/universe.jsonld', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: JSON.stringify({ '@context': {} }) });
    expect(res.status).toBe(401);
    expect((await rawRequest({ port, path: '/api/analytics/stats' })).status).toBe(401);
    expect((await rawRequest({ port, path: '/api/analytics/stats', headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(200);
  });
});
