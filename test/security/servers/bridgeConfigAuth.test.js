/**
 * C-6 renderer side: bridgeFetch / bridgeEventSource attach the agent token
 * from window.electron.agent.getConnection(), never attach one elsewhere, and
 * the pending-actions poll is a POST.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

let bridge;

class FakeEventSource {
  static instances = [];
  static CLOSED = 2;
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = []; FakeEventSource.instances.push(this); }
  addEventListener(t, fn) { this.listeners.push([t, fn]); }
  removeEventListener() {}
  close() { this.readyState = 2; }
}

beforeEach(async () => {
  vi.resetModules();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
});

afterEach(() => {
  delete window.electron;
  vi.unstubAllGlobals();
});

function headerOf(init, name) {
  const h = init?.headers;
  if (!h) return undefined;
  if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get(name) ?? undefined;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

describe('bridgeFetch in Electron', () => {
  beforeEach(async () => {
    window.electron = { agent: { getConnection: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:3001/', token: 'tok-123' })) } };
    bridge = await import('../../../src/services/bridgeConfig.js');
  });

  it('uses the preload URL and sends X-Redstring-Token', async () => {
    await bridge.bridgeFetch('/api/bridge/health', { headers: { Accept: 'application/json' } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3001/api/bridge/health');
    expect(headerOf(init, 'X-Redstring-Token')).toBe('tok-123');
    expect(headerOf(init, 'Accept')).toBe('application/json');
  });

  it('keeps a caller Authorization (LLM key) separate from the agent token', async () => {
    await bridge.bridgeFetch('/api/ai/agent/continue', { method: 'POST', headers: { Authorization: 'Bearer sk-user' } });
    const [, init] = fetch.mock.calls[0];
    expect(headerOf(init, 'Authorization')).toBe('Bearer sk-user');
    expect(headerOf(init, 'X-Redstring-Token')).toBe('tok-123');
  });

  it('puts the token on the event stream URL (EventSource cannot send headers)', async () => {
    const es = bridge.bridgeEventSource('/events/stream');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const real = FakeEventSource.instances[0];
    expect(real.url).toBe('http://127.0.0.1:3001/events/stream?rs_token=tok-123');
    es.close();
  });
});

describe('bridgeFetch without the Electron agent API', () => {
  it('attaches no token (web / older preload)', async () => {
    bridge = await import('../../../src/services/bridgeConfig.js');
    await bridge.bridgeFetch('/api/bridge/health');
    const [, init] = fetch.mock.calls[0];
    expect(headerOf(init, 'X-Redstring-Token')).toBeUndefined();
  });

  it('falls back when getConnection throws', async () => {
    window.electron = { agent: { getConnection: vi.fn(async () => { throw new Error('no handler'); }) } };
    bridge = await import('../../../src/services/bridgeConfig.js');
    await bridge.bridgeFetch('/api/bridge/health');
    const [, init] = fetch.mock.calls[0];
    expect(headerOf(init, 'X-Redstring-Token')).toBeUndefined();
  });
});

describe('pending-actions poll', () => {
  it('BridgeClient leases with POST, not GET', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/ai/BridgeClient.jsx'), 'utf8');
    const call = src.match(/bridgeFetch\('\/api\/bridge\/pending-actions',\s*\{[\s\S]*?\}\)/);
    expect(call, 'pending-actions call with options').toBeTruthy();
    expect(call[0]).toMatch(/method:\s*'POST'/);
  });
});
