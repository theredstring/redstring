#!/usr/bin/env node
// A Git host on this machine, for trying shared universes without GitHub.
//
//   node scripts/fake-forge.mjs [--port 4510] [--dir <folder>]
//
// Speaks two dialects over the same repositories:
//   /api/v1/...        the slice of the Gitea API GiteaSemanticProvider uses
//                      (as Gitea, Forgejo or Codeberg would answer)
//   /github/repos/...  the slice of the GitHub REST API GitHubSemanticProvider
//                      uses (point it here with `apiBase: <host>/github`)
// Everything lives in real bare Git repositories under --dir: `git log` in one
// shows every save, with the person who made it. Writes follow each host's
// rules: an update must name the SHA it replaces, a create must not land on an
// existing file, and a stale SHA is refused — the compare-and-swap shared
// universes depend on. Gitea answers a stale SHA with 422, GitHub with 409.
//
// GitHub's quirks that have bitten Redstring are kept too: a file over 1 MB
// comes back from the contents API with no content (`encoding: "none"`), and
// `--read-lag <ms>` makes GitHub-dialect reads trail writes by that long, as
// GitHub's do for a few seconds after a save (blobs, being addressed by their
// SHA, are never stale).
//
// Who is saving comes from the token: `Authorization: token ana` is Ana. No
// real authentication; it listens on localhost only.
//
// http://localhost:<port>/ is a control page: each repository's history, and a
// switch per person that drops their connection (to try working offline).
//
// Used by scripts/shared-universe-harness.mjs; see
// documentation/core-system/SHARED_UNIVERSE_SYNC.md.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(arg('port', 4510));
const ROOT = path.resolve(arg('dir', path.join(os.tmpdir(), 'redstring-fake-forge')));
const BRANCH = 'main';
const READ_LAG_MS = Math.max(0, Number(arg('read-lag', 0)) || 0);
const GITHUB_CONTENT_LIMIT = 1024 * 1024; // the contents API omits content above this

fs.mkdirSync(ROOT, { recursive: true });
const offline = new Set(); // people whose connection is "down"

// ---------------------------------------------------------------------------
// Git, through plumbing. Node handles one request at a time and every call
// here is synchronous, so a read-compare-write can't interleave with another.

function repoDir(owner, repo) {
  const dir = path.join(ROOT, owner, `${repo}.git`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '--bare', '--quiet', `--initial-branch=${BRANCH}`, dir]);
  }
  return dir;
}

// Every git call has a time limit and is retried once or twice: on macOS a
// git process now and then stalls for minutes (seen in the soak runs on
// `hash-object`), and the host answers one request at a time, so one stalled
// call froze everything. The calls retried are safe to repeat: writing an
// object is idempotent, and update-ref is a compare-and-swap.
const GIT_TIMEOUT_MS = 20000;
function git(dir, gitArgs, { input, env } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('git', gitArgs, {
        cwd: dir,
        input,
        env: { ...process.env, GIT_DIR: dir, ...env },
        maxBuffer: 256 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS
      });
    } catch (error) {
      if (error?.code !== 'ETIMEDOUT' || attempt >= 3) throw error;
      log(`git ${gitArgs[0]} stalled for ${GIT_TIMEOUT_MS / 1000}s; trying again`);
    }
  }
}

function headCommit(dir) {
  try {
    return git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]).toString().trim() || null;
  } catch {
    return null;
  }
}

/** { type, sha, size } of a path at a commit, or null. */
function entryAt(dir, commit, filePath) {
  if (!commit) return null;
  try {
    const line = git(dir, ['ls-tree', '-l', commit, '--', filePath]).toString().trim();
    if (!line) return null;
    const [meta, name] = line.split('\t');
    const [, type, sha, size] = meta.split(/\s+/);
    if (name !== filePath) return null;
    return { type: type === 'tree' ? 'dir' : 'file', sha, size: size === '-' ? 0 : Number(size) };
  } catch {
    return null;
  }
}

function listDir(dir, commit, folder) {
  if (!commit) return null;
  const target = folder ? `${folder.replace(/\/+$/, '')}/` : '';
  if (folder && !entryAt(dir, commit, folder.replace(/\/+$/, ''))) return null;
  const out = git(dir, ['ls-tree', '-l', commit, '--', target || '.']).toString().trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [meta, full] = line.split('\t');
    const [, type, sha, size] = meta.split(/\s+/);
    return { name: path.posix.basename(full), path: full, sha, size: size === '-' ? 0 : Number(size), type: type === 'tree' ? 'dir' : 'file' };
  });
}

function blob(dir, sha) {
  try {
    return git(dir, ['cat-file', 'blob', sha]);
  } catch {
    return null;
  }
}

/** Commit `bytes` at `filePath` on top of `parent`; returns { commit, sha }. */
function commitFile(dir, parent, filePath, bytes, author, message) {
  const sha = git(dir, ['hash-object', '-w', '--stdin'], { input: bytes }).toString().trim();
  const index = path.join(os.tmpdir(), `fake-forge-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    if (parent) git(dir, ['read-tree', parent], { env });
    else git(dir, ['read-tree', '--empty'], { env });
    git(dir, ['update-index', '--add', '--cacheinfo', `100644,${sha},${filePath}`], { env });
    const tree = git(dir, ['write-tree'], { env }).toString().trim();
    const who = { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author}@fake-forge.local`, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@fake-forge.local` };
    const commit = git(dir, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { env: { ...env, ...who } }).toString().trim();
    // The ref moves only from the parent we built on: compare-and-swap again at the Git level.
    git(dir, ['update-ref', `refs/heads/${BRANCH}`, commit, parent || '0'.repeat(40)]);
    if (!moves.has(dir)) moves.set(dir, []);
    moves.get(dir).push({ at: Date.now(), commit, parent });
    return { commit, sha };
  } finally {
    fs.rmSync(index, { force: true });
  }
}

// Every move of each repository's branch, for --read-lag.
const moves = new Map(); // dir -> [{ at, commit, parent }]

/** The branch tip a lagging reader sees: the newest one at least READ_LAG_MS old. */
function visibleHead(dir) {
  const head = headCommit(dir);
  if (!READ_LAG_MS) return head;
  const cutoff = Date.now() - READ_LAG_MS;
  const recent = (moves.get(dir) || []).find((move) => move.at > cutoff);
  return recent ? recent.parent : head;
}

/** A commit from a branch name or commit SHA, or null. */
function resolveRef(dir, ref) {
  try {
    return git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).toString().trim() || null;
  } catch {
    return null;
  }
}

function history(dir, filePath, limit, from = BRANCH) {
  if (!headCommit(dir) || !from) return [];
  const out = git(dir, ['log', `-n${limit}`, '--format=%H%x1f%an%x1f%aI%x1f%s', from, '--', ...(filePath ? [filePath] : [])]).toString().trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [sha, name, date, message] = line.split('\x1f');
    return { sha, author: { login: name }, commit: { message, author: { name, date }, committer: { name, date } } };
  });
}

// ---------------------------------------------------------------------------
// HTTP

function send(res, status, body, type = 'application/json') {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Cache-Control, Pragma',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(data);
}
const fail = (res, status, message) => send(res, status, { message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const fileJson = (filePath, entry, bytes) => ({
  name: path.posix.basename(filePath),
  path: filePath,
  sha: entry.sha,
  size: bytes ? bytes.length : entry.size,
  type: 'file',
  encoding: 'base64',
  content: bytes ? bytes.toString('base64') : ''
});

async function handleApi(req, res, url, user) {
  if (url.pathname === '/api/v1/version') return send(res, 200, { version: 'fake-forge' });
  if (url.pathname === '/api/v1/user') return send(res, 200, { login: user, username: user });

  const m = url.pathname.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (!m) return fail(res, 404, 'not found');
  const [, owner, repo, rest = ''] = m.map((x) => (x ? decodeURIComponent(x) : x));
  const dir = repoDir(owner, repo);
  const head = headCommit(dir);

  if (rest === '') return send(res, 200, { name: repo, full_name: `${owner}/${repo}`, owner: { login: owner }, default_branch: BRANCH, empty: !head, permissions: { pull: true, push: true, admin: true } });

  if (rest.startsWith('git/blobs/')) {
    const sha = rest.slice('git/blobs/'.length);
    const bytes = blob(dir, sha);
    if (!bytes) return fail(res, 404, 'blob not found');
    return send(res, 200, { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
  }

  if (rest === 'commits') {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 20)));
    return send(res, 200, history(dir, url.searchParams.get('path') || '', limit));
  }

  if (rest === 'contents' || rest.startsWith('contents/')) {
    const filePath = rest === 'contents' ? '' : rest.slice('contents/'.length).replace(/\/+$/, '');

    if (req.method === 'GET') {
      if (!filePath) return send(res, 200, listDir(dir, head, '') || []);
      const entry = entryAt(dir, head, filePath);
      if (!entry) return fail(res, 404, 'file not found');
      if (entry.type === 'dir') return send(res, 200, listDir(dir, head, filePath));
      const bytes = blob(dir, entry.sha);
      if ((req.headers.accept || '').includes('application/octet-stream')) return send(res, 200, bytes, 'application/octet-stream');
      return send(res, 200, fileJson(filePath, entry, bytes));
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return fail(res, 400, 'invalid json'); }
      const bytes = Buffer.from(body.content || '', 'base64');
      const current = entryAt(dir, head, filePath);
      if (req.method === 'POST' && current) return fail(res, 422, `repository file already exists [path: ${filePath}]`);
      if (req.method === 'PUT') {
        if (!body.sha) return fail(res, 422, '"sha" is required for updating a file');
        // Gitea 1.22 answers a stale SHA with 422 and this message (checked against a real instance).
        if (!current || current.sha !== body.sha) return fail(res, 422, `sha does not match [given: ${body.sha}, expected: ${current?.sha || 'none'}]`);
      }
      const { commit, sha } = commitFile(dir, head, filePath, bytes, user, body.message || `Update ${filePath}`);
      log(`${user} saved ${owner}/${repo}/${filePath} (${bytes.length} bytes) → ${sha.slice(0, 8)}`);
      return send(res, req.method === 'POST' ? 201 : 200, {
        content: { ...fileJson(filePath, { sha, size: bytes.length }, null), content: undefined },
        commit: { sha: commit, author: { name: user } }
      });
    }
  }

  return fail(res, 404, 'not found');
}

// ---------------------------------------------------------------------------
// GitHub dialect (GitHubSemanticProvider with apiBase `<host>/github`)

// GitHub wraps base64 at 60 columns.
const githubBase64 = (bytes) => bytes.toString('base64').replace(/(.{60})/g, '$1\n');
const githubFail = (res, status, message) => send(res, status, { message, documentation_url: 'https://docs.github.com/rest', status: String(status) });

function githubFileJson(filePath, entry, bytes) {
  const size = bytes ? bytes.length : entry.size;
  const omitted = size > GITHUB_CONTENT_LIMIT;
  return {
    type: 'file',
    name: path.posix.basename(filePath),
    path: filePath,
    sha: entry.sha,
    size,
    encoding: omitted ? 'none' : 'base64',
    content: omitted || !bytes ? '' : githubBase64(bytes)
  };
}

async function handleGithub(req, res, url, user) {
  if (user === 'anonymous') return githubFail(res, 401, 'Bad credentials');
  if (url.pathname === '/github/user') return send(res, 200, { login: user });

  const m = url.pathname.match(/^\/github\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (!m) return githubFail(res, 404, 'Not Found');
  const [, owner, repo, rest = ''] = m.map((x) => (x ? decodeURIComponent(x) : x));
  const dir = repoDir(owner, repo);

  if (rest === '') {
    return send(res, 200, { name: repo, full_name: `${owner}/${repo}`, owner: { login: owner }, private: true, default_branch: BRANCH, permissions: { pull: true, push: true, admin: true } }, 'application/json');
  }

  if (rest.startsWith('git/blobs/')) {
    const sha = rest.slice('git/blobs/'.length);
    const bytes = blob(dir, sha);
    if (!bytes) return githubFail(res, 404, 'Not Found');
    return send(res, 200, { sha, size: bytes.length, encoding: 'base64', content: githubBase64(bytes) });
  }

  if (rest === 'commits') {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('per_page') || 30)));
    return send(res, 200, history(dir, url.searchParams.get('path') || '', limit, visibleHead(dir)));
  }

  if (rest === 'contents' || rest.startsWith('contents/')) {
    const filePath = rest === 'contents' ? '' : rest.slice('contents/'.length).replace(/\/+$/, '');

    if (req.method === 'GET') {
      const ref = url.searchParams.get('ref');
      const at = ref ? resolveRef(dir, ref) : visibleHead(dir);
      if (ref && !at) return githubFail(res, 404, `No commit found for the ref ${ref}`);
      if (!at) return githubFail(res, 404, 'This repository is empty.');
      if (!filePath) return send(res, 200, listDir(dir, at, ''));
      const entry = entryAt(dir, at, filePath);
      if (!entry) return githubFail(res, 404, 'Not Found');
      if (entry.type === 'dir') return send(res, 200, listDir(dir, at, filePath));
      const bytes = blob(dir, entry.sha);
      if (/application\/vnd\.github(\.v3)?\.raw/.test(req.headers.accept || '')) return send(res, 200, bytes, 'application/vnd.github.raw');
      return send(res, 200, githubFileJson(filePath, entry, bytes));
    }

    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return githubFail(res, 400, 'Problems parsing JSON'); }
      if (typeof body.message !== 'string') return githubFail(res, 422, 'Invalid request.\n\n"message" wasn\'t supplied.');
      // Writes see the true tip, never a lagging one.
      const head = headCommit(dir);
      const current = entryAt(dir, head, filePath);
      if (current && !body.sha) return githubFail(res, 422, 'Invalid request.\n\n"sha" wasn\'t supplied.');
      if (body.sha && (!current || current.sha !== body.sha)) {
        return githubFail(res, 409, `is at ${current?.sha || 'nothing'} but expected ${body.sha}`);
      }
      const bytes = Buffer.from(String(body.content || '').replace(/\s/g, ''), 'base64');
      const { commit, sha } = commitFile(dir, head, filePath, bytes, user, body.message);
      log(`${user} saved ${owner}/${repo}/${filePath} (${bytes.length} bytes, GitHub API) → ${sha.slice(0, 8)}`);
      return send(res, current ? 200 : 201, {
        content: { type: 'file', name: path.posix.basename(filePath), path: filePath, sha, size: bytes.length },
        commit: { sha: commit, message: body.message, author: { name: user, date: new Date().toISOString() } }
      });
    }
  }

  return githubFail(res, 404, 'Not Found');
}

// ---------------------------------------------------------------------------
// Control page

function repos() {
  const out = [];
  for (const owner of fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []) {
    const ownerDir = path.join(ROOT, owner);
    if (!fs.statSync(ownerDir).isDirectory()) continue;
    for (const name of fs.readdirSync(ownerDir)) {
      if (name.endsWith('.git')) out.push({ owner, repo: name.slice(0, -4), dir: path.join(ownerDir, name) });
    }
  }
  return out;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function controlPage() {
  const people = [...new Set([...offline, ...repos().flatMap(({ dir }) => history(dir, '', 200).map((c) => c.author.login))])].sort();
  const repoHtml = repos().map(({ owner, repo, dir }) => {
    const rows = history(dir, '', 50).map((c) => `<tr><td>${escapeHtml(c.commit.author.date.replace('T', ' ').slice(0, 19))}</td><td>${escapeHtml(c.author.login)}</td><td><code>${c.sha.slice(0, 8)}</code></td><td>${escapeHtml(c.commit.message)}</td></tr>`).join('');
    return `<section><h2>${escapeHtml(owner)}/${escapeHtml(repo)}</h2><p class="dim"><code>git --git-dir="${escapeHtml(dir)}" log</code></p><table><thead><tr><th>When</th><th>Who</th><th>Commit</th><th>Message</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="dim">No saves yet</td></tr>'}</tbody></table></section>`;
  }).join('') || '<p class="dim">No repositories yet. The first save creates one.</p>';
  const peopleHtml = people.map((p) => `<form method="post" action="/_control/offline"><input type="hidden" name="user" value="${escapeHtml(p)}"><input type="hidden" name="on" value="${offline.has(p) ? '0' : '1'}"><span>${escapeHtml(p)}</span> <span class="${offline.has(p) ? 'off' : 'on'}">${offline.has(p) ? 'offline' : 'online'}</span> <button>${offline.has(p) ? 'Reconnect' : 'Disconnect'}</button></form>`).join('') || '<p class="dim">Nobody has connected yet.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake forge</title><meta http-equiv="refresh" content="3">
<style>:root{--bg:#fbf8f4;--fg:#2a1f1a;--dim:#8a7a70;--line:#e6ddd4;--accent:#7a1f1f}@media (prefers-color-scheme:dark){:root{--bg:#1c1716;--fg:#efe6df;--dim:#a8968a;--line:#3a302c;--accent:#d06a6a}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:960px;margin-inline:auto}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 4px}.dim{color:var(--dim)}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--dim);font-weight:500}code{font:12px ui-monospace,monospace}form{display:flex;gap:10px;align-items:center;margin:6px 0}.on{color:var(--dim)}.off{color:var(--accent);font-weight:600}button{font:inherit;padding:3px 10px;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:4px;cursor:pointer}</style></head>
<body><h1>Fake forge</h1><p class="dim">Repositories in <code>${escapeHtml(ROOT)}</code>. Refreshes every 3 seconds.</p><h2>People</h2>${peopleHtml}${repoHtml}</body></html>`;
}

const log = (...m) => console.log(`[fake-forge ${new Date().toISOString().slice(11, 19)}]`, ...m);

const handle = async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname === '/') return send(res, 200, controlPage(), 'text/html; charset=utf-8');
    if (url.pathname === '/_control/offline' && req.method === 'POST') {
      const form = new URLSearchParams((await readBody(req)).toString());
      const user = form.get('user') || url.searchParams.get('user');
      if (user) (form.get('on') ?? url.searchParams.get('on')) === '1' ? offline.add(user) : offline.delete(user);
      log(`${user} is now ${offline.has(user) ? 'offline' : 'online'}`);
      res.writeHead(303, { Location: '/' });
      return res.end();
    }

    const auth = req.headers.authorization || '';
    const user = (auth.match(/^token\s+(.+)$/i) || auth.match(/^Bearer\s+(.+)$/i) || [])[1]?.trim() || 'anonymous';
    // "Offline": drop the connection, as a dead network would.
    if (offline.has(user)) return req.socket.destroy();
    if (url.pathname.startsWith('/github/')) return await handleGithub(req, res, url, user);
    return await handleApi(req, res, url, user);
  } catch (error) {
    log('error', error?.message || error);
    return fail(res, 500, String(error?.message || error));
  }
};

// Both loopback addresses, so `localhost` works whichever one a client tries
// first (Node's fetch can pick ::1). Never a non-loopback interface.
http.createServer(handle).listen(PORT, '127.0.0.1', () => log(`listening on http://localhost:${PORT} — repositories in ${ROOT}${READ_LAG_MS ? ` — GitHub reads lag ${READ_LAG_MS} ms` : ''}`));
http.createServer(handle).on('error', () => { /* no IPv6 loopback here */ }).listen(PORT, '::1');
