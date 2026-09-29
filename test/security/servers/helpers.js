// Shared helpers for the local-server security tests: free ports, raw HTTP
// requests (fetch can't set Host or omit Origin reliably), and child servers.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * One HTTP request with full control of headers. Host defaults to
 * 127.0.0.1:PORT; pass headers.host to override. Resolves { status, headers, body }.
 */
export function rawRequest({ port, method = 'GET', path: p = '/', headers = {}, body = null, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const h = { host: `127.0.0.1:${port}`, ...headers };
    if (body != null && h['content-length'] === undefined) h['content-length'] = Buffer.byteLength(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, setHost: false }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/** Resolve with the first chunk of a streaming response, then abort it. */
export function firstChunk({ port, path: p, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: p, headers: { host: `127.0.0.1:${port}`, ...headers }, setHost: false }, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
        return;
      }
      res.once('data', (chunk) => { resolve({ status: 200, headers: res.headers, body: chunk.toString() }); req.destroy(); });
    });
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    req.end();
  });
}

export async function waitFor(fn, { timeoutMs = 20000, intervalMs = 100 } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out${lastErr ? `: ${lastErr.message}` : ''}`);
}

export function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Spawn `node <script>` from the repo root with a clean-ish env; collects output. */
export function spawnNode(script, { env = {}, stdin = 'ignore', cwd = ROOT } = {}) {
  const baseEnv = { ...process.env };
  // Never inherit a developer's real agent token into a test server.
  delete baseEnv.REDSTRING_AGENT_TOKEN;
  delete baseEnv.REDSTRING_MCP_TOKEN;
  delete baseEnv.REDSTRING_MCP_HTTP;
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { ...baseEnv, NODE_ENV: 'test', ...env },
    stdio: [stdin, 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', (c) => { child.output += c.toString(); });
  child.stderr.on('data', (c) => { child.output += c.toString(); });
  return child;
}

export function readAgentJson(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, 'agent.json'), 'utf8')); } catch { return null; }
}

export async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
  });
}
