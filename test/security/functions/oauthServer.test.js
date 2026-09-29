// @vitest-environment node
//
// S-02 / S-52 / S-12 — the legacy Node oauth-server.js (may still run on
// GCP). Routes are driven over real HTTP against an in-process listener;
// GitHub is mocked; no developer .env is read.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubMock, makeTestKeys, CALLER_TOKEN, APP_ID } from './githubMock.js';

vi.mock('node-fetch', () => ({ default: (...args) => globalThis.fetch(...args) }));
vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));
vi.mock('../../../src/services/UserAnalytics.js', () => ({ default: { trackActivity() {}, cleanup() {} } }));

// A vault holding a victim's credentials: stateless mode must never use or
// return them.
const vault = vi.hoisted(() => ({
  oauth: { accessToken: 'gho_' + 'victimVaultToken' + 'Z'.repeat(20), user: { login: 'victim' } },
  app: { installationId: 1002, accessToken: 'ghs_victimInstallTokenZZZZZZZZZZZZZZZ' },
}));
vi.mock('../../../src/services/server/tokenVault.js', () => ({
  default: {
    getOAuthCredentials: () => vault.oauth,
    getGitHubAppInstallation: () => vault.app,
    setGitHubAppInstallation: vi.fn((x) => x),
    setOAuthCredentials: vi.fn((x) => x),
  },
}));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const realFetch = globalThis.fetch;

let keys;
let server;
let base;
let app;

beforeAll(async () => {
  keys = makeTestKeys();
  process.env.GITHUB_APP_ID = String(APP_ID);
  process.env.GITHUB_APP_PRIVATE_KEY = keys.privateKey;
  delete process.env.GITHUB_APP_ID_DEV;
  delete process.env.GITHUB_APP_PRIVATE_KEY_DEV;
  delete process.env.GITHUB_WEBHOOK_SECRET;
  delete process.env.ENABLE_SERVER_PERSISTENCE;
  ({ app } = await import('../../../oauth-server.js'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
});

let gh;
beforeEach(() => {
  gh = createGitHubMock();
  vi.stubGlobal('fetch', gh);
});
afterEach(() => vi.unstubAllGlobals());

const req = (path, { method = 'GET', body, headers = {} } = {}) =>
  realFetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const authed = { authorization: `token ${CALLER_TOKEN}` };

describe('oauth-server /api/github/app/installation-token', () => {
  it('refuses without the caller\'s token even though the server vault holds one (old code minted)', async () => {
    const res = await req('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 1002 } });
    expect(res.status).toBe(401);
    expect(gh.minted()).toHaveLength(0);
    expect(gh.calls.some((c) => c.authorization.includes('victimVaultToken'))).toBe(false);
  });

  it('refuses another user\'s install', async () => {
    const res = await req('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 1002 }, headers: authed });
    expect(res.status).toBe(403);
    expect(gh.minted()).toHaveLength(0);
  });

  it('mints for the caller\'s own install with the expected shape, without writing the vault', async () => {
    const { default: tokenVault } = await import('../../../src/services/server/tokenVault.js');
    tokenVault.setGitHubAppInstallation.mockClear();
    const res = await req('/api/github/app/installation-token', { method: 'POST', body: { installation_id: '1001' }, headers: authed });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ token: 'ghs_minted_for_1001', account: { login: 'alice' }, service: 'oauth-server' });
    expect(body.verification.status).toBe('verified');
    expect(gh.minted().map((c) => c.path)).toEqual(['/app/installations/1001/access_tokens']);
    expect(tokenVault.setGitHubAppInstallation).not.toHaveBeenCalled();
  });

  it('allows an org install only for an active member', async () => {
    expect((await req('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 2001 }, headers: authed })).status).toBe(200);
    expect((await req('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 2002 }, headers: authed })).status).toBe(403);
  });
});

describe('oauth-server previously-unauthenticated routes', () => {
  it('GET /installation/:id requires a token and ownership', async () => {
    expect((await req('/api/github/app/installation/1001')).status).toBe(401);
    expect((await req('/api/github/app/installation/1002', { headers: authed })).status).toBe(403);
    const ok = await req('/api/github/app/installation/1001', { headers: authed });
    expect(ok.status).toBe(200);
    expect((await ok.json()).account.login).toBe('alice');
  });

  it('POST /create-repository requires a token and ownership', async () => {
    expect((await req('/api/github/app/create-repository', { method: 'POST', body: { installation_id: 1001, name: 'x' } })).status).toBe(401);
    const denied = await req('/api/github/app/create-repository', { method: 'POST', body: { installation_id: 1002, name: 'x' }, headers: authed });
    expect(denied.status).toBe(403);
    expect(gh.calls.some((c) => c.path === '/user/repos')).toBe(false);
  });

  it('stateless mode never hands out vault contents', async () => {
    const app1 = await req('/api/github/auth/github-app');
    expect(app1.status).toBe(404);
    expect(await app1.text()).not.toContain('victimInstallToken');
    const oauth1 = await req('/api/github/auth/oauth/token');
    expect(oauth1.status).toBe(404);
    expect(await oauth1.text()).not.toContain('victimVaultToken');
  });

  it('/health says nothing about secret configuration', async () => {
    const body = await (await req('/health')).json();
    expect(body).toEqual({ status: 'healthy', service: 'oauth-server' });
  });
});

describe('oauth-server webhook', () => {
  it('refuses deliveries when no webhook secret is configured', async () => {
    const res = await req('/api/github/app/webhook', { method: 'POST', body: { action: 'created' }, headers: { 'x-github-event': 'installation' } });
    expect(res.status).toBe(503);
  });
});

describe('oauth-server listen address (S-52)', () => {
  const freePort = () => new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); });
  });
  const lanAddress = () => Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address || null;
  const canConnect = (host, port) => new Promise((r) => {
    realFetch(`http://${host}:${port}/health`).then(() => r(true), () => r(false));
  });

  it('binds to loopback by default when run as `node oauth-server.js`', async () => {
    const port = await freePort();
    const env = { ...process.env, OAUTH_PORT: String(port), LOG_LEVEL: 'error' };
    for (const k of ['HOST', 'OAUTH_BIND_HOST', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_ID', 'GITHUB_CLIENT_SECRET']) delete env[k];
    // app-semantic-server's name for the REMOTE oauth host shares the
    // container env; it must not change what this server binds to.
    env.OAUTH_HOST = 'redstring-oauth.example.invalid';
    // cwd = a temp dir so dotenv finds no .env to load.
    const child = spawn(process.execPath, [resolve(ROOT, 'oauth-server.js')], { cwd: tmpdir(), env, stdio: 'ignore' });
    try {
      let up = false;
      for (let i = 0; i < 100 && !up; i++) {
        up = await canConnect('127.0.0.1', port);
        if (!up) await new Promise((r) => setTimeout(r, 100));
      }
      expect(up).toBe(true);
      const lan = lanAddress();
      if (lan) expect(await canConnect(lan, port)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  }, 20000);
});
