// @vitest-environment node
//
// S-05 (callback shape), S-10 (no debug pages in public/), S-11 (_headers).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { onRequestGet } = await import('../../../functions/github/app/callback.ts');

const hit = (qs) => onRequestGet({ request: new Request(`https://redstring.io/github/app/callback${qs}`) });

describe('GET /github/app/callback', () => {
  it('forwards a well-formed install result to the SPA root', async () => {
    const res = await hit('?installation_id=1234&setup_action=install&state=AbC_d-9');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location'));
    expect(loc.origin).toBe('https://redstring.io');
    expect(loc.pathname).toBe('/');
    expect(Object.fromEntries(loc.searchParams)).toEqual({ installation_id: '1234', setup_action: 'install', state: 'AbC_d-9' });
  });

  it('drops malformed values and anything not on the list', async () => {
    const res = await hit('?installation_id=12%3Cscript%3E&setup_action=pwn&state=a%20b&code=stolen&redirect=https://evil.com');
    const loc = new URL(res.headers.get('location'));
    expect([...loc.searchParams.keys()]).toEqual([]);
  });

  it('never redirects off-origin', async () => {
    const res = await hit('?installation_id=1&state=//evil.com');
    expect(new URL(res.headers.get('location')).origin).toBe('https://redstring.io');
  });

  it('is not cacheable and sends no referrer', async () => {
    const res = await hit('?installation_id=1');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('public/ ships no debug or test pages (S-10)', () => {
  it('has no debug-viewer.html', () => {
    expect(existsSync(resolve(ROOT, 'public/debug-viewer.html'))).toBe(false);
  });

  it('has no *debug* / *test* html anywhere under public/', () => {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(resolve(dir, d.name)) : [resolve(dir, d.name)]);
    const offenders = walk(resolve(ROOT, 'public')).filter((f) => /\.html?$/i.test(f) && /(debug|test|viewer)/i.test(f));
    expect(offenders).toEqual([]);
  });
});

describe('public/_headers (S-11)', () => {
  const text = readFileSync(resolve(ROOT, 'public/_headers'), 'utf8');

  // Parse Cloudflare's format: a path line, then indented "Name: value" lines.
  const rules = {};
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = line.trim(); rules[current] = []; continue; }
    rules[current].push(line.trim());
  }
  const header = (path, name) => (rules[path] || [])
    .filter((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
    .map((l) => l.slice(name.length + 1).trim());

  it('denies framing everywhere', () => {
    expect(header('/*', 'Content-Security-Policy')).toEqual(["frame-ancestors 'none'"]);
    expect(header('/*', 'X-Frame-Options')).toEqual(['DENY']);
  });

  it('sends HSTS, nosniff, a referrer policy, COOP and a Permissions-Policy', () => {
    expect(header('/*', 'Strict-Transport-Security')[0]).toMatch(/max-age=31536000; includeSubDomains/);
    expect(header('/*', 'X-Content-Type-Options')).toEqual(['nosniff']);
    expect(header('/*', 'Referrer-Policy')).toEqual(['strict-origin-when-cross-origin']);
    expect(header('/*', 'Cross-Origin-Opener-Policy')).toEqual(['same-origin-allow-popups']);
    const pp = header('/*', 'Permissions-Policy')[0];
    for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) expect(pp).toContain(`${f}=()`);
  });

  it('does not carry the full CSP (that lives in index.html, owned by the renderer)', () => {
    expect(header('/*', 'Content-Security-Policy').join(' ')).not.toMatch(/script-src|default-src/);
  });

  it('never lets the OAuth callback leak its code in a Referer', () => {
    expect(header('/oauth/*', 'Referrer-Policy')).toEqual(['no-referrer']);
  });
});
