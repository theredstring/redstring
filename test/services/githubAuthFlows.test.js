import { describe, it, expect, beforeEach, vi } from 'vitest';

// Web App detection is scoped by the OAuth token. Without a working one the
// flows must say "reconnect OAuth" — not "install the App", which is the loop
// a user can go around forever while the App is already installed.

const auth = {
  oauthCache: null,
  githubAppCache: null,
  lastAppDiscoveryFailure: null,
  hasAppInstallation: vi.fn(() => false),
  hasValidTokens: vi.fn(() => !!auth.oauthCache?.accessToken),
  verifyOAuth: vi.fn(async () => 'valid'),
  forceAppDiscovery: vi.fn(async () => false)
};

vi.mock('../../src/services/persistentAuth.js', () => ({ persistentAuth: auth }));
vi.mock('../../src/utils/capacitorAdapter.js', () => ({ usesDeviceFlowAuth: () => false }));
vi.mock('../../src/utils/fileAccessAdapter.js', () => ({ isElectron: () => false }));
vi.mock('../../src/services/bridgeConfig.js', () => ({
  oauthFetch: vi.fn(async () => ({ ok: true, json: async () => ({ name: 'redstring-app' }) }))
}));
vi.mock('../../src/services/universeManagerService.js', () => ({ default: {} }));
vi.mock('../../src/services/universeBackend.js', () => ({ default: {} }));
vi.mock('../../src/services/githubDeviceFlow.js', () => ({
  openVerificationUrl: vi.fn(),
  getOAuthClientId: vi.fn(),
  getAppClientId: vi.fn(),
  getAppSlug: vi.fn(() => 'redstring-app')
}));

const { connectApp, detectAppInstall } = await import('../../src/services/githubAuthFlows.js');

describe('GitHub App flows on web need a working OAuth token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.oauthCache = { accessToken: 'gho_x', user: { login: 'someone' } };
    auth.lastAppDiscoveryFailure = null;
    auth.verifyOAuth.mockResolvedValue('valid');
    auth.forceAppDiscovery.mockResolvedValue(false);
    global.sessionStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    global.window = { location: { href: '' } };
  });

  it('detect reports needsOAuth with no OAuth token instead of "not installed"', async () => {
    auth.oauthCache = null;
    const result = await detectAppInstall();
    expect(result).toEqual({ found: false, needsOAuth: true });
    expect(auth.forceAppDiscovery).not.toHaveBeenCalled();
  });

  it('detect reports needsOAuth when GitHub has revoked the token', async () => {
    auth.verifyOAuth.mockResolvedValue('invalid');
    const result = await detectAppInstall();
    expect(result.needsOAuth).toBe(true);
  });

  it('detect still runs when GitHub could not be reached to check', async () => {
    auth.verifyOAuth.mockResolvedValue('unknown');
    await detectAppInstall();
    expect(auth.forceAppDiscovery).toHaveBeenCalled();
  });

  it('connect does not send the user to the install page without OAuth', async () => {
    auth.verifyOAuth.mockResolvedValue('invalid');
    const result = await connectApp();
    expect(result).toEqual({ needsOAuth: true });
    expect(global.window.location.href).toBe('');
  });

  it('connect stops when discovery itself was refused over OAuth', async () => {
    auth.forceAppDiscovery.mockImplementation(async () => {
      auth.lastAppDiscoveryFailure = { reason: 'oauth_invalid' };
      return false;
    });
    const result = await connectApp();
    expect(result).toEqual({ needsOAuth: true });
    expect(global.window.location.href).toBe('');
  });

  it('connect goes to the install page when OAuth works and nothing is installed', async () => {
    auth.forceAppDiscovery.mockImplementation(async () => {
      auth.lastAppDiscoveryFailure = { reason: 'not_installed' };
      return false;
    });
    const result = await connectApp();
    expect(result).toEqual({ installRedirect: true });
    expect(global.window.location.href).toContain('/installations/new');
  });
});
