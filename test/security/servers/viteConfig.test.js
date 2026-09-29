// @vitest-environment node
/**
 * S-58 + C-6 web dev: the vite dev server listens on localhost by default,
 * refuses to serve secrets/user data, and its agent proxy only lends the token
 * to requests from this machine.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import picomatch from 'picomatch';
import { tmpDir, ROOT } from './helpers.js';

let configFn;
let mod;
const home = path.join(tmpDir('rs-sec-vite-'), 'home');

beforeAll(async () => {
  vi.stubEnv('REDSTRING_HOME', home);
  vi.stubEnv('VITE_HOST', '');
  vi.stubEnv('REDSTRING_AGENT_TOKEN', '');
  mod = await import('../../../vite.config.js');
  configFn = mod.default;
});
afterAll(() => {
  vi.unstubAllEnvs();
  try { fs.rmSync(path.dirname(home), { recursive: true, force: true }); } catch { /* ignore */ }
});

const serverConfig = () => configFn({ mode: 'development', command: 'serve' }).server;

// Same matcher vite builds from server.fs.deny (see vite's _fsDenyGlob).
function denyMatcher(deny) {
  return picomatch(deny.map((p) => (p.includes('/') ? p : `**/${p}`)), { matchBase: false, nocase: true, dot: true });
}

describe('vite dev server exposure', () => {
  it('does not listen on all interfaces by default', () => {
    const { host } = serverConfig();
    expect(host).not.toBe(true);
    expect(host).not.toBe('0.0.0.0');
    expect(host).toBe('localhost');
  });

  it('denies secrets and user data under the project root', () => {
    const isDenied = denyMatcher(serverConfig().fs.deny);
    const root = ROOT.split(path.sep).join('/');
    for (const f of ['WIZARD_KEY.txt', 'github.env', 'github.env.local', '.env', '.env.github-app', 'prodredkey.pem', 'data/queues/patches.jsonl', 'data/analytics/users.json', 'universes/eieio/u.redstring', 'events/log.jsonl', 'backup.redstring']) {
      expect(isDenied(`${root}/${f}`), f).toBe(true);
    }
    for (const f of ['src/main.jsx', 'index.html', 'node_modules/some-lib/data/table.json', 'public/logo.svg']) {
      expect(isDenied(`${root}/${f}`), f).toBe(false);
    }
  });
});

describe('vite agent proxy', () => {
  it('is mounted at the prefix the renderer uses', () => {
    expect(serverConfig().proxy[mod.DEV_AGENT_PROXY_PREFIX]).toBe(mod.agentProxy);
    expect(mod.agentProxy.rewrite('/__redstring_agent/api/bridge/state')).toBe('/api/bridge/state');
  });

  it('refuses requests from other machines (never lends the token)', () => {
    expect(mod.agentProxy.bypass({ socket: { remoteAddress: '192.168.1.20' }, headers: {} })).toBe(false);
    expect(mod.agentProxy.bypass({ socket: { remoteAddress: '::ffff:10.0.0.5' }, headers: {} })).toBe(false);
    expect(mod.agentProxy.bypass({ socket: { remoteAddress: '127.0.0.1' }, headers: {} })).toBeUndefined();
    expect(mod.agentProxy.bypass({ socket: { remoteAddress: '::1' }, headers: {} })).toBeUndefined();
  });

  it('adds the token from agent.json and drops the page\'s own loopback Origin', () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'agent.json'), JSON.stringify({ agents: { 3001: { token: 't'.repeat(64) } } }));
    const proxy = new EventEmitter();
    mod.agentProxy.configure(proxy, {});
    const headers = { origin: 'http://localhost:4001' };
    const proxyReq = {
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      removeHeader: (k) => { delete headers[k.toLowerCase()]; },
    };
    proxy.emit('proxyReq', proxyReq, { headers: { origin: 'http://localhost:4001' } });
    expect(headers['x-redstring-token']).toBe('t'.repeat(64));
    expect(headers.origin).toBeUndefined();

    const evilHeaders = { origin: 'https://evil.example' };
    const evilReq = { setHeader: (k, v) => { evilHeaders[k.toLowerCase()] = v; }, removeHeader: (k) => { delete evilHeaders[k.toLowerCase()]; } };
    proxy.emit('proxyReq', evilReq, { headers: { origin: 'https://evil.example' } });
    expect(evilHeaders.origin).toBe('https://evil.example'); // left for the agent to reject
  });

  it('/api proxy does not relay Origin-less LAN requests', () => {
    const api = serverConfig().proxy['/api'];
    expect(api.bypass({ socket: { remoteAddress: '192.168.1.20' }, headers: {} })).toBe(false);
    expect(api.bypass({ socket: { remoteAddress: '127.0.0.1' }, headers: {} })).toBeUndefined();
  });
});
