import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSharedUniverse, describeSharedLinkFailure } from '../../src/services/externalUniverseLoader.js';

const RAW = 'https://raw.githubusercontent.com/g/secret/main/f.redstring';
const json = (status, body = '{"a":1}') => new Response(status === 200 ? body : 'nope', { status });

afterEach(() => vi.unstubAllGlobals());

describe('fetchSharedUniverse', () => {
  it('reads a public file without asking for a token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200)));
    const getToken = vi.fn();
    expect(await fetchSharedUniverse(RAW, { getToken })).toEqual({ a: 1 });
    expect(getToken).not.toHaveBeenCalled();
  });

  it('reads a private GitHub file as the person, sending the token only to GitHub\'s API', async () => {
    const fetchMock = vi.fn(async (url) => (url.startsWith('https://api.github.com/') ? json(200) : json(404)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchSharedUniverse(RAW, { getToken: async () => 'tok' })).toEqual({ a: 1 });
    const [anon, signedIn] = fetchMock.mock.calls;
    expect(anon[1].headers).toBeUndefined();
    expect(signedIn[0]).toBe('https://api.github.com/repos/g/secret/contents/f.redstring?ref=main');
    expect(signedIn[1].headers.Authorization).toBe('token tok');
  });

  it('never sends a token to another host', async () => {
    const fetchMock = vi.fn(async () => json(404));
    vi.stubGlobal('fetch', fetchMock);
    const getToken = vi.fn(async () => 'tok');
    await expect(fetchSharedUniverse('https://dav.example.com/f.redstring', { getToken })).rejects.toMatchObject({ code: 'NO_ACCESS' });
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says what to do when not signed in, and when the account has no access', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404)));
    const signedOut = await fetchSharedUniverse(RAW, { getToken: async () => null }).catch((e) => e);
    expect(signedOut.code).toBe('NO_ACCESS');
    expect(describeSharedLinkFailure(signedOut)).toMatch(/connect GitHub/i);
    const noAccess = await fetchSharedUniverse(RAW, { getToken: async () => 'tok' }).catch((e) => e);
    expect(describeSharedLinkFailure(noAccess)).toMatch(/doesn't have access/);
  });

  it('explains a host that refuses the read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await fetchSharedUniverse('https://dav.example.com/f.redstring').catch((e) => e);
    expect(error.code).toBe('UNREACHABLE');
    expect(describeSharedLinkFailure(error)).toMatch(/allow Redstring/);
  });
});
