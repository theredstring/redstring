// @vitest-environment node
// The shared security contracts (C-1 … C-9 in documentation/security/HARDENING_PLAN.md),
// imported from their contract paths and checked against the specified
// behaviour. The area test suites go deeper; these are the independent,
// minimum guarantees every other invariant relies on. A missing module fails
// with the contract it belongs to.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, exists, parseFile, walk, stringValue, violation, assertRule } from './_lib/scan.js';

const require = createRequire(import.meta.url);

async function load(rel, contract) {
  if (!exists(rel)) {
    throw new Error(`[contracts/present] ${contract}: ${rel} does not exist. It is created by the area that owns ${contract} `
      + '(see "Shared contracts" in documentation/security/HARDENING_PLAN.md); every related invariant depends on it.');
  }
  return rel.endsWith('.cjs') ? require(path.join(ROOT, rel)) : import(pathToFileURL(path.join(ROOT, rel)).href);
}

function expectFn(mod, name, contract, rel) {
  expect(typeof mod[name], `${contract}: ${rel} must export function ${name}()`).toBe('function');
}

// Payloads are assembled at runtime so no file holds a live-looking string.
const JS = ['java', 'script:'].join('');
const UNSAFE_URLS = [
  `${JS}alert(1)`, 'JaVaScRiPt:alert(1)', `  ${JS}alert(1)`, `\x01${JS}alert(1)`, 'java\tscript:alert(1)', 'java\nscript:alert(1)',
  `${JS}alert(1)//https://wikidata.org`, 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
  'file:///etc/passwd', 'smb://evil.example/share', 'blob:https://redstring.io/x', 'redstring://callback', 'ms-settings:', '', '   ', null, undefined, 42, {},
];

describe('contract C-1: src/utils/safeUrl.js', () => {
  const rel = 'src/utils/safeUrl.js';

  it('safeExternalHref allows only http(s) and mailto', async () => {
    const mod = await load(rel, 'C-1');
    expectFn(mod, 'safeExternalHref', 'C-1', rel);
    for (const bad of UNSAFE_URLS) expect(mod.safeExternalHref(bad), `safeExternalHref(${JSON.stringify(bad)})`).toBeNull();
    expect(mod.safeExternalHref('https://www.wikidata.org/wiki/Q42')).toMatch(/^https:\/\/www\.wikidata\.org\/wiki\/Q42/);
    expect(mod.safeExternalHref('http://example.com')).toMatch(/^http:\/\/example\.com/);
    expect(mod.safeExternalHref('mailto:info@redstring.io')).toMatch(/^mailto:info@redstring\.io/);
  });

  it('safeImageSrc allows https/http/blob and raster data: images, never SVG data URLs', async () => {
    const mod = await load(rel, 'C-1');
    expectFn(mod, 'safeImageSrc', 'C-1', rel);
    expect(mod.safeImageSrc('https://upload.wikimedia.org/a.png')).toBeTruthy();
    expect(mod.safeImageSrc('blob:https://redstring.io/0b3c')).toBeTruthy();
    expect(mod.safeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBeTruthy();
    for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html,<b>x</b>', `${JS}alert(1)`, 'file:///x.png', null]) {
      expect(mod.safeImageSrc(bad), `safeImageSrc(${JSON.stringify(bad)})`).toBeNull();
    }
  });

  it('openExternalUrl refuses unsafe URLs and opens safe ones with noopener', async () => {
    const mod = await load(rel, 'C-1');
    expectFn(mod, 'openExternalUrl', 'C-1', rel);
    const calls = [];
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prev = globalThis.window;
    globalThis.window = { open: (...a) => { calls.push(a); return null; } };
    try {
      expect(mod.openExternalUrl(`${JS}alert(1)`)).toBeFalsy();
      expect(calls).toHaveLength(0);
      mod.openExternalUrl('https://redstring.io/');
      expect(calls).toHaveLength(1);
      expect(String(calls[0][0])).toMatch(/^https:\/\/redstring\.io/);
      expect(calls[0][1]).toBe('_blank');
      expect(String(calls[0][2])).toMatch(/noopener/);
    } finally {
      if (had) globalThis.window = prev; else delete globalThis.window;
    }
  });
});

describe('contract C-2: src/utils/safeColor.js', () => {
  const rel = 'src/utils/safeColor.js';
  const GOOD = ['#fff', '#FFFA', '#8b0000', '#8B0000CC', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(120, 50%, 50%)', 'hsla(120,50%,50%,0.3)', 'maroon', 'white'];
  const BAD = [
    'red);background:url(https://x)', 'url(https://x)', 'expression(alert(1))', 'var(--x)', '#fff;}', '#fff; color: red',
    '"red"', "'red'", 'red\\', 'rgb(1,2,3);color:red', '}body{background:red', 'attr(x)', 'calc(1px)', '', null, undefined, 7,
  ];

  it('sanitizeColor accepts plain colours and rejects CSS injection', async () => {
    const mod = await load(rel, 'C-2');
    expectFn(mod, 'sanitizeColor', 'C-2', rel);
    const FALLBACK = '#000001';
    for (const c of GOOD) {
      const out = mod.sanitizeColor(c, FALLBACK);
      expect(typeof out === 'string' && out !== FALLBACK, `sanitizeColor(${JSON.stringify(c)}) should be accepted`).toBe(true);
    }
    for (const c of BAD) expect(mod.sanitizeColor(c, FALLBACK), `sanitizeColor(${JSON.stringify(c)})`).toBe(FALLBACK);
    expect(mod.sanitizeColor('url(x)')).toBeNull();
  });
});

describe('contract C-3: electron/ipcGuards.cjs', () => {
  const rel = 'electron/ipcGuards.cjs';
  const tmp = [];
  afterAll(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it('isValidStoreName and isSafeExternalUrl', async () => {
    const mod = await load(rel, 'C-3');
    expectFn(mod, 'isValidStoreName', 'C-3', rel);
    expectFn(mod, 'isSafeExternalUrl', 'C-3', rel);
    for (const ok of ['fileHandles', 'a-b_C9', 'x'.repeat(64)]) expect(mod.isValidStoreName(ok), ok).toBe(true);
    for (const bad of ['', '../secrets', 'a/b', 'a\\b', 'x.json', 'x'.repeat(65), ' fileHandles', null, 5]) expect(mod.isValidStoreName(bad), String(bad)).toBe(false);
    for (const ok of ['https://github.com/', 'http://example.com', 'mailto:a@b.c']) expect(mod.isSafeExternalUrl(ok), ok).toBe(true);
    for (const bad of UNSAFE_URLS) expect(mod.isSafeExternalUrl(bad), JSON.stringify(bad)).toBe(false);
  });

  it('isTrustedSender accepts only the app origin', async () => {
    const mod = await load(rel, 'C-3');
    expectFn(mod, 'isTrustedSender', 'C-3', rel);
    expect(mod.isTrustedSender({ senderFrame: { url: 'app://redstring/index.html' } })).toBe(true);
    expect(mod.isTrustedSender({ senderFrame: { url: 'https://evil.example/' } })).toBe(false);
    expect(mod.isTrustedSender({ senderFrame: { url: 'file:///Users/x/evil.html' } })).toBe(false);
    expect(mod.isTrustedSender({ senderFrame: null })).toBe(false);
    expect(mod.isTrustedSender({})).toBe(false);
  });

  it('createPathApprovals approves only through approve() and persists', async () => {
    const mod = await load(rel, 'C-3');
    expectFn(mod, 'createPathApprovals', 'C-3', rel);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-approvals-'));
    tmp.push(dir);
    const persistPath = path.join(dir, 'approvals.json');
    const target = path.join(dir, 'universe.redstring');
    const a = mod.createPathApprovals({ persistPath });
    await a.load?.();
    expect(await a.isApproved(target)).toBe(false);
    await a.approve(target);
    expect(await a.isApproved(target)).toBe(true);
    expect(await a.isApproved(path.join(dir, 'other.redstring'))).toBe(false);
    await a.save?.();
    const b = mod.createPathApprovals({ persistPath });
    await b.load();
    expect(await b.isApproved(target)).toBe(true);
  });
});

describe('contract C-4: electron/updaterSignature.cjs', () => {
  it('exports verifyBundleSignature', async () => {
    const rel = 'electron/updaterSignature.cjs';
    const mod = await load(rel, 'C-4');
    expectFn(mod, 'verifyBundleSignature', 'C-4', rel);
  });
});

// ── C-6: local server guard, exercised over real HTTP ────────────────────

function request(port, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/probe', method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('contract C-6: src/security/localServerGuard.js', () => {
  it('enforces token, Host, Origin and JSON content type', async () => {
    const rel = 'src/security/localServerGuard.js';
    const mod = await load(rel, 'C-6');
    expectFn(mod, 'createLocalServerGuard', 'C-6', rel);
    const { default: express } = await import('express');
    const token = 'a'.repeat(64);
    const app = express();
    let guard = null;
    app.use((req, res, next) => guard(req, res, next));
    app.all('/api/probe', (_req, res) => res.status(200).json({ ok: true }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const { port } = server.address();
    guard = mod.createLocalServerGuard({ token, port });
    const host = `127.0.0.1:${port}`;
    try {
      const results = {
        'no token': await request(port, { headers: { host } }),
        'wrong token': await request(port, { headers: { host, 'x-redstring-token': 'b'.repeat(64) } }),
        'foreign Host (DNS rebinding)': await request(port, { headers: { host: `evil.example:${port}`, 'x-redstring-token': token } }),
        'foreign Origin': await request(port, { headers: { host, origin: 'https://evil.example', 'x-redstring-token': token } }),
        'Origin: null': await request(port, { headers: { host, origin: 'null', 'x-redstring-token': token } }),
        'text/plain POST': await request(port, { method: 'POST', headers: { host, 'content-type': 'text/plain', 'x-redstring-token': token }, body: '{}' }),
        'valid token': await request(port, { headers: { host, 'x-redstring-token': token } }),
        'valid Bearer': await request(port, { headers: { host, authorization: `Bearer ${token}` } }),
        'valid, app:// origin': await request(port, { headers: { host, origin: 'app://redstring', 'x-redstring-token': token } }),
        'valid JSON POST via localhost': await request(port, { method: 'POST', headers: { host: `localhost:${port}`, 'content-type': 'application/json', 'x-redstring-token': token }, body: '{}' }),
      };
      expect(results).toMatchObject({
        'no token': 401,
        'wrong token': 401,
        'foreign Host (DNS rebinding)': 403,
        'foreign Origin': 403,
        'Origin: null': 403,
        'valid token': 200,
        'valid Bearer': 200,
        'valid, app:// origin': 200,
        'valid JSON POST via localhost': 200,
      });
      expect([403, 415]).toContain(results['text/plain POST']);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// ── C-6 / C-7: preload surface ───────────────────────────────────────────

describe('contracts C-6/C-7: electron/preload.cjs surface', () => {
  it('exposes agent.getConnection and secrets.{isAvailable,get,set,delete}', () => {
    const rel = 'electron/preload.cjs';
    const r = parseFile(rel);
    let exposed = null;
    walk(r.ast, (n) => {
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'exposeInMainWorld'
        && stringValue(n.arguments[0]) === 'electron' && n.arguments[1]?.type === 'ObjectExpression') exposed = n.arguments[1];
    });
    const keysOf = (obj) => new Map((obj?.properties || []).filter((p) => p.type === 'ObjectProperty' || p.type === 'ObjectMethod')
      .map((p) => [p.key.name ?? p.key.value, p.value ?? p]));
    const top = keysOf(exposed);
    const found = [];
    const agent = keysOf(top.get('agent'));
    if (!agent.has('getConnection')) found.push(violation(rel, 0, 'window.electron.agent.getConnection() is not exposed (C-6)'));
    const secrets = keysOf(top.get('secrets'));
    for (const k of ['isAvailable', 'get', 'set', 'delete']) {
      if (!secrets.has(k)) found.push(violation(rel, 0, `window.electron.secrets.${k}() is not exposed (C-7)`));
    }
    assertRule('contracts/present', found);
  });
});

describe('contract C-9: functions/_lib/ownership.ts', () => {
  it('exports verifyInstallOwnership', async () => {
    const rel = 'functions/_lib/ownership.ts';
    const mod = await load(rel, 'C-9');
    expectFn(mod, 'verifyInstallOwnership', 'C-9', rel);
  });
});
