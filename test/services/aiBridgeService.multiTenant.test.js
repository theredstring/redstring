import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { initializeBridgeService } from '../../src/services/ai-bridge-service.js';

/**
 * The bridge keeps all of its state in bare module globals with no per-user
 * key and no authentication. Served on a shared host that means one visitor
 * can read (and overwrite) another's entire graph via GET /api/bridge/state.
 *
 * These tests pin the multi-tenant gate: on a hosted deployment the stateful
 * endpoints must refuse, and must refuse with an explicit JSON 404 — NOT by
 * being left unregistered, which would let them fall through to the SPA
 * catch-all and return index.html with a 200.
 */

const silentLogger = { info() { }, warn() { }, error() { }, debug() { } };

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  initializeBridgeService(app, { logger: silentLogger, multiTenant: true });

  // Mimic the real server's SPA catch-all, so a route that is merely
  // unregistered would return 200 HTML and fail these tests loudly.
  app.get('*', (_req, res) => res.status(200).type('html').send('<!doctype html><html></html>'));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const STATEFUL_GETS = [
  '/api/bridge/state',
  '/api/bridge/pending-actions',
  '/api/bridge/telemetry',
  '/api/bridge/debug/traces',
  '/api/bridge/debug/stats'
];

const STATEFUL_POSTS = [
  '/api/bridge/state',
  '/api/bridge/layout',
  '/api/bridge/register-store',
  '/api/bridge/action-completed',
  '/api/bridge/action-feedback',
  '/api/bridge/action-started',
  '/api/bridge/tool-status',
  '/api/bridge/chat/append',
  '/api/wizard/execute-tool'
];

describe('ai-bridge-service multi-tenant gate', () => {
  it.each(STATEFUL_GETS)('refuses GET %s with an explicit JSON 404', async (path) => {
    const res = await fetch(`${baseUrl}${path}`);
    expect(res.status).toBe(404);
    // Must be JSON, not the SPA fallback HTML — clients JSON.parse this.
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.bridgeAvailable).toBe(false);
  });

  it.each(STATEFUL_POSTS)('refuses POST %s with an explicit JSON 404', async (path) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: true })
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.bridgeAvailable).toBe(false);
  });

  it('never discloses graph state, even after a write attempt', async () => {
    // The exposure being guarded: POST a "user's store", then read it back.
    await fetch(`${baseUrl}/api/bridge/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodePrototypes: [{ id: 'secret', name: 'Private Node' }] })
    });

    const res = await fetch(`${baseUrl}/api/bridge/state`);
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(text).not.toContain('Private Node');
    expect(text).not.toContain('nodePrototypes');
  });

  it('reports health as unavailable so clients stop retrying', async () => {
    const res = await fetch(`${baseUrl}/api/bridge/health`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.bridgeAvailable).toBe(false);
  });

  it('still serves tool definitions, which contain no user data', async () => {
    const res = await fetch(`${baseUrl}/api/wizard/tools`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
  });
});

describe('ai-bridge-service defaults', () => {
  // The security property: an image that loses REDSTRING_SINGLE_TENANT must
  // fail CLOSED. If this ever flips to opt-out, a missing env var silently
  // re-opens GET /api/bridge/state to the public internet.
  it('locks down by default when no tenancy option or env var is given', async () => {
    const previous = process.env.REDSTRING_SINGLE_TENANT;
    delete process.env.REDSTRING_SINGLE_TENANT;
    try {
      const app = express();
      app.use(express.json());
      initializeBridgeService(app, { logger: silentLogger });

      const srv = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      try {
        const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/bridge/state`);
        expect(res.status).toBe(404);
      } finally {
        await new Promise((resolve) => srv.close(resolve));
      }
    } finally {
      if (previous === undefined) delete process.env.REDSTRING_SINGLE_TENANT;
      else process.env.REDSTRING_SINGLE_TENANT = previous;
    }
  });
});
