import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockOAuthFetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({
    oauth: { hasToken: false },
    githubApp: { isInstalled: false },
    service: 'oauth-server'
  }),
  text: async () => ''
}));

vi.mock('../../src/services/bridgeConfig.js', () => ({
  oauthFetch: mockOAuthFetch
}));

const createFetchResponse = (overrides = {}) => ({
  ok: true,
  json: async () => ({}),
  text: async () => '',
  ...overrides
});

const { PersistentAuth } = await import('../../src/services/persistentAuth.js');

describe('PersistentAuth (secure storage)', () => {
  let persistentAuth;

  beforeEach(async () => {
    vi.clearAllMocks();

    global.fetch = vi.fn().mockResolvedValue(createFetchResponse());
    global.sessionStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    };
    global.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    };

    mockOAuthFetch.mockImplementation(async (url, options = {}) => {
      if (url.includes('/api/github/auth/state')) {
        return createFetchResponse({
          json: async () => ({
            oauth: { hasToken: false },
            githubApp: { isInstalled: false },
            service: 'oauth-server'
          })
        });
      }

      if (url.includes('/api/github/auth/oauth') && options.method === 'POST') {
        return createFetchResponse({
          json: async () => ({ stored: true })
        });
      }

      if (url.includes('/api/github/auth/oauth') && options.method === 'DELETE') {
        return createFetchResponse({
          json: async () => ({ cleared: true })
        });
      }

      if (url.includes('/api/github/auth/github-app')) {
        return createFetchResponse({
          json: async () => ({})
        });
      }

      if (url.includes('/api/github/oauth/validate')) {
        return createFetchResponse({
          json: async () => ({ valid: true })
        });
      }

      return createFetchResponse();
    });

    persistentAuth = new PersistentAuth();
    if (persistentAuth.readyPromise) {
      await persistentAuth.readyPromise.catch(() => {});
    }
  });

  afterEach(() => {
    persistentAuth?.destroy();
  });

  it('persists OAuth tokens via secure vault and caches them', async () => {
    const tokenData = {
      access_token: 'secure_token_123',
      token_type: 'bearer',
      scope: 'repo'
    };

    await persistentAuth.storeTokens(tokenData);

    expect(mockOAuthFetch).toHaveBeenCalledWith('/api/github/auth/oauth', expect.objectContaining({
      method: 'POST'
    }));

    const cachedToken = await persistentAuth.getAccessToken();
    expect(cachedToken).toBe('secure_token_123');
  });

  it('clears tokens via secure vault', async () => {
    await persistentAuth.storeTokens({ access_token: 'secure_token_456', token_type: 'bearer' });
    await persistentAuth.clearTokens();

    expect(mockOAuthFetch).toHaveBeenCalledWith('/api/github/auth/oauth', expect.objectContaining({
      method: 'DELETE'
    }));

    const tokenAfterClear = await persistentAuth.getAccessToken();
    expect(tokenAfterClear).toBeNull();
  });

  it('hydrates from secure vault state on initialization', async () => {
    mockOAuthFetch.mockImplementationOnce(async () => createFetchResponse({
      json: async () => ({
        oauth: {
          hasToken: true,
          accessToken: 'vault_token',
          tokenType: 'bearer',
          scope: 'repo',
          expiresAt: Date.now() + 10_000,
          user: { login: 'vault-user' }
        },
        githubApp: { isInstalled: false },
        service: 'oauth-server'
      })
    }));

    const freshAuth = new PersistentAuth();
    if (freshAuth.readyPromise) {
      await freshAuth.readyPromise.catch(() => {});
    }

    expect(freshAuth.hasValidTokens()).toBe(true);
    expect(await freshAuth.getAccessToken()).toBe('vault_token');
    freshAuth.destroy();
  });

  describe('verifyOAuth — a stored token is not a working one', () => {
    const seedToken = () => {
      persistentAuth.oauthCache = {
        accessToken: 'gho_stored',
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        user: { login: 'someone' }
      };
      persistentAuth.oauthVerification = { state: 'unverified', checkedAt: 0 };
    };

    const serverSays = (response) => {
      const base = mockOAuthFetch.getMockImplementation();
      mockOAuthFetch.mockImplementation(async (url, options) => (
        url.includes('/api/github/oauth/validate') ? response() : base(url, options)
      ));
    };

    it('clears a token GitHub rejects, so the UI stops saying Connected', async () => {
      seedToken();
      serverSays(async () => createFetchResponse({ ok: false, status: 401, json: async () => ({ valid: false }) }));
      global.fetch = vi.fn().mockResolvedValue(createFetchResponse({ ok: false, status: 401 }));

      expect(persistentAuth.getAuthStatus().hasOAuthTokens).toBe(true);
      const state = await persistentAuth.verifyOAuth({ maxAgeMs: 0 });

      expect(state).toBe('invalid');
      expect(persistentAuth.getAuthStatus().hasOAuthTokens).toBe(false);
    });

    it('keeps the token when GitHub cannot be reached', async () => {
      seedToken();
      serverSays(async () => { throw new Error('offline'); });
      global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

      const state = await persistentAuth.verifyOAuth({ maxAgeMs: 0 });

      expect(state).toBe('unknown');
      expect(persistentAuth.hasValidTokens()).toBe(true);
    });

    it('does not let a negative server answer override a working token', async () => {
      // The server's introspection is per OAuth client ID; a token minted by
      // the other (dev/prod) client reads as invalid there but works fine.
      seedToken();
      serverSays(async () => createFetchResponse({ ok: false, status: 401, json: async () => ({ valid: false }) }));
      global.fetch = vi.fn().mockResolvedValue(createFetchResponse({ ok: true, status: 200 }));

      expect(await persistentAuth.verifyOAuth({ maxAgeMs: 0 })).toBe('valid');
      expect(persistentAuth.hasValidTokens()).toBe(true);
    });

    it('auto-connect no longer signs the user out over a network blip', async () => {
      seedToken();
      serverSays(async () => { throw new Error('offline'); });
      global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

      await persistentAuth.attemptOAuthAutoConnect();

      expect(persistentAuth.hasValidTokens()).toBe(true);
    });

    it('marks App discovery as blocked by OAuth when the install lookup is refused', async () => {
      seedToken();
      const base = mockOAuthFetch.getMockImplementation();
      mockOAuthFetch.mockImplementation(async (url, options) => {
        if (url.includes('/api/github/app/installations')) {
          return createFetchResponse({ ok: false, status: 401, json: async () => ({ error: 'Bad credentials' }) });
        }
        if (url.includes('/api/github/oauth/validate')) {
          return createFetchResponse({ ok: false, status: 401, json: async () => ({ valid: false }) });
        }
        return base(url, options);
      });
      global.fetch = vi.fn().mockResolvedValue(createFetchResponse({ ok: false, status: 401 }));

      const found = await persistentAuth.forceAppDiscovery();

      expect(found).toBe(false);
      expect(persistentAuth.lastAppDiscoveryFailure?.reason).toBe('oauth_invalid');
      expect(persistentAuth.hasValidTokens()).toBe(false);
    });
  });
});
