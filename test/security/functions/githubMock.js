// A tiny in-memory GitHub for the ownership tests. Routes a mocked `fetch`
// by URL + Authorization header and records every call, so tests can assert
// not just the verdict but that nothing was minted on a denial.
//
// Fixtures: caller "alice" (id 42) holds OAuth token CALLER_TOKEN.
//   1001  User install on alice                      (hers)
//   1002  User install on mallory (id 666)           (not hers)
//   2001  Organization install on acme (id 500)      (alice: active member)
//   2002  Organization install on evilcorp (id 501)  (alice: not a member)
//   3001  suspended User install on alice
//   4001  install of a different App (app_id 999)
//   5001  Enterprise install

import { generateKeyPairSync } from 'node:crypto';

export const APP_ID = 12345;
export const CALLER_TOKEN = 'gho_callerTokenAAAAAAAAAAAAAAAAAAAAAAAA';
export const SENTINEL = 'SENTINEL_GITHUB_RAW_BODY_DO_NOT_ECHO';

// Real RSA key generated per test run — never a real credential.
export function makeTestKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const pkcs1 = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey, pkcs1PrivateKey: pkcs1.privateKey };
}

const account = (id, login, type) => ({ id, login, type });

export function defaultInstallations() {
  return {
    1001: { id: 1001, app_id: APP_ID, app_slug: 'redstring-test', target_type: 'User', account: account(42, 'alice', 'User'), permissions: { contents: 'write' }, suspended_at: null },
    1002: { id: 1002, app_id: APP_ID, app_slug: 'redstring-test', target_type: 'User', account: account(666, 'mallory', 'User'), permissions: { contents: 'write' }, suspended_at: null },
    2001: { id: 2001, app_id: APP_ID, app_slug: 'redstring-test', target_type: 'Organization', account: account(500, 'acme', 'Organization'), permissions: { contents: 'write' }, suspended_at: null },
    2002: { id: 2002, app_id: APP_ID, app_slug: 'redstring-test', target_type: 'Organization', account: account(501, 'evilcorp', 'Organization'), permissions: { contents: 'write' }, suspended_at: null },
    3001: { id: 3001, app_id: APP_ID, app_slug: 'redstring-test', target_type: 'User', account: account(42, 'alice', 'User'), permissions: {}, suspended_at: '2026-01-01T00:00:00Z' },
    4001: { id: 4001, app_id: 999, app_slug: 'someone-elses-app', target_type: 'User', account: account(42, 'alice', 'User'), permissions: {}, suspended_at: null },
    5001: { id: 5001, app_id: APP_ID, app_slug: 'redstring-test', target_type: 'Enterprise', account: account(700, 'bigent', 'Enterprise'), permissions: {}, suspended_at: null },
  };
}

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * Build a fetch mock. `overrides` lets a test replace any route:
 *   overrides[key] = (url, init) => Response | Promise<Response> | throws
 * keys: 'user', 'installation', 'membership', 'mint', 'repos', 'userInstallations', 'appInstallations', 'createRepo', 'oauthExchange', 'appToken'
 */
export function createGitHubMock({ installations = defaultInstallations(), overrides = {}, users = null } = {}) {
  const calls = [];
  const tokenUsers = users || { [CALLER_TOKEN]: { id: 42, login: 'alice', type: 'User' } };
  const memberships = {
    acme: { state: 'active', role: 'member', organization: { id: 500, login: 'acme' } },
  };

  const auth = (init) => {
    const h = init?.headers || {};
    if (typeof h.get === 'function') return h.get('authorization') || '';
    for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === 'authorization') return v;
    return '';
  };

  const route = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const authorization = auth(init);
    const p = u.pathname;
    const call = { url: String(url), method, path: p, authorization };
    calls.push(call);

    const use = (key, fallback) => (overrides[key] ? overrides[key](url, init, call) : fallback());

    if (u.host === 'github.com' && p === '/login/oauth/access_token') {
      return use('oauthExchange', () => json(200, { access_token: 'gho_newTokenBBBBBBBBBBBBBBBBBBBBBBBBBB', token_type: 'bearer', scope: 'repo,read:org' }));
    }
    if (p === '/user' && method === 'GET') {
      return use('user', () => {
        const tok = authorization.replace(/^token\s+/i, '');
        const who = tokenUsers[tok];
        return who ? json(200, who) : json(401, { message: `Bad credentials ${SENTINEL}` });
      });
    }
    let m = p.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (m && method === 'POST') {
      return use('mint', () => json(201, { token: `ghs_minted_for_${m[1]}`, expires_at: '2030-01-01T00:00:00Z', permissions: { contents: 'write' } }));
    }
    m = p.match(/^\/app\/installations\/([^/]+)$/);
    if (m && method === 'GET') {
      return use('installation', () => {
        if (!authorization.startsWith('Bearer ')) return json(401, { message: SENTINEL });
        const inst = installations[m[1]];
        return inst ? json(200, inst) : json(404, { message: `Not Found ${SENTINEL}` });
      });
    }
    if (p === '/app/installations' && method === 'GET') {
      return use('appInstallations', () => json(200, Object.values(installations)));
    }
    m = p.match(/^\/user\/memberships\/orgs\/([^/]+)$/);
    if (m && method === 'GET') {
      return use('membership', () => {
        const org = decodeURIComponent(m[1]);
        const mem = memberships[org];
        return mem ? json(200, mem) : json(404, { message: `Not Found ${SENTINEL}` });
      });
    }
    if (p === '/user/installations') {
      return use('userInstallations', () => json(403, { message: `You must authenticate with an access token authorized to a GitHub App ${SENTINEL}` }));
    }
    if (p === '/installation/repositories') {
      return use('repos', () => json(200, { total_count: 1, repositories: [{ id: 1, full_name: 'alice/universe' }] }));
    }
    if (p === '/user/repos' && method === 'POST') {
      return use('createRepo', () => json(201, { id: 9, name: 'new', full_name: 'alice/new', private: true }));
    }
    m = p.match(/^\/applications\/[^/]+\/token$/);
    if (m) {
      return use('appToken', () => json(200, { scopes: ['repo', 'read:org'] }));
    }
    return json(599, { message: `unmocked ${method} ${url}` });
  };

  const fetchMock = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return route(url, init);
  };
  fetchMock.calls = calls;
  fetchMock.minted = () => calls.filter((c) => /\/access_tokens$/.test(c.path));
  fetchMock.memberships = memberships;
  return fetchMock;
}

export { json as jsonResponse };
