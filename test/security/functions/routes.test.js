// @vitest-environment node
//
// Route-level tests for the Cloudflare Pages Function (functions/api/github/
// [[path]].ts), driven through the Hono app with a mocked GitHub.
// S-01, S-04, S-07, S-08, S-09, S-12, I-2.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { importSPKI, jwtVerify } from 'jose';
import {
  createGitHubMock, makeTestKeys, CALLER_TOKEN, APP_ID, SENTINEL, jsonResponse,
} from './githubMock.js';

const { app, __resetRateLimitsForTests } = await import('../../../functions/api/github/[[path]].ts');

let keys;
beforeAll(() => { keys = makeTestKeys(); });

const baseEnv = () => ({
  GITHUB_CLIENT_ID: 'Iv1.testclientid',
  GITHUB_CLIENT_SECRET: 'test-client-secret-value',
  GITHUB_APP_ID: String(APP_ID),
  GITHUB_APP_PRIVATE_KEY: keys.privateKey,
  GITHUB_APP_SLUG: 'redstring-test',
});

const ORIGIN = 'https://redstring.io';

function call(path, { method = 'GET', body, headers = {}, env = baseEnv(), origin = ORIGIN } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] = init.headers['content-type'] || 'application/json';
  }
  return app.request(`${origin}${path}`, init, env);
}

const authed = { authorization: `token ${CALLER_TOKEN}` };

let gh;
beforeEach(() => {
  __resetRateLimitsForTests();
  gh = createGitHubMock();
  vi.stubGlobal('fetch', gh);
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
describe('POST /api/github/app/installation-token (S-01)', () => {
  const mint = (installation_id, headers = authed, env) =>
    call('/api/github/app/installation-token', { method: 'POST', body: { installation_id }, headers, env });

  it('mints for the caller\'s own install and keeps the response shape the SPA reads', async () => {
    const res = await mint(1001);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('ghs_minted_for_1001');
    expect(body.expires_at).toBe('2030-01-01T00:00:00Z');
    expect(body.permissions).toEqual({ contents: 'write' });
    expect(body.account).toMatchObject({ id: 42, login: 'alice' });
    expect(body.repositories).toEqual([{ id: 1, full_name: 'alice/universe' }]);
    expect(body.verification).toMatchObject({ status: 'verified', installationId: 1001, oauthLogin: 'alice' });
    expect(body.service).toBe('oauth-server');
    expect(gh.minted()).toHaveLength(1);
  });

  it('mints with a real App JWT signed by the configured key (iss = App id)', async () => {
    await mint(1001);
    const [m] = gh.minted();
    const jwtStr = m.authorization.replace(/^Bearer\s+/, '');
    const { payload } = await jwtVerify(jwtStr, await importSPKI(keys.publicKey, 'RS256'));
    expect(payload.iss).toBe(String(APP_ID));
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(11 * 60);
  });

  it('works with a PKCS#1 App key too', async () => {
    const env = { ...baseEnv(), GITHUB_APP_PRIVATE_KEY: keys.pkcs1PrivateKey };
    const res = await mint(1001, authed, env);
    expect(res.status).toBe(200);
  });

  it('mints for an org install the caller is an active member of', async () => {
    const res = await mint('2001');
    expect(res.status).toBe(200);
    expect(gh.minted()[0].path).toBe('/app/installations/2001/access_tokens');
  });

  it('refuses another user\'s install with 403 and mints nothing', async () => {
    const res = await mint(1002);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('account_mismatch');
    expect(gh.minted()).toHaveLength(0);
  });

  it('refuses an org install the caller is not a member of, and mints nothing', async () => {
    const res = await mint(2002);
    expect(res.status).toBe(403);
    expect(gh.minted()).toHaveLength(0);
  });

  it('refuses without an Authorization header (401) and never signs or calls GitHub', async () => {
    const res = await mint(1001, {});
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('oauth_required');
    expect(gh.calls).toHaveLength(0);
  });

  it('refuses an installation token presented as the caller', async () => {
    const res = await mint(1001, { authorization: 'token ghs_notAUserTokenXXXXXXXXXXXXXXXXXX' });
    expect(res.status).toBe(400);
    expect(gh.minted()).toHaveLength(0);
  });

  it.each([['1001abc'], ['../1002'], [-1], ['1002 ']])('refuses malformed installation id %j', async (id) => {
    const res = await mint(id);
    expect(res.status).toBe(400);
    expect(gh.minted()).toHaveLength(0);
  });

  it('refuses a missing installation id', async () => {
    const res = await call('/api/github/app/installation-token', { method: 'POST', body: {}, headers: authed });
    expect(res.status).toBe(400);
  });

  it.each([['user'], ['installation'], ['membership']])('fails closed when GitHub %s lookup errors — no mint', async (route) => {
    gh = createGitHubMock({ overrides: { [route]: () => jsonResponse(502, { message: SENTINEL }) } });
    vi.stubGlobal('fetch', gh);
    const res = await mint(route === 'membership' ? 2001 : 1001);
    expect(res.status).toBe(502);
    expect(gh.minted()).toHaveLength(0);
  });

  it('still refuses when /user/installations would have said "unverified" (the old fail-open path)', async () => {
    // Old code: /user/installations 403 → 'unverified' → mint anyway.
    const res = await mint(1002);
    expect(res.status).toBe(403);
    expect(gh.calls.some((c) => c.path === '/user/installations')).toBe(false);
  });

  it('does not echo GitHub\'s raw body when the mint itself fails (S-09)', async () => {
    gh = createGitHubMock({ overrides: { mint: () => jsonResponse(500, { message: SENTINEL }) } });
    vi.stubGlobal('fetch', gh);
    const res = await mint(1001);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(SENTINEL);
    expect(JSON.parse(text).code).toBe('token_mint_failed');
  });

  it('returns 500 app_not_configured (without detail) when the App key is unusable', async () => {
    const res = await mint(1001, authed, { ...baseEnv(), GITHUB_APP_PRIVATE_KEY: 'not a pem' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('app_not_configured');
    expect(JSON.stringify(body)).not.toMatch(/PEM|PKCS/);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/github/app/installation/:id (S-04)', () => {
  it('returns installation data for the owner', async () => {
    const res = await call('/api/github/app/installation/1001', { headers: authed });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.login).toBe('alice');
    expect(body.installation.id).toBe(1001);
    expect(body.repositories).toHaveLength(1);
  });

  it('refuses a stranger\'s installation and mints nothing', async () => {
    const res = await call('/api/github/app/installation/1002', { headers: authed });
    expect(res.status).toBe(403);
    expect(gh.minted()).toHaveLength(0);
  });

  it('refuses without a token', async () => {
    const res = await call('/api/github/app/installation/1001');
    expect(res.status).toBe(401);
    expect(gh.calls).toHaveLength(0);
  });

  it('fails closed when GitHub errors', async () => {
    gh = createGitHubMock({ overrides: { user: () => jsonResponse(503, {}) } });
    vi.stubGlobal('fetch', gh);
    const res = await call('/api/github/app/installation/1001', { headers: authed });
    expect(res.status).toBe(502);
    expect(gh.minted()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/github/app/create-repository (S-04)', () => {
  const create = (installation_id, headers = authed) =>
    call('/api/github/app/create-repository', { method: 'POST', body: { installation_id, name: 'universe' }, headers });

  it('creates for the owner', async () => {
    const res = await create(1001);
    expect(res.status).toBe(200);
    expect(gh.calls.some((c) => c.path === '/user/repos')).toBe(true);
  });

  it('refuses a stranger\'s installation: no mint, no repo', async () => {
    const res = await create(1002);
    expect(res.status).toBe(403);
    expect(gh.minted()).toHaveLength(0);
    expect(gh.calls.some((c) => c.path === '/user/repos')).toBe(false);
  });

  it('refuses without a token', async () => {
    const res = await create(1001, {});
    expect(res.status).toBe(401);
    expect(gh.calls).toHaveLength(0);
  });

  it('does not echo GitHub\'s raw error body', async () => {
    gh = createGitHubMock({ overrides: { createRepo: () => jsonResponse(500, { message: SENTINEL }) } });
    vi.stubGlobal('fetch', gh);
    const res = await create(1001);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it('passes GitHub\'s short validation message through on a 422 (user input problem)', async () => {
    gh = createGitHubMock({
      overrides: { createRepo: () => jsonResponse(422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] }) },
    });
    vi.stubGlobal('fetch', gh);
    const res = await create(1001);
    expect(res.status).toBe(422);
    expect((await res.json()).details).toContain('name already exists');
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/github/app/installations', () => {
  it('fallback keeps only personal installs whose account id is the caller\'s id', async () => {
    const installs = {
      1001: { id: 1001, app_id: APP_ID, target_type: 'User', account: { id: 42, login: 'alice' }, created_at: '2025-01-01' },
      // Same login, different account id (renamed + re-registered login).
      1100: { id: 1100, app_id: APP_ID, target_type: 'User', account: { id: 9999, login: 'Alice' }, created_at: '2025-02-01' },
      1002: { id: 1002, app_id: APP_ID, target_type: 'User', account: { id: 666, login: 'mallory' }, created_at: '2025-03-01' },
    };
    gh = createGitHubMock({ installations: installs });
    vi.stubGlobal('fetch', gh);
    const res = await call('/api/github/app/installations', { headers: authed });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((i) => i.id)).toEqual([1001]);
  });

  it('requires a token', async () => {
    expect((await call('/api/github/app/installations')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('OAuth routes (S-07, S-09)', () => {
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  it('forwards a PKCE code_verifier to GitHub', async () => {
    const res = await call('/api/github/oauth/token', {
      method: 'POST',
      body: { code: 'abc', state: 'xyz', redirect_uri: 'https://redstring.io/oauth/callback', code_verifier: VERIFIER },
    });
    expect(res.status).toBe(200);
    const exchange = gh.calls.find((c) => c.path === '/login/oauth/access_token');
    expect(exchange).toBeTruthy();
  });

  it('sends code_verifier in the exchange body', async () => {
    let sent;
    gh = createGitHubMock({
      overrides: {
        oauthExchange: (_u, init) => {
          sent = JSON.parse(init.body);
          return jsonResponse(200, { access_token: 'gho_x', token_type: 'bearer', scope: 'repo' });
        },
        appToken: () => jsonResponse(200, { scopes: ['repo'] }),
        user: () => jsonResponse(200, { id: 1, login: 'x' }),
      },
    });
    vi.stubGlobal('fetch', gh);
    await call('/api/github/oauth/token', { method: 'POST', body: { code: 'abc', state: 'xyz', code_verifier: VERIFIER } });
    expect(sent.code_verifier).toBe(VERIFIER);
    expect(sent.client_secret).toBe('test-client-secret-value');
  });

  it('omits code_verifier when the SPA did not send one (tolerant)', async () => {
    let sent;
    gh = createGitHubMock({
      overrides: {
        oauthExchange: (_u, init) => {
          sent = JSON.parse(init.body);
          return jsonResponse(200, { access_token: 'gho_x', scope: 'repo' });
        },
        appToken: () => jsonResponse(200, { scopes: ['repo'] }),
      },
    });
    vi.stubGlobal('fetch', gh);
    await call('/api/github/oauth/token', { method: 'POST', body: { code: 'abc', state: 'xyz' } });
    expect('code_verifier' in sent).toBe(false);
  });

  it.each([['short'], ['has spaces in it which are not allowed at all nope nope'], ['x'.repeat(129)], [123]])(
    'rejects a malformed code_verifier %j without calling GitHub', async (v) => {
      const res = await call('/api/github/oauth/token', { method: 'POST', body: { code: 'a', state: 'b', code_verifier: v } });
      expect(res.status).toBe(400);
      expect(gh.calls).toHaveLength(0);
    },
  );

  it('does not echo GitHub\'s error description on a rejected code', async () => {
    gh = createGitHubMock({
      overrides: { oauthExchange: () => jsonResponse(200, { error: 'bad_verification_code', error_description: SENTINEL }) },
    });
    vi.stubGlobal('fetch', gh);
    const res = await call('/api/github/oauth/token', { method: 'POST', body: { code: 'a', state: 'b' } });
    expect(res.ok).toBe(false);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it('does not echo GitHub\'s body when validation fails', async () => {
    gh = createGitHubMock({ overrides: { appToken: () => jsonResponse(422, { message: SENTINEL }) } });
    vi.stubGlobal('fetch', gh);
    const res = await call('/api/github/oauth/validate', { method: 'POST', body: { access_token: 'gho_x' } });
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it('keeps 401 for an invalid token on /oauth/validate (persistentAuth relies on it)', async () => {
    gh = createGitHubMock({ overrides: { appToken: () => jsonResponse(404, { message: SENTINEL }) } });
    vi.stubGlobal('fetch', gh);
    const res = await call('/api/github/oauth/validate', { method: 'POST', body: { access_token: 'gho_x' } });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it('/oauth/client-id returns the public id only — nothing about the secret', async () => {
    const res = await call('/api/github/oauth/client-id');
    const body = await res.json();
    expect(body.clientId).toBe('Iv1.testclientid');
    expect(body).not.toHaveProperty('clientSecretValid');
    expect(body).not.toHaveProperty('configured');
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
  });
});

// ---------------------------------------------------------------------------
describe('Webhook (S-12)', () => {
  const SECRET = 'whsec_test_value';
  const payload = JSON.stringify({ action: 'created', installation: { id: 1 } });
  const sign = (body, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const deliver = (headers, env = { ...baseEnv(), GITHUB_APP_WEBHOOK_SECRET: SECRET }) =>
    call('/api/github/app/webhook', { method: 'POST', body: payload, headers: { 'x-github-event': 'installation', ...headers }, env });

  it('refuses every delivery when no secret is configured', async () => {
    const res = await deliver({}, baseEnv());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('webhook_not_configured');
  });

  it('refuses an unsigned delivery', async () => {
    expect((await deliver({})).status).toBe(401);
  });

  it('refuses a wrongly signed delivery', async () => {
    expect((await deliver({ 'x-hub-signature-256': sign(payload, 'other') })).status).toBe(401);
  });

  it('accepts a correctly signed delivery', async () => {
    const res = await deliver({ 'x-hub-signature-256': sign(payload) });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('CORS (I-2)', () => {
  const acao = async (origin, { env = baseEnv(), host = ORIGIN } = {}) => {
    const res = await call('/api/github/oauth/client-id', { headers: { origin }, env, origin: host });
    return res.headers.get('access-control-allow-origin');
  };

  it('allows https://redstring.io', async () => {
    expect(await acao('https://redstring.io')).toBe('https://redstring.io');
  });

  it('does NOT allow localhost origins in production', async () => {
    expect(await acao('http://localhost:4001')).toBeNull();
    expect(await acao('http://127.0.0.1:4001')).toBeNull();
  });

  it('allows localhost when explicitly enabled for the environment', async () => {
    const env = { ...baseEnv(), ALLOW_LOCALHOST_ORIGINS: 'true' };
    expect(await acao('http://localhost:4001', { env })).toBe('http://localhost:4001');
  });

  it('allows localhost when the Function itself runs on localhost (wrangler pages dev)', async () => {
    expect(await acao('http://localhost:4001', { host: 'http://localhost:8788' })).toBe('http://localhost:4001');
  });

  it('does not allow http://redstring.io or lookalike hosts', async () => {
    expect(await acao('http://redstring.io')).toBeNull();
    expect(await acao('https://redstring.io.evil.com')).toBeNull();
    expect(await acao('https://evilredstring.io')).toBeNull();
    expect(await acao('null')).toBeNull();
  });

  it('keeps *.pages.dev opt-in', async () => {
    expect(await acao('https://evil.pages.dev')).toBeNull();
    const env = { ...baseEnv(), ALLOW_PREVIEW_ORIGINS: 'true' };
    expect(await acao('https://x.redstring-staging.pages.dev', { env })).toBe('https://x.redstring-staging.pages.dev');
  });
});

// ---------------------------------------------------------------------------
describe('Rate limiting (S-08)', () => {
  it('limits sensitive routes per client IP and says when to retry', async () => {
    const headers = { 'cf-connecting-ip': '203.0.113.7' };
    let last;
    for (let i = 0; i < 61; i++) {
      last = await call('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 1 }, headers });
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    // A different client is unaffected.
    const other = await call('/api/github/app/installation-token', {
      method: 'POST', body: { installation_id: 1 }, headers: { 'cf-connecting-ip': '203.0.113.8' },
    });
    expect(other.status).toBe(401);
  });

  it('has a global per-IP ceiling on cheap routes too', async () => {
    const headers = { 'cf-connecting-ip': '198.51.100.1' };
    let last;
    for (let i = 0; i < 301; i++) last = await call('/api/github/app/info', { headers });
    expect(last.status).toBe(429);
  });

  it('consults a RATE_LIMITER binding when one is bound', async () => {
    const env = { ...baseEnv(), RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } };
    const res = await call('/api/github/app/info', { headers: { 'cf-connecting-ip': '192.0.2.1' }, env });
    expect(res.status).toBe(429);
    expect(env.RATE_LIMITER.limit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Response hardening', () => {
  it('marks API responses no-store / nosniff / no-referrer', async () => {
    const res = await call('/api/github/app/installation-token', { method: 'POST', body: { installation_id: 1001 }, headers: authed });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('unknown routes 404 without echoing the path', async () => {
    const res = await call('/api/github/<script>');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<script>');
  });
});
