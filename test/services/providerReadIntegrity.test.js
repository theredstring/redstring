/**
 * Regression tests for the 2026-09-12 wipe.
 *
 * A 6.9 MB universe read back as a 10 KB GitHub contents-API envelope because
 * Chromium's HTTP cache answered the raw-media-type fallback fetch with the
 * JSON body cached by the preceding probe (same URL, different Accept). The
 * envelope imported as an empty universe and was written over the real file.
 *
 * Every test here asserts one of the three independent defenses in the read
 * path: cache opt-out, content-type check, and body-vs-blob-size verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GitHubSemanticProvider,
  GiteaSemanticProvider,
  isContentsEnvelope,
  assertRawBodyMatches
} from '../../src/services/gitNativeProvider.js';

const PATH = 'universes/claude-s-chambers-2/claude-s-chambers-2.redstring';
const BLOB_SIZE = 6916496;

/** The envelope GitHub returns for a file over 1MB. */
const envelope = (overrides = {}) => ({
  name: 'claude-s-chambers-2.redstring',
  path: PATH,
  sha: 'd2e961555ac8180c4e4332de0d453ec29c47184d',
  size: BLOB_SIZE,
  url: 'https://api.github.com/repos/g/O/contents/x?ref=main',
  html_url: 'https://github.com/g/O/blob/main/x',
  git_url: 'https://api.github.com/repos/g/O/git/blobs/d2e9',
  download_url: 'https://raw.githubusercontent.com/g/O/main/x?token=abc',
  type: 'file',
  content: '',
  encoding: 'none',
  _links: { self: '', git: '', html: '' },
  ...overrides
});

const jsonResponse = (body, { status = 200, headers } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : `HTTP ${status}`,
  headers: headers || new Headers({ 'content-type': 'application/json; charset=utf-8' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer
});

const textResponse = (text, { status = 200, contentType = 'text/plain; charset=utf-8' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'OK',
  headers: new Headers({ 'content-type': contentType }),
  text: async () => text,
  json: async () => JSON.parse(text),
  arrayBuffer: async () => new TextEncoder().encode(text).buffer
});

/** A body whose UTF-8 byte length is exactly `size`. */
const bodyOfBytes = (size) => 'x'.repeat(size);

const github = () => new GitHubSemanticProvider({ user: 'g', repo: 'O', token: 't', semanticPath: 'schema' });
const gitea = () => new GiteaSemanticProvider({ endpoint: 'https://git.example.com', user: 'g', repo: 'O', token: 't', semanticPath: 'schema' });

/** Byte length as measured before decoding — what callers now pass. */
const bytesOf = (s) => new TextEncoder().encode(s).length;

describe('assertRawBodyMatches', () => {
  it('accepts a body whose byte length matches the blob size', () => {
    expect(() => assertRawBodyMatches('hello', 5, 'f', 5)).not.toThrow();
  });

  it('compares bytes, not string length', () => {
    const multibyte = '☃☃'; // 2 chars, 6 bytes
    expect(() => assertRawBodyMatches(multibyte, 6, 'f', 6)).not.toThrow();
    expect(() => assertRawBodyMatches(multibyte, 2, 'f', 6)).toThrow(/body is/);
  });

  it('rejects a body shorter than the blob', () => {
    let thrown;
    try { assertRawBodyMatches('short', BLOB_SIZE, PATH, bytesOf('short')); } catch (e) { thrown = e; }
    expect(thrown.code).toBe('READ_TRUNCATED');
  });

  it('does NOT reject a legitimate file carrying a UTF-8 BOM', () => {
    // TextDecoder strips the BOM, so re-encoding the decoded string yields
    // three bytes fewer than the blob. Measuring bytes pre-decode is the
    // reason this passes; comparing re-encoded text would fail it.
    const withBom = '﻿{"format":"redstring-v4.1.0","prototypeSpace":{"prototypes":{}}}';
    const onDiskBytes = new TextEncoder().encode(withBom).length; // includes the BOM
    const decoded = new TextDecoder().decode(new TextEncoder().encode(withBom)); // BOM stripped
    expect(bytesOf(decoded)).toBe(onDiskBytes - 3); // the trap

    expect(() => assertRawBodyMatches(decoded, onDiskBytes, PATH, onDiskBytes)).not.toThrow();
  });

  it('skips the size check when the byte length is unknown', () => {
    expect(() => assertRawBodyMatches('anything', BLOB_SIZE, PATH, null)).not.toThrow();
  });

  it('rejects an envelope even when no size is known', () => {
    let thrown;
    try { assertRawBodyMatches(JSON.stringify(envelope()), 0, PATH, null); } catch (e) { thrown = e; }
    expect(thrown.code).toBe('READ_TRUNCATED');
    expect(thrown.message).toMatch(/envelope/);
  });

  it('does not mistake a real universe for an envelope', () => {
    const doc = JSON.stringify({ format: 'redstring-v4.1.0', prototypeSpace: { prototypes: {} }, encoding: 'utf-8' });
    expect(() => assertRawBodyMatches(doc, bytesOf(doc), PATH, bytesOf(doc))).not.toThrow();
  });

  it('identifies contents envelopes by shape', () => {
    expect(isContentsEnvelope(envelope())).toBe(true);
    expect(isContentsEnvelope({ format: 'redstring-v4' })).toBe(false);
    expect(isContentsEnvelope(null)).toBe(false);
    expect(isContentsEnvelope([])).toBe(false);
  });
});

describe('GitHubSemanticProvider.readFileRawWithMeta', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads an oversized file through the raw leg, with caching disabled on both requests', async () => {
    const body = bodyOfBytes(BLOB_SIZE);
    global.fetch
      .mockResolvedValueOnce(jsonResponse(envelope()))       // probe
      .mockResolvedValueOnce(textResponse(body));            // raw leg

    const result = await github().readFileRawWithMeta(PATH);

    expect(result.content).toBe(body);
    expect(result.size).toBe(BLOB_SIZE);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Both legs must opt out of the HTTP cache — they share a URL and differ
    // only by Accept, which is exactly what browser caches get wrong.
    expect(global.fetch.mock.calls[0][1].cache).toBe('no-store');
    expect(global.fetch.mock.calls[1][1].cache).toBe('no-store');
    // The raw leg must not ask for a JSON media type: `vnd.github.raw+json`
    // is a JSON type, which makes a cached JSON envelope a likelier match.
    const rawAccept = global.fetch.mock.calls[1][1].headers.Accept;
    expect(rawAccept).toBe('application/vnd.github.raw');
    expect(rawAccept).not.toMatch(/json/);
    // Same URL both times — the reason the cache could collide them.
    expect(global.fetch.mock.calls[0][0]).toBe(global.fetch.mock.calls[1][0]);
  });

  it('THE INCIDENT: rejects a cached JSON envelope served to the raw leg', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(envelope()))
      .mockResolvedValueOnce(jsonResponse(envelope())); // cache replays the probe's body

    await expect(github().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });

  it('rejects the envelope body even without a JSON content-type header', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(envelope()))
      .mockResolvedValueOnce(textResponse(JSON.stringify(envelope())));

    // Caught by byte-length mismatch (10KB envelope vs 6.9MB blob).
    await expect(github().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });

  it('rejects a truncated body that is merely short', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(envelope()))
      .mockResolvedValueOnce(textResponse(bodyOfBytes(1024)));

    await expect(github().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });

  it('rejects a failed raw fetch rather than reporting an empty file', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(envelope()))
      .mockResolvedValueOnce(textResponse('', { status: 500 }));

    await expect(github().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });

  it('verifies the base64 leg against the reported size too', async () => {
    const real = '{"format":"redstring-v4.1.0"}';
    const b64 = Buffer.from(real, 'utf8').toString('base64');
    global.fetch.mockResolvedValueOnce(jsonResponse(envelope({
      size: 999999, content: b64, encoding: 'base64'
    })));

    await expect(github().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });

  it('reads a normal small file from the base64 leg', async () => {
    const real = '{"format":"redstring-v4.1.0"}';
    const b64 = Buffer.from(real, 'utf8').toString('base64');
    global.fetch.mockResolvedValueOnce(jsonResponse(envelope({
      size: new TextEncoder().encode(real).length, content: b64, encoding: 'base64'
    })));

    const result = await github().readFileRawWithMeta(PATH);
    expect(result.content).toBe(real);
    expect(global.fetch).toHaveBeenCalledTimes(1); // no raw leg needed
  });

  it('reads a BOM-prefixed file end to end on both legs', async () => {
    const withBom = '﻿{"format":"redstring-v4.1.0","prototypeSpace":{"prototypes":{}}}';
    const onDisk = new TextEncoder().encode(withBom);

    // base64 leg
    global.fetch.mockResolvedValueOnce(jsonResponse(envelope({
      size: onDisk.length,
      content: Buffer.from(onDisk).toString('base64'),
      encoding: 'base64'
    })));
    const small = await github().readFileRawWithMeta(PATH);
    expect(JSON.parse(small.content).format).toBe('redstring-v4.1.0');

    // raw leg
    global.fetch
      .mockResolvedValueOnce(jsonResponse(envelope({ size: onDisk.length })))
      .mockResolvedValueOnce(textResponse(withBom));
    const large = await github().readFileRawWithMeta(PATH);
    expect(JSON.parse(large.content).format).toBe('redstring-v4.1.0');
  });

  it('reports a 404 as FILE_NOT_FOUND, not as empty content', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 }));
    await expect(github().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('reports an ambiguous probe as FILE_INFO_UNKNOWN, not as missing', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    await expect(github().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'FILE_INFO_UNKNOWN' });
  });

  it('readSemanticFile goes through the same verified reader', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(envelope({ path: 'schema/x.ttl' })))
      .mockResolvedValueOnce(jsonResponse(envelope())); // cached envelope again

    await expect(github().readSemanticFile('x')).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });
});

describe('GiteaSemanticProvider read integrity', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('getFileInfo returns null ONLY for a confirmed 404', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 }));
    await expect(gitea().getFileInfo(PATH)).resolves.toBe(null);
  });

  it('getFileInfo throws FILE_INFO_UNKNOWN on a server error instead of reporting absence', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ message: 'boom' }, { status: 500 }));
    await expect(gitea().getFileInfo(PATH)).rejects.toMatchObject({ code: 'FILE_INFO_UNKNOWN', status: 500 });
  });

  it('getFileInfo throws FILE_INFO_UNKNOWN on a network failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(gitea().getFileInfo(PATH)).rejects.toMatchObject({ code: 'FILE_INFO_UNKNOWN', status: 0 });
  });

  it('writeFileRaw does not create a file after an ambiguous probe', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ message: 'boom' }, { status: 500 }));
    await expect(gitea().writeFileRaw(PATH, 'data')).rejects.toMatchObject({ code: 'FILE_INFO_UNKNOWN' });
    // Only the probe happened — no POST/PUT followed.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('readFileRawWithMeta verifies the decoded body against the reported size', async () => {
    const real = '{"format":"redstring-v4.1.0"}';
    global.fetch.mockResolvedValueOnce(jsonResponse({
      sha: 'abc', size: 999999, encoding: 'base64',
      content: Buffer.from(real, 'utf8').toString('base64')
    }));
    await expect(gitea().readFileRawWithMeta(PATH)).rejects.toMatchObject({ code: 'READ_TRUNCATED' });
  });

  it('readFileRawWithMeta reads a well-formed small file', async () => {
    const real = '{"format":"redstring-v4.1.0"}';
    global.fetch.mockResolvedValueOnce(jsonResponse({
      sha: 'abc', size: new TextEncoder().encode(real).length, encoding: 'base64',
      content: Buffer.from(real, 'utf8').toString('base64')
    }));
    const result = await gitea().readFileRawWithMeta(PATH);
    expect(result).toEqual({ content: real, sha: 'abc', size: 29 });
  });

  it('readFileRawWithMeta falls back to the binary leg when content is omitted', async () => {
    const real = '{"format":"redstring-v4.1.0"}';
    const size = new TextEncoder().encode(real).length;
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ sha: 'abc', size, encoding: 'none', content: '' }))
      .mockResolvedValueOnce(textResponse(real, { contentType: 'application/octet-stream' }));

    const result = await gitea().readFileRawWithMeta(PATH);
    expect(result.content).toBe(real);
    expect(global.fetch.mock.calls[0][1].cache).toBe('no-store');
    expect(global.fetch.mock.calls[1][1].cache).toBe('no-store');
  });
});
