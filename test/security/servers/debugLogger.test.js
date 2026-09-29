/**
 * S-57: the debug ingest client (POSTs to 127.0.0.1:7242, incl. LLM output
 * previews) is inert unless this is a Vite dev build or REDSTRING_DEBUG_LOG=1.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { debugLogSync, debugLog, isDebugLogEnabled, resetServerAvailabilityCache } from '../../../src/utils/debugLogger.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('debugLogger gating', () => {
  it('sends nothing in a production build (DEV false, no flag)', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('REDSTRING_DEBUG_LOG', '');
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);
    resetServerAvailabilityCache();
    expect(isDebugLogEnabled()).toBe(false);
    debugLogSync('x', 'llm output preview', { preview: 'secret-ish' });
    await debugLog('x', 'llm output preview', { preview: 'secret-ish' });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends nothing in plain Node / tests without the flag', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);
    resetServerAvailabilityCache();
    expect(isDebugLogEnabled()).toBe(false);
    debugLogSync('x', 'y', {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is enabled only by the explicit opt-in flag', () => {
    vi.stubEnv('REDSTRING_DEBUG_LOG', '1');
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);
    resetServerAvailabilityCache();
    expect(isDebugLogEnabled()).toBe(true);
    debugLogSync('x', 'y', {});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('127.0.0.1:7242');
  });
});
