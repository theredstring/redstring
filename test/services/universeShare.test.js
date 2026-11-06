import { describe, it, expect, vi, afterEach } from 'vitest';
import { sharedLinkForUniverse, repoAudience } from '../../src/services/universeShare.js';

afterEach(() => vi.unstubAllGlobals());

const inRepo = (gitRepo = {}) => ({
  slug: 'atlas',
  raw: { gitRepo: { linkedRepo: { type: 'github', user: 'grant', repo: 'maps' }, ...gitRepo } },
});

describe('sharedLinkForUniverse', () => {
  it('points at the file the sync engine writes', () => {
    expect(sharedLinkForUniverse(inRepo())).toBe('https://redstring.io/open?gh=grant/maps/main/universes/atlas/atlas.redstring');
    expect(sharedLinkForUniverse(inRepo({ universeFolder: 'world', universeFile: 'Big Map.redstring', branch: 'trunk' })))
      .toBe('https://redstring.io/open?gh=grant/maps/trunk/universes/world/Big-Map.redstring');
  });

  it('has nothing to offer without a GitHub repository', () => {
    expect(sharedLinkForUniverse({ slug: 'atlas', raw: { gitRepo: {} } })).toBe(null);
    expect(sharedLinkForUniverse(null)).toBe(null);
    expect(sharedLinkForUniverse(inRepo({ linkedRepo: { type: 'gitea', user: 'g', repo: 'r' } }))).toBe(null);
  });

  it('passes on the link a read-only universe came from', () => {
    expect(sharedLinkForUniverse({ slug: 'v', raw: { readOnly: { sourceUrl: 'https://x.example/f.redstring' } } }))
      .toBe(`https://redstring.io/open?url=${encodeURIComponent('https://x.example/f.redstring')}`);
  });
});

describe('repoAudience', () => {
  const answers = (response) => vi.stubGlobal('fetch', vi.fn(async () => response));

  it('reads what the repository says, without sending a token', async () => {
    answers(new Response(JSON.stringify({ private: false }), { status: 200 }));
    expect(await repoAudience({ user: 'g', repo: 'r' })).toBe('anyone');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    answers(new Response(JSON.stringify({ private: true }), { status: 200 }));
    expect(await repoAudience({ user: 'g', repo: 'r' })).toBe('repo');
  });

  it('a repository hidden from the public is private to its people', async () => {
    answers(new Response('', { status: 404 }));
    expect(await repoAudience({ user: 'g', repo: 'r' })).toBe('repo');
  });

  it('never claims more than it knows', async () => {
    answers(new Response('', { status: 403 }));
    expect(await repoAudience({ user: 'g', repo: 'r' })).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await repoAudience({ user: 'g', repo: 'r' })).toBe('unknown');
  });
});
