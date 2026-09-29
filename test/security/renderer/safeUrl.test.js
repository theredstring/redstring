/**
 * S-40 / S-46 — C-1 contract: safeExternalHref, safeImageSrc, openExternalUrl.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeExternalHref, safeImageSrc, openExternalUrl, hostMatches, cssImageUrl } from '../../../src/utils/safeUrl.js';

const UNSAFE_HREFS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '\x01javascript:alert(1)',
  '\x00javascript:alert(1)',
  'java\nscript:alert(1)',
  'java\tscript:alert(1)',
  'java\rscript:alert(1)',
  '  javascript:alert(1)',
  ' \u0009javascript:alert(1)',
  'javascript:alert(1)//wikidata.org',
  'javascript://wikidata.org/%0aalert(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'DATA:image/svg+xml,<svg onload=alert(1)>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'smb://attacker/share',
  'blob:https://redstring.io/5a0e',
  'ftp://example.com/x',
  'redstring://open?x',
  'about:blank',
  'chrome://settings',
  'ms-settings:',
  'intent://scan/#Intent;scheme=zxing;end',
  '//evil.com/x',
  '/relative/path',
  'wikidata.org/wiki/Q1',
  '',
  '   ',
  null,
  undefined,
  42,
  {},
  { toString: () => 'javascript:alert(1)' },
  ['https://example.com'],
  'https://' + 'a'.repeat(9000) + '.com',
];

describe('safeExternalHref', () => {
  it.each(UNSAFE_HREFS.map(v => [JSON.stringify(String(v)).slice(0, 60), v]))('rejects %s', (_label, value) => {
    expect(safeExternalHref(value)).toBeNull();
  });

  it.each([
    ['https://www.wikidata.org/wiki/Q42', 'https://www.wikidata.org/wiki/Q42'],
    ['http://example.com', 'http://example.com/'],
    ['HTTPS://EXAMPLE.COM/A', 'https://example.com/A'],
    ['  https://example.com/x  ', 'https://example.com/x'],
    ['mailto:someone@example.com', 'mailto:someone@example.com'],
    ['https://en.wikipedia.org/wiki/Caf%C3%A9', 'https://en.wikipedia.org/wiki/Caf%C3%A9'],
  ])('accepts %s', (value, expected) => {
    expect(safeExternalHref(value)).toBe(expected);
  });

  it('never returns a string whose scheme is not http(s)/mailto', () => {
    for (const v of [...UNSAFE_HREFS, 'https:evil.com', 'HTTP:\\\\x']) {
      const out = safeExternalHref(v);
      if (out) expect(/^(https?:\/\/|mailto:)/.test(out)).toBe(true);
    }
  });
});

describe('safeImageSrc', () => {
  it.each([
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/x.jpg/500px-x.jpg',
    'http://example.com/a.png',
    'blob:https://redstring.io/0f0e0d0c-aaaa-bbbb-cccc-000000000000',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/4AAQ',
    'data:image/jpg;base64,/9j/4AAQ',
    'DATA:IMAGE/PNG;base64,iVBORw0KGgo=',
    'data:image/gif;base64,R0lGODlh',
    'data:image/webp;base64,UklGR',
    'data:image/avif;base64,AAAA',
  ])('accepts %s', (value) => {
    expect(safeImageSrc(value)).toBeTruthy();
  });

  it('returns data URLs untouched (no copy/normalisation of big payloads)', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(200000);
    expect(safeImageSrc(big)).toBe(big);
  });

  it.each([
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'data:text/html,<script>alert(1)</script>',
    'data:image/png,raw',
    'data:application/octet-stream;base64,AAAA',
    ' \x01data:text/html,<script>',
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    'file:///Users/x/secret.png',
    'smb://host/share/x.png',
    'redstring://x',
    '/assets/x.png',
    '',
    null,
    undefined,
    7,
  ])('rejects %s', (value) => {
    expect(safeImageSrc(value)).toBeNull();
  });
});

describe('openExternalUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens safe URLs with noopener,noreferrer', () => {
    const spy = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(openExternalUrl('https://example.com/a')).toBe(true);
    expect(spy).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
  });

  it('refuses unsafe URLs without calling window.open', () => {
    const spy = vi.spyOn(window, 'open').mockImplementation(() => null);
    for (const v of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', ' java\tscript:1', null]) {
      expect(openExternalUrl(v)).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('cssImageUrl', () => {
  it('quotes a safe image URL', () => {
    expect(cssImageUrl('https://x.example/a.png')).toBe('url("https://x.example/a.png")');
  });

  it('refuses unsafe sources', () => {
    expect(cssImageUrl('javascript:alert(1)')).toBeNull();
    expect(cssImageUrl('data:image/svg+xml,<svg>')).toBeNull();
  });

  it('cannot be broken out of', () => {
    const out = cssImageUrl('data:image/png;base64,AAAA"),url(https://evil.example/x');
    // Everything after url(" up to the final ") is one quoted string.
    const inner = out.slice('url("'.length, -'")'.length);
    expect(inner).not.toMatch(/(^|[^\\])"/);
  });
});

describe('hostMatches', () => {
  it.each([
    ['wikidata.org', 'wikidata.org', true],
    ['www.wikidata.org', 'wikidata.org', true],
    ['WWW.WikiData.org', 'wikidata.org', true],
    ['wikidata.org.', 'wikidata.org', true],
    ['evilwikidata.org', 'wikidata.org', false],
    ['wikidata.org.evil.com', 'wikidata.org', false],
    ['', 'wikidata.org', false],
    [null, 'wikidata.org', false],
  ])('%s vs %s → %s', (h, d, want) => {
    expect(hostMatches(h, d)).toBe(want);
  });
});
