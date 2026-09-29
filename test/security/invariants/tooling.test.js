// @vitest-environment node
// Tests for the security tooling itself (scripts/security/*): the secret
// patterns, the audit gate's allowlist logic, the CSP checker and check-dist.
// Every fake secret here is assembled at runtime so this file never contains
// a string the scanner would flag.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { scanText, fingerprint, isBinary } from '../../../scripts/security/secret-patterns.mjs';
import { isAllowed } from '../../../scripts/security/secret-scan.mjs';
import { gate, rootAdvisories } from '../../../scripts/security/audit-gate.mjs';
import { cspProblems } from '../../../scripts/security/csp-check.mjs';
import { checkDist } from '../../../scripts/security/check-dist.mjs';

const hex = (n, c = 'a1') => c.repeat(Math.ceil(n / c.length)).slice(0, n);
const alnum = (n) => 'Zq7'.repeat(Math.ceil(n / 3)).slice(0, n);

const FAKES = {
  'openrouter-key': `sk-or-v1-${hex(64)}`,
  'anthropic-key': `sk-ant-api03-${alnum(90)}`,
  'openai-key': `sk-proj-${alnum(60)}`,
  'github-token': `ghp_${alnum(36)}`,
  'github-pat': `github_pat_${alnum(82)}`,
  'google-api-key': `AIza${alnum(35)}`,
  'aws-access-key': `AKIA${'ABCDEFGHIJKLMNOP'}`,
  'slack-token': `xoxb-${'1234567890'}-${alnum(24)}`,
  'npm-token': `npm_${alnum(36)}`,
  'private-key': `-----BEGIN ${'PRIVATE'} KEY-----\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'.repeat(2)}\n-----END PRIVATE KEY-----`,
  'oauth-client-secret': `GITHUB_CLIENT_${'SECRET'}=${hex(40, 'b1')}`,
};

describe('secret-patterns', () => {
  for (const [rule, text] of Object.entries(FAKES)) {
    it(`detects ${rule} and never prints it`, () => {
      const hits = scanText(`const x = "${text}";\n`);
      expect(hits.map((h) => h.rule)).toContain(rule);
      for (const h of hits) {
        expect(h.redacted.length).toBeLessThan(60);
        // No more than the prefix + 3 characters of the secret body survive.
        expect(text.includes(h.redacted.replace(/… .*$/, '')) || h.rule === 'private-key').toBe(true);
        const secretTail = rule === 'private-key' ? 'MIIEvQIBADAN' : text.slice(-10);
        expect(h.redacted).not.toContain(secretTail);
      }
    });
  }

  it('the JSON-escaped PEM form (\\n) is detected too', () => {
    const escaped = FAKES['private-key'].replace(/\n/g, '\\n');
    expect(scanText(`{"key":"${escaped}"}`).map((h) => h.rule)).toContain('private-key');
  });

  it('ignores placeholders and look-alikes', () => {
    const placeholders = [
      'sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'OPENROUTER_API_KEY=sk-or-v1-...', 'ghp_YOUR_TOKEN_HERE',
      `-----BEGIN ${'PRIVATE'} KEY-----\n...\n-----END PRIVATE KEY-----`, `AIza${alnum(36)}`, 'client_secret: process.env.GITHUB_CLIENT_SECRET',
      `GITHUB_CLIENT_${'SECRET'}=your_client_secret_here`, 'sk-ant-...',
    ];
    for (const p of placeholders) expect(scanText(p), p).toEqual([]);
  });

  it('fingerprints are stable, short and not the secret', () => {
    const fp = fingerprint(FAKES['openrouter-key']);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint(FAKES['openrouter-key'])).toBe(fp);
  });

  it('flags binary buffers', () => {
    expect(isBinary(Buffer.from([0x89, 0x50, 0x00, 0x01]))).toBe(true);
    expect(isBinary(Buffer.from('plain text'))).toBe(false);
  });
});

describe('secret-scan allowlist matching', () => {
  const hit = { rule: 'google-api-key', path: 'test/fixtures/keys.json', fingerprint: 'abcdef0123456789' };
  it('matches by fingerprint, or by path glob + rule', async () => {
    const picomatch = (await import('picomatch')).default;
    expect(isAllowed(hit, [{ fingerprint: 'abcdef0123456789', match: null }])).toBe(true);
    expect(isAllowed(hit, [{ match: picomatch('test/fixtures/**'), rule: 'google-api-key' }])).toBe(true);
    expect(isAllowed(hit, [{ match: picomatch('test/fixtures/**'), rule: 'openrouter-key' }])).toBe(false);
    expect(isAllowed(hit, [{ match: picomatch('src/**') }])).toBe(false);
  });
});

describe('audit-gate', () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      xlsx: { name: 'xlsx', severity: 'high', isDirect: true, via: [{ source: 1, name: 'xlsx', title: 'Prototype Pollution', url: 'https://github.com/advisories/GHSA-4r6h-8v6p-xvw6', severity: 'high', range: '<0.19.3' }], effects: [], fixAvailable: false },
      hono: { name: 'hono', severity: 'high', isDirect: true, via: [{ source: 2, name: 'hono', title: 'CORS', url: 'https://github.com/advisories/GHSA-88fw-hqm2-52qc', severity: 'high', range: '<4.12.25' }], effects: [], fixAvailable: true },
      inner: { name: 'inner', severity: 'critical', isDirect: false, via: [{ source: 3, name: 'inner', title: 'RCE', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'critical', range: '<2' }], effects: ['outer'], fixAvailable: true },
      outer: { name: 'outer', severity: 'critical', isDirect: true, via: ['inner'], effects: [], fixAvailable: true },
      meh: { name: 'meh', severity: 'moderate', isDirect: true, via: [{ source: 4, name: 'meh', title: 'x', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff', severity: 'moderate' }], effects: [] },
    },
  };
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const past = '2020-01-01';

  it('reports only high/critical root advisories, with the direct dependency that pulls each in', () => {
    const roots = rootAdvisories(report);
    expect(roots.map((r) => r.package).sort()).toEqual(['hono', 'inner', 'xlsx']);
    expect(roots.find((r) => r.package === 'inner').pulledInBy).toEqual(['outer']);
  });

  it('fails without an allowlist, passes when each advisory is allowlisted', () => {
    expect(gate(report, { active: [], expired: [], errors: [] }).failing).toHaveLength(3);
    const allow = { active: [
      { package: 'xlsx', advisories: ['GHSA-4r6h-8v6p-xvw6'], reason: 'r', expires: future },
      { package: 'hono', reason: 'r', expires: future },
      { package: 'inner', reason: 'r', expires: future },
    ], expired: [], errors: [] };
    const r = gate(report, allow);
    expect(r.failing).toEqual([]);
    expect(r.allowed).toHaveLength(3);
  });

  it('an advisory-specific entry does not cover other advisories of the package', () => {
    const r = gate(report, { active: [{ package: 'xlsx', advisories: ['GHSA-zzzz-zzzz-zzzz'], reason: 'r', expires: future }], expired: [], errors: [] });
    expect(r.failing.map((a) => a.package)).toContain('xlsx');
    expect(r.unused).toHaveLength(1);
  });

  it('loadAllowlist moves expired entries out and validates fields', async () => {
    const { loadAllowlist } = await import('../../../scripts/security/audit-gate.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-audit-'));
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, JSON.stringify({ entries: [
      { package: 'xlsx', reason: 'only parses files the user picked locally', expires: past },
      { package: 'hono', reason: 'short', expires: future },
      { package: 'x', reason: 'a long enough reason for the entry', expires: 'someday' },
    ] }));
    const r = loadAllowlist(file);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.expired.map((e) => e.package)).toEqual(['xlsx']);
    expect(r.errors.join('\n')).toMatch(/hono.*reason/);
    expect(r.errors.join('\n')).toMatch(/x\).*expires/);
  });
});

describe('csp-check', () => {
  // The C-8 baseline from the hardening plan must pass as written.
  const BASELINE = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' https: http: data: blob:; media-src 'self' https: blob: data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self' https://github.com; frame-src 'none'";
  const page = (policy, body = '<script type="module" src="/src/main.jsx"></script>') =>
    `<!doctype html><html><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${policy}" /></head><body>${body}</body></html>`;

  it('accepts the C-8 baseline', () => {
    expect(cspProblems(page(BASELINE))).toEqual([]);
  });

  it("rejects 'unsafe-eval' / 'unsafe-inline' in script-src, a missing meta, and inline scripts", () => {
    expect(cspProblems(page(BASELINE.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")))).toContain("script-src allows 'unsafe-eval'");
    expect(cspProblems(page(BASELINE.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")))).toContain("script-src allows 'unsafe-inline'");
    expect(cspProblems('<html><head></head></html>')[0]).toMatch(/no <meta/);
    expect(cspProblems(page(BASELINE, '<script>alert(1)</script>')).join()).toMatch(/inline <script>/);
    expect(cspProblems(page(BASELINE.replace("object-src 'none'; ", '')))).toContain("object-src is not 'none'");
  });
});

describe('check-dist', () => {
  const dirs = [];
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const HEADERS = "/*\n  Content-Security-Policy: frame-ancestors 'none'\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  X-Content-Type-Options: nosniff\n";
  const INDEX = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'" /></head><body><script type="module" src="./assets/index.js"></script></body></html>`;
  function makeDist(extra = {}) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-dist-'));
    dirs.push(d);
    fs.mkdirSync(path.join(d, 'assets'));
    const files = { 'index.html': INDEX, _headers: HEADERS, 'assets/index.js': 'console.log(1)', ...extra };
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c);
    return d;
  }

  it('passes a clean build', async () => {
    expect((await checkDist(makeDist())).problems).toEqual([]);
  });

  it('flags a bundled key, a debug page, the debug-log endpoint and a missing CSP', async () => {
    const d = makeDist({
      'assets/leak.js': `const k = "${FAKES['openrouter-key']}";`,
      'debug-viewer.html': '<html></html>',
      'assets/log.js': "fetch('http://127.0.0.1:7242/ingest')",
      'index.html': '<!doctype html><html><head></head></html>',
    });
    const { problems } = await checkDist(d);
    const text = problems.join('\n');
    expect(text).toMatch(/assets\/leak\.js:1: OpenRouter API key sk-or-v1-a1a…/);
    expect(text).not.toContain(FAKES['openrouter-key']);
    expect(text).toMatch(/debug-viewer\.html: forbidden/);
    expect(text).toMatch(/:7242/);
    expect(text).toMatch(/index\.html: CSP: no <meta/);
  });
});
