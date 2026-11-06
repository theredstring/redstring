import { describe, it, expect } from 'vitest';
import {
  parseSharedLink, buildSharedLink, buildAppLink, normalizeSourceUrl, unwrapSharedLink
} from '../../src/services/sharedLink.js';

const RAW = 'https://raw.githubusercontent.com/grant/atlas/main/universes/my%20web/my%20web.redstring';

describe('shared links', () => {
  it('turns a GitHub file into a readable link and back', () => {
    const link = buildSharedLink('https://github.com/grant/atlas/blob/main/universes/foo/foo.redstring');
    expect(link).toBe('https://redstring.io/open?gh=grant/atlas/main/universes/foo/foo.redstring');
    expect(parseSharedLink(link)).toBe('https://raw.githubusercontent.com/grant/atlas/main/universes/foo/foo.redstring');
  });

  it('survives spaces and pluses in a path', () => {
    const link = buildSharedLink(RAW);
    expect(link).toContain('my%20web');
    expect(parseSharedLink(link)).toBe(RAW);
    const plus = 'https://raw.githubusercontent.com/g/a/main/c%2B%2B.redstring';
    expect(parseSharedLink(buildSharedLink(plus))).toBe(plus);
  });

  it('carries any direct https file', () => {
    const source = 'https://dav.example.com/share/foo.redstring?v=2';
    const link = buildSharedLink(source);
    expect(link).toBe(`https://redstring.io/open?url=${encodeURIComponent(source)}`);
    expect(parseSharedLink(link)).toBe(source);
  });

  it('gives the app the same link', () => {
    const app = buildAppLink('https://dav.example.com/foo.redstring');
    expect(app.startsWith('redstring://open?url=')).toBe(true);
    expect(parseSharedLink(app)).toBe('https://dav.example.com/foo.redstring');
  });

  it('never passes on a private raw link token', () => {
    const copied = 'https://raw.githubusercontent.com/g/a/main/f.redstring?token=SECRET';
    expect(normalizeSourceUrl(copied)).not.toContain('SECRET');
    expect(buildSharedLink(copied)).not.toContain('SECRET');
    expect(parseSharedLink(`https://redstring.io/open?url=${encodeURIComponent(copied)}`)).not.toContain('SECRET');
  });

  it.each([
    'http://dav.example.com/foo.redstring',
    'https://example.com/not-a-universe.png',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://github.com/g/a',
  ])('refuses %s as a source', (source) => {
    expect(parseSharedLink(`https://redstring.io/open?url=${encodeURIComponent(source)}`)).toBe(null);
  });

  it.each([
    'a/b',
    'a/b/c',
    'a/../../evil/f.redstring',
    'a/b/c/../f.redstring',
    'a//c/f.redstring',
    'a/b/c/not-a-universe.txt',
  ])('refuses gh=%s', (gh) => {
    expect(parseSharedLink(`https://redstring.io/open?gh=${gh}`)).toBe(null);
  });

  it('only reads links from Redstring, except for the page\'s own address', () => {
    const query = 'open?url=https%3A%2F%2Fexample.com%2Ff.redstring';
    expect(parseSharedLink(`https://evil.example/${query}`)).toBe(null);
    expect(parseSharedLink(`http://redstring.io/${query}`)).toBe(null);
    expect(parseSharedLink(`https://redstring.io/other?url=x`)).toBe(null);
    expect(parseSharedLink(`http://localhost:4001/${query}`, { anyHost: true })).toBe('https://example.com/f.redstring');
    expect(parseSharedLink('redstring://auth?url=https%3A%2F%2Fexample.com%2Ff.redstring')).toBe(null);
    expect(parseSharedLink('not a url')).toBe(null);
  });

  it('lets the link box take a shared link', () => {
    expect(unwrapSharedLink('  https://redstring.io/open?gh=g/a/main/f.redstring ')).toBe('https://raw.githubusercontent.com/g/a/main/f.redstring');
    expect(unwrapSharedLink('https://github.com/g/a')).toBe('https://github.com/g/a');
  });
});
