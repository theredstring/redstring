/**
 * S-45 — JSON-LD never fetches a remote @context outside the vocabulary
 * allowlist. S-48 — universes loaded from a link: https only, size-capped,
 * nesting-capped.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  safeDocumentLoader,
  resolveAllowedContextUrl,
  _clearContextCache,
} from '../../../src/formats/jsonldLoader.js';
import { importJSONLD } from '../../../src/formats/importAdapters.js';
import { semanticHash } from '../../../src/services/semanticHashCore.js';
import {
  classifyUrl,
  fetchRedstringJson,
  jsonNestingDepth,
  MAX_JSON_DEPTH,
} from '../../../src/services/externalUniverseLoader.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});
beforeEach(() => _clearContextCache());

describe('safeDocumentLoader (S-45)', () => {
  it.each([
    'https://evil.example/context.jsonld',
    'http://127.0.0.1:3001/api/bridge/state',
    'http://localhost:3001/',
    'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'https://schema.org.evil.example/',
    'https://user:pw@schema.org/',
    'https://schema.org:8443/',
    'data:application/json,{}',
  ])('refuses %s without making a request', async (url) => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(safeDocumentLoader(url)).rejects.toThrow(/refused/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches an allowlisted vocabulary over https (http upgraded) and caches it', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ '@context': { name: 'http://schema.org/name' } }), {
      status: 200, headers: { 'content-type': 'application/ld+json' },
    }));
    globalThis.fetch = fetchSpy;
    const a = await safeDocumentLoader('http://schema.org/');
    const b = await safeDocumentLoader('https://schema.org');
    expect(a.document['@context'].name).toBe('http://schema.org/name');
    expect(b.document).toBe(a.document);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://schema.org/docs/jsonldcontext.jsonld');
  });

  it('refuses an oversized context', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }));
    await expect(safeDocumentLoader('https://www.w3.org/ns/activitystreams')).rejects.toThrow(/too large/);
  });

  it('resolveAllowedContextUrl only answers for the allowlisted hosts', () => {
    expect(resolveAllowedContextUrl('https://www.w3.org/ns/activitystreams')).toBe('https://www.w3.org/ns/activitystreams');
    expect(resolveAllowedContextUrl('https://evil.example/')).toBeNull();
  });

  it('importJSONLD rejects a document whose @context points at an arbitrary host', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(importJSONLD({
      '@context': 'https://evil.example/ctx.jsonld',
      '@id': 'https://example.org/a',
      'name': 'A',
    })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('semanticHash (run on files from anywhere) uses the same loader', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(semanticHash({ '@context': 'http://127.0.0.1:3001/x', '@id': 'urn:a', 'urn:p': 'v' })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('externalUniverseLoader (S-48)', () => {
  it('classifyUrl refuses plain http', () => {
    expect(classifyUrl('http://example.com/u.redstring')).toMatchObject({ kind: 'invalid' });
    expect(classifyUrl('http://github.com/o/r/blob/main/u.redstring')).toMatchObject({ kind: 'invalid' });
    expect(classifyUrl('https://example.com/u.redstring')).toMatchObject({ kind: 'raw-file' });
  });

  it('fetchRedstringJson refuses a non-https URL without fetching', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(fetchRedstringJson('http://example.com/u.redstring')).rejects.toThrow(/https/);
    await expect(fetchRedstringJson('file:///u.redstring')).rejects.toThrow(/https/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a declared Content-Length over the cap', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-length': String(60 * 1024 * 1024) } }));
    await expect(fetchRedstringJson('https://example.com/u.redstring')).rejects.toThrow(/too large/);
  });

  it('stops reading a body that grows past the cap without a Content-Length', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(32);
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent > 4 * 1024 * 1024) { controller.close(); return; }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 }));
    await expect(fetchRedstringJson('https://example.com/u.redstring', { maxBytes: 1024 * 1024 })).rejects.toThrow(/too large/);
    expect(sent).toBeLessThan(2 * 1024 * 1024);
  });

  it('refuses pathologically nested JSON before parsing it', async () => {
    const deep = '['.repeat(MAX_JSON_DEPTH + 5) + ']'.repeat(MAX_JSON_DEPTH + 5);
    globalThis.fetch = vi.fn(async () => new Response(deep, { status: 200 }));
    await expect(fetchRedstringJson('https://example.com/u.redstring')).rejects.toThrow(/nested too deeply/);
  });

  it('loads an ordinary file', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"format":"redstring-v4","a":[1,{"b":"[[[["}]}', { status: 200 }));
    await expect(fetchRedstringJson('https://example.com/u.redstring')).resolves.toMatchObject({ format: 'redstring-v4' });
  });

  it('jsonNestingDepth ignores brackets inside strings', () => {
    expect(jsonNestingDepth('{"a":"[[[[[[","b":[1,[2]]}')).toBe(3);
    expect(jsonNestingDepth('"\\"[[["')).toBe(0);
  });

  it('uses a 25 MB cap inside the native app and 50 MB elsewhere', async () => {
    const { maxExternalUniverseBytes } = await import('../../../src/services/externalUniverseLoader.js');
    expect(maxExternalUniverseBytes()).toBe(50 * 1024 * 1024);
    window.Capacitor = { isNativePlatform: () => true };
    try {
      expect(maxExternalUniverseBytes()).toBe(25 * 1024 * 1024);
    } finally {
      delete window.Capacitor;
    }
  });
});
