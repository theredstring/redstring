// S-05 / S-06 / S-07 — the web redirect callbacks (githubAuthCallbacks.js)
// and the flows that arm them (githubAuthFlows.js).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  oauthCache: { accessToken: 'gho_live', user: { login: 'alice' } },
  githubAppCache: null,
  storeTokens: vi.fn(async () => {}),
  storeAppInstallation: vi.fn(async () => {}),
  hasAppInstallation: vi.fn(() => false),
  hasValidTokens: vi.fn(() => true),
  verifyOAuth: vi.fn(async () => 'valid'),
  forceAppDiscovery: vi.fn(async () => false),
}));
const oauthFetch = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/persistentAuth.js', () => ({ persistentAuth: auth }));
vi.mock('../../../src/services/bridgeConfig.js', () => ({ oauthFetch }));
vi.mock('../../../src/services/universeManagerService.js', () => ({
  default: { getOAuthRedirectUri: () => 'https://redstring.io/oauth/callback' },
}));
vi.mock('../../../src/services/universeBackend.js', () => ({ default: {} }));
vi.mock('../../../src/utils/capacitorAdapter.js', () => ({ usesDeviceFlowAuth: () => false }));
vi.mock('../../../src/utils/fileAccessAdapter.js', () => ({ isElectron: () => false }));
vi.mock('../../../src/services/githubDeviceFlow.js', () => ({
  openVerificationUrl: vi.fn(),
  getOAuthClientId: vi.fn(),
  getAppClientId: vi.fn(),
  getAppSlug: vi.fn(() => 'redstring-app'),
}));

const { runPendingCallbacks } = await import('../../../src/services/githubAuthCallbacks.js');
const { connectOAuth, connectApp } = await import('../../../src/services/githubAuthFlows.js');
const S = await import('../../../src/services/githubOAuthState.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const setUrl = (qs) => window.history.replaceState({}, '', `/${qs}`);
const tokenCalls = () => oauthFetch.mock.calls.filter(([p]) => p === '/api/github/oauth/token');
const mintCalls = () => oauthFetch.mock.calls.filter(([p]) => p === '/api/github/app/installation-token');

beforeEach(() => {
  sessionStorage.clear();
  setUrl('');
  vi.clearAllMocks();
  oauthFetch.mockImplementation(async (path) => {
    if (path === '/api/github/oauth/token') return ok({ access_token: 'gho_new' });
    if (path === '/api/github/app/installation-token') return ok({ token: 'ghs_x', expires_at: '2030-01-01T00:00:00Z', account: { login: 'alice' } });
    if (path === '/api/github/app/installations') return ok([]);
    if (path === '/api/github/oauth/client-id') return ok({ clientId: 'Iv1.cid' });
    if (path === '/api/github/app/info') return ok({ name: 'redstring-app' });
    return ok({});
  });
  vi.stubGlobal('fetch', vi.fn(async () => ok({ id: 42, login: 'alice' })));
});
afterEach(() => vi.unstubAllGlobals());

describe('OAuth callback (S-06 / S-07)', () => {
  it('refuses a code when this tab never armed a state (old code exchanged it)', async () => {
    sessionStorage.setItem(S.OAUTH_PENDING_KEY, 'true');
    setUrl('?code=attackercode&state=whatever');
    const { oauth } = await runPendingCallbacks();
    expect(oauth.handled).toBe(false);
    expect(oauth.error).toMatch(/state mismatch/);
    expect(tokenCalls()).toHaveLength(0);
    expect(auth.storeTokens).not.toHaveBeenCalled();
  });

  it('refuses a mismatched state', async () => {
    const { state } = await S.armOAuthRedirect();
    setUrl(`?code=c&state=${state}tampered`);
    const { oauth } = await runPendingCallbacks();
    expect(oauth.handled).toBe(false);
    expect(tokenCalls()).toHaveLength(0);
  });

  it('exchanges with the matching state and sends the PKCE verifier, then clears it', async () => {
    const { state } = await S.armOAuthRedirect();
    const verifier = sessionStorage.getItem(S.OAUTH_VERIFIER_KEY);
    setUrl(`?code=goodcode&state=${state}`);
    const { oauth } = await runPendingCallbacks();
    expect(oauth.handled).toBe(true);
    const [[, init]] = tokenCalls();
    expect(JSON.parse(init.body)).toMatchObject({ code: 'goodcode', state, code_verifier: verifier });
    expect(sessionStorage.getItem(S.OAUTH_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(S.OAUTH_STATE_KEY)).toBeNull();
  });

  it('also accepts the result stored by the static callback page', async () => {
    const { state } = await S.armOAuthRedirect();
    sessionStorage.setItem('github_oauth_result', JSON.stringify({ code: 'c2', state }));
    const { oauth } = await runPendingCallbacks();
    expect(oauth.handled).toBe(true);
  });
});

describe('App install callback (S-05)', () => {
  it('ignores an installation_id on the URL when no install is pending (old code minted & bound it)', async () => {
    setUrl('?installation_id=666&setup_action=install&state=x');
    const { app } = await runPendingCallbacks();
    expect(app.handled).toBe(false);
    expect(mintCalls()).toHaveLength(0);
    expect(auth.storeAppInstallation).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('ignores it when the state does not match the armed one, and falls back to discovery', async () => {
    S.armAppInstall();
    setUrl('?installation_id=666&setup_action=install&state=forged');
    const { app } = await runPendingCallbacks();
    expect(app.handled).toBe(false);
    expect(mintCalls()).toHaveLength(0);
    expect(oauthFetch.mock.calls.some(([p]) => p === '/api/github/app/installations')).toBe(true);
  });

  it('ignores the old Date.now() style state', async () => {
    sessionStorage.setItem(S.APP_PENDING_KEY, 'true');
    const legacy = String(Date.now());
    setUrl(`?installation_id=666&state=${legacy}`);
    await runPendingCallbacks();
    expect(mintCalls()).toHaveLength(0);
  });

  it('accepts the installation that comes back with this tab\'s state', async () => {
    const state = S.armAppInstall();
    setUrl(`?installation_id=12345&setup_action=install&state=${state}`);
    const { app } = await runPendingCallbacks();
    expect(app.handled).toBe(true);
    const [[, init]] = mintCalls();
    expect(JSON.parse(init.body)).toEqual({ installation_id: '12345' });
    expect(auth.storeAppInstallation).toHaveBeenCalledWith(expect.objectContaining({ installationId: '12345' }));
    expect(sessionStorage.getItem(S.APP_STATE_KEY)).toBeNull();
    expect(sessionStorage.getItem(S.APP_PENDING_KEY)).toBeNull();
  });

  it('rejects a non-numeric installation id even with the right state', async () => {
    const state = S.armAppInstall();
    setUrl(`?installation_id=12345abc&state=${state}`);
    await runPendingCallbacks();
    expect(mintCalls()).toHaveLength(0);
  });

  it('applies the same rule to the static callback page\'s stored result', async () => {
    sessionStorage.setItem('github_app_result', JSON.stringify({ installation_id: '666', state: 'forged' }));
    await runPendingCallbacks();
    expect(mintCalls()).toHaveLength(0);
  });
});

describe('Flows arm crypto-random state (S-05 / S-06 / S-07)', () => {
  let hrefSink;
  const realWindow = globalThis.window;
  beforeEach(() => {
    hrefSink = '';
    // jsdom cannot navigate off-origin; capture the target instead.
    vi.stubGlobal('window', { ...realWindow, location: { set href(v) { hrefSink = v; }, get href() { return hrefSink; } } });
  });

  it('connectOAuth sends a random state and an S256 challenge, never Math.random', async () => {
    const mathRandom = vi.spyOn(Math, 'random');
    await connectOAuth();
    const url = new URL(hrefSink);
    expect(url.hostname).toBe('github.com');
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionStorage.getItem(S.OAUTH_STATE_KEY)).toBe(state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge'))
      .toBe(await S.s256Challenge(sessionStorage.getItem(S.OAUTH_VERIFIER_KEY)));
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('connectApp puts the armed random state on the install URL', async () => {
    auth.forceAppDiscovery.mockResolvedValue(false);
    const r = await connectApp();
    expect(r).toEqual({ installRedirect: true });
    const url = new URL(hrefSink);
    expect(url.pathname).toBe('/apps/redstring-app/installations/new');
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionStorage.getItem(S.APP_STATE_KEY)).toBe(state);
    expect(sessionStorage.getItem(S.APP_PENDING_KEY)).toBe('true');
  });
});
