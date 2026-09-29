// @vitest-environment node
//
// S-01 / S-04 / S-02 — contract C-9. The same fail-closed matrix runs against
// both implementations of verifyInstallOwnership: the Cloudflare Function's
// (functions/_lib/ownership.ts, what redstring.io runs) and the legacy Node
// oauth-server's port.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGitHubMock, CALLER_TOKEN, APP_ID, jsonResponse } from './githubMock.js';

// oauth-server.js imports node-fetch, dotenv, a token vault and an analytics
// singleton at load. Keep the test hermetic: route node-fetch to the mocked
// global fetch, and never read a developer's .env / github.env.local.
vi.mock('node-fetch', () => ({ default: (...args) => globalThis.fetch(...args) }));
vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));
vi.mock('../../../src/services/UserAnalytics.js', () => ({ default: { trackActivity() {}, cleanup() {} } }));
vi.mock('../../../src/services/server/tokenVault.js', () => ({
  default: {
    getOAuthCredentials: () => null,
    getGitHubAppInstallation: () => null,
    setGitHubAppInstallation: (x) => x,
    setOAuthCredentials: (x) => x,
  },
}));

const fnImpl = await import('../../../functions/_lib/ownership.ts');
const nodeImpl = await import('../../../oauth-server.js');

const JWT = 'header.payload.signature';

const implementations = [
  ['Cloudflare Function (functions/_lib/ownership.ts)', fnImpl.verifyInstallOwnership],
  ['legacy oauth-server.js', nodeImpl.verifyInstallOwnership],
];

describe.each(implementations)('verifyInstallOwnership — %s', (_name, verify) => {
  let gh;
  beforeEach(() => {
    gh = createGitHubMock();
    vi.stubGlobal('fetch', gh);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (id, token = CALLER_TOKEN, appId = APP_ID, jwt = JWT) => verify(id, token, jwt, appId);

  // --- allowed ---------------------------------------------------------------

  it('allows the caller\'s own personal install', async () => {
    const r = await run(1001);
    expect(r).toMatchObject({ ok: true, installationId: 1001, user: { id: 42, login: 'alice' } });
    expect(r.installation.account.login).toBe('alice');
  });

  it('accepts the id as a decimal string and returns it as a number', async () => {
    const r = await run('1001');
    expect(r.ok).toBe(true);
    expect(r.installationId).toBe(1001);
  });

  it('accepts the configured App id as a string (Worker secrets are strings)', async () => {
    const r = await run(1001, CALLER_TOKEN, String(APP_ID));
    expect(r.ok).toBe(true);
  });

  it('allows an org install when the caller is an ACTIVE member of that org', async () => {
    const r = await run(2001);
    expect(r).toMatchObject({ ok: true, installationId: 2001 });
    const mem = gh.calls.find((c) => c.path === '/user/memberships/orgs/acme');
    expect(mem.authorization).toBe(`token ${CALLER_TOKEN}`);
  });

  it('asks GitHub about the installation with the App JWT, and about the user with the caller token', async () => {
    await run(1001);
    expect(gh.calls.find((c) => c.path === '/user').authorization).toBe(`token ${CALLER_TOKEN}`);
    expect(gh.calls.find((c) => c.path === '/app/installations/1001').authorization).toBe(`Bearer ${JWT}`);
  });

  it('never mints anything itself', async () => {
    await run(1001);
    expect(gh.minted()).toHaveLength(0);
  });

  // --- denied: ownership ------------------------------------------------------

  it('denies another user\'s personal install (the live S-01 attack)', async () => {
    const r = await run(1002);
    expect(r).toEqual({ ok: false, code: 'account_mismatch', status: 403 });
  });

  it('denies an org install when the caller is not a member (404)', async () => {
    const r = await run(2002);
    expect(r).toEqual({ ok: false, code: 'not_org_member', status: 403 });
  });

  it('denies an org install when GitHub refuses the membership lookup (403: no read:org / SSO)', async () => {
    gh = createGitHubMock({ overrides: { membership: () => jsonResponse(403, { message: 'nope' }) } });
    vi.stubGlobal('fetch', gh);
    expect(await run(2001)).toEqual({ ok: false, code: 'not_org_member', status: 403 });
  });

  it('denies a pending (not yet accepted) org membership', async () => {
    gh.memberships.acme.state = 'pending';
    expect(await run(2001)).toEqual({ ok: false, code: 'not_org_member', status: 403 });
  });

  it('denies when the membership belongs to a different org id than the install account', async () => {
    gh.memberships.acme.organization.id = 9999;
    expect(await run(2001)).toEqual({ ok: false, code: 'not_org_member', status: 403 });
  });

  it('denies a suspended install', async () => {
    expect(await run(3001)).toEqual({ ok: false, code: 'installation_suspended', status: 403 });
  });

  it('denies an install of a different App', async () => {
    expect(await run(4001)).toEqual({ ok: false, code: 'app_credentials_mismatch', status: 409 });
  });

  it('denies an Enterprise (or any non User/Organization) install', async () => {
    expect(await run(5001)).toEqual({ ok: false, code: 'unsupported_target', status: 403 });
  });

  it('denies a nonexistent installation', async () => {
    expect(await run(77777)).toEqual({ ok: false, code: 'installation_not_found', status: 404 });
  });

  it('denies when account.type disagrees with target_type', async () => {
    gh = createGitHubMock({
      overrides: {
        installation: () => jsonResponse(200, { id: 1001, app_id: APP_ID, target_type: 'User', account: { id: 42, login: 'alice', type: 'Organization' } }),
      },
    });
    vi.stubGlobal('fetch', gh);
    expect(await run(1001)).toMatchObject({ ok: false, code: 'unsupported_target' });
  });

  it('compares account ids strictly (a string "42" is not user 42)', async () => {
    gh = createGitHubMock({
      overrides: {
        installation: () => jsonResponse(200, { id: 1001, app_id: APP_ID, target_type: 'User', account: { id: '42', login: 'alice' } }),
      },
    });
    vi.stubGlobal('fetch', gh);
    expect((await run(1001)).ok).toBe(false);
  });

  it('denies when GitHub returns a different installation than the one asked for', async () => {
    gh = createGitHubMock({
      overrides: {
        installation: () => jsonResponse(200, { id: 1001, app_id: APP_ID, target_type: 'User', account: { id: 42, login: 'alice' } }),
      },
    });
    vi.stubGlobal('fetch', gh);
    expect(await run(1002)).toEqual({ ok: false, code: 'github_error', status: 502 });
  });

  it('denies when the install has no account', async () => {
    gh = createGitHubMock({
      overrides: { installation: () => jsonResponse(200, { id: 1001, app_id: APP_ID, target_type: 'User' }) },
    });
    vi.stubGlobal('fetch', gh);
    expect(await run(1001)).toEqual({ ok: false, code: 'github_error', status: 502 });
  });

  // --- denied: caller token ---------------------------------------------------

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['with a newline (header injection)', 'gho_abc\r\nX-Evil: 1'],
    ['with a space', 'gho_abc def'],
    ['non-string', 12345],
    ['absurdly long', 'g'.repeat(600)],
  ])('refuses a %s caller token without calling GitHub', async (_label, token) => {
    const r = await verify(1001, token, JWT, APP_ID);
    expect(r).toEqual({ ok: false, code: 'oauth_required', status: 401 });
    expect(gh.calls).toHaveLength(0);
  });

  it('refuses an installation token (ghs_) as a caller identity, without calling GitHub', async () => {
    const r = await run(1001, 'ghs_installationTokenXXXXXXXXXXXXXXXXXXXX');
    expect(r).toEqual({ ok: false, code: 'wrong_token_type', status: 400 });
    expect(gh.calls).toHaveLength(0);
  });

  it('maps a revoked caller token (GET /user 401) to oauth_invalid', async () => {
    const r = await run(1001, 'gho_revokedCCCCCCCCCCCCCCCCCCCCCCCCCCC');
    expect(r).toEqual({ ok: false, code: 'oauth_invalid', status: 401 });
    expect(gh.calls.some((c) => c.path.startsWith('/app/'))).toBe(false);
  });

  it('denies when /user returns no numeric id', async () => {
    gh = createGitHubMock({ overrides: { user: () => jsonResponse(200, { login: 'alice' }) } });
    vi.stubGlobal('fetch', gh);
    expect(await run(1001)).toEqual({ ok: false, code: 'github_error', status: 502 });
  });

  // --- denied: installation id ------------------------------------------------

  it.each([
    ['abc'], ['12abc'], ['1e3'], ['0x1f'], [' 1001'], ['1001 '], ['-1'], ['0'], ['01001'],
    ['1001/../1002'], ['1001?x=1'], [-1], [0], [1.5], [NaN], [Infinity], [2 ** 53],
    [null], [undefined], [{}], [[1001]], [true], ['99999999999999999999'],
  ])('refuses installation id %j without calling GitHub', async (id) => {
    const r = await run(id);
    expect(r).toEqual({ ok: false, code: 'invalid_installation_id', status: 400 });
    expect(gh.calls).toHaveLength(0);
  });

  // --- denied: configuration ---------------------------------------------------

  it.each([[undefined], [''], ['abc'], [0], [-5]])('refuses when the configured App id is %j', async (appId) => {
    expect(await verify(1001, CALLER_TOKEN, JWT, appId)).toEqual({ ok: false, code: 'app_not_configured', status: 500 });
  });

  it('refuses without an App JWT', async () => {
    expect(await run(1001, CALLER_TOKEN, APP_ID, '')).toEqual({ ok: false, code: 'app_not_configured', status: 500 });
  });

  // --- denied: GitHub trouble (fail closed) -------------------------------------

  it.each([
    ['user', 500], ['user', 502], ['user', 403], ['user', 429],
    ['installation', 500], ['installation', 503], ['installation', 403], ['installation', 301],
    ['membership', 500], ['membership', 502],
  ])('denies when GitHub %s lookup returns %i', async (route, status) => {
    gh = createGitHubMock({ overrides: { [route]: () => jsonResponse(status, { message: 'boom' }) } });
    vi.stubGlobal('fetch', gh);
    const id = route === 'membership' ? 2001 : 1001;
    const r = await run(id);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(route === 'installation' && status === 401 ? 'github_app_auth_failed' : 'github_error');
  });

  it('reports a rejected App JWT as github_app_auth_failed', async () => {
    gh = createGitHubMock({ overrides: { installation: () => jsonResponse(401, { message: 'bad jwt' }) } });
    vi.stubGlobal('fetch', gh);
    expect(await run(1001)).toEqual({ ok: false, code: 'github_app_auth_failed', status: 502 });
  });

  it.each(['user', 'installation', 'membership'])('denies when the %s lookup throws (network error)', async (route) => {
    gh = createGitHubMock({ overrides: { [route]: () => { throw new TypeError('fetch failed'); } } });
    vi.stubGlobal('fetch', gh);
    const r = await run(route === 'membership' ? 2001 : 1001);
    expect(r).toEqual({ ok: false, code: 'github_error', status: 502 });
  });

  it.each(['user', 'installation', 'membership'])('denies when the %s lookup returns malformed JSON', async (route) => {
    gh = createGitHubMock({
      overrides: { [route]: () => new Response('<html>not json', { status: 200, headers: { 'content-type': 'text/html' } }) },
    });
    vi.stubGlobal('fetch', gh);
    const r = await run(route === 'membership' ? 2001 : 1001);
    expect(r.ok).toBe(false);
  });
});
