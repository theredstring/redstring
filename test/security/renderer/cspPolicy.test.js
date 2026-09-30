/**
 * S-41 — the CSP meta tag in index.html: present, first in <head> after the
 * charset (so it governs everything the page loads), and strict on scripts.
 * The browser-level check is csp.e2e.spec.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, '../../../index.html'), 'utf8');

const policyOf = (source) => {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const metas = [...doc.querySelectorAll('meta[http-equiv]')]
    .filter((m) => m.getAttribute('http-equiv').toLowerCase() === 'content-security-policy');
  return { metas, doc };
};

const directives = (content) => Object.fromEntries(
  content.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name.toLowerCase(), values];
  })
);

describe('index.html Content-Security-Policy', () => {
  const { metas, doc } = policyOf(html);
  const policy = metas.length ? directives(metas[0].getAttribute('content')) : {};

  it('has exactly one CSP meta tag', () => {
    expect(metas).toHaveLength(1);
  });

  it('comes before any script, stylesheet or icon in <head>', () => {
    const headChildren = [...doc.head.children];
    const cspIndex = headChildren.indexOf(metas[0]);
    const firstLoad = headChildren.findIndex((el) => ['SCRIPT', 'LINK', 'STYLE'].includes(el.tagName));
    expect(cspIndex).toBeGreaterThanOrEqual(0);
    expect(firstLoad === -1 || cspIndex < firstLoad).toBe(true);
  });

  it('script-src allows no inline code and no eval', () => {
    const script = policy['script-src'];
    expect(script).toBeTruthy();
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain('data:');
    expect(script).not.toContain('blob:');
    expect(script).not.toContain('*');
    expect(script.some((s) => /^https?:/.test(s))).toBe(false);
  });

  it('locks down the rest of the high-risk directives', () => {
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['frame-src']).toEqual(["'none'"]);
    expect(policy['worker-src']).not.toContain('*');
    expect(policy['connect-src']).not.toContain('*');
    expect(policy['form-action']).toBeTruthy();
  });

  it('has no inline scripts for the policy to have to allow', () => {
    const inline = [...doc.querySelectorAll('script')].filter((s) => !s.getAttribute('src'));
    expect(inline).toHaveLength(0);
  });
});
