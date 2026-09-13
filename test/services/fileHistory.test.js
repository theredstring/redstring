/**
 * Reading a file's history, and reading a file AT a past revision.
 *
 * The repository already holds every version a universe has ever had — a write
 * that empties one leaves the previous content in history, untouched. That is
 * the only reason the 2026-09-12 wipe was recoverable. These cover the two
 * calls that make it reachable from inside the app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubSemanticProvider, GiteaSemanticProvider } from '../../src/services/gitNativeProvider.js';

const PATH = 'universes/claude-s-chambers-2/claude-s-chambers-2.redstring';

const jsonResponse = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : `HTTP ${status}`,
  headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer
});

const textResponse = (text) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
  text: async () => text,
  json: async () => JSON.parse(text),
  arrayBuffer: async () => new TextEncoder().encode(text).buffer
});

/** The shape GitHub returns from /repos/{o}/{r}/commits?path=... */
const commit = (sha, date) => ({
  sha,
  commit: { author: { date }, message: `Update ${PATH}` }
});

const github = () => new GitHubSemanticProvider({ user: 'g', repo: 'O', token: 't', semanticPath: 'schema' });
const gitea = () => new GiteaSemanticProvider({ endpoint: 'https://git.example.com', user: 'g', repo: 'O', token: 't', semanticPath: 'schema' });

describe('listFileHistory (GitHub)', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists revisions newest first with their sizes', async () => {
    // The real shape of the incident: two big versions, then the wipe.
    global.fetch
      .mockResolvedValueOnce(jsonResponse([
        commit('c66c761e', '2026-09-12T21:35:29Z'),
        commit('c11c2089', '2026-09-12T21:16:01Z')
      ]))
      .mockResolvedValueOnce(jsonResponse({ size: 10010, sha: 'c66c761e' }))
      .mockResolvedValueOnce(jsonResponse({ size: 6916496, sha: 'c11c2089' }));

    const history = await github().listFileHistory(PATH, { limit: 2 });

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ sha: 'c66c761e', size: 10010 });
    expect(history[1]).toMatchObject({ sha: 'c11c2089', size: 6916496 });
    // The damage is visible from size alone, before reading a byte.
    expect(history[1].size).toBeGreaterThan(history[0].size * 100);
  });

  it('asks the commits endpoint, scoped to the one path', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse([]));
    await github().listFileHistory(PATH, { withSize: false });

    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('/repos/g/O/commits');
    expect(url).toContain(`path=${encodeURIComponent(PATH)}`);
    expect(global.fetch.mock.calls[0][1].cache).toBe('no-store');
  });

  it('skips the size lookups when they are not wanted', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse([commit('abc', '2026-09-12T21:16:01Z')]));
    const history = await github().listFileHistory(PATH, { withSize: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(history[0].size).toBe(null);
  });

  it('leaves size null when a revision cannot be sized, rather than calling it empty', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse([commit('abc', '2026-09-12T21:16:01Z')]))
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, { status: 500 }));

    const history = await github().listFileHistory(PATH);
    expect(history[0].size).toBe(null);
  });

  it('reports a missing file as FILE_NOT_FOUND', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 }));
    await expect(github().listFileHistory(PATH)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});

describe('reading at a revision (GitHub)', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('passes the revision to both the probe and the raw leg', async () => {
    const body = 'x'.repeat(6916496);
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ size: 6916496, sha: 'c11c2089', encoding: 'none', content: '' }))
      .mockResolvedValueOnce(textResponse(body));

    const result = await github().readFileRawWithMeta(PATH, { ref: 'c11c2089' });

    expect(result.content).toBe(body);
    expect(global.fetch.mock.calls[0][0]).toContain('?ref=c11c2089');
    expect(global.fetch.mock.calls[1][0]).toContain('?ref=c11c2089');
  });

  it('reads the branch tip when no revision is given', async () => {
    const doc = '{"format":"redstring-v4.1.0"}';
    global.fetch.mockResolvedValueOnce(jsonResponse({
      size: new TextEncoder().encode(doc).length,
      sha: 'tip',
      encoding: 'base64',
      content: Buffer.from(doc, 'utf8').toString('base64')
    }));

    await github().readFileRawWithMeta(PATH);
    expect(global.fetch.mock.calls[0][0]).not.toContain('?ref=');
  });

  it('still verifies the body against the blob size at a revision', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ size: 6916496, sha: 'c11c2089', encoding: 'none', content: '' }))
      .mockResolvedValueOnce(textResponse('truncated'));

    await expect(github().readFileRawWithMeta(PATH, { ref: 'c11c2089' }))
      .rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });
});

describe('listFileHistory (Gitea)', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists revisions from the self-hosted commits endpoint', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse([commit('abc', '2026-09-12T21:16:01Z')]))
      .mockResolvedValueOnce(jsonResponse({ size: 4242, sha: 'abc' }));

    const history = await gitea().listFileHistory(PATH);
    expect(history[0]).toMatchObject({ sha: 'abc', size: 4242 });
    expect(global.fetch.mock.calls[0][0]).toContain('/commits');
  });

  it('reads at a revision instead of always hitting main', async () => {
    const doc = '{"format":"redstring-v4.1.0"}';
    global.fetch.mockResolvedValueOnce(jsonResponse({
      size: new TextEncoder().encode(doc).length,
      sha: 'abc',
      encoding: 'base64',
      content: Buffer.from(doc, 'utf8').toString('base64')
    }));

    await gitea().readFileRawWithMeta(PATH, { ref: 'abc' });
    expect(global.fetch.mock.calls[0][0]).toContain('ref=abc');
    expect(global.fetch.mock.calls[0][0]).not.toContain('ref=main');
  });
});
