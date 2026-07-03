#!/usr/bin/env node
/**
 * Phase 4 gate: drive the REAL MCP server (stdio JSON-RPC) against a live
 * headless daemon — no browser. Proves an MCP client can read the daemon's
 * store and apply a mutation that lands in the .redstring file.
 *
 * Flow: start daemon on a temp universe → spawn redstring-mcp-server.js with
 * BRIDGE_PORT pointed at it → initialize → tools/call list_available_graphs →
 * tools/call apply_mutations (create a graph) → re-read → assert.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const PORT = process.env.WIZARD_PORT || '3017';
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.cwd();

let daemon, mcp, tmpDir;
const cleanup = () => {
  try { daemon?.kill('SIGTERM'); } catch {}
  try { mcp?.kill('SIGKILL'); } catch {}
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bridge/health`); if (r.ok) return await r.json(); } catch {}
    await sleep(200);
  }
  throw new Error('daemon never became healthy');
}

// ── Minimal newline-delimited JSON-RPC client over the MCP child's stdio ──
function makeRpc(child) {
  let buf = '';
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // ignore non-JSON noise
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let nextId = 1;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 30000);
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { request, notify };
}

async function main() {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rs-mcp-'));
  const universe = path.join(tmpDir, 'u.redstring');

  console.log('[mcp-e2e] starting daemon on', universe);
  daemon = spawn('node', ['wizard-server.js'], {
    cwd: ROOT,
    env: { ...process.env, REDSTRING_UNIVERSE: universe, WIZARD_PORT: PORT },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  daemon.stderr.on('data', () => {}); // silence
  const health = await waitForHealth();
  assert.equal(health.headless, true, 'daemon should be headless');

  console.log('[mcp-e2e] spawning MCP server (BRIDGE_PORT=' + PORT + ')');
  mcp = spawn('node', ['redstring-mcp-server.js'], {
    cwd: ROOT,
    env: { ...process.env, BRIDGE_PORT: PORT },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  mcp.stderr.on('data', () => {}); // MCP logs to stderr — silence
  const rpc = makeRpc(mcp);

  const init = await rpc.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-daemon-smoke', version: '1.0.0' }
  });
  assert.ok(init?.serverInfo || init?.capabilities, 'initialize returned a result');
  console.log('[mcp-e2e] PASS initialize (server:', init?.serverInfo?.name || '?', ')');
  rpc.notify('notifications/initialized', {});

  // Seed a graph THROUGH the MCP server via apply_mutations.
  const applyRes = await rpc.request('tools/call', {
    name: 'apply_mutations',
    arguments: { operations: [{ type: 'createNewGraph', initialData: { id: 'g-mcp', name: 'MCP Made Graph' } }] }
  });
  const applyText = (applyRes?.content || []).map(c => c.text || '').join(' ');
  console.log('[mcp-e2e] apply_mutations →', applyText.slice(0, 120).replace(/\n/g, ' '));

  // Give the daemon a beat to persist, then read back via the MCP tool.
  await sleep(500);
  const listRes = await rpc.request('tools/call', { name: 'list_available_graphs', arguments: {} });
  const listText = (listRes?.content || []).map(c => c.text || '').join('\n');
  assert.match(listText, /MCP Made Graph/, `list_available_graphs should show the new graph. Got: ${listText.slice(0, 300)}`);
  console.log('[mcp-e2e] PASS list_available_graphs shows "MCP Made Graph"');

  // Confirm it hit the daemon's live store over HTTP too.
  const state = await (await fetch(`${BASE}/api/bridge/state`)).json();
  assert.ok(state.graphs.some(g => g.id === 'g-mcp'), 'daemon state should contain g-mcp');
  console.log('[mcp-e2e] PASS daemon /api/bridge/state contains g-mcp');

  // Persist + verify on disk.
  await fetch(`${BASE}/api/store/save`, { method: 'POST' });
  daemon.kill('SIGTERM');
  await sleep(800);
  assert.ok(fs.existsSync(universe), 'universe file should exist');
  assert.match(fs.readFileSync(universe, 'utf8'), /MCP Made Graph/, 'file should contain the MCP-made graph');
  console.log('[mcp-e2e] PASS universe file on disk contains the MCP-made graph');

  console.log('\n\x1b[32mMCP↔DAEMON E2E PASSED\x1b[0m');
}

main().then(() => { cleanup(); process.exit(0); })
      .catch((err) => { console.error('\n\x1b[31mMCP↔DAEMON E2E FAILED:\x1b[0m', err.message); cleanup(); process.exit(1); });
