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

    // One timed-out background call puts the oauth-server in a five-minute
    // cooldown. Detect install is the user asking right now, so every call
    // in the discovery chain must get through, or each press reads as
    // "not installed" until the cooldown lapses.
    const appCalls = () => mockOAuthFetch.mock.calls.filter(([url]) => url.includes('/api/github/app/'));
    const serveInstall = () => {
      const base = mockOAuthFetch.getMockImplementation();
      mockOAuthFetch.mockImplementation(async (url, options) => {
        if (url.includes('/api/github/app/installations')) {
          return createFetchResponse({ json: async () => ([{ id: 42, account: { login: 'someone' } }]) });
        }
        if (url.includes('/api/github/app/installation-token')) {
          return createFetchResponse({ json: async () => ({ token: 'ghs_fresh' }) });
        }
        if (url.includes('/api/github/app/installation/42')) {
          return createFetchResponse({ json: async () => ({ repositories: [], account: { login: 'someone' } }) });
        }
        return base(url, options);
      });
    };

    it('user-initiated App discovery bypasses the oauth-server cooldown on every call', async () => {
      seedToken();
      serveInstall();
      mockOAuthFetch.mockClear();

      await persistentAuth.forceAppDiscovery();

      const calls = appCalls();
      expect(calls.map(([url]) => url)).toEqual(expect.arrayContaining([
        '/api/github/app/installations',
        '/api/github/app/installation-token',
        '/api/github/app/installation/42'
      ]));
      for (const [url, options] of calls) {
        expect(options?.bypassCooldown, url).toBe(true);
      }
    });

    it('background App auto-connect still respects the cooldown', async () => {
      seedToken();
      serveInstall();
      mockOAuthFetch.mockClear();

      await persistentAuth.attemptAppAutoConnect();

      const calls = appCalls();
      expect(calls.length).toBeGreaterThan(0);
      for (const [url, options] of calls) {
        expect(options?.bypassCooldown, url).toBeFalsy();
      }
    });
  });
  describe('a stored GitHub App installation survives a failed token refresh', () => {
    const install = { installationId: 77, accessToken: 'ghs_old', repositories: [], userData: { login: 'me' } };
    const seedInstall = () => { persistentAuth.githubAppCache = { ...install }; };
    const serveMint = (respond) => {
      const base = mockOAuthFetch.getMockImplementation();
      mockOAuthFetch.mockImplementation(async (url, options = {}) => {
        if (url.includes('/api/github/app/installation-token')) return respond();
        return base(url, options);
      });
    };

    it('keeps it when the server cannot be reached (an iPad coming back from the background)', async () => {
      seedInstall();
      serveMint(async () => { throw new TypeError('Load failed'); });
      expect(await persistentAuth.attemptAppAutoConnect()).toBe(false);
      expect(persistentAuth.hasAppInstallation()).toBe(true);
      expect(localStorage.setItem).not.toHaveBeenCalledWith('github_app_disconnected_at', expect.anything());
    });

    it('keeps it through the server cooldown and a server error', async () => {
      seedInstall();
      serveMint(async () => { throw new Error('OAuth server unavailable (cooldown)'); });
      await persistentAuth.attemptAppAutoConnect();
      serveMint(async () => createFetchResponse({ ok: false, status: 502, text: async () => '{"code":"token_mint_failed"}' }));
      await persistentAuth.attemptAppAutoConnect();
      expect(persistentAuth.hasAppInstallation()).toBe(true);
    });

    it('keeps it when GitHub cannot be reached to check the fresh token', async () => {
      seedInstall();
      serveMint(async () => createFetchResponse({ json: async () => ({ token: 'ghs_new' }) }));
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'));
      expect(await persistentAuth.attemptAppAutoConnect()).toBe(false);
      expect(persistentAuth.hasAppInstallation()).toBe(true);
    });

    it('forgets it only when the server says the installation no longer exists, and not stickily', async () => {
      seedInstall();
      serveMint(async () => createFetchResponse({ ok: false, status: 404, text: async () => '{"error":"Installation not found","code":"installation_not_found"}' }));
      expect(await persistentAuth.attemptAppAutoConnect()).toBe(false);
      expect(persistentAuth.hasAppInstallation()).toBe(false);
      expect(localStorage.setItem).not.toHaveBeenCalledWith('github_app_disconnected_at', expect.anything());
    });

    it('an expired token (a 401 from GitHub) keeps the installation and drops only the token', async () => {
      seedInstall();
      await persistentAuth.expireAppToken();
      expect(persistentAuth.hasAppInstallation()).toBe(true);
      expect(persistentAuth.getAppInstallation().accessToken).toBeNull();
    });
  });
});
