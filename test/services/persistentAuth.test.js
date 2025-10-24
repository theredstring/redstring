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
});
