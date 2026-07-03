#!/usr/bin/env node
/**
 * redstring — command-line interface to a Redstring universe.
 *
 * Two backends, chosen automatically:
 *   • HTTP mode   — a daemon is running (probe /api/bridge/health). Commands go
 *                   through its endpoints; the daemon owns the file.
 *   • Direct mode — no daemon. The CLI boots the headless store itself
 *                   (createHeadlessStore + HeadlessUniverse), runs one command,
 *                   flushes, and exits. Acquires the same lock, so it refuses to
 *                   run if a daemon already owns the universe.
 *
 * Node built-ins only (util.parseArgs, fetch, child_process). No deps.
 *
 * Usage:
 *   redstring [--universe <path>] [--port <n>] [--json] <command> [args]
 *
 *   daemon start|stop|status         manage the background daemon
 *   universe create|info             create an empty universe / show status
 *   graph list|create <name>|show <id>
 *   node create <name> --graph <id> [--color <hex>]
 *   node list --graph <id>
 *   edge create <srcName> <dstName> --graph <id> [--type <name>]
 *   search <query>                   find graphs/prototypes by name
 *   apply <specs.json|->             enqueue/execute raw action specs
 *   export [--out <file>]            write the full universe JSON
 *   state [--json]                   summarize the current store
 */
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// The store + extracted handlers log to console.log (harmless in a browser, but
// it would corrupt the CLI's stdout). Route ALL library noise to stderr; the
// CLI's own output goes to stdout exclusively via emit().
console.log = (...a) => process.stderr.write(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
const emit = (s) => process.stdout.write(String(s) + '\n');

const PORT = process.env.WIZARD_PORT || process.env.BRIDGE_PORT || '3001';
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── arg parsing ────────────────────────────────────────────────────────────
const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    universe: { type: 'string' },
    port: { type: 'string' },
    graph: { type: 'string' },
    color: { type: 'string' },
    type: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  }
});

const [command, sub, ...rest] = positionals;
const die = (msg, code = 1) => { console.error(`redstring: ${msg}`); process.exit(code); };
const out = (obj) => emit(flags.json ? JSON.stringify(obj) : formatHuman(obj));

const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const daemonPidFile = path.join(os.homedir(), '.redstring', 'daemon.pid');

async function daemonHealth() {
  try {
    const r = await fetch(`${BASE}/api/bridge/health`);
    if (!r.ok) return null;
    const h = await r.json();
    return h.headless ? h : null; // only treat a headless daemon as "up" for our purposes
  } catch { return null; }
}

// ── backends ────────────────────────────────────────────────────────────────
function httpBackend() {
  const post = async (p, body) => {
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const t = await r.text();
    if (!r.ok) throw new Error(`POST ${p} → ${r.status}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : {};
  };
  const get = async (p) => {
    const r = await fetch(`${BASE}${p}`);
    const t = await r.text();
    if (!r.ok) throw new Error(`GET ${p} → ${r.status}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : {};
  };
  const waitAction = async (id, timeoutMs = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const s = await get(`/api/bridge/action-status/${id}`);
      if (s.status === 'completed') return s.result;
      if (s.status === 'unknown') throw new Error(`action ${id} unknown`);
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`action ${id} timed out`);
  };
  return {
    mode: 'http',
    async getState() { return get('/api/bridge/state'); },
    async runActions(actions) {
      const res = await post('/api/bridge/pending-actions/enqueue', { actions });
      const results = [];
      for (const id of res.actionIds || []) results.push(await waitAction(id));
      return results;
    },
    async export() { return get('/api/store/export'); },
    async status() { return get('/api/store/status'); },
    async save() { return post('/api/store/save', {}); },
    async close() {}
  };
}

async function directBackend(universePath) {
  if (!universePath) die('no daemon running and no --universe given (also set REDSTRING_UNIVERSE or ~/.redstring/daemon.json)');
  const { initRuntime } = await import(path.join(ROOT, 'src/headless/runtime.js'));
  const runtime = await initRuntime({ universePath, log: () => {} });
  return {
    mode: 'direct',
    async getState() { return runtime.buildBridgeStatePayload(); },
    async runActions(actions) {
      const ordered = [...actions].sort((a, b) => runtime.priority(a) - runtime.priority(b));
      const results = [];
      for (const a of ordered) results.push(await runtime.executeAction(a.action, a.params));
      return results;
    },
    async export() { return runtime.exportRedstring(); },
    async status() {
      const s = runtime.getState();
      return { headless: true, universe: runtime.universePath, stateVersion: runtime.stateVersion, graphs: s.graphs.size, prototypes: s.nodePrototypes.size, edges: s.edges?.size || 0, activeGraphId: s.activeGraphId || null };
    },
    async save() { await runtime.flush(); return { ok: true }; },
    async close() { await runtime.shutdown(); }
  };
}

function resolveUniverse() {
  if (flags.universe) return path.resolve(flags.universe);
  if (process.env.REDSTRING_UNIVERSE) return path.resolve(process.env.REDSTRING_UNIVERSE);
  try {
    const cfg = path.join(os.homedir(), '.redstring', 'daemon.json');
    if (fs.existsSync(cfg)) { const c = JSON.parse(fs.readFileSync(cfg, 'utf8')); if (c?.universe) return path.resolve(c.universe); }
  } catch {}
  return null;
}

async function getBackend() {
  const health = await daemonHealth();
  if (health) return httpBackend();
  return directBackend(resolveUniverse());
}

// ── helpers ──────────────────────────────────────────────────────────────────
function findGraphByName(state, name) {
  const n = name.toLowerCase();
  // take LAST match — newest wins (mirrors the store's resolve-by-name rule)
  let hit = null;
  for (const g of state.graphs) if ((g.name || '').toLowerCase() === n) hit = g;
  return hit;
}
function instancesOf(state, graphId) {
  const g = state.graphs.find(x => x.id === graphId);
  if (!g) return [];
  const protos = new Map(state.nodePrototypes.map(p => [p.id, p]));
  return Object.values(g.instances || {}).map(inst => ({ ...inst, name: protos.get(inst.prototypeId)?.name || inst.prototypeId }));
}

function formatHuman(obj) {
  if (typeof obj === 'string') return obj;
  return JSON.stringify(obj, null, 2);
}

// ── commands ──────────────────────────────────────────────────────────────────
async function cmdDaemon() {
  if (sub === 'status') {
    const h = await daemonHealth();
    if (!h) return out('daemon: not running');
    return out({ running: true, universe: h.universe, stateVersion: h.stateVersion });
  }
  if (sub === 'start') {
    const universe = resolveUniverse();
    if (!universe) die('daemon start requires --universe or REDSTRING_UNIVERSE');
    if (await daemonHealth()) die('daemon already running');
    const logFd = fs.openSync(path.join(os.homedir(), '.redstring', 'daemon.log'), 'a');
    fs.mkdirSync(path.dirname(daemonPidFile), { recursive: true });
    const child = spawn('node', ['wizard-server.js'], {
      cwd: ROOT, detached: true, stdio: ['ignore', logFd, logFd],
      env: { ...process.env, REDSTRING_UNIVERSE: universe, WIZARD_PORT: PORT }
    });
    fs.writeFileSync(daemonPidFile, String(child.pid));
    child.unref();
    // wait for health
    for (let i = 0; i < 50; i++) { if (await daemonHealth()) return out({ started: true, pid: child.pid, universe }); await new Promise(r => setTimeout(r, 200)); }
    die('daemon did not become healthy — see ~/.redstring/daemon.log');
  }
  if (sub === 'stop') {
    if (!fs.existsSync(daemonPidFile)) die('no daemon pidfile');
    const pid = parseInt(fs.readFileSync(daemonPidFile, 'utf8'), 10);
    try { process.kill(pid, 'SIGTERM'); } catch (e) { die(`could not signal pid ${pid}: ${e.message}`); }
    fs.rmSync(daemonPidFile, { force: true });
    return out({ stopped: true, pid });
  }
  die(`unknown: daemon ${sub || ''}`);
}

async function withBackend(fn) {
  const backend = await getBackend();
  try { return await fn(backend); }
  finally { await backend.close(); }
}

async function main() {
  if (flags.help || !command) return printHelp();

  switch (command) {
    case 'daemon': return cmdDaemon();

    case 'universe': return withBackend(async (b) => {
      if (sub === 'info') return out(await b.status());
      if (sub === 'create') {
        // In direct mode, booting the backend already created/loaded the file; flush to materialize it.
        await b.save();
        return out({ created: true, ...(await b.status()) });
      }
      die(`unknown: universe ${sub || ''}`);
    });

    case 'state': return withBackend(async (b) => {
      const s = await b.getState();
      if (flags.json) return out(s);
      const lines = [`store: ${s.storeMode || 'unknown'}  v${s.stateVersion ?? '?'}`,
        `graphs: ${s.graphs.length}  prototypes: ${s.nodePrototypes.length}  edges: ${(s.graphEdges || []).length}`,
        `active: ${s.activeGraphId || 'none'}`];
      return out(lines.join('\n'));
    });

    case 'export': return withBackend(async (b) => {
      const data = await b.export();
      if (flags.out) { fs.writeFileSync(path.resolve(flags.out), JSON.stringify(data, null, 2)); return out(`wrote ${flags.out}`); }
      return emit(JSON.stringify(data));
    });

    case 'graph': return withBackend(async (b) => {
      if (sub === 'list') {
        const s = await b.getState();
        if (flags.json) return out(s.graphs.map(g => ({ id: g.id, name: g.name, instances: g.instanceCount ?? Object.keys(g.instances || {}).length })));
        return out(s.graphs.map(g => `${g.id}  ${g.name}  (${g.instanceCount ?? Object.keys(g.instances || {}).length} nodes)`).join('\n') || '(no graphs)');
      }
      if (sub === 'create') {
        const name = rest[0]; if (!name) die('graph create <name>');
        const gid = newId('graph');
        await b.runActions([{ action: 'createNewGraph', params: [{ id: gid, name }] }]);
        await b.save();
        return out({ created: true, id: gid, name });
      }
      if (sub === 'show') {
        const gid = rest[0]; if (!gid) die('graph show <id>');
        const s = await b.getState();
        const g = s.graphs.find(x => x.id === gid) || findGraphByName(s, gid);
        if (!g) die(`graph not found: ${gid}`);
        return out({ id: g.id, name: g.name, description: g.description, nodes: instancesOf(s, g.id).map(i => ({ instanceId: i.id, name: i.name })), edgeIds: g.edgeIds || [] });
      }
      die(`unknown: graph ${sub || ''}`);
    });

    case 'node': return withBackend(async (b) => {
      if (sub === 'list') {
        const gid = flags.graph; if (!gid) die('node list --graph <id>');
        const s = await b.getState();
        const list = instancesOf(s, gid);
        if (flags.json) return out(list.map(i => ({ instanceId: i.id, prototypeId: i.prototypeId, name: i.name })));
        return out(list.map(i => `${i.id}  ${i.name}`).join('\n') || '(no nodes)');
      }
      if (sub === 'create') {
        const name = rest[0]; const gid = flags.graph;
        if (!name || !gid) die('node create <name> --graph <id>');
        const protoId = newId('proto'); const instId = newId('inst');
        await b.runActions([{ action: 'applyMutations', params: [[
          { type: 'addNodePrototype', prototypeData: { id: protoId, name, color: flags.color || '#5B7F58' } },
          { type: 'addNodeInstance', graphId: gid, prototypeId: protoId, position: { x: 300, y: 300 }, instanceId: instId }
        ]] }]);
        await b.save();
        return out({ created: true, prototypeId: protoId, instanceId: instId, name, graph: gid });
      }
      die(`unknown: node ${sub || ''}`);
    });

    case 'edge': return withBackend(async (b) => {
      if (sub === 'create') {
        const [srcName, dstName] = rest; const gid = flags.graph;
        if (!srcName || !dstName || !gid) die('edge create <srcName> <dstName> --graph <id>');
        const s = await b.getState();
        const insts = instancesOf(s, gid);
        const find = (nm) => { const n = nm.toLowerCase(); let h = null; for (const i of insts) if ((i.name || '').toLowerCase() === n) h = i; return h; };
        const src = find(srcName), dst = find(dstName);
        if (!src) die(`source node not found in graph: ${srcName}`);
        if (!dst) die(`target node not found in graph: ${dstName}`);
        const edge = { id: newId('edge'), sourceId: src.id, destinationId: dst.id };
        if (flags.type) edge.name = flags.type;
        await b.runActions([{ action: 'applyMutations', params: [[{ type: 'addEdge', graphId: gid, edgeData: edge }]] }]);
        await b.save();
        return out({ created: true, id: edge.id, from: src.name, to: dst.name });
      }
      die(`unknown: edge ${sub || ''}`);
    });

    case 'search': return withBackend(async (b) => {
      const q = (sub || '').toLowerCase(); if (!q) die('search <query>');
      const s = await b.getState();
      const graphs = s.graphs.filter(g => (g.name || '').toLowerCase().includes(q)).map(g => ({ kind: 'graph', id: g.id, name: g.name }));
      const protos = s.nodePrototypes.filter(p => (p.name || '').toLowerCase().includes(q)).map(p => ({ kind: 'prototype', id: p.id, name: p.name }));
      const hits = [...graphs, ...protos];
      if (flags.json) return out(hits);
      return out(hits.map(h => `${h.kind}\t${h.id}\t${h.name}`).join('\n') || '(no matches)');
    });

    case 'apply': return withBackend(async (b) => {
      const source = sub; if (!source) die('apply <specs.json|->');
      const raw = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(source), 'utf8');
      let specs = JSON.parse(raw);
      if (!Array.isArray(specs)) specs = specs.actions || [specs];
      const results = await b.runActions(specs);
      await b.save();
      return out({ applied: specs.length, results });
    });

    default: die(`unknown command: ${command}`);
  }
}

function printHelp() {
  emit(`redstring — CLI for a Redstring universe

Usage: redstring [--universe <path>] [--port <n>] [--json] <command>

Commands:
  daemon start|stop|status
  universe create|info
  graph list | create <name> | show <id>
  node create <name> --graph <id> [--color <hex>] | list --graph <id>
  edge create <srcName> <dstName> --graph <id> [--type <name>]
  search <query>
  apply <specs.json|->
  export [--out <file>]
  state [--json]

Backend: uses a running daemon if present (localhost:${PORT}); otherwise runs
directly against the file from --universe / REDSTRING_UNIVERSE / ~/.redstring/daemon.json.`);
}

// Explicit exit: the headless store keeps the event loop alive, so a resolved
// main() would otherwise hang the process after the command completes.
main().then(() => process.exit(0)).catch((err) => { console.error(`redstring: ${err.message}`); process.exit(1); });
