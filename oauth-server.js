/**
 * Dedicated OAuth Server
 * Handles GitHub OAuth flow with clean separation from AI bridge
 * Neuroplastic architecture - each server has one clear purpose
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve as pathResolve } from 'path';
import tokenVault from './src/services/server/tokenVault.js';
import userAnalytics from './src/services/UserAnalytics.js';

// Load environment variables
dotenv.config();

// Load GitHub App credentials from github.env.local if present (local dev only)
if (existsSync('github.env.local')) {
  dotenv.config({ path: 'github.env.local', override: false });
}

// If GITHUB_APP_PRIVATE_KEY is not set but PRIVATE_KEY_PATH is, read the PEM file
if (!process.env.GITHUB_APP_PRIVATE_KEY && process.env.PRIVATE_KEY_PATH) {
  const pemPath = process.env.PRIVATE_KEY_PATH;
  if (existsSync(pemPath)) {
    process.env.GITHUB_APP_PRIVATE_KEY = readFileSync(pemPath, 'utf8');
    console.log(`[OAuth] Loaded GitHub App private key from ${pemPath}`);
  } else {
    console.warn(`[OAuth] PRIVATE_KEY_PATH set to "${pemPath}" but file not found`);
  }
}

// Load dev private key from PRIVATE_KEY_PATH_DEV (for Electron dev with a separate GitHub App)
if (!process.env.GITHUB_APP_PRIVATE_KEY_DEV && process.env.PRIVATE_KEY_PATH_DEV) {
  const devPemPath = process.env.PRIVATE_KEY_PATH_DEV;
  if (existsSync(devPemPath)) {
    process.env.GITHUB_APP_PRIVATE_KEY_DEV = readFileSync(devPemPath, 'utf8');
    console.log(`[OAuth] Loaded dev GitHub App private key from ${devPemPath}`);
  } else {
    console.warn(`[OAuth] PRIVATE_KEY_PATH_DEV set to "${devPemPath}" but file not found`);
  }
}

// STATELESS MODE: User data stays in browser localStorage, not server
// Server only facilitates OAuth exchange, does NOT persist tokens
const ENABLE_SERVER_PERSISTENCE = process.env.ENABLE_SERVER_PERSISTENCE === 'true' || false;

// Environment-based logging control
const isProduction = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (isProduction ? 'warn' : 'info');

// Create a logger that respects environment settings
const logger = {
  info: (...args) => {
    if (LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
      console.log(...args);
    }
  },
  warn: (...args) => {
    if (LOG_LEVEL === 'warn' || LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
      console.warn(...args);
    }
  },
  error: (...args) => {
    // Always log errors
    console.error(...args);
  },
  debug: (...args) => {
    if (LOG_LEVEL === 'debug') {
      console.log('[DEBUG]', ...args);
    }
  }
};

const app = express();
const PORT = process.env.OAUTH_PORT || 3002;

// Trust the first proxy hop so rate limiting sees the real client IP behind
// GCP Cloud Run / the load balancer (this server may run on its own service).
app.set('trust proxy', 1);

// CORS: restrict to known origins. Defaults to the production domain; extend
// via CORS_ORIGINS env (comma-separated) for dev/staging. Same allowlist as
// app-semantic-server.js so the two stay in sync.
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'https://redstring.io,https://www.redstring.io')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    // Local development: the app is served from a Vite port (e.g.
    // http://localhost:4001) and calls this server directly at :3002, which
    // is cross-origin. Auto-allow localhost/127.0.0.1 origins when NOT in
    // production so onboarding/auth work out of the box without needing
    // CORS_ORIGINS set. Production (NODE_ENV=production) never takes this path.
    if ((process.env.NODE_ENV || 'development').toLowerCase() !== 'production') {
      try {
        const host = new URL(origin).hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
          return callback(null, true);
        }
      } catch { /* invalid Origin */ }
    }
    // Cloud Run domains are shared/registrable infrastructure, so this broad
    // allowance is opt-in via ALLOW_CLOUDRUN_ORIGINS=true. Prefer setting
    // CORS_ORIGINS to the exact staging/prod hosts instead.
    if (process.env.ALLOW_CLOUDRUN_ORIGINS === 'true') {
      try {
        const host = new URL(origin).hostname;
        if (host.endsWith('.a.run.app') || host.endsWith('.run.app')) {
          return callback(null, true);
        }
      } catch { /* invalid Origin */ }
    }
    // Silently omit CORS headers instead of throwing 500. Same-origin loads
    // (browser sends Origin for `<script type="module" crossorigin>` even
    // when same-origin) need to succeed; cross-origin gets blocked correctly
    // by the missing Access-Control-Allow-Origin header.
    return callback(null, false);
  },
  credentials: false,
}));
// Capture raw bytes so the webhook handler can verify HMAC signatures.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Rate limiters
const oauthSensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for OAuth endpoint.' },
});
const oauthGlobalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { error: 'Too many requests, slow down.' },
});
app.use(oauthGlobalLimiter);

// Enhanced health check with detailed configuration status
app.get('/health', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  
  // S-09: configuration details stay in the server log, not the response.
  if (!(clientId && clientSecret)) logger.warn('[OAuth] Health: OAuth client id/secret not configured');
  res.json({
    status: 'healthy',
    service: 'oauth-server'
  });
});

// Helper to detect if this server is running in a dev/test environment.
// Host-header detection used to live here, but the OAuth server is reached via
// an in-container proxy (app-semantic-server.js → http://localhost:3002), so
// every request looks "local" regardless of the original request's hostname.
// NODE_ENV is set per Cloud Run service (production for redstring-prod,
// development for redstring-test, development locally) — deterministic and
// proxy-safe.
function isLocalRequest(_req) {
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  return env !== 'production';
}

const GITHUB_USER_INSTALLATIONS_URL = 'https://api.github.com/user/installations';

function resolveGitHubAppIdentifiers() {
  const ids = [];
  const idCandidates = [
    process.env.GITHUB_APP_ID,
    process.env.GITHUB_APP_ID_DEV
  ];
  for (const value of idCandidates) {
    if (!value) continue;
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      ids.push(numeric);
    }
  }

  const prodSlug = process.env.GITHUB_APP_SLUG || 'redstring-semantic-sync';
  const devSlug = process.env.GITHUB_APP_SLUG_DEV || prodSlug;
  const slugs = Array.from(new Set(
    [prodSlug, devSlug]
      .map((slug) => (slug || '').trim())
      .filter((slug) => slug.length > 0)
  ));

  return { ids, slugs };
}

// =============================================================================
// Installation ownership (contract C-9) — the same algorithm as
// functions/_lib/ownership.ts, which is what redstring.io runs. Fail closed:
// GET /user (caller token) → GET /app/installations/{id} (App JWT) → a User
// install must belong to the caller; an Organization install needs an active
// membership. Any GitHub error, unexpected shape, suspended install, other
// App's install or other target type is a denial — never "mint anyway".
// =============================================================================

const GH_API = 'https://api.github.com';
const OWNERSHIP_USER_AGENT = 'Redstring-GitHubApp-Server/1.0';

const isPositiveSafeInt = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

function parseInstallationId(raw) {
  if (typeof raw === 'number') return isPositiveSafeInt(raw) ? raw : null;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const n = Number(raw);
  return isPositiveSafeInt(n) ? n : null;
}

async function ownershipGetJson(url, authorization) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': authorization,
        'User-Agent': OWNERSHIP_USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      redirect: 'manual'
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    try { await res.text(); } catch { /* ignore */ }
    return { status: res.status, body: null };
  }
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: 0, body: null };
  }
}

async function verifyInstallOwnership(rawId, oauthToken, appJwtStr, configuredAppId) {
  const deny = (code, status) => ({ ok: false, code, status });

  const installationId = parseInstallationId(rawId);
  if (installationId == null) return deny('invalid_installation_id', 400);

  if (typeof oauthToken !== 'string' || !oauthToken || oauthToken.length > 512 || !/^[\x21-\x7e]+$/.test(oauthToken)) {
    return deny('oauth_required', 401);
  }
  if (oauthToken.startsWith('ghs_')) return deny('wrong_token_type', 400);

  const appId = typeof configuredAppId === 'string' && /^[1-9][0-9]{0,15}$/.test(configuredAppId.trim())
    ? Number(configuredAppId.trim())
    : configuredAppId;
  if (!isPositiveSafeInt(appId)) return deny('app_not_configured', 500);
  if (typeof appJwtStr !== 'string' || !appJwtStr) return deny('app_not_configured', 500);

  const userRes = await ownershipGetJson(`${GH_API}/user`, `token ${oauthToken}`);
  if (!userRes) return deny('github_error', 502);
  if (userRes.status === 401) return deny('oauth_invalid', 401);
  if (userRes.status !== 200) return deny('github_error', 502);
  const user = userRes.body;
  if (!isPositiveSafeInt(user?.id) || typeof user?.login !== 'string') return deny('github_error', 502);

  const instRes = await ownershipGetJson(`${GH_API}/app/installations/${installationId}`, `Bearer ${appJwtStr}`);
  if (!instRes) return deny('github_error', 502);
  if (instRes.status === 404) return deny('installation_not_found', 404);
  if (instRes.status === 401) return deny('github_app_auth_failed', 502);
  if (instRes.status !== 200) return deny('github_error', 502);
  const inst = instRes.body;
  if (!inst || typeof inst !== 'object' || inst.id !== installationId) return deny('github_error', 502);
  if (!isPositiveSafeInt(inst.app_id) || inst.app_id !== appId) return deny('app_credentials_mismatch', 409);
  if (inst.suspended_at) return deny('installation_suspended', 403);
  const account = inst.account;
  if (!account || !isPositiveSafeInt(account.id) || typeof account.login !== 'string' || !account.login) {
    return deny('github_error', 502);
  }
  if (account.type != null && account.type !== inst.target_type) return deny('unsupported_target', 403);

  const ok = () => ({ ok: true, installationId: inst.id, installation: inst, user: { id: user.id, login: user.login } });

  if (inst.target_type === 'User') {
    return account.id === user.id ? ok() : deny('account_mismatch', 403);
  }
  if (inst.target_type === 'Organization') {
    const memRes = await ownershipGetJson(
      `${GH_API}/user/memberships/orgs/${encodeURIComponent(account.login)}`,
      `token ${oauthToken}`
    );
    if (!memRes) return deny('github_error', 502);
    if (memRes.status === 401) return deny('oauth_invalid', 401);
    if (memRes.status === 403 || memRes.status === 404) return deny('not_org_member', 403);
    if (memRes.status !== 200) return deny('github_error', 502);
    const m = memRes.body;
    if (m?.state === 'active' && isPositiveSafeInt(m?.organization?.id) && m.organization.id === account.id) {
      return ok();
    }
    return deny('not_org_member', 403);
  }
  return deny('unsupported_target', 403);
}

const OWNERSHIP_MESSAGES = {
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
  github_error: 'GitHub request failed'
};

function configuredAppSlots() {
  return [
    {
      slot: 'prod',
      appId: process.env.GITHUB_APP_ID ? Number(process.env.GITHUB_APP_ID) : null,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY || null,
      slug: process.env.GITHUB_APP_SLUG || null
    },
    {
      slot: 'dev',
      appId: process.env.GITHUB_APP_ID_DEV ? Number(process.env.GITHUB_APP_ID_DEV) : null,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY_DEV || null,
      slug: process.env.GITHUB_APP_SLUG_DEV || null
    }
  ].filter((c) => isPositiveSafeInt(c.appId) && c.privateKey);
}

function signAppJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iat: now - 60, exp: now + (10 * 60), iss: appId }, privateKey, { algorithm: 'RS256' });
}

// Route gate: requires `Authorization: token <oauth_token>` from the caller
// and proves ownership against whichever configured App (prod/dev slot) owns
// the installation. Sends the refusal itself and returns null, or returns
// { installationId, installation, user, appJWT, slot }.
async function requireInstallOwnership(req, res, rawInstallationId) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^(?:token|Bearer)\s+(.+)$/i);
  const oauthToken = match ? match[1].trim() : null;
  if (!oauthToken) {
    res.status(401).json({ error: OWNERSHIP_MESSAGES.oauth_required, code: 'oauth_required', service: 'oauth-server' });
    return null;
  }
  const slots = configuredAppSlots();
  if (slots.length === 0) {
    res.status(500).json({ error: OWNERSHIP_MESSAGES.app_not_configured, code: 'app_not_configured', service: 'oauth-server' });
    return null;
  }

  let result = null;
  for (const slot of slots) {
    let appJWT;
    try {
      appJWT = signAppJwt(slot.appId, slot.privateKey);
    } catch (e) {
      logger.error('[GitHubApp] JWT signing failed for slot', slot.slot, e?.message || e);
      result = { ok: false, code: 'app_not_configured', status: 500 };
      continue;
    }
    result = await verifyInstallOwnership(rawInstallationId, oauthToken, appJWT, slot.appId);
    if (result.ok) return { ...result, appJWT, slot };
    // Only "this App has no such install" moves on to the next configured App.
    if (result.code !== 'installation_not_found') break;
  }
  logger.warn('[GitHubApp] Installation access denied:', { code: result.code });
  res.status(result.status).json({ error: OWNERSHIP_MESSAGES[result.code], code: result.code, service: 'oauth-server' });
  return null;
}

async function findInstallationViaOAuth(accessToken, installationId) {
  if (!accessToken) {
    return { ok: false, status: 0, reason: 'missing_token' };
  }

  const perPage = 100;
  const targetId = installationId != null ? Number(installationId) : null;

  if (targetId == null || Number.isNaN(targetId)) {
    return { ok: false, status: 0, reason: 'invalid_installation_id' };
  }

  let page = 1;
  const maxPages = 10; // Safety cap
  let lastStatus = null;

  while (page <= maxPages) {
    const url = `${GITHUB_USER_INSTALLATIONS_URL}?per_page=${perPage}&page=${page}`;
    let response;

    try {
      response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'Redstring-OAuth-Server/1.0'
        }
      });
    } catch (networkError) {
      return { ok: false, status: 0, reason: 'network_error', error: networkError };
    }
    lastStatus = response.status;

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        status: response.status,
        reason: 'github_error',
        details: text
      };
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      return {
        ok: false,
        status: response.status,
        reason: 'parse_error',
        error: parseError
      };
    }

    const installations = Array.isArray(data?.installations) ? data.installations : [];
    const match = installations.find((installation) => Number(installation?.id) === targetId);
    if (match) {
      return { ok: true, installation: match };
    }

    const linkHeader = response.headers.get('link') || '';
    if (!/\brel="next"/.test(linkHeader) || installations.length === 0) {
      break;
    }

    page += 1;
  }

  return { ok: true, installation: null, status: lastStatus };
}

async function listInstallationsViaOAuth(accessToken) {
  if (!accessToken) {
    return { ok: false, status: 0, reason: 'missing_token', installations: [] };
  }

  const allInstallations = [];
  const perPage = 100;
  let page = 1;
  const maxPages = 10;

  while (page <= maxPages) {
    const url = `${GITHUB_USER_INSTALLATIONS_URL}?per_page=${perPage}&page=${page}`;
    let response;
    try {
      response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'Redstring-OAuth-Server/1.0'
        }
      });
    } catch (networkError) {
      return { ok: false, status: 0, reason: 'network_error', error: networkError, installations: [] };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        status: response.status,
        reason: 'github_error',
        details: text,
        installations: []
      };
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      return {
        ok: false,
        status: response.status,
        reason: 'parse_error',
        error: parseError,
        installations: []
      };
    }

    const installations = Array.isArray(data?.installations) ? data.installations : [];
    allInstallations.push(...installations);

    const linkHeader = response.headers.get('link') || '';
    if (!/\brel="next"/.test(linkHeader) || installations.length === 0) {
      break;
    }

    page += 1;
  }

  return { ok: true, installations: allInstallations };
}

async function fetchInstallationRepositoriesViaOAuth(accessToken, installationId) {
  if (!accessToken || !installationId) {
    return [];
  }

  try {
    const response = await fetch(`https://api.github.com/user/installations/${installationId}/repositories`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${accessToken}`,
        'User-Agent': 'Redstring-OAuth-Server/1.0'
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn('[GitHubApp] OAuth repository listing failed:', {
        installationId,
        status: response.status,
        reason: text
      });
      return [];
    }

    const repoData = await response.json();
    if (Array.isArray(repoData?.repositories)) {
      return repoData.repositories;
    }
  } catch (error) {
    logger.warn('[GitHubApp] OAuth repository listing error:', {
      installationId,
      error: error.message
    });
  }

  return [];
}

async function discoverInstallationViaOAuth(accessToken) {
  const { ids, slugs } = resolveGitHubAppIdentifiers();
  if (!accessToken || (ids.length === 0 && slugs.length === 0)) {
    return null;
  }

  const listResult = await listInstallationsViaOAuth(accessToken);
  if (!listResult.ok) {
    logger.debug('[GitHubApp] Installation discovery failed via OAuth:', {
      status: listResult.status,
      reason: listResult.reason || null,
      details: listResult.details || null
    });
    return null;
  }

  const matches = listResult.installations || [];
  const match = matches.find((installation) => {
    const slug = installation?.app_slug;
    const appId = Number(installation?.app_id);
    const slugMatch = slug && slugs.includes(slug);
    const idMatch = !Number.isNaN(appId) && ids.includes(appId);
    return slugMatch || idMatch;
  });

  if (!match) {
    return null;
  }

  const repositories = await fetchInstallationRepositoriesViaOAuth(accessToken, match.id);

  return {
    installationId: match.id,
    account: match.account || null,
    permissions: match.permissions || null,
    repositories,
    installation: match
  };
}

function createVerificationRecord(result, oauthCredentials) {
  if (!result) {
    return null;
  }

  const oauthLogin = result.oauthUser?.login || oauthCredentials?.user?.login || null;
  const trimmedDetails = typeof result.details === 'string'
    ? result.details.slice(0, 2000)
    : null;

  return {
    status: result.status,
    reason: result.reason || null,
    installationId: result.installation?.id ?? result.checkedInstallationId ?? null,
    installationAccount: result.installation?.account?.login ?? null,
    targetType: result.installation?.target_type ?? null,
    // Capture which GitHub App the install actually belongs to. Without this,
    // a deployment configured for a different App than the install will mint
    // with the wrong key and GitHub returns an opaque 404. Surfacing app_id
    // and app_slug to the client lets the diagnostic panel say exactly which
    // App owns the install vs. which one the deployment is configured for.
    appId: result.installation?.app_id ?? null,
    appSlug: result.installation?.app_slug ?? null,
    oauthLogin,
    statusCode: result.statusCode ?? null,
    details: trimmedDetails,
    checkedInstallationId: result.checkedInstallationId ?? (result.installation?.id ?? null),
    checkedAt: Date.now()
  };
}

function formatVerificationForResponse(record) {
  if (!record) {
    return null;
  }

  const response = {
    status: record.status || null,
    reason: record.reason || null,
    oauthLogin: record.oauthLogin || null,
    installationId: record.installationId ?? null,
    checkedInstallationId: record.checkedInstallationId ?? null,
    installationAccount: record.installationAccount || null,
    targetType: record.targetType || null,
    appId: record.appId ?? null,
    appSlug: record.appSlug || null,
    statusCode: record.statusCode ?? null,
    details: record.details || null,
    checkedAt: record.checkedAt ? new Date(record.checkedAt).toISOString() : null
  };

  Object.keys(response).forEach((key) => {
    if (response[key] == null) {
      delete response[key];
    }
  });

  return response;
}

function verificationRecordsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.status || null) === (b.status || null) &&
    (a.reason || null) === (b.reason || null) &&
    (a.installationId ?? null) === (b.installationId ?? null) &&
    (a.checkedInstallationId ?? null) === (b.checkedInstallationId ?? null) &&
    (a.installationAccount || null) === (b.installationAccount || null) &&
    (a.targetType || null) === (b.targetType || null) &&
    (a.oauthLogin || null) === (b.oauthLogin || null) &&
    (a.statusCode ?? null) === (b.statusCode ?? null) &&
    (a.details || null) === (b.details || null)
  );
}

async function verifyInstallationWithOAuth(installationId, oauthCredentials, { enforceAccountMatch = true } = {}) {
  const numericInstallationId = installationId != null ? Number(installationId) : null;

  if (numericInstallationId == null || Number.isNaN(numericInstallationId)) {
    return {
      status: 'missing_installation',
      reason: 'missing_installation_id',
      installation: null,
      oauthUser: oauthCredentials?.user || null,
      checkedInstallationId: null
    };
  }

  if (!oauthCredentials?.accessToken) {
    return {
      status: 'skipped',
      reason: 'oauth_not_connected',
      installation: null,
      oauthUser: oauthCredentials?.user || null,
      checkedInstallationId: numericInstallationId
    };
  }

  const lookup = await findInstallationViaOAuth(oauthCredentials.accessToken, numericInstallationId);
  const oauthUser = oauthCredentials.user || null;

  if (!lookup.ok) {
    if (lookup.status === 401) {
      return {
        status: 'oauth_invalid',
        reason: 'oauth_token_invalid',
        installation: null,
        oauthUser,
        statusCode: lookup.status,
        details: lookup.details || null,
        checkedInstallationId: numericInstallationId
      };
    }

    if (lookup.status === 404) {
      return {
        status: 'not_found',
        reason: 'installation_not_found',
        installation: null,
        oauthUser,
        statusCode: lookup.status,
        details: lookup.details || null,
        checkedInstallationId: numericInstallationId
      };
    }

    // 403: token is valid but lacks scope to list installations. GitHub
    // requires `read:org` on /user/installations even for personal installs
    // in some configurations. This is NOT an indictment of the install
    // itself — the mint API is the authoritative source. Mark as
    // 'unverified' so the mint endpoint can choose to proceed instead of
    // failing closed on a verification step that can't even run.
    if (lookup.status === 403) {
      return {
        status: 'unverified',
        reason: 'oauth_scope_insufficient',
        installation: null,
        oauthUser,
        statusCode: lookup.status,
        details: lookup.details || 'OAuth token lacks read:org scope required by /user/installations',
        checkedInstallationId: numericInstallationId
      };
    }

    return {
      status: 'error',
      reason: lookup.reason || 'github_request_failed',
      installation: null,
      oauthUser,
      statusCode: lookup.status || null,
      details: lookup.details || null,
      checkedInstallationId: numericInstallationId
    };
  }

  if (!lookup.installation) {
    const defaultDetail = 'GitHub did not include this installation in /user/installations for the current OAuth token. Tokens without read:org scope cannot enumerate organization installs.';
    return {
      status: 'unverified',
      reason: lookup.reason || 'installation_not_listed',
      installation: null,
      oauthUser,
      statusCode: lookup.status || null,
      details: lookup.details || defaultDetail,
      checkedInstallationId: numericInstallationId
    };
  }

  const installation = lookup.installation;

  if (
    enforceAccountMatch &&
    installation?.target_type === 'User' &&
    oauthUser?.id &&
    installation?.account?.id &&
    installation.account.id !== oauthUser.id
  ) {
    return {
      status: 'account_mismatch',
      reason: 'installation_account_mismatch',
      installation,
      oauthUser,
      checkedInstallationId: numericInstallationId
    };
  }

  return {
    status: 'verified',
    reason: null,
    installation,
    oauthUser,
    checkedInstallationId: numericInstallationId
  };
}

// Get GitHub OAuth client ID with enhanced validation and dev/prod selection
app.get('/api/github/oauth/client-id', (req, res) => {
  try {
    const useDev = isLocalRequest(req);
    const clientId = useDev
      ? (process.env.GITHUB_CLIENT_ID_DEV || process.env.GITHUB_CLIENT_ID || null)
      : (process.env.GITHUB_CLIENT_ID || null);
    const clientSecret = useDev
      ? (process.env.GITHUB_CLIENT_SECRET_DEV || process.env.GITHUB_CLIENT_SECRET || null)
      : (process.env.GITHUB_CLIENT_SECRET || null);
    
    // Enhanced validation
    const isConfigured = !!(clientId && clientSecret);
    const clientIdValid = clientId && clientId.trim().length > 0;
    const clientSecretValid = clientSecret && clientSecret.trim().length > 0;
    
    logger.debug('[OAuth] Client ID request:', {
      configured: isConfigured,
      clientIdValid,
      clientSecretValid,
      clientIdLength: clientId ? clientId.length : 0,
      clientSecretLength: clientSecret ? clientSecret.length : 0,
      selection: useDev ? 'dev' : 'prod'
    });
    
    res.json({ 
      clientId: clientIdValid ? clientId.trim() : null, 
      configured: isConfigured,
      clientIdValid,
      clientSecretValid,
      selection: useDev ? 'dev' : 'prod',
      service: 'oauth-server' 
    });
  } catch (error) {
    logger.error('[OAuth] Failed to get client ID:', error);
    res.status(500).json({ 
      error: 'Failed to get client ID',
      service: 'oauth-server',
      details: error.message
    });
  }
});

// OAuth callback handler — GitHub redirects here after user authorizes.
// Detects Electron vs browser via state prefix and redirects accordingly.
app.get('/oauth/callback', (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.error('[OAuth] GitHub callback error:', error);
    // Plain text: `error` comes straight from the query string.
    return res.status(400).type('text/plain').send('GitHub OAuth error');
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state from GitHub OAuth callback');
  }

  // Browser flow: redirect back to the frontend app with code/state as query params
  const frontendPort = process.env.PORT || 4001;
  const frontendUrl = `http://localhost:${frontendPort}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  logger.info('[OAuth] Redirecting to frontend app');
  return res.redirect(frontendUrl);
});

// Refresh OAuth access token
app.post('/api/github/oauth/refresh', oauthSensitiveLimiter, async (req, res) => {
  try {
    const { refresh_token } = req.body;
    
    logger.debug('[OAuth] Refresh token request:', {
      hasRefreshToken: !!refresh_token,
      refreshTokenLength: refresh_token ? refresh_token.length : 0
    });
    
    if (!refresh_token) {
      return res.status(400).json({ 
        error: 'Missing refresh token',
        service: 'oauth-server'
      });
    }
    
    // Select dev/prod OAuth credentials based on redirect_uri or request origin
    const redirectHost = (() => {
      try { return new URL(redirect_uri).host.toLowerCase(); } catch { return ''; }
    })();
    const isLocal = redirectHost.includes('localhost') || isLocalRequest(req);
    const clientId = isLocal
      ? (process.env.GITHUB_CLIENT_ID_DEV || process.env.GITHUB_CLIENT_ID)
      : process.env.GITHUB_CLIENT_ID;
    const clientSecret = isLocal
      ? (process.env.GITHUB_CLIENT_SECRET_DEV || process.env.GITHUB_CLIENT_SECRET)
      : process.env.GITHUB_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ 
        error: 'GitHub OAuth not configured',
        service: 'oauth-server'
      });
    }
    
    logger.debug('[OAuth] Refreshing access token...');
    
    // GitHub doesn't actually support refresh tokens in the traditional sense
    // But we can validate the existing token and return it if still valid
    // In a real implementation, you'd store refresh tokens and manage them properly
    
    // For now, we'll treat the "refresh_token" as an indication to validate current auth
    // This is a simplified implementation - in production you'd want proper refresh token flow
    
    res.status(501).json({
      error: 'Token refresh not yet implemented',
      message: 'GitHub OAuth uses long-lived tokens. Please re-authenticate if your token has expired.',
      service: 'oauth-server'
    });
    
  } catch (error) {
    console.error('[OAuth] Token refresh failed:', error);
    res.status(500).json({ 
      error: error.message,
      service: 'oauth-server'
    });
  }
});

// Validate an OAuth access token against GitHub OAuth App API
app.post('/api/github/oauth/validate', oauthSensitiveLimiter, async (req, res) => {
  try {
    const { access_token } = req.body || {};
    console.log('[OAuth] Validate request received, token length:', access_token ? access_token.length : 0);
    
    if (!access_token) {
      console.log('[OAuth] No access token provided');
      return res.status(400).json({
        error: 'Missing access_token',
        service: 'oauth-server'
      });
    }

    // Select dev/prod credentials based on request origin
    const useDev = isLocalRequest(req);
    const clientId = useDev
      ? (process.env.GITHUB_CLIENT_ID_DEV || process.env.GITHUB_CLIENT_ID)
      : process.env.GITHUB_CLIENT_ID;
    const clientSecret = useDev
      ? (process.env.GITHUB_CLIENT_SECRET_DEV || process.env.GITHUB_CLIENT_SECRET)
      : process.env.GITHUB_CLIENT_SECRET;

    console.log('[OAuth] Using credentials:', { useDev, clientIdLength: clientId ? clientId.length : 0, clientSecretLength: clientSecret ? clientSecret.length : 0 });

    if (!clientId || !clientSecret) {
      console.log('[OAuth] Missing OAuth credentials');
      return res.status(500).json({
        error: 'GitHub OAuth not configured',
        service: 'oauth-server'
      });
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    console.log('[OAuth] Making GitHub validation request...');

    const ghResp = await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Basic ${basic}`,
        'User-Agent': 'Redstring-OAuth-Server/1.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ access_token })
    });

    console.log('[OAuth] GitHub validation response:', ghResp.status, ghResp.statusText);

    if (!ghResp.ok) {
      const text = await ghResp.text();
      console.log('[OAuth] GitHub validation failed:', text);
      const status = ghResp.status === 404 || ghResp.status === 401 ? 401 : ghResp.status;
      return res.status(status).json({
        valid: false,
        error: 'Token invalid or revoked',
        details: text,
        service: 'oauth-server'
      });
    }

    const data = await ghResp.json();
    console.log('[OAuth] GitHub validation success, data keys:', Object.keys(data));
    
    // GitHub may return scopes as array or string
    let scopes = [];
    if (Array.isArray(data.scopes)) scopes = data.scopes;
    else if (typeof data.scopes === 'string') scopes = data.scopes.split(',').map(s => s.trim()).filter(Boolean);
    else if (typeof data.scope === 'string') scopes = data.scope.split(',').map(s => s.trim()).filter(Boolean);

    console.log('[OAuth] Extracted scopes:', scopes);

    return res.json({
      valid: true,
      scopes,
      note: 'Token is valid',
      service: 'oauth-server'
    });
  } catch (error) {
    console.error('[OAuth] Validate failed:', error);
    return res.status(500).json({ error: error.message, service: 'oauth-server' });
  }
});

// Revoke an OAuth access token via OAuth App API
app.delete('/api/github/oauth/revoke', oauthSensitiveLimiter, async (req, res) => {
  try {
    const { access_token } = req.body || {};
    if (!access_token) {
      return res.status(400).json({
        error: 'Missing access_token',
        service: 'oauth-server'
      });
    }

    const useDev = isLocalRequest(req);
    const clientId = useDev
      ? (process.env.GITHUB_CLIENT_ID_DEV || process.env.GITHUB_CLIENT_ID)
      : process.env.GITHUB_CLIENT_ID;
    const clientSecret = useDev
      ? (process.env.GITHUB_CLIENT_SECRET_DEV || process.env.GITHUB_CLIENT_SECRET)
      : process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: 'GitHub OAuth not configured',
        service: 'oauth-server'
      });
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const ghResp = await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Basic ${basic}`,
        'User-Agent': 'Redstring-OAuth-Server/1.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ access_token })
    });

    if (ghResp.status === 204) {
      return res.json({ revoked: true, service: 'oauth-server' });
    }

    const text = await ghResp.text();
    const status = ghResp.status === 404 || ghResp.status === 401 ? 401 : ghResp.status;
    return res.status(status).json({
      revoked: false,
      error: 'Failed to revoke token',
      details: text,
      service: 'oauth-server'
    });
  } catch (error) {
    console.error('[OAuth] Revoke failed:', error);
    return res.status(500).json({ error: error.message, service: 'oauth-server' });
  }
});

// Exchange OAuth code for access token with enhanced error handling
app.post('/api/github/oauth/token', oauthSensitiveLimiter, async (req, res) => {
  try {
    const { code, state, redirect_uri, code_verifier } = req.body || {};

    logger.debug('[OAuth] Token exchange request:', {
      hasCode: !!code,
      hasState: !!state,
      hasRedirectUri: !!redirect_uri,
      hasCodeVerifier: !!code_verifier
    });

    if (!code || !state) {
      return res.status(400).json({
        error: 'Missing code or state',
        code: 'missing_code_or_state',
        service: 'oauth-server'
      });
    }
    if (code_verifier != null && (typeof code_verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(code_verifier))) {
      return res.status(400).json({ error: 'Invalid code_verifier', code: 'invalid_code_verifier', service: 'oauth-server' });
    }
    
    // Select dev/prod OAuth credentials based on redirect_uri or request origin
    const redirectHost = (() => {
      try { return new URL(redirect_uri).host.toLowerCase(); } catch { return ''; }
    })();
    const isLocal = redirectHost.includes('localhost') || isLocalRequest(req);
    const clientId = isLocal
      ? (process.env.GITHUB_CLIENT_ID_DEV || process.env.GITHUB_CLIENT_ID)
      : process.env.GITHUB_CLIENT_ID;
    const clientSecret = isLocal
      ? (process.env.GITHUB_CLIENT_SECRET_DEV || process.env.GITHUB_CLIENT_SECRET)
      : process.env.GITHUB_CLIENT_SECRET;
    
    // Enhanced validation with detailed error messages
    if (!clientId || !clientSecret) {
      logger.error('[OAuth] Missing credentials:', {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        clientIdLength: clientId ? clientId.length : 0,
        clientSecretLength: clientSecret ? clientSecret.length : 0
      });
      
      return res.status(500).json({
        error: 'GitHub OAuth not configured',
        code: 'oauth_not_configured',
        service: 'oauth-server'
      });
    }
    
    // Validate credential format
    const clientIdValid = clientId.trim().length > 0;
    const clientSecretValid = clientSecret.trim().length > 0;
    
    if (!clientIdValid || !clientSecretValid) {
      logger.error('[OAuth] Invalid credentials format:', {
        clientIdValid,
        clientSecretValid,
        clientIdLength: clientId.length,
        clientSecretLength: clientSecret.length
      });
      
      return res.status(500).json({
        error: 'GitHub OAuth not configured',
        code: 'oauth_not_configured',
        service: 'oauth-server'
      });
    }
    
    logger.debug('[OAuth] Exchanging code for token...');
    
    const requestPayload = {
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      code,
      redirect_uri,
      state
    };
    // PKCE (S-07): forward the verifier when the SPA sent one.
    if (typeof code_verifier === 'string') requestPayload.code_verifier = code_verifier;
    // (The payload carries the client secret — never log it.)

    // Exchange code for access token with GitHub
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Redstring-OAuth-Server/1.0'
      },
      body: JSON.stringify(requestPayload)
    });
    
    logger.debug('[OAuth] GitHub response status:', tokenResponse.status);
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[OAuth] GitHub API error:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        errorText,
        headers: Object.fromEntries(tokenResponse.headers.entries())
      });
      
      // Provide more specific error messages based on status code
      let errorMessage = `GitHub API error: ${tokenResponse.status}`;
      if (tokenResponse.status === 404) {
        errorMessage = 'GitHub OAuth credentials invalid or OAuth app not found (404)';
      } else if (tokenResponse.status === 400) {
        errorMessage = 'Invalid OAuth request parameters (400)';
      } else if (tokenResponse.status === 401) {
        errorMessage = 'GitHub OAuth credentials invalid (401)';
      }
      
      throw new Error(errorMessage);
    }
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      console.error('[OAuth] GitHub OAuth error:', tokenData);
      throw new Error(`GitHub OAuth error: ${tokenData.error_description || tokenData.error}`);
    }
    
    logger.info('[OAuth] Token exchange successful');

    // Immediately validate the token against OAuth App API and ensure required scopes
    try {
      const basic = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');
      const validateResp = await fetch(`https://api.github.com/applications/${clientId.trim()}/token`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Basic ${basic}`,
          'User-Agent': 'Redstring-OAuth-Server/1.0',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ access_token: tokenData.access_token })
      });

      if (!validateResp.ok) {
        const vtext = await validateResp.text();
        return res.status(400).json({
          error: 'Token validation failed',
          details: vtext,
          service: 'oauth-server'
        });
      }

      const vdata = await validateResp.json();
      let scopes = [];
      if (Array.isArray(vdata.scopes)) scopes = vdata.scopes;
      else if (typeof vdata.scopes === 'string') scopes = vdata.scopes.split(',').map(s => s.trim()).filter(Boolean);
      else if (typeof vdata.scope === 'string') scopes = vdata.scope.split(',').map(s => s.trim()).filter(Boolean);

      // Require 'repo' scope for private repo operations
      if (!scopes.includes('repo')) {
        return res.status(400).json({
          error: 'Insufficient OAuth scope',
          required: ['repo'],
          scopes,
          service: 'oauth-server'
        });
      }
    } catch (validationError) {
      console.error('[OAuth] Post-exchange validation error:', validationError);
      return res.status(400).json({
        error: 'Token validation error',
        details: validationError.message,
        service: 'oauth-server'
      });
    }

    // Fetch user profile for context and auditing
    let userData = null;
    try {
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${tokenData.access_token}`,
          'User-Agent': 'Redstring-OAuth-Server/1.0'
        }
      });
      if (userResponse.ok) {
        userData = await userResponse.json();
        
        // Track OAuth login
        try {
          const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
          const userAgent = req.headers['user-agent'] || null;
          userAnalytics.trackActivity({
            userId: String(userData.id),
            userLogin: userData.login,
            action: 'oauth_login',
            metadata: {
              provider: 'github',
              scope: tokenData.scope
            },
            ip,
            userAgent,
            path: req.path
          });
        } catch (analyticsError) {
          logger.debug('[OAuth] Analytics tracking error:', analyticsError.message);
        }
      } else {
        const text = await userResponse.text().catch(() => '');
        logger.warn('[OAuth] Failed to fetch GitHub user profile:', userResponse.status, text);
      }
    } catch (profileError) {
      logger.warn('[OAuth] User profile fetch error:', profileError.message);
    }

    const expiresAt = tokenData.expires_in
      ? Date.now() + (tokenData.expires_in * 1000)
      : null; // GitHub OAuth tokens don't expire by default

    // STATELESS MODE: Only persist to server if explicitly enabled
    // By default, tokens stay in browser localStorage (user data stays local!)
    if (ENABLE_SERVER_PERSISTENCE) {
      try {
        tokenVault.setOAuthCredentials({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          scope: tokenData.scope || null,
          tokenType: tokenData.token_type || 'bearer',
          expiresAt,
          user: userData
        });
        logger.info('[OAuth] Token persisted to server (ENABLE_SERVER_PERSISTENCE=true)');
      } catch (vaultError) {
        logger.warn('[OAuth] Failed to persist OAuth credentials:', vaultError.message);
      }
    } else {
      logger.info('[OAuth] Server persistence disabled - tokens will be stored in browser localStorage only');
    }

    // Return token data to frontend (browser will store in localStorage)
    res.json({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'bearer',
      scope: tokenData.scope,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      user: userData,
      service: 'oauth-server',
      persistence: ENABLE_SERVER_PERSISTENCE ? 'server' : 'browser-only'
    });
    
  } catch (error) {
    console.error('[OAuth] Token exchange failed:', {
      error: error.message,
      stack: error.stack,
      service: 'oauth-server'
    });
    
    res.status(500).json({ 
      error: error.message,
      service: 'oauth-server',
      timestamp: new Date().toISOString()
    });
  }
});

// Secure token state endpoints
app.get('/api/github/auth/state', async (req, res) => {
  try {
    const includeTokens = (() => {
      const raw = (req.query?.includeTokens || '').toString().toLowerCase();
      return raw === 'true' || raw === '1' || raw === 'yes';
    })();

    // STATELESS MODE: Server doesn't persist tokens by default
    // Tokens are stored in browser localStorage (user data stays local!)
    const oauthCredentials = ENABLE_SERVER_PERSISTENCE ? tokenVault.getOAuthCredentials() : null;
    let githubAppCredentials = ENABLE_SERVER_PERSISTENCE ? tokenVault.getGitHubAppInstallation() : null;
    let verificationRecordForResponse = githubAppCredentials?.verification || null;

    if (!githubAppCredentials && oauthCredentials?.accessToken) {
      try {
        const discovered = await discoverInstallationViaOAuth(oauthCredentials.accessToken);
        if (discovered?.installationId) {
          logger.info('[GitHubApp] Auto-discovered installation via OAuth token:', {
            installationId: discovered.installationId,
            account: discovered.account?.login || null,
            repositoryCount: Array.isArray(discovered.repositories) ? discovered.repositories.length : 0
          });

          const verificationResult = await verifyInstallationWithOAuth(
            discovered.installationId,
            oauthCredentials
          );
          const recordCandidate = createVerificationRecord(verificationResult, oauthCredentials);

          try {
            githubAppCredentials = tokenVault.setGitHubAppInstallation({
              installationId: discovered.installationId,
              accessToken: null,
              tokenExpiresAt: null,
              repositories: Array.isArray(discovered.repositories) ? discovered.repositories : [],
              account: discovered.account || null,
              permissions: discovered.permissions || null,
              verification: recordCandidate
            });
            verificationRecordForResponse = githubAppCredentials.verification || recordCandidate;
          } catch (persistError) {
            logger.warn('[GitHubApp] Failed to persist auto-discovered installation:', persistError.message);
            githubAppCredentials = {
              installationId: discovered.installationId,
              accessToken: null,
              tokenExpiresAt: null,
              repositories: Array.isArray(discovered.repositories) ? discovered.repositories : [],
              account: discovered.account || null,
              permissions: discovered.permissions || null,
              verification: recordCandidate,
              storedAt: Date.now()
            };
            verificationRecordForResponse = recordCandidate;
          }
        }
      } catch (discoveryError) {
        logger.warn('[GitHubApp] OAuth installation discovery error:', discoveryError.message);
      }
    }

    if (githubAppCredentials?.installationId) {
      const verificationResult = await verifyInstallationWithOAuth(
        githubAppCredentials.installationId,
        oauthCredentials
      );
      const recordCandidate = createVerificationRecord(verificationResult, oauthCredentials);

      if (verificationResult.status === 'not_found' || verificationResult.status === 'account_mismatch') {
        logger.warn('[GitHubApp] Stored installation failed verification, clearing credentials', {
          installationId: githubAppCredentials.installationId,
          status: verificationResult.status,
          reason: verificationResult.reason
        });
        tokenVault.clearGitHubAppInstallation();
        githubAppCredentials = null;
        verificationRecordForResponse = recordCandidate;
      } else if (githubAppCredentials) {
        const nextPayload = { ...githubAppCredentials };
        let needsUpdate = false;

        if (verificationResult.installation?.account) {
          const existingAccountId = githubAppCredentials.account?.id ?? null;
          const nextAccountId = verificationResult.installation.account.id ?? null;
          if (!existingAccountId || (nextAccountId && nextAccountId !== existingAccountId)) {
            nextPayload.account = verificationResult.installation.account;
            needsUpdate = true;
          }
        }

        const prevVerification = githubAppCredentials.verification || null;
        if (!verificationRecordsEqual(prevVerification, recordCandidate)) {
          nextPayload.verification = recordCandidate;
          needsUpdate = true;
        }

        if (needsUpdate) {
          githubAppCredentials = tokenVault.setGitHubAppInstallation(nextPayload);
          verificationRecordForResponse = githubAppCredentials.verification || recordCandidate;
        } else {
          verificationRecordForResponse = prevVerification || recordCandidate;
        }
      }
    }

    const response = {
      service: 'oauth-server',
      persistence: ENABLE_SERVER_PERSISTENCE ? 'server' : 'browser-only',
      stateless: !ENABLE_SERVER_PERSISTENCE,
      oauth: oauthCredentials ? {
        hasToken: true,
        scope: oauthCredentials.scope || null,
        tokenType: oauthCredentials.tokenType || 'bearer',
        expiresAt: oauthCredentials.expiresAt || null,
        storedAt: oauthCredentials.storedAt || null,
        user: oauthCredentials.user || null
      } : { hasToken: false },
      githubApp: githubAppCredentials ? {
        isInstalled: true,
        installationId: githubAppCredentials.installationId || null,
        tokenExpiresAt: githubAppCredentials.tokenExpiresAt || null,
        storedAt: githubAppCredentials.storedAt || null,
        account: githubAppCredentials.account || null,
        permissions: githubAppCredentials.permissions || null,
        repositories: Array.isArray(githubAppCredentials.repositories)
          ? githubAppCredentials.repositories
          : []
      } : { isInstalled: false }
    };

    if (githubAppCredentials) {
      response.githubApp.verification = formatVerificationForResponse(
        verificationRecordForResponse || githubAppCredentials.verification || null
      );
    } else if (verificationRecordForResponse) {
      response.githubApp.verification = formatVerificationForResponse(verificationRecordForResponse);
    }

    if (includeTokens && oauthCredentials?.accessToken) {
      response.oauth.accessToken = oauthCredentials.accessToken;
      response.oauth.refreshToken = oauthCredentials.refreshToken || null;
    }

    if (includeTokens && githubAppCredentials?.accessToken) {
      response.githubApp.accessToken = githubAppCredentials.accessToken;
    }

    res.json(response);
  } catch (error) {
    logger.error('[OAuth] Auth state retrieval failed:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

app.get('/api/github/auth/oauth/token', (req, res) => {
  try {
    // Unauthenticated read of the server-side vault: only in explicit
    // single-user server-persistence mode. Stateless (the default) never
    // hands out stored credentials, even if a vault file exists.
    const credentials = ENABLE_SERVER_PERSISTENCE ? tokenVault.getOAuthCredentials() : null;
    if (!credentials?.accessToken) {
      return res.status(404).json({
        error: 'No OAuth token stored',
        service: 'oauth-server'
      });
    }
    res.json({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken || null,
      scope: credentials.scope || null,
      token_type: credentials.tokenType || 'bearer',
      expires_at: credentials.expiresAt ? new Date(credentials.expiresAt).toISOString() : null,
      user: credentials.user || null,
      stored_at: credentials.storedAt ? new Date(credentials.storedAt).toISOString() : null,
      service: 'oauth-server'
    });
  } catch (error) {
    logger.error('[OAuth] OAuth token retrieval failed:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

app.post('/api/github/auth/oauth', (req, res) => {
  try {
    const {
      access_token,
      refresh_token,
      scope = null,
      token_type = 'bearer',
      expires_at = null,
      user = null
    } = req.body || {};

    if (!access_token || typeof access_token !== 'string' || access_token.trim().length === 0) {
      return res.status(400).json({
        error: 'Missing access_token',
        service: 'oauth-server'
      });
    }

    // STATELESS MODE: Only persist to server if explicitly enabled
    if (!ENABLE_SERVER_PERSISTENCE) {
      logger.info('[OAuth] Server persistence disabled - tokens should be stored in browser localStorage');
      return res.json({
        stored: false,
        persistence: 'browser-only',
        message: 'Server is stateless - tokens are stored in browser localStorage only',
        service: 'oauth-server'
      });
    }

    const expiresAtTs = expires_at
      ? new Date(expires_at).getTime()
      : null;

    const stored = tokenVault.setOAuthCredentials({
      accessToken: access_token,
      refreshToken: refresh_token || null,
      scope,
      tokenType: token_type || 'bearer',
      expiresAt: expiresAtTs,
      user
    });

    res.json({
      stored: true,
      expires_at: stored.expiresAt ? new Date(stored.expiresAt).toISOString() : null,
      persistence: 'server',
      service: 'oauth-server'
    });
  } catch (error) {
    logger.error('[OAuth] Failed to persist OAuth credentials:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

app.delete('/api/github/auth/oauth', (req, res) => {
  try {
    // STATELESS MODE: Server doesn't persist, so nothing to clear
    if (ENABLE_SERVER_PERSISTENCE) {
      tokenVault.clearOAuthCredentials();
    }
    res.json({
      cleared: true,
      persistence: ENABLE_SERVER_PERSISTENCE ? 'server' : 'browser-only',
      message: ENABLE_SERVER_PERSISTENCE ? 'Server tokens cleared' : 'Server is stateless - clear tokens from browser localStorage',
      service: 'oauth-server'
    });
  } catch (error) {
    logger.error('[OAuth] Failed to clear OAuth credentials:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

app.get('/api/github/auth/github-app', (req, res) => {
  try {
    // See /auth/oauth/token: the vault is only readable in explicit
    // server-persistence mode. (The installation-token route used to write
    // every minted token here, where any caller could read it back.)
    const credentials = ENABLE_SERVER_PERSISTENCE ? tokenVault.getGitHubAppInstallation() : null;
    if (!credentials) {
      return res.status(404).json({
        error: 'No GitHub App installation stored',
        service: 'oauth-server'
      });
    }
    res.json({
      installationId: credentials.installationId || null,
      accessToken: credentials.accessToken || null,
      tokenExpiresAt: credentials.tokenExpiresAt ? new Date(credentials.tokenExpiresAt).toISOString() : null,
      repositories: Array.isArray(credentials.repositories) ? credentials.repositories : [],
      account: credentials.account || null,
      permissions: credentials.permissions || null,
      verification: credentials.verification || null,
      stored_at: credentials.storedAt ? new Date(credentials.storedAt).toISOString() : null,
      service: 'oauth-server'
    });
  } catch (error) {
    logger.error('[OAuth] GitHub App credentials retrieval failed:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

app.post('/api/github/auth/github-app', (req, res) => {
  try {
    const {
      installationId,
      accessToken = null,
      tokenExpiresAt = null,
      repositories = [],
      account = null,
      permissions = null,
      verification = null
    } = req.body || {};

    if (!installationId) {
      return res.status(400).json({
        error: 'installationId is required',
        service: 'oauth-server'
      });
    }

    // STATELESS MODE: Only persist to server if explicitly enabled
    if (!ENABLE_SERVER_PERSISTENCE) {
      logger.info('[OAuth] Server persistence disabled - GitHub App installation should be stored in browser localStorage');
      return res.json({
        stored: false,
        persistence: 'browser-only',
        message: 'Server is stateless - installation stored in browser localStorage only',
        service: 'oauth-server'
      });
    }

    const stored = tokenVault.setGitHubAppInstallation({
      installationId,
      accessToken,
      tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : null,
      repositories,
      account,
      permissions,
      verification
    });

    res.json({
      stored: true,
      tokenExpiresAt: stored.tokenExpiresAt ? new Date(stored.tokenExpiresAt).toISOString() : null,
      repositoryCount: Array.isArray(stored.repositories) ? stored.repositories.length : 0,
      verification: stored.verification || null,
      persistence: 'server',
      service: 'oauth-server'
    });
  } catch (error) {
    logger.error('[OAuth] Failed to persist GitHub App installation:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

app.delete('/api/github/auth/github-app', (req, res) => {
  try {
    // STATELESS MODE: Server doesn't persist, so nothing to clear
    if (ENABLE_SERVER_PERSISTENCE) {
      tokenVault.clearGitHubAppInstallation();
    }
    res.json({
      cleared: true,
      persistence: ENABLE_SERVER_PERSISTENCE ? 'server' : 'browser-only',
      message: ENABLE_SERVER_PERSISTENCE ? 'Server installation cleared' : 'Server is stateless - clear installation from browser localStorage',
      service: 'oauth-server'
    });
  } catch (error) {
    logger.error('[OAuth] Failed to clear GitHub App credentials:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

// Create repository via OAuth user authentication (recommended approach)
app.post('/api/github/oauth/create-repository', async (req, res) => {
  try {
    const { access_token, name, private: isPrivate, description, auto_init } = req.body;
    
    if (!access_token || !name) {
      return res.status(400).json({
        error: 'Access token and repository name are required',
        service: 'oauth-server'
      });
    }

    logger.debug('[OAuth] Creating repository via user authentication:', { name, isPrivate });

    // Create repository using user's access token
    const createRepoResponse = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${access_token}`,
        'User-Agent': 'Redstring-OAuth-Server/1.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name.trim(),
        private: isPrivate !== false, // Default to private
        description: description || `Redstring universe: ${name}`,
        auto_init: auto_init !== false, // Default to true (create README)
        has_issues: false,
        has_projects: false,
        has_wiki: false
      })
    });

    if (!createRepoResponse.ok) {
      const errorText = await createRepoResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { message: errorText };
      }

      logger.error('[OAuth] Repository creation failed:', {
        status: createRepoResponse.status,
        statusText: createRepoResponse.statusText,
        error: errorData,
        service: 'oauth-server'
      });

      return res.status(createRepoResponse.status).json({
        error: 'Repository creation failed',
        details: errorData.message || errorText,
        github_error: JSON.stringify(errorData),
        service: 'oauth-server'
      });
    }

    const newRepo = await createRepoResponse.json();
    
    logger.info('[OAuth] Repository created successfully:', {
      name: newRepo.full_name,
      private: newRepo.private,
      html_url: newRepo.html_url
    });

    res.json({
      id: newRepo.id,
      name: newRepo.name,
      full_name: newRepo.full_name,
      description: newRepo.description,
      private: newRepo.private,
      html_url: newRepo.html_url,
      clone_url: newRepo.clone_url,
      default_branch: newRepo.default_branch,
      created_at: newRepo.created_at,
      service: 'oauth-server'
    });

  } catch (error) {
    console.error('[OAuth] Repository creation error:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

// GitHub App endpoints

// Get GitHub App info (slug/name) for installation links
app.get('/api/github/app/info', (req, res) => {
  try {
    const useDev = isLocalRequest(req);

    // Use environment-specific app slug
    let appSlug;
    if (useDev) {
      appSlug = process.env.GITHUB_APP_SLUG_DEV || process.env.GITHUB_APP_SLUG || 'redstring-semantic-sync-test';
    } else {
      appSlug = process.env.GITHUB_APP_SLUG || 'redstring-semantic-sync';
    }

    logger.info('[GitHubApp] App info requested:', {
      useDev,
      appSlug,
      host: req.headers.host,
      environment: useDev ? 'test' : 'prod'
    });

    res.json({
      name: appSlug,
      service: 'oauth-server',
      environment: useDev ? 'test' : 'prod'
    });
  } catch (error) {
    logger.error('[GitHubApp] App info request failed:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

// Generate installation access token (server-side only for security).
//
// S-02: requires the caller's OAuth token and proves ownership (C-9) before
// minting — the old handler checked a server-side vault token (absent in
// stateless mode → 'skipped') and minted for any installation id. The token
// is minted for the id GitHub returned for the verified installation and is
// NOT written to the server-side vault.
app.post('/api/github/app/installation-token', async (req, res) => {
  try {
    const { installation_id } = req.body || {};

    if (installation_id == null || installation_id === '') {
      return res.status(400).json({
        error: 'Installation ID is required',
        code: 'missing_installation',
        service: 'oauth-server'
      });
    }

    const gate = await requireInstallOwnership(req, res, installation_id);
    if (!gate) return;
    const { installationId, installation, user, appJWT, slot } = gate;

    logger.info('[GitHubApp] Installation token request:', {
      installationId,
      resolvedAppSlot: slot.slot,
      targetType: installation.target_type
    });

    const tokenResponse = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${appJWT}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => '');
      logger.error('[GitHubApp] Installation token request failed:', {
        status: tokenResponse.status,
        installationId,
        slot: slot.slot,
        errorText: errorText.slice(0, 300)
      });
      if (tokenResponse.status === 404) {
        return res.status(404).json({ error: 'Installation not found', code: 'installation_not_found', service: 'oauth-server' });
      }
      if (tokenResponse.status === 401) {
        return res.status(502).json({ error: 'GitHub App authentication failed', code: 'github_app_auth_failed', service: 'oauth-server' });
      }
      if (tokenResponse.status === 403) {
        return res.status(502).json({ error: 'Installation access forbidden', code: 'installation_forbidden', service: 'oauth-server' });
      }
      return res.status(502).json({ error: 'Failed to generate installation token', code: 'token_mint_failed', service: 'oauth-server' });
    }

    const tokenData = await tokenResponse.json();
    logger.info('[GitHubApp] Installation token generated successfully');

    let repositories = [];
    try {
      const reposResponse = await fetch('https://api.github.com/installation/repositories', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${tokenData.token}`,
          'User-Agent': 'Redstring-GitHubApp-Server/1.0'
        }
      });
      if (reposResponse.ok) {
        const repoData = await reposResponse.json();
        if (Array.isArray(repoData?.repositories)) {
          repositories = repoData.repositories;
        }
      } else {
        logger.warn('[GitHubApp] Failed to fetch installation repositories:', reposResponse.status);
      }
    } catch (repoError) {
      logger.warn('[GitHubApp] Installation repositories fetch error:', repoError.message);
    }

    res.json({
      token: tokenData.token,
      expires_at: tokenData.expires_at,
      permissions: tokenData.permissions,
      account: installation.account || null,
      repositories,
      service: 'oauth-server',
      verification: {
        status: 'verified',
        oauthLogin: user.login,
        installationId,
        checkedInstallationId: installationId,
        installationAccount: installation.account?.login || null,
        targetType: installation.target_type,
        appId: installation.app_id,
        checkedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[GitHubApp] Installation token generation failed:', error);
    res.status(500).json({
      error: 'Internal error',
      code: 'internal_error',
      service: 'oauth-server'
    });
  }
});

// List GitHub App installations.
//
// CRITICAL: This MUST use the requesting user's OAuth token, NOT the App's
// JWT. The App JWT lists ALL installations across ALL accounts that have
// installed this App, and returning them leaks other users' install IDs
// (and worse, the client used to auto-bind to installations[0] from this
// list — which could be a complete stranger's install, with that account's
// repo grant). The user's OAuth token, via /user/installations, returns
// only installations that user has access to. Then we filter to installs
// owned by THIS App so we don't show installs of other Apps either.
app.get('/api/github/app/installations', async (req, res) => {
  try {
    // Extract OAuth token from Authorization header. The client passes its
    // own user token here — the server is stateless about user identity.
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^(?:token|Bearer)\s+(.+)$/i);
    const oauthToken = match ? match[1].trim() : null;

    if (!oauthToken) {
      return res.status(401).json({
        error: 'OAuth token required',
        hint: 'Pass "Authorization: token <oauth_token>" header. Listing installs by App JWT is disabled because it leaks installs from other accounts.',
        service: 'oauth-server'
      });
    }

    // Reject obvious wrong token types (App installation tokens start with
    // ghs_, which CAN'T call /user/installations and would 403 anyway).
    if (oauthToken.startsWith('ghs_')) {
      return res.status(400).json({
        error: 'Wrong token type',
        hint: 'Pass an OAuth user-to-server token (gho_/ghp_/github_pat_), not an App installation token (ghs_).',
        service: 'oauth-server'
      });
    }

    logger.debug('[GitHubApp] Listing installations via OAuth identity...');

    const { ids: configuredAppIds, slugs: configuredAppSlugs } = resolveGitHubAppIdentifiers();

    // PRIMARY path: ask GitHub for the installs THIS user has access to,
    // using their OAuth token. This is the cleanest scoping mechanism.
    let installsForFiltering = null;
    let primaryFailure = null;
    const listResult = await listInstallationsViaOAuth(oauthToken);
    if (listResult.ok) {
      installsForFiltering = listResult.installations || [];
    } else {
      primaryFailure = {
        status: listResult.status,
        reason: listResult.reason,
        details: listResult.details
      };
      logger.warn('[GitHubApp] /user/installations failed, will try App-JWT fallback scoped to OAuth user:', primaryFailure);
    }

    // FALLBACK path: /user/installations can 403 when (a) the OAuth App
    // requires SAML SSO authorization for the user's org, (b) the OAuth
    // App's permissions are tightened on GitHub's side, or (c) GitHub
    // changed scope requirements. In those cases, identify the user via
    // /user (which works with any valid token), then enumerate this App's
    // installs via App JWT and filter to the ones whose account matches
    // the OAuth user. This preserves the privacy guarantee (no foreign
    // installs leak) while routing around an account-level gate.
    if (!installsForFiltering) {
      // Step 1: verify who this OAuth token belongs to.
      let oauthLogin = null;
      let oauthUserId = null;
      try {
        const userResp = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `token ${oauthToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Redstring-OAuth-Server/1.0'
          }
        });
        if (userResp.ok) {
          const userJson = await userResp.json().catch(() => null);
          oauthLogin = userJson?.login || null;
          oauthUserId = isPositiveSafeInt(userJson?.id) ? userJson.id : null;
        }
      } catch (e) {
        logger.warn('[GitHubApp] OAuth /user lookup failed during fallback:', e?.message || e);
      }

      if (!oauthLogin || !oauthUserId) {
        // Can't identify caller at all → can't safely scope.
        logger.warn('[GitHubApp] Installation listing: caller identity unknown', primaryFailure);
        const status = primaryFailure?.status === 401 ? 401 : primaryFailure?.status === 403 ? 403 : 502;
        return res.status(status).json({
          error: 'Failed to list installations for OAuth user',
          code: status === 401 ? 'oauth_invalid' : 'identity_unknown',
          service: 'oauth-server'
        });
      }

      // Step 2: pick a configured App slot and enumerate ITS installs.
      // Walk every configured slot — an install for THIS App could be on
      // either the prod or dev App ID, and we'd rather merge than gamble.
      const slotsToTry = [
        { appId: process.env.GITHUB_APP_ID, privateKey: process.env.GITHUB_APP_PRIVATE_KEY, name: 'prod' },
        { appId: process.env.GITHUB_APP_ID_DEV, privateKey: process.env.GITHUB_APP_PRIVATE_KEY_DEV, name: 'dev' }
      ].filter((s) => s.appId && s.privateKey);

      const allAppInstalls = [];
      for (const slot of slotsToTry) {
        try {
          const payload = {
            iat: Math.floor(Date.now() / 1000) - 60,
            exp: Math.floor(Date.now() / 1000) + (10 * 60),
            iss: parseInt(slot.appId, 10)
          };
          const slotJWT = jwt.sign(payload, slot.privateKey, { algorithm: 'RS256' });
          const slotResp = await fetch('https://api.github.com/app/installations?per_page=100', {
            headers: {
              'Accept': 'application/vnd.github.v3+json',
              'Authorization': `Bearer ${slotJWT}`,
              'User-Agent': 'Redstring-OAuth-Server/1.0'
            }
          });
          if (slotResp.ok) {
            const slotInstalls = await slotResp.json().catch(() => []);
            if (Array.isArray(slotInstalls)) allAppInstalls.push(...slotInstalls);
          } else {
            logger.warn(`[GitHubApp] Fallback enumeration via App JWT (${slot.name}) failed:`, slotResp.status);
          }
        } catch (e) {
          logger.warn(`[GitHubApp] Fallback JWT mint for slot ${slot.name} failed:`, e?.message || e);
        }
      }

      // Step 3: KEEP ONLY personal installs whose account id is the OAuth
      // user's id. This is the privacy guarantee that replaces
      // /user/installations' built-in scoping. (Ids, not logins: logins can
      // be renamed and later re-registered by someone else.)
      installsForFiltering = allAppInstalls.filter((inst) =>
        inst?.target_type === 'User' && inst?.account?.id === oauthUserId && !inst?.suspended_at);

      logger.info('[GitHubApp] Fallback enumeration succeeded:', {
        oauthLogin,
        totalAppInstalls: allAppInstalls.length,
        matchingAccount: installsForFiltering.length
      });
    }

    // Filter to installations of THIS deployment's configured App(s).
    // Even in the primary path this is needed because the user might have
    // installed multiple GitHub Apps; only this deployment's configured
    // Apps are mintable.
    const ourInstalls = installsForFiltering.filter((inst) => {
      const appId = Number(inst?.app_id);
      const slug = inst?.app_slug || '';
      const idMatch = !Number.isNaN(appId) && configuredAppIds.includes(appId);
      const slugMatch = slug && configuredAppSlugs.includes(slug);
      return idMatch || slugMatch;
    });

    logger.info('[GitHubApp] Found installations:', {
      total: installsForFiltering.length,
      forThisApp: ourInstalls.length,
      usedFallback: !!primaryFailure
    });

    // Most recent first, just like the old behavior.
    const sortedInstallations = ourInstalls.sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );

    res.json(sortedInstallations);

  } catch (error) {
    console.error('[GitHubApp] List installations failed:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

// Mint an installation token for an already-verified installation (helper for
// the two routes below). Returns the token string, or sends the error.
async function mintVerifiedInstallationToken(res, installationId, appJWT) {
  const tokenResponse = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${appJWT}`,
      'User-Agent': 'Redstring-GitHubApp-Server/1.0'
    }
  });
  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text().catch(() => '');
    logger.error('[GitHubApp] Installation token request failed:', {
      status: tokenResponse.status,
      installationId,
      errorText: errorText.slice(0, 300)
    });
    const status = tokenResponse.status === 404 ? 404 : 502;
    res.status(status).json({
      error: status === 404 ? 'Installation not found' : 'Failed to generate installation token',
      code: status === 404 ? 'installation_not_found' : 'token_mint_failed',
      service: 'oauth-server'
    });
    return null;
  }
  const tokenData = await tokenResponse.json();
  return tokenData?.token || null;
}

// Get installation data (S-02: ownership-gated; previously unauthenticated).
app.get('/api/github/app/installation/:installation_id', async (req, res) => {
  try {
    const gate = await requireInstallOwnership(req, res, req.params.installation_id);
    if (!gate) return;
    const { installationId, installation, appJWT } = gate;

    // The repositories endpoint requires an installation token, not the App JWT.
    const installationToken = await mintVerifiedInstallationToken(res, installationId, appJWT);
    if (!installationToken) {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to generate installation token', code: 'token_mint_failed', service: 'oauth-server' });
      }
      return;
    }

    let repositories = [];
    const reposResponse = await fetch('https://api.github.com/installation/repositories', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${installationToken}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });
    if (reposResponse.ok) {
      const reposData = await reposResponse.json();
      repositories = reposData.repositories || [];
    } else {
      logger.warn('[GitHubApp] Repositories request failed:', { status: reposResponse.status, installationId });
    }

    res.json({
      installation,
      repositories,
      account: installation.account,
      permissions: installation.permissions,
      service: 'oauth-server'
    });

  } catch (error) {
    console.error('[GitHubApp] Installation data request failed:', error);
    res.status(500).json({
      error: 'Internal error',
      code: 'internal_error',
      service: 'oauth-server'
    });
  }
});

// Create repository via GitHub App installation (S-02: ownership-gated;
// previously unauthenticated).
app.post('/api/github/app/create-repository', async (req, res) => {
  try {
    const { installation_id, name, private: isPrivate, description, auto_init } = req.body || {};

    if (installation_id == null || installation_id === '' || !name || typeof name !== 'string') {
      return res.status(400).json({
        error: 'Installation ID and repository name are required',
        code: 'missing_fields',
        service: 'oauth-server'
      });
    }

    const gate = await requireInstallOwnership(req, res, installation_id);
    if (!gate) return;
    const { installationId, appJWT } = gate;

    logger.debug('[GitHubApp] Creating repository via installation:', { installationId, name, isPrivate });

    const installationToken = await mintVerifiedInstallationToken(res, installationId, appJWT);
    if (!installationToken) {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to generate installation token', code: 'token_mint_failed', service: 'oauth-server' });
      }
      return;
    }

    const createRepoResponse = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${installationToken}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        private: !!isPrivate,
        description: description || 'Redstring knowledge graph repository',
        auto_init: !!auto_init
      })
    });

    if (!createRepoResponse.ok) {
      const errorText = await createRepoResponse.text().catch(() => '');
      console.error('[GitHubApp] Repository creation failed:', {
        status: createRepoResponse.status,
        errorText: errorText.slice(0, 300)
      });

      if (createRepoResponse.status === 403) {
        return res.status(403).json({
          error: 'Repository creation forbidden',
          code: 'repository_creation_forbidden',
          details: 'GitHub App installation does not have permission to create repositories. Please check the app permissions or create the repository manually.',
          service: 'oauth-server'
        });
      }

      const status = createRepoResponse.status >= 400 && createRepoResponse.status < 500 ? createRepoResponse.status : 502;
      return res.status(status).json({
        error: `Repository creation failed: ${createRepoResponse.status}`,
        code: 'repository_creation_failed',
        service: 'oauth-server'
      });
    }

    const newRepo = await createRepoResponse.json();

    logger.info('[GitHubApp] Repository created successfully:', {
      name: newRepo.full_name,
      private: newRepo.private,
      installationId
    });

    res.json({
      id: newRepo.id,
      name: newRepo.name,
      full_name: newRepo.full_name,
      description: newRepo.description,
      private: newRepo.private,
      html_url: newRepo.html_url,
      clone_url: newRepo.clone_url,
      default_branch: newRepo.default_branch,
      created_at: newRepo.created_at,
      service: 'oauth-server'
    });

  } catch (error) {
    console.error('[GitHubApp] Repository creation error:', error);
    res.status(500).json({
      error: 'Internal error',
      code: 'internal_error',
      service: 'oauth-server'
    });
  }
});

// Provide GitHub App slug/name for installation URL, selecting dev when local
app.get('/api/github/app/client-id', (req, res) => {
  try {
    const useDev = isLocalRequest(req);
    const prodSlug = process.env.GITHUB_APP_SLUG || 'redstring-semantic-sync';
    const devSlug = process.env.GITHUB_APP_SLUG_DEV || process.env.GITHUB_APP_SLUG || 'redstring-semantic-sync-dev';
    const appName = useDev ? devSlug : prodSlug;

    res.json({
      appName,
      selection: useDev ? 'dev' : 'prod',
      prodSlug,
      devSlug,
      service: 'oauth-server'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to determine app name', details: error.message, service: 'oauth-server' });
  }
});

// GitHub App webhook handler.
// Defense in depth: even though the edge (app-semantic-server) verifies the
// signature when GITHUB_WEBHOOK_SECRET is set, re-verify here in case this
// service is ever reached directly. Unsigned deliveries are never accepted:
// with no secret configured every delivery is refused (503).
const webhookSecret = () => process.env.GITHUB_WEBHOOK_SECRET || '';
function verifyGithubSignature(rawBody, header) {
  const secret = webhookSecret();
  if (!secret || !header || !rawBody) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.post('/api/github/app/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const signature = req.headers['x-hub-signature-256'];
  const payload = req.body || {};

  if (!webhookSecret()) {
    logger.warn('[GitHubApp] GITHUB_WEBHOOK_SECRET not set — refusing webhook delivery', { event });
    return res.status(503).json({ error: 'Webhook not configured', code: 'webhook_not_configured' });
  }
  if (!verifyGithubSignature(req.rawBody, signature)) {
    logger.warn('[GitHubApp] Invalid webhook signature, rejecting', { event });
    return res.status(401).json({ error: 'Invalid signature', code: 'invalid_signature' });
  }

  logger.debug('[GitHubApp] Webhook received:', {
    event,
    action: payload.action,
    installationId: payload.installation?.id
  });

  switch (event) {
    case 'installation':
      if (payload.action === 'created') {
        logger.info('[GitHubApp] New installation:', {
          installationId: payload.installation.id,
          account: payload.installation.account.login,
          repositories: payload.repositories?.length || 0
        });
      } else if (payload.action === 'deleted') {
        logger.info('[GitHubApp] Installation removed:', payload.installation.id);
      }
      break;

    case 'installation_repositories':
      logger.info('[GitHubApp] Repository access changed:', {
        installationId: payload.installation.id,
        added: payload.repositories_added?.length || 0,
        removed: payload.repositories_removed?.length || 0
        });
      break;

    default:
      logger.debug('[GitHubApp] Unhandled webhook event:', event);
  }

  res.status(200).json({ received: true });
});

// Start server — only when run directly (`node oauth-server.js`), so tests can
// import the app without binding a port.
//
// S-52: binds to loopback by default. The server is normally reached through
// an in-container proxy (app-semantic-server → http://localhost:3002) or by a
// local Vite dev server; a deployment that must accept outside connections (a
// standalone Cloud Run service) opts in with OAUTH_BIND_HOST=0.0.0.0.
// (Not OAUTH_HOST: app-semantic-server already uses that name for the REMOTE
// oauth host it proxies to, and both processes share one environment.)
const BIND_HOST = process.env.OAUTH_BIND_HOST || '127.0.0.1';
const HOST = BIND_HOST;

const isMainModule = (() => {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(pathResolve(process.argv[1]));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  // `localhost` can resolve to ::1 first; when bound to the IPv4 loopback by
  // default, also listen on the IPv6 loopback (best effort) so clients that
  // dial http://localhost:3002 connect either way.
  if (HOST === '127.0.0.1') {
    const v6 = app.listen(PORT, '::1');
    v6.on('error', () => { /* no IPv6 loopback here — IPv4 is enough */ });
  }
  app.listen(PORT, HOST, () => {
    logger.info(`🔐 OAuth Server running on ${HOST}:${PORT}`);
    logger.info(`📋 Health check: http://localhost:${PORT}/health`);

    // STATELESS MODE INFO
    if (ENABLE_SERVER_PERSISTENCE) {
      logger.warn('⚠️  Server persistence ENABLED - user tokens stored on server');
      logger.warn('⚠️  This is NOT recommended for production (ephemeral filesystem on Cloud Run)');
    } else {
      logger.info('✅ STATELESS MODE - User data stays in browser localStorage');
      logger.info('✅ Server only facilitates OAuth exchange, does NOT persist tokens');
      logger.info('✅ Perfect for Cloud Run ephemeral containers!');
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (clientId && clientSecret) {
      logger.info('✅ GitHub OAuth configured');
      logger.debug(`📋 Client ID length: ${clientId.length}`);
      logger.debug(`📋 Client Secret length: ${clientSecret.length}`);
    } else {
      logger.warn('⚠️  GitHub OAuth not configured - set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET');
    }

    if (appId && privateKey) {
      logger.info('✅ GitHub App configured');
      logger.debug(`📋 App ID: ${appId}`);
      logger.debug(`📋 Private Key length: ${privateKey.length}`);
      if (process.env.PRIVATE_KEY_PATH) {
        logger.info(`  Key loaded from file: ${process.env.PRIVATE_KEY_PATH}`);
      }
    } else {
      logger.warn('⚠️  GitHub App not configured - set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY');
      logger.warn('🔍 Check Secret Manager permissions for Cloud Run service account');
    }

    if (existsSync('github.env.local')) {
      logger.info('  Loaded supplementary env from github.env.local');
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('🔐 OAuth Server shutting down...');
    process.exit(0);
  });
}

export { app, verifyInstallOwnership, parseInstallationId };
