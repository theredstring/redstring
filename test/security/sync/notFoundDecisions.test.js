/**
 * S-75: "absent" is the one answer that lets an empty write, or a create, go
 * through. It must be decided on structured fields — never on an error
 * MESSAGE that happens to contain "404" or "File not found".
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isConfirmedNotFound,
  checkDestinationBeforeEmptyWrite,
  __testing
} from '../../../src/services/emptyWriteGuard.js';
import { GitSyncEngine } from '../../../src/services/gitSyncEngine.js';
import { GitHubSemanticProvider } from '../../../src/services/gitNativeProvider.js';

const err = (message, fields = {}) => Object.assign(new Error(message), fields);

describe('isConfirmedNotFound', () => {
  it.each([
    ['provider not-found', err('File not found: x', { code: 'FILE_NOT_FOUND', status: 404 }), true],
    ['provider not-found without status', err('File not found: x', { code: 'FILE_NOT_FOUND' }), true],
    ['node ENOENT', err('no such file', { code: 'ENOENT' }), true],
    ['FS Access NotFoundError', Object.assign(new Error('gone'), { name: 'NotFoundError' }), true],
    ['403 whose message mentions 404', err('getFileInfo(404.redstring) status=403: 404 page', { status: 403, code: 'FILE_INFO_UNKNOWN' }), false],
    ['5xx quoting a 404', err('GitHub API error: 502 - upstream said 404', { status: 502 }), false],
    ['bare message "File not found"', err('File not found: universes/x.redstring'), false],
    ['bare message with 404', err('HTTP 404'), false],
    ['FILE_NOT_FOUND contradicted by a 403 status', err('File not found', { code: 'FILE_NOT_FOUND', status: 403 }), false],
    ['null', null, false],
    ['string', 'File not found', false]
  ])('%s → %s', (_label, error, expected) => {
    expect(isConfirmedNotFound(error)).toBe(expected);
    expect(__testing.defaultIsNotFound(error)).toBe(expected);
  });
});

describe('checkDestinationBeforeEmptyWrite default not-found check', () => {
  it('refuses when the read failed with a 403 whose message contains 404', async () => {
    const verdict = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => { throw err('status=403: rate limit (see /404)', { status: 403 }); }
    });
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toBe('destination-unreadable');
  });

  it('refuses when the read failed with an uncoded "File not found" message', async () => {
    const verdict = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => { throw err('File not found: x'); }
    });
    expect(verdict.safe).toBe(false);
  });

  it('still allows a structured 404', async () => {
    const verdict = await checkDestinationBeforeEmptyWrite({
      readDestination: async () => { throw err('File not found: x', { code: 'FILE_NOT_FOUND', status: 404 }); }
    });
    expect(verdict).toMatchObject({ safe: true, reason: 'destination-absent' });
  });
});

describe('GitSyncEngine first contact / loadFromGit', () => {
  const makeEngine = (readError) => {
    const provider = {
      writes: 0,
      async writeFileRaw() { this.writes++; return { content: { sha: 'new' } }; },
      async readFileRawWithMeta() { throw readError; }
    };
    const engine = new GitSyncEngine(provider, 'universes/x', 'x.redstring', 'x');
    engine.notifyStatus = () => {};
    return { engine, provider };
  };

  it('does not treat a message-only "File not found" as absent (first contact refuses the write)', async () => {
    const { engine, provider } = makeEngine(err('File not found: x (proxy said so)'));
    await expect(engine._firstContactCheck('universes/x/x.redstring')).rejects.toThrow();
    expect(engine.lastKnownRemoteSha).toBeUndefined();
    expect(provider.writes).toBe(0);
  });

  it('does not treat a 403 mentioning 404 as absent', async () => {
    const { engine } = makeEngine(err('status=403 404', { status: 403 }));
    await expect(engine._firstContactCheck('p')).rejects.toThrow();
    expect(engine.lastKnownRemoteSha).toBeUndefined();
  });

  it('a structured 404 is still a confirmed create', async () => {
    const { engine } = makeEngine(err('File not found: x', { code: 'FILE_NOT_FOUND', status: 404 }));
    await engine._firstContactCheck('p');
    expect(engine.lastKnownRemoteSha).toBeNull();
  });

  it('loadFromGit surfaces a message-only not-found instead of "starting fresh"', async () => {
    const { engine } = makeEngine(err('File not found: x'));
    await expect(engine.loadFromGit()).rejects.toThrow();
    expect(engine.lastKnownRemoteSha).toBeUndefined();
  });
});

describe('providers throw structured not-found errors', () => {
  it('GitHub readFileRawWithMeta 404 carries code and status', async () => {
    const provider = new GitHubSemanticProvider({ user: 'u', repo: 'r', token: 't', semanticPath: 'schema' });
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const error = await provider.readFileRawWithMeta('universes/x/x.redstring').catch((e) => e);
      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.status).toBe(404);
      expect(isConfirmedNotFound(error)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
