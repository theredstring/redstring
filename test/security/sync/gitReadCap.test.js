/**
 * S-78: git reads are capped by platform using the size the listing reports,
 * BEFORE any content is downloaded or decoded. Over the cap is an error that
 * no guard mistakes for "absent" or "empty".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  GitHubSemanticProvider,
  GiteaSemanticProvider,
  maxGitReadBytes,
  GIT_READ_CAP_DESKTOP_BYTES,
  GIT_READ_CAP_NATIVE_BYTES
} from '../../../src/services/gitNativeProvider.js';
import { isConfirmedNotFound, checkDestinationBeforeEmptyWrite } from '../../../src/services/emptyWriteGuard.js';

const MB = 1024 * 1024;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete window.Capacitor;
});

const listing = (size) => ({
  ok: true,
  status: 200,
  json: async () => ({ type: 'file', sha: 'abc123', size, encoding: 'none', content: '' })
});

describe('maxGitReadBytes', () => {
  it('is 50 MB on web/desktop and 25 MB in the native shell', () => {
    expect(GIT_READ_CAP_DESKTOP_BYTES).toBe(50 * MB);
    expect(GIT_READ_CAP_NATIVE_BYTES).toBe(25 * MB);
    expect(maxGitReadBytes()).toBe(50 * MB);
    window.Capacitor = { isNativePlatform: () => true };
    expect(maxGitReadBytes()).toBe(25 * MB);
  });
});

describe('GitHub readFileRawWithMeta size cap', () => {
  const provider = () => new GitHubSemanticProvider({ user: 'u', repo: 'r', token: 't', semanticPath: 'schema' });

  it('refuses a 60 MB file on desktop without fetching the blob', async () => {
    const fetchMock = vi.fn(async () => listing(60 * MB));
    globalThis.fetch = fetchMock;
    const error = await provider().readFileRawWithMeta('universes/big/big.redstring').catch((e) => e);
    expect(error.code).toBe('FILE_TOO_LARGE');
    expect(error.message).toMatch(/60 MB/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // listing only; no blob, no raw leg
    expect(isConfirmedNotFound(error)).toBe(false);
  });

  it('refuses a 30 MB file in the native shell', async () => {
    window.Capacitor = { isNativePlatform: () => true };
    globalThis.fetch = vi.fn(async () => listing(30 * MB));
    const error = await provider().readFileRawWithMeta('x.redstring').catch((e) => e);
    expect(error.code).toBe('FILE_TOO_LARGE');
  });

  it('an over-cap destination blocks an empty write (unreadable, not absent)', async () => {
    globalThis.fetch = vi.fn(async () => listing(60 * MB));
    const p = provider();
    const verdict = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => (await p.readFileRawWithMeta('x.redstring')).content
    });
    expect(verdict.safe).toBe(false);
  });
});

describe('Gitea readFileRawWithMeta size cap', () => {
  it('refuses before reading the bytes', async () => {
    const fetchMock = vi.fn(async () => listing(60 * MB));
    globalThis.fetch = fetchMock;
    const provider = new GiteaSemanticProvider({ endpoint: 'https://gitea.example', user: 'u', repo: 'r', token: 't' });
    const error = await provider.readFileRawWithMeta('x.redstring').catch((e) => e);
    expect(error.code).toBe('FILE_TOO_LARGE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
