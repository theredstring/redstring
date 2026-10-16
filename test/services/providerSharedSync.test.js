/**
 * The three things a host must do for shared universes, on every provider:
 *   1. write only if the file is still at the expected SHA (compare-and-swap)
 *   2. read the file at an old SHA (the merge base)
 *   3. report the current SHA cheaply (has anyone else saved?)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubSemanticProvider, GiteaSemanticProvider } from '../../src/services/gitNativeProvider.js';

global.fetch = vi.fn();

const b64 = (text) => btoa(unescape(encodeURIComponent(text)));
const ok = (json) => ({ ok: true, status: 200, json: () => Promise.resolve(json), text: () => Promise.resolve(JSON.stringify(json)) });
const fail = (status, text = '') => ({ ok: false, status, json: () => Promise.resolve({ message: text }), text: () => Promise.resolve(text) });

const PROVIDERS = {
  github: {
    make: () => new GitHubSemanticProvider({ user: 'u', repo: 'r', token: 't' }),
    root: 'https://api.github.com/repos/u/r/contents',
    repo: 'https://api.github.com/repos/u/r'
  },
  gitea: {
    make: () => new GiteaSemanticProvider({ endpoint: 'http://forge.local', user: 'u', repo: 'r', token: 't' }),
    root: 'http://forge.local/api/v1/repos/u/r/contents',
    repo: 'http://forge.local/api/v1/repos/u/r'
  }
};

beforeEach(() => vi.clearAllMocks());

for (const [name, setup] of Object.entries(PROVIDERS)) {
  describe(`${name}: compare-and-swap writes`, () => {
    it('sends exactly the expected SHA and makes one request', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(ok({ content: { sha: 'new' } }));
      const result = await p.writeFileRaw('universes/u/u.redstring', '{}', { expectedSha: 'old' });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(`${setup.root}/universes/u/u.redstring`);
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body).sha).toBe('old');
      expect(result.content.sha).toBe('new');
    });

    it('reports a moved remote as REMOTE_DIVERGED and never retries', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(fail(409, 'sha does not match'));
      await expect(p.writeFileRaw('f.redstring', '{}', { expectedSha: 'stale' }))
        .rejects.toMatchObject({ code: 'REMOTE_DIVERGED' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('treats a 422 about the SHA as a moved remote too', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(fail(422, '{"message":"sha does not match [given: a, expected: b]"}'));
      await expect(p.writeFileRaw('f.redstring', '{}', { expectedSha: 'a' }))
        .rejects.toMatchObject({ code: 'REMOTE_DIVERGED' });
    });

    it('does not mistake an unrelated 422 for a moved remote', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(fail(422, '{"message":"invalid path"}'));
      const error = await p.writeFileRaw('f.redstring', '{}', { expectedSha: 'a' }).catch((e) => e);
      expect(error.code).not.toBe('REMOTE_DIVERGED');
    });
  });

  describe(`${name}: reading the merge base`, () => {
    it('reads a file by its blob SHA', async () => {
      const p = setup.make();
      const text = '{"name":"café"}';
      const bytes = new TextEncoder().encode(text).length;
      fetch.mockResolvedValueOnce(ok({ sha: 'abc', encoding: 'base64', content: b64(text), size: bytes }));
      expect(await p.readFileAtSha('f.redstring', 'abc')).toBe(text);
      expect(fetch.mock.calls[0][0]).toBe(`${setup.repo}/git/blobs/abc`);
    });

    it('refuses a blob that is not the one asked for', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(ok({ sha: 'other', encoding: 'base64', content: b64('{}'), size: 2 }));
      await expect(p.readFileAtSha('f.redstring', 'abc')).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
    });

    it('refuses a blob shorter than its reported size', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(ok({ sha: 'abc', encoding: 'base64', content: b64('{}'), size: 9000 }));
      await expect(p.readFileAtSha('f.redstring', 'abc')).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
    });
  });

  describe(`${name}: current SHA without downloading`, () => {
    it('lists the folder and picks the file', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(ok([
        { name: 'blobs', type: 'dir', sha: 'd1' },
        { name: 'my universe.redstring', type: 'file', sha: 'f1' }
      ]));
      expect(await p.getRemoteFileSha('universes/my universe/my universe.redstring')).toBe('f1');
      expect(fetch.mock.calls[0][0]).toMatch(new RegExp(`^${setup.root}/universes/my%20universe(\\?ref=main)?$`));
    });

    it('returns null when the file is not in the folder', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(ok([{ name: 'other.redstring', type: 'file', sha: 'x' }]));
      expect(await p.getRemoteFileSha('universes/u/u.redstring')).toBeNull();
    });

    it('returns null when the folder is missing', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(fail(404));
      expect(await p.getRemoteFileSha('universes/u/u.redstring')).toBeNull();
    });

    it('says "unknown", not "absent", when the host cannot answer', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(fail(503));
      await expect(p.getRemoteFileSha('universes/u/u.redstring')).rejects.toMatchObject({ code: 'FILE_INFO_UNKNOWN' });
    });
  });

  describe(`${name}: history`, () => {
    it('names who made each revision', async () => {
      const p = setup.make();
      fetch.mockResolvedValueOnce(ok([
        { sha: 'c2', author: { login: 'ana' }, commit: { message: 'Update', author: { name: 'Ana', date: '2026-10-16T10:00:00Z' } } },
        { sha: 'c1', author: null, commit: { message: 'Update', author: { name: 'Ben B', date: '2026-10-15T10:00:00Z' } } }
      ]));
      const revisions = await p.listFileHistory('f.redstring', { withSize: false });
      expect(revisions.map((r) => r.author)).toEqual(['ana', 'Ben B']);
    });
  });
}

describe('gitea: creating a file that must not exist yet', () => {
  it('POSTs without a sha', async () => {
    const p = PROVIDERS.gitea.make();
    fetch.mockResolvedValueOnce(ok({ content: { sha: 'first' } }));
    await p.writeFileRaw('f.redstring', '{}', { expectedSha: null });
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).sha).toBeUndefined();
  });

  it('a create over an existing file is a moved remote', async () => {
    const p = PROVIDERS.gitea.make();
    fetch.mockResolvedValueOnce(fail(422, '{"message":"repository file already exists [path: f.redstring]"}'));
    await expect(p.writeFileRaw('f.redstring', '{}', { expectedSha: null }))
      .rejects.toMatchObject({ code: 'REMOTE_DIVERGED' });
  });

  it('without expectedSha it still behaves as before (image blobs use this)', async () => {
    const p = PROVIDERS.gitea.make();
    fetch.mockResolvedValueOnce(fail(404)); // getFileInfo: absent
    fetch.mockResolvedValueOnce(ok({ content: { sha: 's' } }));
    await p.writeFileRaw('blobs/a.png', new Uint8Array([1, 2, 3]));
    expect(fetch.mock.calls[1][1].method).toBe('POST');
  });
});
