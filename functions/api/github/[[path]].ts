// Cloudflare Pages Function — catch-all router for all /api/github/** endpoints.
//
// Port of the Node oauth-server.js endpoint set (~10 endpoints + 7 stateless
// stubs). One credential set per Worker environment — see _lib/env.ts.
//
// Mounting: this file is automatically invoked by Cloudflare Pages for any
// request matching /api/github/* (see cloudflare/pages/_routes.json).

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
  verifyInstallationWithOAuth,
  formatVerificationForResponse,
} from '../../_lib/github';

const SERVICE = 'oauth-server'; // SPA may assert on this; keep stable
const app = new Hono<{ Bindings: Env }>();

// CORS — same-origin (Pages serves SPA + this function) doesn't need it, but
// Electron and curl tests do. Allow redstring.io + localhost by default.
// `*.pages.dev` / `*.workers.dev` are attacker-registrable, so that broad
// preview allowance is opt-in per environment via ALLOW_PREVIEW_ORIGINS=true.
app.use('/api/github/*', cors({
  origin: (origin, c) => {
    if (!origin) return '*';
    const allowPreview = (c?.env as Env | undefined)?.ALLOW_PREVIEW_ORIGINS === 'true';
    try {
      const host = new URL(origin).hostname;
      if (host === 'redstring.io' || host.endsWith('.redstring.io')) return origin;
      if (host === 'localhost' || host.endsWith('.localhost')) return origin;
      if (allowPreview && (host.endsWith('.pages.dev') || host.endsWith('.workers.dev'))) return origin;
    } catch { /* ignore */ }
    return null;
  },
  credentials: false,
}));

// Shared ownership gate for GitHub App endpoints. Requires the SPA to pass its
// OAuth user token so the Worker can confirm the caller actually owns the
// installation before minting a token / returning its data — installation IDs
// are enumerable integers, so acting on an arbitrary one is broken access
// control. Returns a Response to short-circuit on refusal, otherwise the
// verification context. NOTE: an `unverified` result (token present but the
// install can't be enumerated via /user/installations, e.g. org installs when
// the OAuth token lacks read:org) is allowed through to preserve those flows;
// fully closing that residual requires read:org scope on the OAuth token.
async function requireInstallOwnership(c: any, installationId: string | number) {
  const oauthToken = extractOAuthToken(c.req.header('authorization'));
  if (!oauthToken) {
    return c.json({
      error: 'OAuth token required',
      hint: `Pass "Authorization: token <oauth_token>" so the Worker can confirm you own installation ${installationId} before acting on it.`,
      code: 'oauth_required',
      service: SERVICE,
    }, 401);
  }
  const oauthUser = await fetchOAuthUser(oauthToken);
  const verification = await verifyInstallationWithOAuth(installationId, oauthToken, oauthUser);
  const deniedStatus: Record<string, number> = {
    missing_installation: 400,
    account_mismatch: 403,
    not_found: 403,
    oauth_invalid: 401,
  };
  if (deniedStatus[verification.status]) {
    return c.json({
      error: 'Installation access denied',
      code: verification.status,
      verification: formatVerificationForResponse(verification),
      service: SERVICE,
    }, deniedStatus[verification.status] as any);
  }
  return { oauthToken, oauthUser, verification };
}

// =============================================================================
// /api/github/oauth/* — user-facing OAuth flow
// =============================================================================

// Public client ID for the SPA to start the OAuth dance.
app.get('/api/github/oauth/client-id', (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID || null;
  const configured = !!(clientId && c.env.GITHUB_CLIENT_SECRET);
  return c.json({
    clientId: clientId && clientId.trim().length > 0 ? clientId.trim() : null,
    configured,
    clientIdValid: !!(clientId && clientId.trim().length > 0),
    clientSecretValid: !!(c.env.GITHUB_CLIENT_SECRET && c.env.GITHUB_CLIENT_SECRET.trim().length > 0),
    service: SERVICE,
  });
});

// Exchange OAuth code for access token, validate, fetch user, return.
app.post('/api/github/oauth/token', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const { code, state, redirect_uri } = body || {};

  if (!code || !state) {
    return c.json({ error: 'Missing code or state', service: SERVICE, received: { hasCode: !!code, hasState: !!state } }, 400);
  }
  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json({ error: 'GitHub OAuth not configured', hint: 'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET as Worker secrets', service: SERVICE }, 500);
  }

  // Step 1: exchange code → token
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim(), code, redirect_uri, state }),
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text().catch(() => '');
    return c.json({ error: `GitHub API error: ${tokenResp.status}`, details: errText, service: SERVICE }, 500);
  }
  const tokenData: any = await tokenResp.json();
  if (tokenData.error) {
    return c.json({ error: `GitHub OAuth error: ${tokenData.error_description || tokenData.error}`, service: SERVICE }, 500);
  }

  // Step 2: validate token + check `repo` scope (same as Node server)
  const basic = btoa(`${clientId.trim()}:${clientSecret.trim()}`);
  const validateResp = await fetch(`https://api.github.com/applications/${clientId.trim()}/token`, {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Basic ${basic}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: tokenData.access_token }),
  });
  if (!validateResp.ok) {
    const vtext = await validateResp.text().catch(() => '');
    return c.json({ error: 'Token validation failed', details: vtext, service: SERVICE }, 400);
  }
  const vdata: any = await validateResp.json();
  const scopes: string[] = Array.isArray(vdata.scopes)
    ? vdata.scopes
    : typeof vdata.scopes === 'string' ? vdata.scopes.split(',').map((s: string) => s.trim()).filter(Boolean)
    : typeof vdata.scope === 'string' ? vdata.scope.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  if (!scopes.includes('repo')) {
    return c.json({ error: 'Insufficient OAuth scope', required: ['repo'], scopes, service: SERVICE }, 400);
  }

  // Step 3: fetch user profile (best-effort)
  let userData: any = null;
  try {
    const userResp = await fetch('https://api.github.com/user', {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${tokenData.access_token}`, 'User-Agent': USER_AGENT },
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
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const { access_token } = body || {};
  if (!access_token) return c.json({ error: 'Missing access_token', service: SERVICE }, 400);

  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.json({ error: 'GitHub OAuth not configured', service: SERVICE }, 500);

  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Basic ${basic}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const status = resp.status === 404 || resp.status === 401 ? 401 : resp.status;
    return c.json({ valid: false, error: 'Token invalid or revoked', details: text, service: SERVICE }, status as any);
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
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const { access_token } = body || {};
  if (!access_token) return c.json({ error: 'Missing access_token', service: SERVICE }, 400);

  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.json({ error: 'GitHub OAuth not configured', service: SERVICE }, 500);

  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: 'DELETE',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Basic ${basic}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token }),
  });
  if (resp.status === 204) return c.json({ revoked: true, service: SERVICE });
  const text = await resp.text().catch(() => '');
  const status = resp.status === 404 || resp.status === 401 ? 401 : resp.status;
  return c.json({ revoked: false, error: 'Failed to revoke token', details: text, service: SERVICE }, status as any);
});

// Create a repository using the user's OAuth token.
app.post('/api/github/oauth/create-repository', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const { access_token, name, private: isPrivate, description, auto_init } = body || {};
  if (!access_token || !name) {
    return c.json({ error: 'Access token and repository name are required', service: SERVICE }, 400);
  }
  const resp = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${access_token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
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
    let errData: any = { message: errText };
    try { errData = JSON.parse(errText); } catch { /* keep raw */ }
    return c.json({ error: 'Repository creation failed', details: errData.message || errText, github_error: errText, service: SERVICE }, resp.status as any);
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

// Mint an installation access token. Verifies the install belongs to the
// OAuth user IF the SPA supplies its OAuth token via Authorization. Without
// it, verification is skipped (matches Node server stateless behavior).
app.post('/api/github/app/installation-token', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const { installation_id } = body || {};
  if (!installation_id) return c.json({ error: 'Installation ID is required', service: SERVICE }, 400);

  const appId = c.env.GITHUB_APP_ID;
  const privateKey = c.env.GITHUB_APP_PRIVATE_KEY;
  const expectedSlug = c.env.GITHUB_APP_SLUG || null;
  if (!appId || !privateKey) {
    return c.json({ error: 'GitHub App not configured', hint: 'Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY as Worker secrets', service: SERVICE }, 500);
  }

  // Require the SPA's OAuth token so we can confirm the install belongs to this
  // user before minting. Installation IDs are enumerable integers, so minting
  // for an arbitrary ID with no caller identity is broken access control.
  const oauthToken = extractOAuthToken(c.req.header('authorization'));
  if (!oauthToken) {
    return c.json({
      error: 'OAuth token required',
      hint: `Pass "Authorization: token <oauth_token>" so the Worker can confirm you own installation ${installation_id} before minting a token.`,
      code: 'oauth_required',
      service: SERVICE,
    }, 401);
  }
  let verificationResult = null;
  let verificationForResponse = null;
  if (oauthToken) {
    const oauthUser = await fetchOAuthUser(oauthToken);
    verificationResult = await verifyInstallationWithOAuth(installation_id, oauthToken, oauthUser);
    verificationForResponse = formatVerificationForResponse(verificationResult);
    if (verificationResult.status === 'missing_installation') {
      return c.json({ error: 'Invalid installation ID', code: 'missing_installation', verification: verificationForResponse, service: SERVICE }, 400);
    }
    if (verificationResult.status === 'account_mismatch' || verificationResult.status === 'not_found') {
      return c.json({ error: 'GitHub App installation not accessible for the connected OAuth account', code: verificationResult.status, verification: verificationForResponse, service: SERVICE }, 403);
    }
    if (verificationResult.status === 'oauth_invalid') {
      return c.json({ error: 'GitHub OAuth token is invalid or expired. Please reconnect OAuth and retry.', code: 'oauth_invalid', verification: verificationForResponse, service: SERVICE }, 401);
    }
    // status === 'unverified' / 'skipped' / 'error' / 'verified' all fall through to mint
    // 'unverified' (403 on /user/installations) and 'error' both proceed — the mint
    // endpoint is the authoritative source. Node server behaved the same way.

    // App credential mismatch check: if the install belongs to a different App
    // than this Worker is configured for, surface a clean diagnostic instead of
    // a confusing GitHub 404 on the mint.
    const inst = verificationResult.installation;
    const installAppId = inst?.app_id != null ? Number(inst.app_id) : null;
    const installAppSlug = inst?.app_slug || null;
    const configuredAppId = Number(appId);
    const matchesById = installAppId != null && !Number.isNaN(installAppId) && installAppId === configuredAppId;
    const matchesBySlug = installAppSlug && expectedSlug && installAppSlug === expectedSlug;
    if (inst && !matchesById && !matchesBySlug) {
      return c.json({
        error: 'GitHub App credential mismatch',
        code: 'app_credentials_mismatch',
        hint: `Installation ${installation_id} belongs to app_id=${installAppId}${installAppSlug ? ` (slug=${installAppSlug})` : ''}, but this Worker is configured for app_id=${configuredAppId}${expectedSlug ? ` (slug=${expectedSlug})` : ''}.`,
        verification: verificationForResponse,
        service: SERVICE,
      }, 409);
    }
  }

  // Sign JWT and mint installation token.
  const jwtStr = await appJwt(appId, privateKey);
  const mintResp = await fetch(`https://api.github.com/app/installations/${installation_id}/access_tokens`, {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Bearer ${jwtStr}`, 'User-Agent': USER_AGENT },
  });
  if (!mintResp.ok) {
    const errText = await mintResp.text().catch(() => '');
    const errResponse: Record<string, any> = { error: 'Failed to generate installation token', status: mintResp.status, details: errText, service: SERVICE };
    if (mintResp.status === 401) { errResponse.error = 'GitHub App authentication failed'; errResponse.hint = 'The GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY may be incorrect.'; }
    else if (mintResp.status === 404) { errResponse.error = 'Installation not found'; errResponse.hint = `Installation ID ${installation_id} does not exist or the GitHub App does not have access to it.`; }
    else if (mintResp.status === 403) { errResponse.error = 'Installation access forbidden'; errResponse.hint = 'The GitHub App may have been suspended or uninstalled.'; }
    return c.json(errResponse, (mintResp.status === 404 ? 404 : 502) as any);
  }
  const tokenData: any = await mintResp.json();

  // Fetch installation info (account) and repositories — best-effort.
  let account: any = null;
  try {
    const infoResp = await fetch(`https://api.github.com/app/installations/${installation_id}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Bearer ${jwtStr}`, 'User-Agent': USER_AGENT },
    });
    if (infoResp.ok) account = (await infoResp.json() as any)?.account || null;
  } catch { /* non-fatal */ }

  let repositories: any[] = [];
  try {
    const reposResp = await fetch('https://api.github.com/installation/repositories', {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${tokenData.token}`, 'User-Agent': USER_AGENT },
    });
    if (reposResp.ok) {
      const repoData: any = await reposResp.json();
      if (Array.isArray(repoData?.repositories)) repositories = repoData.repositories;
    }
  } catch { /* non-fatal */ }

  const responsePayload: Record<string, any> = {
    token: tokenData.token,
    expires_at: tokenData.expires_at,
    permissions: tokenData.permissions,
    account,
    repositories,
    service: SERVICE,
  };
  if (verificationForResponse) responsePayload.verification = verificationForResponse;
  return c.json(responsePayload);
});

// List installations accessible to the requesting OAuth user, filtered to
// installs of THIS Worker's configured App. Requires Authorization header
// to prevent leaking cross-account installs.
app.get('/api/github/app/installations', async (c) => {
  const oauthToken = extractOAuthToken(c.req.header('authorization'));
  if (!oauthToken) {
    return c.json({
      error: 'OAuth token required',
      hint: 'Pass "Authorization: token <oauth_token>". Listing installs by App JWT is disabled because it leaks installs from other accounts.',
      service: SERVICE,
    }, 401);
  }
  if (oauthToken.startsWith('ghs_')) {
    return c.json({
      error: 'Wrong token type',
      hint: 'Pass an OAuth user-to-server token (gho_/ghp_/github_pat_), not an App installation token (ghs_).',
      service: SERVICE,
    }, 400);
  }

  const configuredAppId = Number(c.env.GITHUB_APP_ID);
  const configuredSlug = c.env.GITHUB_APP_SLUG || null;

  // Primary path: ask GitHub which installs THIS user has access to.
  const primary = await listInstallationsViaOAuth(oauthToken);
  let installs = primary.ok ? primary.installations : null;

  // Fallback: /user/installations can 403 (SAML SSO, scope tightening, etc.).
  // Identify the user via /user, then enumerate via App JWT and filter to
  // installs whose account matches the user. Preserves the privacy guarantee.
  if (!installs) {
    const oauthUser = await fetchOAuthUser(oauthToken);
    if (!oauthUser?.login) {
      return c.json({
        error: 'Failed to list installations for OAuth user',
        details: primary.details || 'Could not identify OAuth user via /user fallback',
        reason: primary.reason || 'fallback_identity_unknown',
        service: SERVICE,
      }, (primary.status || 502) as any);
    }
    try {
      const jwtStr = await appJwt(c.env.GITHUB_APP_ID, c.env.GITHUB_APP_PRIVATE_KEY);
      const resp = await fetch('https://api.github.com/app/installations?per_page=100', {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Bearer ${jwtStr}`, 'User-Agent': USER_AGENT },
      });
      if (resp.ok) {
        const all: any[] = await resp.json().catch(() => []);
        const loginLc = oauthUser.login.toLowerCase();
        installs = (Array.isArray(all) ? all : []).filter((inst: any) => (inst?.account?.login || '').toLowerCase() === loginLc);
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
  ours.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return c.json(ours);
});

// Get a specific installation's data (installation info + repositories).
app.get('/api/github/app/installation/:installation_id', async (c) => {
  const installation_id = c.req.param('installation_id');
  const gate = await requireInstallOwnership(c, installation_id);
  if (gate instanceof Response) return gate;
  const appId = c.env.GITHUB_APP_ID;
  const privateKey = c.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) return c.json({ error: 'GitHub App not configured', service: SERVICE }, 500);

  const jwtStr = await appJwt(appId, privateKey);
  const infoResp = await fetch(`https://api.github.com/app/installations/${installation_id}`, {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Bearer ${jwtStr}`, 'User-Agent': USER_AGENT },
  });
  if (!infoResp.ok) {
    return c.json({ error: `GitHub API error: ${infoResp.status}`, service: SERVICE }, 500);
  }
  const installationData: any = await infoResp.json();

  // Repositories require an installation token, not the App JWT.
  const tokenResp = await fetch(`https://api.github.com/app/installations/${installation_id}/access_tokens`, {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Bearer ${jwtStr}`, 'User-Agent': USER_AGENT },
  });
  if (!tokenResp.ok) {
    return c.json({ error: `Failed to get installation token: ${tokenResp.status}`, service: SERVICE }, 500);
  }
  const { token: installationToken }: any = await tokenResp.json();
  let repositories: any[] = [];
  const reposResp = await fetch('https://api.github.com/installation/repositories', {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${installationToken}`, 'User-Agent': USER_AGENT },
  });
  if (reposResp.ok) {
    const reposData: any = await reposResp.json();
    repositories = reposData?.repositories || [];
  }
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
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const { installation_id, name, private: isPrivate, description, auto_init } = body || {};
  if (!installation_id || !name) {
    return c.json({ error: 'Installation ID and repository name are required', service: SERVICE }, 400);
  }
  const gate = await requireInstallOwnership(c, installation_id);
  if (gate instanceof Response) return gate;
  const appId = c.env.GITHUB_APP_ID;
  const privateKey = c.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) return c.json({ error: 'GitHub App not configured', service: SERVICE }, 500);

  const jwtStr = await appJwt(appId, privateKey);
  const tokenResp = await fetch(`https://api.github.com/app/installations/${installation_id}/access_tokens`, {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Bearer ${jwtStr}`, 'User-Agent': USER_AGENT },
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text().catch(() => '');
    return c.json({ error: `Failed to get installation token: ${errText}`, service: SERVICE }, tokenResp.status as any);
  }
  const { token: installationToken }: any = await tokenResp.json();

  const createResp = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${installationToken}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, private: !!isPrivate, description: description || 'Redstring knowledge graph repository', auto_init: !!auto_init }),
  });
  if (!createResp.ok) {
    const errText = await createResp.text().catch(() => '');
    if (createResp.status === 403) {
      return c.json({
        error: 'Repository creation forbidden',
        details: 'GitHub App installation does not have permission to create repositories. Please check the app permissions or create the repository manually.',
        github_error: errText,
        service: SERVICE,
      }, 403);
    }
    return c.json({ error: `Repository creation failed: ${createResp.status}`, details: errText, service: SERVICE }, createResp.status as any);
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
// 404 for anything else under /api/github/
// =============================================================================
app.all('/api/github/*', (c) => c.json({ error: 'Not found', path: c.req.path, service: SERVICE }, 404));

export const onRequest = handle(app);
