// @vitest-environment node
/**
 * S-50: the REAL MCP server (redstring-mcp-server.js) as a child process.
 *  - stdio only by default: no HTTP listener at all
 *  - REDSTRING_MCP_HTTP=1: guarded (own token in agent.json), JSON only, no
 *    CORS wildcard, tool args validated against the zod schema, leftover
 *    duplicate bridge/AI/OAuth routes gone
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { freePort, rawRequest, waitFor, tmpDir, spawnNode, readAgentJson, killChild } from './helpers.js';

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

describe('MCP server, default (stdio only)', () => {
  let child;
  let port;
  let home;

  beforeAll(async () => {
    port = await freePort();
    home = path.join(tmpDir('rs-sec-mcp-'), 'home');
    // stdin must stay open or the stdio transport ends and the process exits.
    child = spawnNode('redstring-mcp-server.js', {
      stdin: 'pipe',
      env: { MCP_PORT: String(port), BRIDGE_PORT: String(await freePort()), REDSTRING_HOME: home },
    });
    await waitFor(() => /MCP HTTP listener off/.test(child.output), { timeoutMs: 30000 });
  }, 45000);

  afterAll(async () => {
    await killChild(child);
    try { fs.rmSync(path.dirname(home), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('opens no HTTP port', async () => {
    expect(child.exitCode).toBe(null); // still alive on stdio
    expect(await canConnect(port)).toBe(false);
  });

  it('still answers MCP over stdio', async () => {
    let out = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    await waitFor(() => out.includes('"id":1'), { timeoutMs: 10000 });
    expect(JSON.parse(out.trim().split('\n').find((l) => l.includes('"id":1'))).result.serverInfo.name).toBe('redstring');
  });
});

describe('MCP server with REDSTRING_MCP_HTTP=1', () => {
  let child;
  let port;
  let home;
  let token;
  const json = { 'content-type': 'application/json' };
  const rpc = (body, headers = {}) => rawRequest({ port, method: 'POST', path: '/api/mcp/request', headers: { ...json, ...headers }, body: JSON.stringify(body) });

  beforeAll(async () => {
    port = await freePort();
    home = path.join(tmpDir('rs-sec-mcphttp-'), 'home');
    child = spawnNode('redstring-mcp-server.js', {
      stdin: 'pipe',
      env: { REDSTRING_MCP_HTTP: '1', MCP_PORT: String(port), BRIDGE_PORT: String(await freePort()), REDSTRING_HOME: home },
    });
    token = await waitFor(() => readAgentJson(home)?.mcp?.[String(port)]?.token, { timeoutMs: 30000 });
  }, 45000);

  afterAll(async () => {
    await killChild(child);
    try { fs.rmSync(path.dirname(home), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const auth = () => ({ 'x-redstring-token': token });

  it('records its own token with owner-only permissions', () => {
    expect(fs.statSync(path.join(home, 'agent.json')).mode & 0o777).toBe(0o600);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('401s without the token', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    expect((await rawRequest({ port, path: '/health' })).status).toBe(401);
  });

  it('403s a foreign Host and evil / null Origins', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...auth(), host: 'evil.example' })).status).toBe(403);
    for (const origin of ['https://evil.example', 'null']) {
      expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...auth(), origin })).status, origin).toBe(403);
    }
  });

  it('sends no wildcard CORS header', async () => {
    const res = await rawRequest({ port, path: '/health', headers: auth() });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects text/plain and form bodies (415)', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await rawRequest({ port, method: 'POST', path: '/api/mcp/request', headers: { ...auth(), 'content-type': ct }, body });
      expect(res.status, ct).toBe(415);
    }
  });

  it('serves tools/list with the token', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, auth());
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).result.tools.length).toBeGreaterThan(0);
  });

  it('validates tools/call arguments against the zod schema before running the tool', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'open_graph', arguments: { graphId: { $gt: '' } } } }, auth());
    expect(res.status).toBe(200);
    const text = JSON.parse(res.body).result.content[0].text;
    expect(text).toMatch(/validation/i);
    expect(text).not.toMatch(/bridge not available|not available/i); // never reached the handler
  });

  it('no longer serves the duplicate bridge / AI / OAuth routes', async () => {
    const gone = [
      ['GET', '/api/bridge/state'], ['POST', '/api/bridge/state'], ['GET', '/api/bridge/pending-actions'],
      ['POST', '/api/bridge/actions/add-node-prototype'], ['POST', '/api/ai/agent'], ['POST', '/api/ai/chat'],
      ['POST', '/api/wizard'], ['POST', '/api/github/oauth/token'], ['GET', '/api/github/oauth/client-id'],
    ];
    for (const [method, p] of gone) {
      const res = await rawRequest({ port, method, path: p, headers: { ...auth(), ...(method === 'POST' ? json : {}) }, body: method === 'POST' ? '{}' : null });
      expect(res.status, `${method} ${p}`).toBe(404);
    }
  });
});
