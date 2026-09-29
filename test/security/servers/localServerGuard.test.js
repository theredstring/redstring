// @vitest-environment node
/**
 * C-6 guard, unit-tested on a bare node:http server on a random port: Host,
 * Origin, token, content type, CORS preflight, query-token scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  createLocalServerGuard,
  tokensMatch,
  extractToken,
  allowedOriginsFromEnv,
  DEFAULT_ALLOWED_ORIGINS,
} from '../../../src/security/localServerGuard.js';
import { rawRequest } from './helpers.js';

const TOKEN = 'a'.repeat(64);
let server;
let port;
let reached = 0;

beforeAll(async () => {
  const guard = createLocalServerGuard({ token: TOKEN, port: () => port, queryTokenPaths: ['/events/stream'] });
  server = http.createServer((req, res) => {
    guard(req, res, () => {
      reached += 1;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

afterAll(() => new Promise((r) => server.close(r)));

const auth = { 'x-redstring-token': TOKEN };

describe('createLocalServerGuard', () => {
  it('lets a valid local request through', async () => {
    const before = reached;
    const res = await rawRequest({ port, path: '/api/x', headers: auth });
    expect(res.status).toBe(200);
    expect(reached).toBe(before + 1);
  });

  it('accepts localhost and [::1] Host forms for the right port', async () => {
    for (const host of [`localhost:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
      const res = await rawRequest({ port, path: '/', headers: { ...auth, host } });
      expect(res.status, host).toBe(200);
    }
  });

  it('rejects a wrong Host (DNS rebinding) with 403 before the token check', async () => {
    for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', `127.0.0.1.nip.io:${port}`]) {
      const before = reached;
      const res = await rawRequest({ port, path: '/', headers: { ...auth, host } });
      expect(res.status, host).toBe(403);
      expect(JSON.parse(res.body).error).toBe('forbidden_host');
      expect(reached).toBe(before);
    }
  });

  it('rejects a missing or wrong token with 401', async () => {
    expect((await rawRequest({ port, path: '/' })).status).toBe(401);
    expect((await rawRequest({ port, path: '/', headers: { 'x-redstring-token': 'b'.repeat(64) } })).status).toBe(401);
    expect((await rawRequest({ port, path: '/', headers: { 'x-redstring-token': TOKEN.slice(1) } })).status).toBe(401);
  });

  it('accepts Authorization: Bearer as a fallback, but X-Redstring-Token wins', async () => {
    expect((await rawRequest({ port, path: '/', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    // A route that carries an LLM key in Authorization still authenticates via the header.
    expect((await rawRequest({ port, path: '/', headers: { ...auth, authorization: 'Bearer sk-user-llm-key' } })).status).toBe(200);
  });

  it('rejects disallowed and "null" Origins with 403', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:9999', 'file://', 'app://evil']) {
      const res = await rawRequest({ port, path: '/', headers: { ...auth, origin } });
      expect(res.status, origin).toBe(403);
      expect(JSON.parse(res.body).error).toBe('forbidden_origin');
    }
  });

  it('allows the app and vite dev origins and answers CORS for them', async () => {
    for (const origin of DEFAULT_ALLOWED_ORIGINS) {
      const res = await rawRequest({ port, path: '/', headers: { ...auth, origin } });
      expect(res.status, origin).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('answers a preflight from an allowed origin without a token, never from evil', async () => {
    const ok = await rawRequest({
      port, method: 'OPTIONS', path: '/api/x',
      headers: { origin: 'app://redstring', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-redstring-token,content-type' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-headers']).toMatch(/X-Redstring-Token/i);
    const evil = await rawRequest({ port, method: 'OPTIONS', path: '/api/x', headers: { origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
  });

  it('rejects non-JSON bodies (text/plain, form) with 415 even with a valid token', async () => {
    for (const ct of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const before = reached;
      const res = await rawRequest({ port, method: 'POST', path: '/', headers: { ...auth, 'content-type': ct }, body: '{"a":1}' });
      expect(res.status, ct).toBe(415);
      expect(reached).toBe(before);
    }
  });

  it('accepts JSON bodies and body-less POSTs', async () => {
    expect((await rawRequest({ port, method: 'POST', path: '/', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).status).toBe(200);
    expect((await rawRequest({ port, method: 'POST', path: '/', headers: auth })).status).toBe(200);
  });

  it('accepts ?rs_token= only on the listed stream path', async () => {
    expect((await rawRequest({ port, path: `/events/stream?rs_token=${TOKEN}` })).status).toBe(200);
    expect((await rawRequest({ port, path: `/api/bridge/state?rs_token=${TOKEN}` })).status).toBe(401);
    expect((await rawRequest({ port, method: 'POST', path: `/events/stream?rs_token=${TOKEN}` })).status).toBe(401);
  });

  it('fails closed (503) when no token is configured', async () => {
    const guard = createLocalServerGuard({ token: () => null, port: 1234 });
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    let nextCalled = false;
    guard({ method: 'GET', url: '/', headers: { host: '127.0.0.1:1234' } }, res, () => { nextCalled = true; });
    expect(res.statusCode).toBe(503);
    expect(nextCalled).toBe(false);
  });
});

describe('guard helpers', () => {
  it('tokensMatch is exact and rejects empties', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', '')).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
    expect(tokensMatch(null, 'x')).toBe(false);
  });

  it('extractToken prefers the header over Authorization', () => {
    expect(extractToken({ method: 'GET', url: '/', headers: { 'x-redstring-token': 't1', authorization: 'Bearer t2' } })).toBe('t1');
    expect(extractToken({ method: 'GET', url: '/', headers: { authorization: 'Bearer t2' } })).toBe('t2');
    expect(extractToken({ method: 'GET', url: '/', headers: { authorization: 'token t2' } })).toBe(null);
  });

  it('allowedOriginsFromEnv never admits "null"', () => {
    const list = allowedOriginsFromEnv('null, http://localhost:5173 ,NULL');
    expect(list).toContain('http://localhost:5173');
    expect(list.map((o) => o.toLowerCase())).not.toContain('null');
  });
});
