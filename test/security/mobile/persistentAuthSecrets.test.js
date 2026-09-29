/**
 * S-72 / S-73 / S-74: GitHub credentials in PersistentAuth.
 *   - the parked App user-to-server token lives in the secret store and is
 *     cleared by BOTH clearTokens() and clearAppInstallation()
 *   - an App refresh token is kept, not discarded, across access-token renewals
 *   - device-flow platforms never mirror tokens to/from an auth server
 *   - disconnect messages say where to revoke on GitHub
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockOAuthFetch = vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }));
vi.mock('../../../src/services/bridgeConfig.js', () => ({ oauthFetch: mockOAuthFetch }));

const {
  PersistentAuth,
  OAUTH_DISCONNECTED_MESSAGE,
  APP_DISCONNECTED_MESSAGE
} = await import('../../../src/services/persistentAuth.js');
const { __setSecretBackendForTests, isEncrypted } = await import('../../../src/utils/secureStore.js');

function installLocalStorage() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
  globalThis.localStorage = ls;
  return store;
}

const memoryBackend = () => {
  const data = new Map();
  return {
    kind: 'native',
    data,
    get: async (k) => (data.has(k) ? data.get(k) : null),
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); }
  };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

let ls;
let backend;
beforeEach(() => {
  vi.clearAllMocks();
  ls = installLocalStorage();
  backend = memoryBackend();
  __setSecretBackendForTests(backend);
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  __setSecretBackendForTests(undefined);
  delete window.electron;
  delete window.Capacitor;
});

const makeAuth = async () => {
  const auth = new PersistentAuth();
  await auth.readyPromise;
  return auth;
};

describe('App user-to-server token (S-72)', () => {
  it('is stored in the secret store, not as plaintext in localStorage', async () => {
    const auth = await makeAuth();
    await auth.saveAppUserToServerToken('ghu_parked');
    expect(backend.data.get('github_app_user_token')).toBe('ghu_parked');
    expect(ls.has('github_app_user_token')).toBe(false);
    expect(auth.getAppUserToServerToken()).toBe('ghu_parked');
  });

  it('is never plaintext in localStorage on the web layer either', async () => {
    __setSecretBackendForTests(null);
    const auth = await makeAuth();
    await auth.saveAppUserToServerToken('ghu_web');
    expect(isEncrypted(ls.get('github_app_user_token'))).toBe(true);
  });

  it('survives a reload (loaded with the rest of the auth state)', async () => {
    const first = await makeAuth();
    await first.saveAppUserToServerToken('ghu_parked');
    const second = await makeAuth();
    expect(second.getAppUserToServerToken()).toBe('ghu_parked');
  });

  it('a legacy plaintext copy is migrated into the secret store on load', async () => {
    ls.set('github_app_user_token', 'ghu_legacy_plain');
    const auth = await makeAuth();
    expect(auth.getAppUserToServerToken()).toBe('ghu_legacy_plain');
    expect(backend.data.get('github_app_user_token')).toBe('ghu_legacy_plain');
    expect(ls.has('github_app_user_token')).toBe(false);
  });

  it('clearTokens() removes it', async () => {
    const auth = await makeAuth();
    await auth.saveAppUserToServerToken('ghu_parked');
    await auth.clearTokens();
    expect(auth.getAppUserToServerToken()).toBeNull();
    expect(backend.data.has('github_app_user_token')).toBe(false);
  });

  it('clearAppInstallation() removes it, along with the App access and refresh tokens', async () => {
    const auth = await makeAuth();
    await auth.saveAppUserToServerToken('ghu_parked');
    await auth.storeAppInstallation({ installationId: 42, accessToken: 'ghu_access', refreshToken: 'ghr_refresh' });
    await flush();
    expect(backend.data.get('github_app_refresh_token')).toBe('ghr_refresh');

    await auth.clearAppInstallation();
    expect(auth.getAppUserToServerToken()).toBeNull();
    for (const key of ['github_app_user_token', 'github_app_access_token', 'github_app_refresh_token']) {
      expect(backend.data.has(key)).toBe(false);
      expect(ls.has(key)).toBe(false);
    }
  });
});

describe('OAuth tokens at rest (S-71)', () => {
  it('storeTokens puts access/refresh tokens in the secret store', async () => {
    const auth = await makeAuth();
    await auth.storeTokens({ access_token: 'gho_a', refresh_token: 'ghr_b' }, { id: 1, login: 'me' });
    await flush();
    expect(backend.data.get('github_access_token')).toBe('gho_a');
    expect(backend.data.get('github_refresh_token')).toBe('ghr_b');
    expect(ls.has('github_access_token')).toBe(false);
  });

  it('an existing encrypted-localStorage login keeps working after the switch to the native store', async () => {
    __setSecretBackendForTests(null);
    const before = await makeAuth();
    await before.storeTokens({ access_token: 'gho_existing' }, { id: 1, login: 'me' });
    await vi.waitFor(() => expect(isEncrypted(ls.get('github_access_token'))).toBe(true));

    __setSecretBackendForTests(backend); // app update: native store now available
    const after = await makeAuth();
    expect(after.oauthCache?.accessToken).toBe('gho_existing');
    expect(backend.data.get('github_access_token')).toBe('gho_existing');
    expect(ls.has('github_access_token')).toBe(false);
  });
});

describe('App refresh token (S-73)', () => {
  it('is kept when only the access token is renewed', async () => {
    const auth = await makeAuth();
    await auth.storeAppInstallation({ installationId: 7, accessToken: 'ghu_1', refreshToken: 'ghr_keep', refreshTokenExpiresAt: '2027-01-01T00:00:00Z' });
    await auth.storeAppInstallation({ installationId: 7, accessToken: 'ghu_2' });
    await flush();
    expect(auth.githubAppCache.refreshToken).toBe('ghr_keep');
    expect(backend.data.get('github_app_refresh_token')).toBe('ghr_keep');
    expect(auth.githubAppCache.refreshTokenExpiresAt).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });

  it('is not carried over to a different installation', async () => {
    const auth = await makeAuth();
    await auth.storeAppInstallation({ installationId: 7, accessToken: 'ghu_1', refreshToken: 'ghr_7' });
    await auth.storeAppInstallation({ installationId: 8, accessToken: 'ghu_8' });
    expect(auth.githubAppCache.refreshToken).toBeNull();
  });
});

describe('no token mirroring on device-flow platforms (S-74)', () => {
  const tokenCalls = () => mockOAuthFetch.mock.calls.filter(([path]) => /\/api\/github\/auth\//.test(path));

  it('Electron: storeTokens / storeAppInstallation / clear never touch /api/github/auth/*', async () => {
    window.electron = { isElectron: true };
    const auth = await makeAuth();
    await auth.storeTokens({ access_token: 'gho_secret', refresh_token: 'ghr_secret' }, { id: 1, login: 'me' });
    await auth.storeAppInstallation({ installationId: 1, accessToken: 'ghu_secret' });
    await auth.persistOAuthCache();
    await auth.clearTokens();
    await auth.clearAppInstallation();
    expect(tokenCalls()).toEqual([]);
  });

  it('Capacitor: never pulls tokens from the auth-state endpoint', async () => {
    window.Capacitor = { isNativePlatform: () => true };
    await makeAuth();
    expect(tokenCalls()).toEqual([]);
  });

  it('web: still mirrors (server-side OAuth completion depends on it)', async () => {
    const auth = await makeAuth();
    await auth.storeTokens({ access_token: 'gho_web' }, { id: 1, login: 'me' });
    expect(tokenCalls().some(([path, init]) => path === '/api/github/auth/oauth' && init?.method === 'POST')).toBe(true);
  });
});

describe('disconnect tells the user where to revoke (S-73)', () => {
  it('names the GitHub settings pages', () => {
    expect(OAUTH_DISCONNECTED_MESSAGE).toContain('github.com/settings/applications');
    expect(APP_DISCONNECTED_MESSAGE).toContain('github.com/settings/installations');
  });
});
