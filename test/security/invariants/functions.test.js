// @vitest-environment node
// Cloudflare Pages invariants: the GitHub App routes in functions/, the
// response headers in public/_headers, and what ships from public/.
//
// Besides the structural checks, this replays the two concrete attacks from
// the audit against the real Pages handler with a fake GitHub API:
//   S-01  mint an installation token for someone else's installation
//   S-12  deliver an unsigned webhook when no secret is configured
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  parseFile, traverse, violation, lineOf, stringValue, functionTable, reaches, callsNamed,
  isFunction, calleeTail, assertRule, importsFrom, exists, read, allRepoFiles,
} from './_lib/scan.js';

const ROUTER = 'functions/api/github/[[path]].ts';
const OWNERSHIP = 'functions/_lib/ownership.ts';
const LEGACY = 'oauth-server.js';

const PROTECTED_ROUTES = [
  ['post', '/api/github/app/installation-token'],
  ['get', '/api/github/app/installation/:installation_id'],
  ['post', '/api/github/app/create-repository'],
];

describe('security invariants: Cloudflare Functions and public/', () => {
  // Both servers that can mint installation tokens: the Pages Function and the
  // legacy Node oauth-server.js (a JS port of the same check).
  function routeViolations(file, ownershipName, table, ast) {
    const found = [];
    const seen = new Set();
    traverse(ast, {
      CallExpression(p) {
        const method = calleeTail(p.node);
        const route = stringValue(p.node.arguments[0]);
        if (!PROTECTED_ROUTES.some(([m, pth]) => m === method && pth === route)) return;
        seen.add(route);
        // Any handler or middleware after the path may do the check.
        const ok = ownershipName && p.node.arguments.slice(1).some((h) => {
          const fn = isFunction(h) ? h : table.get(h?.name);
          return reaches(fn, callsNamed(ownershipName), table);
        });
        if (!ok) found.push(violation(file, lineOf(p.node), `${method.toUpperCase()} ${route} does not call verifyInstallOwnership`));
      },
    });
    for (const [m, pth] of PROTECTED_ROUTES) {
      if (!seen.has(pth)) found.push(violation(file, 0, `route ${m.toUpperCase()} ${pth} not found — if it moved, update PROTECTED_ROUTES in this test`));
    }
    return found;
  }

  it('installation-scoped routes call verifyInstallOwnership (C-9)', () => {
    const found = [];
    const r = parseFile(ROUTER);
    const names = importsFrom(ROUTER, r.ast, OWNERSHIP);
    const local = [...names].find(([, imported]) => imported === 'verifyInstallOwnership')?.[0];
    if (!exists(OWNERSHIP)) found.push(violation(OWNERSHIP, 0, 'missing (contract C-9)'));
    if (!local) found.push(violation(ROUTER, 0, `does not import verifyInstallOwnership from ${OWNERSHIP}`));
    found.push(...routeViolations(ROUTER, local, functionTable(r.ast), r.ast));

    if (exists(LEGACY)) {
      const legacy = parseFile(LEGACY);
      const table = functionTable(legacy.ast);
      if (!table.has('verifyInstallOwnership')) found.push(violation(LEGACY, 0, 'has no verifyInstallOwnership (port of C-9)'));
      found.push(...routeViolations(LEGACY, table.has('verifyInstallOwnership') ? 'verifyInstallOwnership' : null, table, legacy.ast));
    }
    assertRule('functions/ownership-check', found);
  });

  it('public/_headers sets the security headers', () => {
    const file = 'public/_headers';
    const found = [];
    if (!exists(file)) {
      found.push(violation(file, 0, 'missing'));
    } else {
      // Cloudflare _headers: a path line, then indented "Name: value" lines.
      const blocks = new Map();
      let current = null;
      for (const raw of read(file).split('\n')) {
        if (!raw.trim() || raw.trim().startsWith('#')) continue;
        if (!/^\s/.test(raw)) { current = raw.trim(); blocks.set(current, []); continue; }
        if (current) blocks.get(current).push(raw.trim());
      }
      const all = (blocks.get('/*') || []).join('\n').toLowerCase();
      const need = [
        [/content-security-policy:.*frame-ancestors\s+'none'/, "Content-Security-Policy: frame-ancestors 'none'"],
        [/x-frame-options:\s*deny/, 'X-Frame-Options: DENY'],
        [/strict-transport-security:\s*max-age=(3153[6-9]\d{3}|315[4-9]\d{4}|31[6-9]\d{5}|3[2-9]\d{6}|[4-9]\d{7}|\d{9,})/, 'Strict-Transport-Security: max-age=31536000 (one year or more)'],
        [/x-content-type-options:\s*nosniff/, 'X-Content-Type-Options: nosniff'],
        [/referrer-policy:\s*\S+/, 'Referrer-Policy'],
        [/permissions-policy:\s*\S+/, 'Permissions-Policy'],
      ];
      for (const [re, label] of need) if (!re.test(all)) found.push(violation(file, 0, `/* block lacks ${label}`));
    }
    assertRule('web/headers', found);
  });

  it('public/ ships no debug, test or preview pages and no secrets', () => {
    const found = allRepoFiles()
      .filter((f) => f.startsWith('public/'))
      .filter((f) => /(^|[/_.-])(debug|test|tests|preview|sandbox|playground)([/_.-]|$)/i.test(f)
        || /\.(pem|key|map)$/i.test(f) || /(^|\/)\.env/.test(f) || /WIZARD_KEY|github\.env/i.test(f))
      .map((f) => violation(f, 0, 'served from the production origin'));
    assertRule('web/public-dir', found);
  });
});

// ── Attack replays against the real handler ──────────────────────────────

const APP_ID = '12345';
const CALLER = { id: 1, login: 'mallory' };
let onRequest;
let privateKeyPem;
let importError = null;

beforeAll(async () => {
  ({ privateKey: privateKeyPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }));
  try {
    ({ onRequest } = await import('../../../functions/api/github/[[path]].ts'));
  } catch (e) {
    importError = e;
  }
});

afterEach(() => { vi.unstubAllGlobals(); });

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A fake api.github.com. `installation` is what GET /app/installations/999
 * returns (or a number for an error status); `orgMember` controls
 * /user/memberships/orgs/:org. /user/installations always 403s, as it does
 * for the OAuth-App tokens (gho_) the web app actually sends.
 */
function fakeGitHub({ installation, orgMember = false }) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    calls.push({ method, path: url.pathname });
    if (url.hostname !== 'api.github.com') return json(404, { message: 'not github' });
    const p = url.pathname;
    if (method === 'GET' && p === '/user') return json(200, CALLER);
    if (method === 'GET' && p.startsWith('/user/installations')) return json(403, { message: 'Resource not accessible by integration' });
    if (method === 'GET' && p.startsWith('/user/memberships/orgs/')) {
      return orgMember ? json(200, { state: 'active', role: 'member', organization: { id: 50, login: 'victim-org' } }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && /^\/app\/installations\/\d+$/.test(p)) {
      return typeof installation === 'number' ? json(installation, { message: 'upstream error' }) : json(200, installation);
    }
    if (method === 'POST' && /^\/app\/installations\/\d+\/access_tokens$/.test(p)) {
      return json(201, { token: 'ghs_minted', expires_at: '2099-01-01T00:00:00Z', permissions: { contents: 'write' } });
    }
    if (method === 'GET' && p === '/installation/repositories') return json(200, { repositories: [] });
    if (method === 'POST' && (p === '/user/repos' || /^\/orgs\/[^/]+\/repos$/.test(p))) return json(201, { id: 7, full_name: 'x/y' });
    if (method === 'GET' && p === '/app') return json(200, { id: Number(APP_ID), slug: 'redstring-test' });
    return json(404, { message: 'Not Found' });
  };
  return { calls, fetchImpl };
}

function env(extra = {}) {
  return {
    GITHUB_CLIENT_ID: 'Iv1.test', GITHUB_CLIENT_SECRET: 'test-secret-not-real',
    GITHUB_APP_ID: APP_ID, GITHUB_APP_PRIVATE_KEY: privateKeyPem, GITHUB_APP_SLUG: 'redstring-test',
    ...extra,
  };
}

async function call(pathname, { method = 'GET', body, headers = {}, envExtra } = {}) {
  const request = new Request(`https://redstring.io${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  return onRequest({
    request, env: env(envExtra), params: {}, data: {},
    waitUntil() {}, passThroughOnException() {}, next: async () => new Response('next', { status: 404 }),
  });
}

// Assembled at runtime so the secret scanner does not flag this file.
const AUTH = { authorization: `Bearer gho_${'f'.repeat(36)}` };
const install = (over) => ({
  id: 999, app_id: Number(APP_ID), app_slug: 'redstring-test', target_type: 'User',
  account: { id: 2, login: 'victim', type: 'User' }, suspended_at: null, ...over,
});

const DENY_SCENARIOS = [
  ['someone else’s personal installation', { installation: install() }],
  ['an organisation the caller is not a member of', { installation: install({ target_type: 'Organization', account: { id: 50, login: 'victim-org', type: 'Organization' } }), orgMember: false }],
  ['a suspended installation the caller owns', { installation: install({ account: { id: CALLER.id, login: CALLER.login, type: 'User' }, suspended_at: '2026-01-01T00:00:00Z' }) }],
  ['an installation of a different GitHub App', { installation: install({ app_id: 999999, app_slug: 'other-app', account: { id: CALLER.id, login: CALLER.login, type: 'User' } }) }],
  ['GitHub failing (502) on the installation lookup', { installation: 502 }],
];

describe('security invariants: attack replays against functions/api/github', () => {
  const minted = (calls) => calls.filter((c) => c.method === 'POST' && /\/access_tokens$/.test(c.path));

  it('the router module loads', () => {
    expect(importError, `could not import ${ROUTER}: ${importError?.message}`).toBeNull();
  });

  for (const [label, scenario] of DENY_SCENARIOS) {
    it(`installation routes refuse ${label}`, async () => {
      if (importError) throw importError;
      const found = [];
      const requests = [
        ['POST /app/installation-token', '/api/github/app/installation-token', { method: 'POST', body: { installation_id: 999 } }],
        ['GET /app/installation/999', '/api/github/app/installation/999', {}],
        ['POST /app/create-repository', '/api/github/app/create-repository', { method: 'POST', body: { installation_id: 999, name: 'pwned', private: true } }],
      ];
      for (const [name, pth, opts] of requests) {
        const gh = fakeGitHub(scenario);
        vi.stubGlobal('fetch', gh.fetchImpl);
        const res = await call(pth, { ...opts, headers: AUTH });
        if (res.status < 400) found.push(violation(ROUTER, 0, `${name}: ${res.status} for ${label} (expected 401/403/404)`));
        if (minted(gh.calls).length) found.push(violation(ROUTER, 0, `${name}: minted an installation token for ${label}`));
      }
      assertRule('functions/attacker-scenarios', found);
    });
  }

  it('installation-token without an Authorization header is refused without minting', async () => {
    if (importError) throw importError;
    const gh = fakeGitHub({ installation: install() });
    vi.stubGlobal('fetch', gh.fetchImpl);
    const res = await call('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 999 } });
    const found = [];
    if (res.status < 400) found.push(violation(ROUTER, 0, `no Authorization: got ${res.status}`));
    if (minted(gh.calls).length) found.push(violation(ROUTER, 0, 'minted without an Authorization header'));
    assertRule('functions/attacker-scenarios', found);
  });

  it('the caller’s own personal installation still gets a token (no false lock-out)', async () => {
    if (importError) throw importError;
    const gh = fakeGitHub({ installation: install({ account: { id: CALLER.id, login: CALLER.login, type: 'User' } }) });
    vi.stubGlobal('fetch', gh.fetchImpl);
    const res = await call('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 999 }, headers: AUTH });
    expect(res.status, `legitimate owner was refused: ${res.status} ${await res.clone().text()}`).toBe(200);
    expect(minted(gh.calls).map((c) => c.path)).toEqual(['/app/installations/999/access_tokens']);
  });

  it('an unsigned webhook is refused when GITHUB_APP_WEBHOOK_SECRET is not configured', async () => {
    if (importError) throw importError;
    vi.stubGlobal('fetch', fakeGitHub({ installation: install() }).fetchImpl);
    const res = await call('/api/github/app/webhook', { method: 'POST', body: { action: 'created' }, headers: { 'x-github-event': 'installation' } });
    const found = res.status < 400 ? [violation(ROUTER, 0, `unsigned webhook accepted with ${res.status}`)] : [];
    assertRule('functions/attacker-scenarios', found);
  });
});
