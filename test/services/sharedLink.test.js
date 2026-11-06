import { describe, it, expect, vi } from 'vitest';
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

  describe('Dropbox', () => {
    const FILE = 'https://dl.dropboxusercontent.com/scl/fi/abc123/my%20map.redstring?rlkey=key456';
    const COPIED = 'https://www.dropbox.com/scl/fi/abc123/my%20map.redstring?rlkey=key456&st=3099g7vb&dl=0';

    it('takes what Copy link gives, and reads from where the app is allowed to', () => {
      expect(normalizeSourceUrl(COPIED)).toBe(FILE);
    });

    it.each([
      ['another copy of it', 'https://www.dropbox.com/scl/fi/abc123/my%20map.redstring?rlkey=key456&st=viaxk8w4&dl=0'],
      ['a download link', 'https://www.dropbox.com/scl/fi/abc123/my%20map.redstring?rlkey=key456&dl=1'],
      ['the bare domain', 'https://dropbox.com/scl/fi/abc123/my%20map.redstring?rlkey=key456'],
      ['the download host already', `${FILE}&st=viaxk8w4&dl=0`],
    ])('comes to the same file from %s', (_, url) => {
      expect(normalizeSourceUrl(url)).toBe(FILE);
    });

    it('shares a link that holds only what it needs', () => {
      const link = buildSharedLink(COPIED);
      expect(link).not.toContain('st%3D');
      expect(link).not.toContain('dl%3D');
      expect(parseSharedLink(link)).toBe(FILE);
    });

    it('is found inside a pasted or followed Redstring link', () => {
      expect(parseSharedLink(`https://redstring.io/open?url=${encodeURIComponent(COPIED)}`)).toBe(FILE);
    });

    it('leaves a link with no key as it is, for Dropbox to refuse', () => {
      expect(normalizeSourceUrl('https://www.dropbox.com/scl/fi/abc123/f.redstring')).toBe('https://dl.dropboxusercontent.com/scl/fi/abc123/f.redstring');
    });

    it('still only takes universe files', () => {
      expect(normalizeSourceUrl('https://www.dropbox.com/scl/fi/abc123/photo.png?rlkey=k&dl=0')).toBe(null);
      expect(normalizeSourceUrl('https://www.dropbox.com/scl/fo/abc123/folder?rlkey=k&dl=0')).toBe(null);
    });

    it('leaves other hosts alone', () => {
      expect(normalizeSourceUrl('https://dropbox.com.evil.example/f.redstring?rlkey=k&dl=0')).toBe('https://dropbox.com.evil.example/f.redstring?rlkey=k&dl=0');
    });
  });

  it('gives the app the same link', () => {
    const app = buildAppLink('https://dav.example.com/foo.redstring');
    expect(app.startsWith('redstring://open?url=')).toBe(true);
    expect(parseSharedLink(app)).toBe('https://dav.example.com/foo.redstring');
  });

  it('sends staging\'s Open in App to the dev app, and nothing else\'s', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'redstring-staging.pages.dev', origin: 'https://redstring-staging.pages.dev' } });
    const fromStaging = buildAppLink('https://dav.example.com/foo.redstring');
    expect(fromStaging.startsWith('redstring-dev://open?url=')).toBe(true);
    expect(parseSharedLink(fromStaging)).toBe('https://dav.example.com/foo.redstring');
    expect(parseSharedLink('redstring-dev://auth?url=https%3A%2F%2Fexample.com%2Ff.redstring')).toBe(null);
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'redstring.io', origin: 'https://redstring.io' } });
    expect(buildAppLink('https://dav.example.com/foo.redstring').startsWith('redstring://open?url=')).toBe(true);
    vi.unstubAllGlobals();
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

  it('reads and writes links on staging, so they can be tried there', () => {
    const staging = 'https://redstring-staging.pages.dev/open?gh=g/a/main/f.redstring';
    expect(parseSharedLink(staging)).toBe('https://raw.githubusercontent.com/g/a/main/f.redstring');
    vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'redstring-staging.pages.dev', origin: 'https://redstring-staging.pages.dev' } });
    expect(buildSharedLink('https://raw.githubusercontent.com/g/a/main/f.redstring')).toBe(staging);
    vi.unstubAllGlobals();
  });

  it('lets the link box take a shared link', () => {
    expect(unwrapSharedLink('  https://redstring.io/open?gh=g/a/main/f.redstring ')).toBe('https://raw.githubusercontent.com/g/a/main/f.redstring');
    expect(unwrapSharedLink('https://github.com/g/a')).toBe('https://github.com/g/a');
  });
});
