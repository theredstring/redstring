// Cloudflare Pages Function — catch-all router for all /api/github/** endpoints.
//
// Port of the Node oauth-server.js endpoint set (~10 endpoints + 7 stateless
// stubs). One credential set per Worker environment — see _lib/env.ts.
//
// Mounting: this file is automatically invoked by Cloudflare Pages for any
// request matching /api/github/* (see public/_routes.json).
//
// Security posture (see documentation/security/):
// - Every route that acts on a GitHub App installation id goes through
//   requireInstallOwnership → verifyInstallOwnership (_lib/ownership.ts),
//   which fails closed (S-01/S-04).
// - Error bodies carry a status and a short `code`; GitHub's raw responses and
//   configuration details are logged server-side only (S-09).
// - Best-effort per-isolate rate limiting (S-08) — the WAF rule is the wall.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handle } from 'hono/cloudflare-pages';
import type { Env } from '../../_lib/env';
import { USER_AGENT } from '../../_lib/env';
import { appJwt } from '../../_lib/jwt';
import {
  extractOAuthToken,
  fetchOAuthUser,
  listInstallationsViaOAuth,
} from '../../_lib/github';
import {
  verifyInstallOwnership,
  verificationSummary,
  type OwnershipDenyCode,
} from '../../_lib/ownership';
import {
  createRateLimiter,
  isSensitivePath,
  GLOBAL_RULE,
  SENSITIVE_RULE,
} from '../../_lib/rateLimit';

const SERVICE = 'oauth-server'; // SPA may assert on this; keep stable
const app = new Hono<{ Bindings: Env }>();
let limiter = createRateLimiter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fail = (c: any, status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  c.json({ error, code, ...extra, service: SERVICE }, status as any);

// Server-side detail for `wrangler pages deployment tail`. Never includes
// tokens; GitHub bodies are truncated.
const logDetail = (where: string, info: Record<string, unknown>) => {
  try { console.error(`[github-fn] ${where}`, JSON.stringify(info).slice(0, 1000)); } catch { /* ignore */ }
};

const readJson = async (c: any): Promise<any> => {
  try { return (await c.req.json()) || {}; } catch { return {}; }
};

const ghHeaders = (authorization: string, extra: Record<string, string> = {}) => ({
  'Accept': 'application/vnd.github.v3+json',
  'Authorization': authorization,
  'User-Agent': USER_AGENT,
  ...extra,
});

const isLoopbackHost = (host: string) =>
  host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1';

const OWNERSHIP_MESSAGES: Record<OwnershipDenyCode, string> = {
  invalid_installation_id: 'Invalid installation ID',
  oauth_required: 'OAuth token required',
  wrong_token_type: 'Wrong token type',
  app_not_configured: 'GitHub App not configured',
  oauth_invalid: 'GitHub OAuth token is invalid or expired. Please reconnect OAuth and retry.',
  installation_not_found: 'Installation not found',
  app_credentials_mismatch: 'GitHub App credential mismatch',
  installation_suspended: 'Installation suspended',
  account_mismatch: 'GitHub App installation not accessible for the connected OAuth account',
  not_org_member: 'GitHub App installation not accessible for the connected OAuth account',
  unsupported_target: 'GitHub App installation not accessible for the connected OAuth account',
  github_app_auth_failed: 'GitHub App authentication failed',
  github_error: 'GitHub request failed',
};

// Ownership gate (contract C-9). The SPA passes its OAuth user token in
// `Authorization: token …`; the Worker proves the caller owns — or is an
// active member of the org that owns — the installation before acting on it.
// Returns a Response to short-circuit on refusal, otherwise the verified
// installation, the caller, and the App JWT to reuse.
async function requireInstallOwnership(c: any, rawInstallationId: unknown) {
  const oauthToken = extractOAuthToken(c.req.header('authorization'));
  if (!oauthToken) {
    return fail(c, 401, 'oauth_required', OWNERSHIP_MESSAGES.oauth_required);
  }
  const appId = c.env.GITHUB_APP_ID;
  const privateKey = c.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    return fail(c, 500, 'app_not_configured', OWNERSHIP_MESSAGES.app_not_configured);
  }
  let jwtStr: string;
  try {
    jwtStr = await appJwt(appId, privateKey);
  } catch (e: any) {
    logDetail('app jwt signing failed', { message: e?.message || String(e) });
    return fail(c, 500, 'app_not_configured', OWNERSHIP_MESSAGES.app_not_configured);
  }
  const result = await verifyInstallOwnership(rawInstallationId, oauthToken, jwtStr, appId);
  if (!result.ok) {
    console.warn('[github-fn] installation access denied', { code: result.code });
    return fail(c, result.status, result.code, OWNERSHIP_MESSAGES[result.code]);
  }
  return { ...result, jwtStr };
}

async function mintInstallationToken(installationId: number, jwtStr: string) {
  const resp = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: ghHeaders(`Bearer ${jwtStr}`),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    logDetail('installation token mint failed', { status: resp.status, body: text.slice(0, 300) });
    return { ok: false as const, status: resp.status };
  }
  const data: any = await resp.json().catch(() => null);
  if (!data?.token) return { ok: false as const, status: 502 };
  return { ok: true as const, data };
}

function mintFailure(c: any, status: number) {
  if (status === 404) return fail(c, 404, 'installation_not_found', 'Installation not found');
  if (status === 401) return fail(c, 502, 'github_app_auth_failed', 'GitHub App authentication failed');
  if (status === 403) return fail(c, 502, 'installation_forbidden', 'Installation access forbidden');
  return fail(c, 502, 'token_mint_failed', 'Failed to generate installation token');
}

async function listInstallationRepositories(installationToken: string): Promise<any[]> {
  try {
    const resp = await fetch('https://api.github.com/installation/repositories', {
      headers: ghHeaders(`token ${installationToken}`),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    return Array.isArray(data?.repositories) ? data.repositories : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Response hardening for everything this Function returns. public/_headers
// does not apply to Function responses, so API responses get their own.
app.use('*', async (c, next) => {
  await next();
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
  try {
    for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
  } catch {
    // Immutable headers (e.g. a Response.redirect) — rebuild the response.
    c.res = new Response(c.res.body, c.res);
    for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
  }
});

// CORS — same-origin (Pages serves SPA + this function) doesn't need it, but
// cross-origin dev setups do. Allow redstring.io by default. Localhost is NOT
// allowed in production: only when the Function itself is served from
// localhost (`wrangler pages dev`) or the environment opts in with
// ALLOW_LOCALHOST_ORIGINS=true (I-2). `*.pages.dev` / `*.workers.dev` are
// attacker-registrable, so that broad preview allowance is opt-in per
// environment via ALLOW_PREVIEW_ORIGINS=true.
app.use('/api/github/*', cors({
  origin: (origin, c) => {
    if (!origin) return '*';
    const env = c?.env as Env | undefined;
    const allowPreview = env?.ALLOW_PREVIEW_ORIGINS === 'true';
    let allowLocal = env?.ALLOW_LOCALHOST_ORIGINS === 'true';
    try {
      if (!allowLocal && isLoopbackHost(new URL(c.req.url).hostname)) allowLocal = true;
    } catch { /* ignore */ }
    try {
      const u = new URL(origin);
      const host = u.hostname;
      if (u.protocol === 'https:' && (host === 'redstring.io' || host.endsWith('.redstring.io'))) return origin;
      if (allowLocal && (u.protocol === 'http:' || u.protocol === 'https:') && isLoopbackHost(host)) return origin;
      if (allowPreview && u.protocol === 'https:' && (host.endsWith('.pages.dev') || host.endsWith('.workers.dev'))) return origin;
    } catch { /* ignore */ }
    return null;
  },
  credentials: false,
}));

// Rate limiting (S-08). Keyed on CF-Connecting-IP, which Cloudflare always
// sets and clients cannot forge; requests without it (local wrangler dev)
// are not limited.
app.use('/api/github/*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip');
  if (!ip || c.req.method === 'OPTIONS') return next();
  const sensitive = isSensitivePath(c.req.path);
  const rules = sensitive ? [SENSITIVE_RULE, GLOBAL_RULE] : [GLOBAL_RULE];
  for (const rule of rules) {
    const d = limiter.check(ip, rule);
    if (!d.ok) {
      c.header('Retry-After', String(d.retryAfterSec));
      return fail(c, 429, 'rate_limited', 'Too many requests');
    }
  }
  const binding = (c.env as Env | undefined)?.RATE_LIMITER;
  if (binding) {
    try {
      const r = await binding.limit({ key: `${sensitive ? 's' : 'g'}:${ip}` });
      if (!r.success) return fail(c, 429, 'rate_limited', 'Too many requests');
    } catch { /* binding unavailable — in-isolate limit still applied */ }
  }
  return next();
});

app.onError((err, c) => {
  logDetail('unhandled error', { path: c.req.path, message: (err as any)?.message || String(err) });
  return fail(c, 500, 'internal_error', 'Internal error');
});

// =============================================================================
// /api/github/oauth/* — user-facing OAuth flow
// =============================================================================

// Public client ID for the SPA to start the OAuth dance. Deliberately says
// nothing about whether the secret is configured (S-09).
app.get('/api/github/oauth/client-id', (c) => {
  const clientId = (c.env.GITHUB_CLIENT_ID || '').trim();
  return c.json({ clientId: clientId || null, service: SERVICE });
});

// RFC 7636 code_verifier: 43–128 chars of the unreserved set.
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

// Exchange OAuth code for access token, validate, fetch user, return.
app.post('/api/github/oauth/token', async (c) => {
  const body = await readJson(c);
  const { code, state, redirect_uri, code_verifier } = body || {};

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    return fail(c, 400, 'missing_code_or_state', 'Missing code or state');
  }
  // PKCE (S-07): forwarded when present. GitHub then requires it to match
  // the code_challenge sent on the authorize request.
  if (code_verifier != null && (typeof code_verifier !== 'string' || !PKCE_VERIFIER_RE.test(code_verifier))) {
    return fail(c, 400, 'invalid_code_verifier', 'Invalid code_verifier');
  }
  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail(c, 500, 'oauth_not_configured', 'GitHub OAuth not configured');
  }

  // Step 1: exchange code → token
  const exchange: Record<string, string> = {
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    code,
    state,
  };
  if (typeof redirect_uri === 'string' && redirect_uri) exchange.redirect_uri = redirect_uri;
  if (typeof code_verifier === 'string') exchange.code_verifier = code_verifier;

  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify(exchange),
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text().catch(() => '');
    logDetail('oauth code exchange http error', { status: tokenResp.status, body: errText.slice(0, 300) });
    return fail(c, 502, 'token_exchange_failed', 'GitHub token exchange failed');
  }
  const tokenData: any = await tokenResp.json().catch(() => ({}));
  if (tokenData.error || !tokenData.access_token) {
    logDetail('oauth code exchange rejected', { error: tokenData.error || 'no_access_token', description: tokenData.error_description });
    return fail(c, 400, 'token_exchange_rejected', 'GitHub rejected the authorization code');
  }

  // Step 2: validate token + check `repo` scope (same as Node server)
  const basic = btoa(`${clientId.trim()}:${clientSecret.trim()}`);
  const validateResp = await fetch(`https://api.github.com/applications/${clientId.trim()}/token`, {
    method: 'POST',
    headers: { ...ghHeaders(`Basic ${basic}`), 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: tokenData.access_token }),
  });
  if (!validateResp.ok) {
    const vtext = await validateResp.text().catch(() => '');
    logDetail('oauth token validation failed', { status: validateResp.status, body: vtext.slice(0, 300) });
    return fail(c, 400, 'token_validation_failed', 'Token validation failed');
  }
  const vdata: any = await validateResp.json();
  const scopes: string[] = Array.isArray(vdata.scopes)
    ? vdata.scopes
    : typeof vdata.scopes === 'string' ? vdata.scopes.split(',').map((s: string) => s.trim()).filter(Boolean)
    : typeof vdata.scope === 'string' ? vdata.scope.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  if (!scopes.includes('repo')) {
    return fail(c, 400, 'insufficient_scope', 'Insufficient OAuth scope', { required: ['repo'], scopes });
  }

  // Step 3: fetch user profile (best-effort)
  let userData: any = null;
  try {
    const userResp = await fetch('https://api.github.com/user', {
      headers: ghHeaders(`token ${tokenData.access_token}`),
    });
    if (userResp.ok) userData = await userResp.json();
  } catch { /* non-fatal */ }

  const expiresAt = tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : null;
  return c.json({
    access_token: tokenData.access_token,
    token_type: tokenData.token_type || 'bearer',
    scope: tokenData.scope,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    user: userData,
    service: SERVICE,
    persistence: 'browser-only',
  });
});

// GitHub OAuth doesn't support refresh tokens for the classic OAuth App flow.
// Node server returned 501 here; preserve that contract.
app.post('/api/github/oauth/refresh', async (c) => {
  return c.json({
    error: 'Token refresh not implemented',
    message: 'GitHub OAuth uses long-lived tokens. Please re-authenticate if your token has expired.',
    service: SERVICE,
  }, 501);
});

// Validate an OAuth access token against the OAuth App API.
app.post('/api/github/oauth/validate', async (c) => {
  const { access_token } = await readJson(c);
  if (!access_token || typeof access_token !== 'string') return fail(c, 400, 'missing_access_token', 'Missing access_token');

  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(c, 500, 'oauth_not_configured', 'GitHub OAuth not configured');

  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: 'POST',
    headers: { ...ghHeaders(`Basic ${basic}`), 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const status = resp.status === 404 || resp.status === 401 ? 401 : 502;
    if (status !== 401) logDetail('oauth validate failed', { status: resp.status, body: text.slice(0, 300) });
    return c.json({ valid: false, error: 'Token invalid or revoked', code: status === 401 ? 'token_invalid' : 'github_error', service: SERVICE }, status as any);
  }
  const data: any = await resp.json();
  const scopes: string[] = Array.isArray(data.scopes)
    ? data.scopes
    : typeof data.scopes === 'string' ? data.scopes.split(',').map((s: string) => s.trim()).filter(Boolean)
    : typeof data.scope === 'string' ? data.scope.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  return c.json({ valid: true, scopes, note: 'Token is valid', service: SERVICE });
});

// Revoke an OAuth access token.
app.delete('/api/github/oauth/revoke', async (c) => {
  const { access_token } = await readJson(c);
  if (!access_token || typeof access_token !== 'string') return fail(c, 400, 'missing_access_token', 'Missing access_token');

  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(c, 500, 'oauth_not_configured', 'GitHub OAuth not configured');

  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: 'DELETE',
    headers: { ...ghHeaders(`Basic ${basic}`), 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token }),
  });
  if (resp.status === 204) return c.json({ revoked: true, service: SERVICE });
  const text = await resp.text().catch(() => '');
  const status = resp.status === 404 || resp.status === 401 ? 401 : 502;
  if (status !== 401) logDetail('oauth revoke failed', { status: resp.status, body: text.slice(0, 300) });
  return c.json({ revoked: false, error: 'Failed to revoke token', code: status === 401 ? 'token_invalid' : 'github_error', service: SERVICE }, status as any);
});

// GitHub's own short explanation for a failed repo create (e.g. "name already
// exists on this account") — useful to the user whose token made the call.
const githubMessage = (text: string): string | null => {
  try {
    const j = JSON.parse(text);
    const parts = [j?.message, ...(Array.isArray(j?.errors) ? j.errors.map((e: any) => e?.message) : [])]
      .filter((s) => typeof s === 'string' && s);
    return parts.length ? parts.join(': ').slice(0, 200) : null;
  } catch {
    return null;
  }
};

// Create a repository using the user's OAuth token.
app.post('/api/github/oauth/create-repository', async (c) => {
  const { access_token, name, private: isPrivate, description, auto_init } = await readJson(c);
  if (!access_token || !name || typeof access_token !== 'string') {
    return fail(c, 400, 'missing_fields', 'Access token and repository name are required');
  }
  const resp = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...ghHeaders(`token ${access_token}`), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: String(name).trim(),
      private: isPrivate !== false, // default private
      description: description || `Redstring universe: ${name}`,
      auto_init: auto_init !== false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const status = resp.status >= 400 && resp.status < 500 ? resp.status : 502;
    if (resp.status !== 422) logDetail('oauth repo create failed', { status: resp.status, body: errText.slice(0, 300) });
    return fail(c, status, 'repository_creation_failed', 'Repository creation failed', {
      details: resp.status === 422 ? githubMessage(errText) : null,
    });
  }
  const newRepo: any = await resp.json();
  return c.json({
    id: newRepo.id, name: newRepo.name, full_name: newRepo.full_name, description: newRepo.description,
    private: newRepo.private, html_url: newRepo.html_url, clone_url: newRepo.clone_url,
    default_branch: newRepo.default_branch, created_at: newRepo.created_at, service: SERVICE,
  });
});

// =============================================================================
// /api/github/app/* — GitHub App endpoints (require JWT signing)
// =============================================================================

// App slug for building installation URLs.
const appInfo = (c: any) => c.json({
  name: c.env.GITHUB_APP_SLUG || 'redstring-semantic-sync',
  appName: c.env.GITHUB_APP_SLUG || 'redstring-semantic-sync',
  service: SERVICE,
});
app.get('/api/github/app/info', appInfo);
app.get('/api/github/app/client-id', appInfo);

// Mint an installation access token — only for an installation the caller
// owns (User install) or is an active member of the owning org. Fails closed:
// any GitHub error or unverifiable state is a refusal, never a mint.
app.post('/api/github/app/installation-token', async (c) => {
  const { installation_id } = await readJson(c);
  if (installation_id == null || installation_id === '') {
    return fail(c, 400, 'missing_installation', 'Installation ID is required');
  }

  const gate = await requireInstallOwnership(c, installation_id);
  if (gate instanceof Response) return gate;

  // Mint with the id GitHub returned for the verified installation.
  const mint = await mintInstallationToken(gate.installationId, gate.jwtStr);
  if (!mint.ok) return mintFailure(c, mint.status);
  const tokenData = mint.data;

  const repositories = await listInstallationRepositories(tokenData.token);

  return c.json({
    token: tokenData.token,
    expires_at: tokenData.expires_at,
    permissions: tokenData.permissions,
    account: gate.installation.account || null,
    repositories,
    service: SERVICE,
    verification: verificationSummary(gate),
  });
});

// List installations accessible to the requesting OAuth user, filtered to
// installs of THIS Worker's configured App. Requires Authorization header
// to prevent leaking cross-account installs.
app.get('/api/github/app/installations', async (c) => {
  const oauthToken = extractOAuthToken(c.req.header('authorization'));
  if (!oauthToken) {
    return fail(c, 401, 'oauth_required', 'OAuth token required');
  }
  if (oauthToken.startsWith('ghs_')) {
    return fail(c, 400, 'wrong_token_type', 'Wrong token type');
  }

  const configuredAppId = Number(c.env.GITHUB_APP_ID);
  const configuredSlug = c.env.GITHUB_APP_SLUG || null;

  // Primary path: ask GitHub which installs THIS user has access to.
  const primary = await listInstallationsViaOAuth(oauthToken);
  let installs = primary.ok ? primary.installations : null;

  // Fallback: /user/installations 403s for OAuth-App tokens (the web SPA's
  // gho_ token), SAML SSO, etc. Identify the user via /user, then enumerate
  // via App JWT and keep only personal installs whose account id is the
  // user's id. (Org installs are found via the install callback instead.)
  if (!installs) {
    const oauthUser = await fetchOAuthUser(oauthToken);
    const userId = oauthUser?.id;
    if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
      logDetail('installations: caller identity unknown', { status: primary.status, reason: primary.reason });
      const status = primary.status === 401 ? 401 : primary.status === 403 ? 403 : 502;
      return fail(c, status, primary.status === 401 ? 'oauth_invalid' : 'identity_unknown', 'Failed to list installations for OAuth user');
    }
    try {
      const jwtStr = await appJwt(c.env.GITHUB_APP_ID, c.env.GITHUB_APP_PRIVATE_KEY);
      const resp = await fetch('https://api.github.com/app/installations?per_page=100', {
        headers: ghHeaders(`Bearer ${jwtStr}`),
      });
      if (resp.ok) {
        const all = (await resp.json().catch(() => [])) as any[];
        installs = (Array.isArray(all) ? all : []).filter((inst: any) =>
          inst?.target_type === 'User' && inst?.account?.id === userId && !inst?.suspended_at);
      } else {
        installs = [];
      }
    } catch {
      installs = [];
    }
  }

  // Filter to THIS Worker's configured App.
  const ours = (installs || []).filter((inst: any) => {
    const appIdMatch = !Number.isNaN(configuredAppId) && Number(inst?.app_id) === configuredAppId;
    const slugMatch = configuredSlug && inst?.app_slug === configuredSlug;
    return appIdMatch || slugMatch;
  });
  ours.sort((a: any, b: any) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
  return c.json(ours);
});

// Get a specific installation's data (installation info + repositories).
app.get('/api/github/app/installation/:installation_id', async (c) => {
  const gate = await requireInstallOwnership(c, c.req.param('installation_id'));
  if (gate instanceof Response) return gate;
  const installationData = gate.installation;

  // Repositories require an installation token, not the App JWT.
  const mint = await mintInstallationToken(gate.installationId, gate.jwtStr);
  if (!mint.ok) return mintFailure(c, mint.status);
  const repositories = await listInstallationRepositories(mint.data.token);

  return c.json({
    installation: installationData,
    repositories,
    account: installationData.account,
    permissions: installationData.permissions,
    service: SERVICE,
  });
});

// Create a repository via the GitHub App installation.
app.post('/api/github/app/create-repository', async (c) => {
  const { installation_id, name, private: isPrivate, description, auto_init } = await readJson(c);
  if (installation_id == null || installation_id === '' || !name || typeof name !== 'string') {
    return fail(c, 400, 'missing_fields', 'Installation ID and repository name are required');
  }
  const gate = await requireInstallOwnership(c, installation_id);
  if (gate instanceof Response) return gate;

  const mint = await mintInstallationToken(gate.installationId, gate.jwtStr);
  if (!mint.ok) return mintFailure(c, mint.status);

  const createResp = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...ghHeaders(`token ${mint.data.token}`), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, private: !!isPrivate, description: description || 'Redstring knowledge graph repository', auto_init: !!auto_init }),
  });
  if (!createResp.ok) {
    const errText = await createResp.text().catch(() => '');
    logDetail('app repo create failed', { status: createResp.status, body: errText.slice(0, 300) });
    if (createResp.status === 403) {
      return fail(c, 403, 'repository_creation_forbidden', 'Repository creation forbidden', {
        details: 'GitHub App installation does not have permission to create repositories. Please check the app permissions or create the repository manually.',
      });
    }
    const status = createResp.status >= 400 && createResp.status < 500 ? createResp.status : 502;
    // Only a 422 (e.g. "name already exists") is about the caller's input and
    // worth showing them; anything else stays in the log.
    return fail(c, status, 'repository_creation_failed', 'Repository creation failed', {
      details: createResp.status === 422 ? githubMessage(errText) : null,
    });
  }
  const newRepo: any = await createResp.json();
  return c.json({
    id: newRepo.id, name: newRepo.name, full_name: newRepo.full_name, description: newRepo.description,
    private: newRepo.private, html_url: newRepo.html_url, clone_url: newRepo.clone_url,
    default_branch: newRepo.default_branch, created_at: newRepo.created_at, service: SERVICE,
  });
});

// =============================================================================
// /api/github/auth/* — STATELESS STUBS
// The Node server stored tokens server-side when ENABLE_SERVER_PERSISTENCE=true.
// In stateless mode (the only mode on Cloudflare) these endpoints just tell
// the SPA "use browser storage." src/services/persistentAuth.js already
// handles these responses gracefully.
// =============================================================================

app.get('/api/github/auth/state', (c) => c.json({
  service: SERVICE,
  persistence: 'browser-only',
  stateless: true,
  oauth: { hasToken: false },
  githubApp: { isInstalled: false },
}));

app.get('/api/github/auth/oauth/token', (c) => c.json(
  { error: 'No OAuth token stored', service: SERVICE }, 404,
));

app.post('/api/github/auth/oauth', (c) => c.json({
  stored: false,
  persistence: 'browser-only',
  message: 'Server is stateless - tokens are stored in browser localStorage only',
  service: SERVICE,
}));

app.delete('/api/github/auth/oauth', (c) => c.json({
  cleared: true,
  persistence: 'browser-only',
  message: 'Server is stateless - clear tokens from browser localStorage',
  service: SERVICE,
}));

app.get('/api/github/auth/github-app', (c) => c.json(
  { error: 'No GitHub App installation stored', service: SERVICE }, 404,
));

app.post('/api/github/auth/github-app', (c) => c.json({
  stored: false,
  persistence: 'browser-only',
  message: 'Server is stateless - installation stored in browser localStorage only',
  service: SERVICE,
}));

app.delete('/api/github/auth/github-app', (c) => c.json({
  cleared: true,
  persistence: 'browser-only',
  message: 'Server is stateless - clear installation from browser localStorage',
  service: SERVICE,
}));

// =============================================================================
// GitHub App webhook
// =============================================================================
//
// Registered as the App's Webhook URL, so GitHub POSTs here directly — nothing
// in the SPA calls it. Nothing consumes the payload, so this verifies and
// acknowledges.
//
// It exists rather than 404ing because GitHub retries failed deliveries and
// eventually flags the endpoint as failing on the App's settings page. If
// you'd rather not have the endpoint at all, clear the Webhook URL in the App
// settings and delete this route.
//
// Unsigned deliveries are never accepted (S-12): with no
// GITHUB_APP_WEBHOOK_SECRET bound, every delivery is refused with 503 so the
// misconfiguration shows up on the App's delivery log.
app.post('/api/github/app/webhook', async (c) => {
  const event = c.req.header('x-github-event') || 'unknown';
  const signature = c.req.header('x-hub-signature-256') || '';
  const secret = (c.env as Env).GITHUB_APP_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[Webhook] GITHUB_APP_WEBHOOK_SECRET not set — refusing delivery', { event });
    return fail(c, 503, 'webhook_not_configured', 'Webhook not configured');
  }

  // Raw bytes, not a re-serialized object — the HMAC covers the exact payload.
  const raw = await c.req.text();

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const expected = 'sha256=' + [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare: a length check first, then accumulate differences
  // so the loop can't return early and leak position via timing.
  let mismatch = expected.length ^ signature.length;
  for (let i = 0; i < expected.length && i < signature.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (!signature || mismatch !== 0) {
    console.warn('[Webhook] Invalid signature, rejecting', { event });
    return fail(c, 401, 'invalid_signature', 'Invalid webhook signature');
  }

  console.log('[Webhook] Acknowledged', { event });
  return c.json({ received: true, event, service: SERVICE });
});

// =============================================================================
// 404 for anything else under /api/github/
// =============================================================================
app.all('/api/github/*', (c) => c.json({ error: 'Not found', code: 'not_found', service: SERVICE }, 404));

export const onRequest = handle(app);

// Test hooks. Pages only routes `onRequest*` exports; these are ignored by it.
export { app };
export function __resetRateLimitsForTests() {
  limiter = createRateLimiter();
}
