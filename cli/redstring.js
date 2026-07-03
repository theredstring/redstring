#!/usr/bin/env node
/**
 * redstring — run and drive Redstring from the command line.
 *
 * A workspace is a local folder of universes (.redstring files); one universe is
 * active at a time. `redstring run` starts a background Redstring serving your
 * workspace; other commands talk to it if it's up, or run the store directly
 * (one-shot) if it isn't.
 *
 * Node built-ins only. No dependencies.
 *
 *   redstring run [<universe>]        start the background Redstring (+ activate)
 *   redstring stop                    stop the background Redstring
 *   redstring status                  is it running? which workspace / universe
 *   redstring list                    list universes in the workspace
 *   redstring create <name>           create a universe (and make it active)
 *   redstring use <universe>          switch the active universe
 *   redstring show <universe>         show a universe's details
 *   redstring rm <universe> [--keep-file]   delete a universe
 *   redstring workspace [link <dir>]  show or set the workspace folder
 *   redstring auth github <token>     save a BYOK GitHub token
 *   redstring pull <user/repo>[/path] import a universe from a GitHub repo (+ activate)
 *   redstring push [<universe>] [<user/repo>]   publish a universe to a GitHub repo
 *   redstring link|unlink <universe> ...        manage a universe's repo link
 *   redstring graph|node|edge|search|apply|export|state   (operate on the active universe)
 *
 * Flags: --workspace/-w <dir>, --universe <file> (back-compat), --port <n>, --json,
 *        --token <t>, --branch <b>, --name <n>, -m/--message <msg>, --no-activate
 */
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { resolveWorkspace, rememberWorkspace, resolveGithubToken, rememberGithubToken, REDSTRING_HOME } from '../src/headless/config.js';
import { GitHubUniverseSync, parseRepoSpec } from '../src/headless/githubSync.js';

// The store + handlers log via console.log; route ALL library noise to stderr so
// the CLI's stdout stays clean. Intentional output goes through emit() only.
console.log = (...a) => process.stderr.write(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
const emit = (s) => process.stdout.write(String(s) + '\n');

const PORT = process.env.WIZARD_PORT || process.env.BRIDGE_PORT || '3001';
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PID_FILE = path.join(REDSTRING_HOME, 'redstring.pid');
const LOG_FILE = path.join(REDSTRING_HOME, 'redstring.log');

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    workspace: { type: 'string', short: 'w' },
    universe: { type: 'string' },
    port: { type: 'string' },
    graph: { type: 'string' },
    color: { type: 'string' },
    type: { type: 'string' },
    out: { type: 'string' },
    token: { type: 'string' },
    branch: { type: 'string' },
    name: { type: 'string' },
    message: { type: 'string', short: 'm' },
    'no-activate': { type: 'boolean' },
    local: { type: 'boolean' },
    git: { type: 'boolean' },
    'keep-file': { type: 'boolean' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  }
});

const [command, sub, ...rest] = positionals;
const die = (msg, code = 1) => { console.error(`redstring: ${msg}`); process.exit(code); };
const out = (obj) => emit(flags.json ? JSON.stringify(obj) : formatHuman(obj));
const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

async function probeRunning() {
  try {
    const r = await fetch(`${BASE}/api/bridge/health`);
    if (!r.ok) return null;
    const h = await r.json();
    return h.headless ? h : null; // only a headless instance counts as "running" for us
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
  const del = async (p) => {
    const r = await fetch(`${BASE}${p}`, { method: 'DELETE' });
    const t = await r.text();
    if (!r.ok) throw new Error(`DELETE ${p} → ${r.status}: ${t.slice(0, 200)}`);
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
    async save() { return post('/api/store/save', {}); },
    async workspaceInfo() { return get('/api/workspace'); },
    async createUniverse(name) { return post('/api/workspace/universes', { name }); },
    async switchUniverse(slug) { return post('/api/workspace/active', { slug }); },
    async deleteUniverse(slug, { keepFile } = {}) { return del(`/api/workspace/universes/${encodeURIComponent(slug)}${keepFile ? '?keepFile=true' : ''}`); },
    async unlink(slug, slot) { return post('/api/workspace/unlink', { slug, slot }); },
    async pull(repoSpec, opts) { return post('/api/workspace/pull', { repo: repoSpec, ...opts }); },
    async push(slug, opts) { return post('/api/workspace/push', { slug, ...opts }); },
    async link(slug, repoSpec, opts) { return post('/api/workspace/link', { slug, repo: repoSpec, ...opts }); },
    async close() {}
  };
}

// Construct a GitHub sync client from a repo spec + BYOK token (direct mode).
function githubSyncFor(repoSpec, { branch } = {}) {
  const { user, repo, path: repoPath } = parseRepoSpec(repoSpec);
  const token = resolveGithubToken({ flags, env: process.env });
  if (!token) die('no GitHub token — run `redstring auth github <token>` or set REDSTRING_GITHUB_TOKEN');
  return { sync: new GitHubUniverseSync({ user, repo, token, branch: branch || flags.branch || 'main', log: () => {} }), repoPath };
}

async function directBackend() {
  const { dir, activeFileHint } = resolveWorkspace({ flags });
  const { initRuntime } = await import(path.join(ROOT, 'src/headless/runtime.js'));
  const runtime = await initRuntime({ workspaceDir: dir, activeFileHint, log: () => {} });
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
    async save() { await runtime.flush(); return { ok: true }; },
    async workspaceInfo() {
      return { workspace: runtime.workspaceDir, active: runtime.getActiveUniverse()?.slug || null, universes: runtime.listUniverses() };
    },
    async createUniverse(name) { const u = await runtime.createUniverse(name); return { ok: true, universe: u, active: runtime.getActiveUniverse()?.slug }; },
    async switchUniverse(slug) { await runtime.switchUniverse(slug); return { ok: true, active: runtime.getActiveUniverse()?.slug }; },
    async deleteUniverse(slug, opts) { const r = await runtime.deleteUniverse(slug, opts); return { ok: true, ...r }; },
    async unlink(slug, slot) { runtime.unlinkUniverse(slug, slot); return { ok: true }; },
    async pull(repoSpec, { name = null, activate = true, branch = null } = {}) {
      const { sync, repoPath } = githubSyncFor(repoSpec, { branch });
      const universe = await runtime.pullUniverse(sync, { repoPath, name, activate });
      return { ok: true, universe, active: runtime.getActiveUniverse()?.slug };
    },
    async push(slug, { repo = null, message = null, branch = null } = {}) {
      const entry = runtime.listUniverses().find((u) => u.slug === slug);
      let repoSpec = repo;
      let storedPath = null;
      if (!repoSpec && entry?.gitRepo?.enabled && entry.gitRepo.linkedRepo) {
        const lr = entry.gitRepo.linkedRepo;
        repoSpec = `${lr.user}/${lr.repo}`;
        storedPath = entry.gitRepo.repoPath || null;
      }
      if (!repoSpec) die('no linked repo — pass a repo: `redstring push <universe> <user/repo>`');
      const { sync, repoPath } = githubSyncFor(repoSpec, { branch: branch || entry?.gitRepo?.linkedRepo?.branch });
      const result = await runtime.pushUniverse(sync, slug, { message, repoPath: storedPath || repoPath });
      return { ok: true, ...result };
    },
    async link(slug, repoSpec, { branch = null } = {}) {
      const { user, repo, path: repoPath } = parseRepoSpec(repoSpec);
      runtime.setGitLink(
        slug,
        { type: 'github', user, repo, authMethod: 'token', branch: branch || flags.branch || 'main' },
        repoPath ? { universeFolder: repoPath.includes('/') ? repoPath.slice(0, repoPath.lastIndexOf('/')) : slug, universeFile: repoPath.split('/').pop() } : {}
      );
      return { ok: true, linked: `${user}/${repo}` };
    },
    async close() { await runtime.shutdown(); }
  };
}

/** HTTP if a background Redstring is up; otherwise a one-shot direct-library backend. */
async function getBackend() {
  if (await probeRunning()) return httpBackend();
  return directBackend();
}

async function withBackend(fn) {
  const backend = await getBackend();
  try { return await fn(backend); }
  finally { await backend.close(); }
}

// Resolve a user-supplied universe name-or-slug to its slug (last match wins).
function resolveUniverseArg(info, nameOrSlug) {
  const q = String(nameOrSlug || '').toLowerCase();
  let hit = null;
  for (const u of info.universes) {
    if (u.slug === nameOrSlug) return u.slug;
    if ((u.name || '').toLowerCase() === q || u.slug.toLowerCase() === q) hit = u.slug;
  }
  if (!hit) die(`no such universe: ${nameOrSlug}`);
  return hit;
}

// ── auto-start (the `run` verb) ───────────────────────────────────────────────
async function ensureRunning() {
  const existing = await probeRunning();
  if (existing) return existing;
  const { dir } = resolveWorkspace({ flags });
  rememberWorkspace(dir); // persist the linked workspace for future invocations
  fs.mkdirSync(REDSTRING_HOME, { recursive: true });
  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn('node', ['wizard-server.js'], {
    cwd: ROOT, detached: true, stdio: ['ignore', logFd, logFd],
    env: { ...process.env, REDSTRING_WORKSPACE: dir, WIZARD_PORT: PORT }
  });
  fs.writeFileSync(PID_FILE, String(child.pid));
  child.unref();
  for (let i = 0; i < 60; i++) {
    const h = await probeRunning();
    if (h) return h;
    await new Promise(r => setTimeout(r, 200));
  }
  die(`Redstring did not become ready — see ${LOG_FILE}`);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function findGraphByName(state, name) {
  const n = name.toLowerCase();
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

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (flags.help || !command) return printHelp();

  switch (command) {
    // ── lifecycle ──────────────────────────────────────────────────────────
    case 'run': {
      const health = await ensureRunning();
      if (sub) {
        // activate the named universe
        const info = await httpBackend().workspaceInfo();
        const slug = resolveUniverseArg(info, sub);
        await httpBackend().switchUniverse(slug);
      }
      const h = await probeRunning();
      return out(flags.json ? h : `Redstring running on ${BASE}\nworkspace: ${h.workspace}\nactive universe: ${h.activeUniverse}`);
    }

    case 'stop': {
      const running = await probeRunning();
      if (!fs.existsSync(PID_FILE)) {
        if (!running) return out('Redstring is not running');
        die('running but no pidfile — stop it manually');
      }
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
      try { process.kill(pid, 'SIGTERM'); } catch (e) { die(`could not signal pid ${pid}: ${e.message}`); }
      fs.rmSync(PID_FILE, { force: true });
      return out({ stopped: true, pid });
    }

    case 'status':
    case 'ps': {
      const h = await probeRunning();
      if (h) return out(flags.json ? h : `running: yes\nworkspace: ${h.workspace}\nactive universe: ${h.activeUniverse}\nstate version: ${h.stateVersion}`);
      const { dir } = resolveWorkspace({ flags });
      return out(flags.json ? { running: false, workspace: dir } : `running: no\nworkspace: ${dir}\n(start it with: redstring run)`);
    }

    case 'workspace': {
      if (sub === 'link') {
        const dir = rest[0]; if (!dir) die('workspace link <dir>');
        const abs = path.resolve(dir);
        rememberWorkspace(abs);
        const running = await probeRunning();
        return out(flags.json
          ? { workspace: abs, note: running ? 'restart with `redstring run` to serve the new workspace' : null }
          : `workspace set to ${abs}${running ? '\n(restart with `redstring run` to serve it)' : ''}`);
      }
      const { dir } = resolveWorkspace({ flags });
      return out(flags.json ? { workspace: dir } : dir);
    }

    // ── universe management ─────────────────────────────────────────────────
    case 'list':
    case 'ls': return withBackend(async (b) => {
      const info = await b.workspaceInfo();
      if (flags.json) return out(info.universes.map(u => ({ slug: u.slug, name: u.name, active: u.active, source: u.sourceOfTruth })));
      return out(info.universes.map(u => `${u.active ? '*' : ' '} ${u.name}  [${u.slug}]  (${u.sourceOfTruth})`).join('\n') || '(no universes)');
    });

    case 'create': return withBackend(async (b) => {
      const name = sub; if (!name) die('create <name>');
      const r = await b.createUniverse(name);
      return out(flags.json ? r : `created "${name}" (active)`);
    });

    case 'use': return withBackend(async (b) => {
      const name = sub; if (!name) die('use <universe>');
      const info = await b.workspaceInfo();
      const slug = resolveUniverseArg(info, name);
      const r = await b.switchUniverse(slug);
      return out(flags.json ? r : `active universe: ${slug}`);
    });

    case 'rm':
    case 'remove': return withBackend(async (b) => {
      const name = sub; if (!name) die('rm <universe>');
      const info = await b.workspaceInfo();
      const slug = resolveUniverseArg(info, name);
      const r = await b.deleteUniverse(slug, { keepFile: !!flags['keep-file'] });
      return out(flags.json ? r : `removed ${slug}${flags['keep-file'] ? ' (file kept)' : ''}`);
    });

    case 'show': return withBackend(async (b) => {
      const name = sub; if (!name) die('show <universe>');
      const info = await b.workspaceInfo();
      const slug = resolveUniverseArg(info, name);
      const u = info.universes.find(x => x.slug === slug);
      return out(u);
    });

    // ── GitHub-backed universes ─────────────────────────────────────────────
    case 'auth': {
      if (sub !== 'github') die('auth github <token>');
      const token = rest[0]; if (!token) die('auth github <token>');
      rememberGithubToken(token);
      return out(flags.json ? { ok: true } : 'GitHub token saved to ~/.redstring/config.json');
    }

    case 'pull': return withBackend(async (b) => {
      const repoSpec = sub; if (!repoSpec) die('pull <user/repo>[/path/to/file.redstring]');
      const r = await b.pull(repoSpec, { name: flags.name || null, activate: !flags['no-activate'], branch: flags.branch || null });
      const u = r.universe || {};
      return out(flags.json ? r : `pulled "${u.name || repoSpec}" [${u.slug || '?'}]${flags['no-activate'] ? '' : ' (active)'}`);
    });

    case 'push': return withBackend(async (b) => {
      // Args: [<universe>] [<user/repo>] in any order — repo is the one with a slash.
      const args = [sub, ...rest].filter(Boolean);
      const repoArg = args.find(a => a.includes('/')) || null;
      const uniArg = args.find(a => a !== repoArg) || null;
      const info = await b.workspaceInfo();
      const slug = uniArg ? resolveUniverseArg(info, uniArg) : (info.active || info.universes.find(u => u.active)?.slug);
      if (!slug) die('no active universe to push');
      const r = await b.push(slug, { repo: repoArg, message: flags.message || null, branch: flags.branch || null });
      return out(flags.json ? r : `pushed ${r.slug} → ${r.repoPath}${r.commit ? ` (${r.commit.slice(0, 8)})` : ''}`);
    });

    case 'link': return withBackend(async (b) => {
      const uniArg = sub; const repoSpec = rest[0];
      if (!uniArg || !repoSpec) die('link <universe> <user/repo>');
      const info = await b.workspaceInfo();
      const slug = resolveUniverseArg(info, uniArg);
      const r = await b.link(slug, repoSpec, { branch: flags.branch || null });
      return out(flags.json ? r : `linked ${slug} → ${repoSpec}`);
    });

    case 'unlink': return withBackend(async (b) => {
      const uniArg = sub; if (!uniArg) die('unlink <universe> [--local]');
      const info = await b.workspaceInfo();
      const slug = resolveUniverseArg(info, uniArg);
      const slot = flags.local ? 'local' : 'git';
      const r = await b.unlink(slug, slot);
      return out(flags.json ? r : `unlinked ${slot} from ${slug}`);
    });

    // ── graph operations (on the active universe) ───────────────────────────
    case 'state': return withBackend(async (b) => {
      const s = await b.getState();
      if (flags.json) return out(s);
      return out([`store: ${s.storeMode || 'unknown'}  v${s.stateVersion ?? '?'}`,
        `graphs: ${s.graphs.length}  prototypes: ${s.nodePrototypes.length}  edges: ${(s.graphEdges || []).length}`,
        `active graph: ${s.activeGraphId || 'none'}`].join('\n'));
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

    default: die(`unknown command: ${command} (try: redstring --help)`);
  }
}

function printHelp() {
  emit(`redstring — run and drive Redstring from the command line

Usage: redstring [--workspace <dir>] [--port <n>] [--json] <command>

Lifecycle:
  run [<universe>]      start background Redstring serving your workspace (+ activate)
  stop                  stop the background Redstring
  status                is it running? which workspace / active universe
  workspace [link <dir>]  show or set the workspace folder

Universes:
  list                  list universes in the workspace
  create <name>         create a universe (and make it active)
  use <universe>        switch the active universe
  show <universe>       show a universe's details
  rm <universe> [--keep-file]   delete a universe

GitHub (BYOK token):
  auth github <token>   save a GitHub token to ~/.redstring/config.json
  pull <user/repo>[/path] [--name <n>] [--no-activate]   import a universe from a repo
  push [<universe>] [<user/repo>] [-m <msg>]             publish a universe to a repo
  link <universe> <user/repo>    record a repo link (without pushing)
  unlink <universe> [--local]    detach the git (or local) source

Graph (operate on the active universe):
  graph list | create <name> | show <id>
  node create <name> --graph <id> [--color <hex>] | list --graph <id>
  edge create <src> <dst> --graph <id> [--type <name>]
  search <query> | apply <specs.json|-> | export [--out <file>] | state [--json]

A workspace is a local folder of universes (.redstring files). Commands use a
running Redstring if present (localhost:${PORT}); otherwise they run the store
directly for one shot. Default workspace: ~/redstring (created on first run).`);
}

// Explicit exit: the headless store keeps the event loop alive, so a resolved
// main() would otherwise hang after the command completes.
main().then(() => process.exit(0)).catch((err) => { console.error(`redstring: ${err.message}`); process.exit(1); });
