import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The oauth-server's App routes call GitHub several times in a row from the
 * Worker (installation discovery: /user/installations, /user, an RS256 JWT,
 * /app/installations), and a cold Worker adds seconds. Measured on
 * production: 6.0s, 0.2s and 1.7s just to reject a bad token. oauthFetch
 * used to abort at 2s, so Detect install failed with
 * "AbortError: signal is aborted without reason" before the server answered.
 */
describe('oauthFetch timeout', () => {
  let oauthFetch;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_OAUTH_URL', 'https://oauth.test');
    global.sessionStorage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    ({ oauthFetch } = await import('../../src/services/bridgeConfig.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const slowServer = (ms) => vi.fn((url, init) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ ok: true, status: 200, json: async () => [] }), ms);
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(t);
      const err = new Error('signal is aborted without reason');
      err.name = 'AbortError';
      reject(err);
    });
  }));

  it('waits for a slow App discovery response instead of aborting it', async () => {
    global.fetch = slowServer(6000);
    const pending = oauthFetch('/api/github/app/installations', {
      headers: { Authorization: 'token gho_x' },
      bypassCooldown: true
    });
    await vi.advanceTimersByTimeAsync(6000);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it('still gives up on a server that never answers', async () => {
    global.fetch = slowServer(10 * 60 * 1000);
    const pending = oauthFetch('/api/github/app/installations', {
      headers: { Authorization: 'token gho_x' },
      bypassCooldown: true
    });
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await settled;
  });
});
