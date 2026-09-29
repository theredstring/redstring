// @vitest-environment node
// Local server invariants: the agent (wizard) server, the MCP server, the
// legacy/cloud servers and the Vite dev server. The threat is a web page in
// the user's browser (or a device on the same Wi-Fi) talking to localhost.
import { describe, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import picomatch from 'picomatch';
import {
  ROOT, serverFiles, codeFiles, parseAll, parseFile, traverse, violation, lineOf, snippet, memberName,
  calleeTail, stringValue, assertRule, importsFrom, isReferenced, walk, isCall, src, exists,
} from './_lib/scan.js';

const { parsed: SERVERS } = parseAll([...new Set([...serverFiles(), ...codeFiles(['functions/'])])]);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const GUARD_MODULE = 'src/security/localServerGuard.js';

/** An expression that can only be a loopback host (env override allowed: process.env.HOST || '127.0.0.1'). */
function isLoopbackHost(p, depth = 0) {
  if (!p || !p.node || depth > 4) return false;
  const n = p.node;
  if (n.type === 'StringLiteral') return LOOPBACK.has(n.value);
  if (n.type === 'LogicalExpression' && (n.operator === '||' || n.operator === '??')) return isLoopbackHost(p.get('right'), depth + 1);
  if (n.type === 'Identifier') {
    const b = p.scope.getBinding(n.name);
    if (!b || !b.path.isVariableDeclarator() || !b.path.node.init) return false;
    return isLoopbackHost(b.path.get('init'), depth + 1);
  }
  if (n.type === 'ObjectExpression') {
    const hostProp = p.get('properties').find((pp) => pp.isObjectProperty() && (pp.node.key.name ?? pp.node.key.value) === 'host');
    return hostProp ? isLoopbackHost(hostProp.get('value'), depth + 1) : false;
  }
  return false;
}

describe('security invariants: local servers', () => {
  it('no bare cors() or wildcard CORS', () => {
    const found = [];
    for (const { file, ast, source } of SERVERS) {
      walk(ast, (n) => {
        if (!isCall(n) || calleeTail(n) !== 'cors' || n.callee.type !== 'Identifier') return;
        const opts = n.arguments[0];
        if (!opts) { found.push(violation(file, lineOf(n), snippet(source, n))); return; }
        if (opts.type === 'ObjectExpression') {
          const origin = opts.properties.find((pr) => pr.type === 'ObjectProperty' && (pr.key.name ?? pr.key.value) === 'origin');
          if (!origin) found.push(violation(file, lineOf(n), `${snippet(source, n)} — no origin (defaults to *)`));
          else if (stringValue(origin.value) === '*' || (origin.value.type === 'BooleanLiteral' && origin.value.value)) {
            found.push(violation(file, lineOf(n), snippet(source, n)));
          }
        }
      });
    }
    assertRule('servers/no-open-cors', found);
  });

  it('every .listen() binds an explicit loopback host', () => {
    const found = [];
    for (const { file, ast, source } of SERVERS) {
      traverse(ast, {
        CallExpression(p) {
          if (calleeTail(p.node) !== 'listen' || p.node.callee.type !== 'MemberExpression') return;
          const [first, second] = p.node.arguments;
          if (!first || first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression') return;
          const ok = first.type === 'ObjectExpression' ? isLoopbackHost(p.get('arguments.0')) : isLoopbackHost(p.get('arguments.1'));
          if (!ok) found.push(violation(file, lineOf(p.node), `${snippet(source, p.node, 70)}${second ? '' : ' — no host: listens on all interfaces'}`));
        },
      });
    }
    assertRule('servers/loopback-listen', found);
  });

  it('wizard-server.js and redstring-mcp-server.js install createLocalServerGuard and take JSON only', () => {
    const found = [];
    for (const file of ['wizard-server.js', 'redstring-mcp-server.js']) {
      const r = parseFile(file);
      if (!r.ast) { found.push(violation(file, 0, 'does not parse')); continue; }
      const names = importsFrom(file, r.ast, GUARD_MODULE);
      const local = [...names].find(([, imported]) => imported === 'createLocalServerGuard')?.[0];
      if (!local || !isReferenced(r.ast, local)) {
        found.push(violation(file, 0, `does not import createLocalServerGuard from ${GUARD_MODULE}`));
      } else {
        // The guard must actually be mounted: app.use(createLocalServerGuard(...)) or app.use(guard).
        let mounted = false;
        traverse(r.ast, {
          CallExpression(p) {
            if (calleeTail(p.node) !== 'use') return;
            for (const a of p.get('arguments')) {
              if (a.isCallExpression() && calleeTail(a.node) === local) mounted = true;
              if (a.isIdentifier()) {
                const b = a.scope.getBinding(a.node.name);
                const init = b && b.path.isVariableDeclarator() ? b.path.node.init : null;
                if (init && isCall(init) && calleeTail(init) === local) mounted = true;
              }
            }
          },
        });
        if (!mounted) found.push(violation(file, 0, 'imports createLocalServerGuard but never passes it to app.use(...)'));
      }
      walk(r.ast, (n) => {
        if (isCall(n) && memberName(n.callee) === 'express.urlencoded') {
          found.push(violation(file, lineOf(n), `${snippet(r.source, n)} — form bodies are CSRF-able; accept JSON only`));
        }
      });
    }
    assertRule('servers/local-guard', found);
  });

  it('the MCP server only listens on HTTP when REDSTRING_MCP_HTTP=1', () => {
    const file = 'redstring-mcp-server.js';
    const r = parseFile(file);
    const found = [];
    const mentionsFlag = (p) => {
      if (!p || !p.node) return false;
      if (src(r.source, p.node).includes('REDSTRING_MCP_HTTP')) return true;
      let hit = false;
      p.traverse({
        Identifier(ip) {
          const b = ip.scope.getBinding(ip.node.name);
          const init = b && b.path.isVariableDeclarator() ? b.path.node.init : null;
          if (init && src(r.source, init).includes('REDSTRING_MCP_HTTP')) hit = true;
        },
      });
      if (p.isIdentifier()) {
        const b = p.scope.getBinding(p.node.name);
        const init = b && b.path.isVariableDeclarator() ? b.path.node.init : null;
        if (init && src(r.source, init).includes('REDSTRING_MCP_HTTP')) hit = true;
      }
      return hit;
    };
    traverse(r.ast, {
      CallExpression(p) {
        if (calleeTail(p.node) !== 'listen' || p.node.callee.type !== 'MemberExpression') return;
        // Guarded if an enclosing if/&& tests the flag, or an earlier if in an
        // enclosing function tests it (early-return style).
        let guarded = false;
        for (let cur = p.parentPath; cur && !guarded; cur = cur.parentPath) {
          if ((cur.isIfStatement() || cur.isConditionalExpression()) && mentionsFlag(cur.get('test'))) guarded = true;
          if (cur.isLogicalExpression() && mentionsFlag(cur.get('left'))) guarded = true;
          if (cur.isFunction() || cur.isProgram()) {
            cur.traverse({
              IfStatement(ip) {
                if (ip.node.start < p.node.start && mentionsFlag(ip.get('test'))) guarded = true;
              },
            });
          }
        }
        if (!guarded) found.push(violation(file, lineOf(p.node), `${snippet(r.source, p.node, 70)} — HTTP listener is on by default`));
      },
    });
    assertRule('servers/mcp-http-opt-in', found);
  });

  const tmpDirs = [];
  afterAll(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

  it('the queue journal never persists API keys or tokens', async () => {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/services/queue/Queue.js')).href);
    const Manager = mod.QueueManager ?? mod.default.constructor;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-queue-invariant-'));
    tmpDirs.push(dir);
    const q = new Manager(dir);
    // Built at runtime so this file never contains a string the secret scanner flags.
    const secrets = {
      openrouter: `sk-or-v1-${'0123456789abcdef'.repeat(4)}`,
      anthropic: `sk-ant-api03-${'A'.repeat(40)}`,
      github: `gho_${'B'.repeat(36)}`,
      bearer: `Bearer ${'c'.repeat(32)}`,
    };
    q.enqueue('invariant', {
      type: 'goal',
      apiKey: secrets.openrouter,
      meta: { apiKey: secrets.anthropic, api_key: secrets.anthropic, nested: { githubToken: secrets.github } },
      headers: { Authorization: secrets.bearer },
      payload: { text: 'keep me' },
    });
    const journal = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const found = Object.entries(secrets)
      .filter(([, v]) => journal.includes(v))
      .map(([k]) => violation('src/services/queue/Queue.js', 0, `journal contains the ${k} secret verbatim`));
    if (!journal.includes('keep me')) found.push(violation('src/services/queue/Queue.js', 0, 'journal lost the non-secret payload (scrub removed too much)'));
    assertRule('servers/queue-journal-secrets', found);
  });

  it('the Vite dev server binds localhost by default and denies secret files', async () => {
    const saved = { VITE_HOST: process.env.VITE_HOST };
    delete process.env.VITE_HOST;
    let config;
    try {
      const mod = await import(pathToFileURL(path.join(ROOT, 'vite.config.js')).href);
      const exported = mod.default;
      config = typeof exported === 'function' ? await exported({ mode: 'development', command: 'serve' }) : exported;
    } finally {
      if (saved.VITE_HOST !== undefined) process.env.VITE_HOST = saved.VITE_HOST;
    }
    const found = [];
    const host = config.server?.host;
    if (!(host === undefined || host === false || LOOPBACK.has(host))) {
      found.push(violation('vite.config.js', 0, `server.host is ${JSON.stringify(host)} with VITE_HOST unset — the dev server is reachable from the LAN`));
    }
    // Mirror Vite 5's matcher exactly (dep-*.js: _fsDenyGlob): patterns
    // without "/" get a "**/" prefix; matched against absolute paths. Note a
    // user-supplied deny list REPLACES Vite's defaults (.env, .env.*, *.pem).
    const deny = config.server?.fs?.deny ?? ['.env', '.env.*', '*.{crt,pem}'];
    const isDenied = picomatch(deny.map((pt) => (pt.includes('/') ? pt : `**/${pt}`)), { matchBase: false, nocase: true, dot: true });
    const MUST_DENY = [
      'WIZARD_KEY.txt', 'github.env', 'github.env.local', 'github.env.production', '.env', '.env.production',
      '.env.github-app', 'keys/app.private-key.pem', 'data/queues/goals.jsonl', 'data/analytics/users.json',
      'universes/demo/demo.redstring', 'backup.redstring', 'events/2025-08-09.jsonl',
    ];
    for (const rel of MUST_DENY) {
      const abs = path.join(ROOT, rel).split(path.sep).join('/');
      if (!isDenied(abs)) found.push(violation('vite.config.js', 0, `server.fs.deny does not cover ${rel}`));
    }
    if (!exists('vite.config.js')) found.push(violation('vite.config.js', 0, 'missing'));
    assertRule('servers/vite-dev-exposure', found);
  });
});
