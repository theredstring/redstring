/**
 * Dedicated OAuth Server
 * Handles GitHub OAuth flow with clean separation from AI bridge
 * Neuroplastic architecture - each server has one clear purpose
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import tokenVault from './src/services/server/tokenVault.js';

// Load environment variables
dotenv.config();

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

// CORS for frontend communication
app.use(cors({ origin: true }));
app.use(express.json());

// Enhanced health check with detailed configuration status
app.get('/health', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  
  res.json({ 
    status: 'healthy', 
    service: 'oauth-server',
    port: PORT,
    configured: !!(clientId && clientSecret),
    clientIdConfigured: !!clientId,
    clientSecretConfigured: !!clientSecret,
    clientIdLength: clientId ? clientId.length : 0,
    clientSecretLength: clientSecret ? clientSecret.length : 0,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Helper to detect if request comes from dev/test environment
function isLocalRequest(req) {
  try {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().toLowerCase();
    // Treat localhost AND redstring-test deployment as dev/test
    return host.includes('localhost') || 
           host.includes('127.0.0.1') ||
           host.includes('redstring-test');
  } catch { return false; }
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

// Refresh OAuth access token
app.post('/api/github/oauth/refresh', async (req, res) => {
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
app.post('/api/github/oauth/validate', async (req, res) => {
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
app.delete('/api/github/oauth/revoke', async (req, res) => {
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
app.post('/api/github/oauth/token', async (req, res) => {
  try {
    const { code, state, redirect_uri } = req.body;
    
    logger.debug('[OAuth] Token exchange request:', {
      hasCode: !!code,
      hasState: !!state,
      hasRedirectUri: !!redirect_uri,
      redirect_uri: redirect_uri,
      redirect_uri_exact: JSON.stringify(redirect_uri),
      codeLength: code ? code.length : 0,
      stateLength: state ? state.length : 0
    });
    
    if (!code || !state) {
      return res.status(400).json({ 
        error: 'Missing code or state',
        service: 'oauth-server',
        received: { hasCode: !!code, hasState: !!state }
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
        hint: 'Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables',
        service: 'oauth-server',
        details: {
          clientIdConfigured: !!clientId,
          clientSecretConfigured: !!clientSecret,
          clientIdLength: clientId ? clientId.length : 0,
          clientSecretLength: clientSecret ? clientSecret.length : 0
        }
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
        error: 'Invalid OAuth credentials format',
        service: 'oauth-server',
        details: {
          clientIdValid,
          clientSecretValid,
          clientIdLength: clientId.length,
          clientSecretLength: clientSecret.length
        }
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
    
    logger.debug('[OAuth] Sending to GitHub:', JSON.stringify(requestPayload, null, 2));
    
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
    const credentials = tokenVault.getOAuthCredentials();
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
    const credentials = tokenVault.getGitHubAppInstallation();
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

// Generate installation access token (server-side only for security)
app.post('/api/github/app/installation-token', async (req, res) => {
  try {
    const { installation_id } = req.body;
    
    if (!installation_id) {
      return res.status(400).json({
        error: 'Installation ID is required',
        service: 'oauth-server'
      });
    }

    const useDev = isLocalRequest(req);
    const appId = useDev
      ? (process.env.GITHUB_APP_ID_DEV || process.env.GITHUB_APP_ID)
      : process.env.GITHUB_APP_ID;
    const privateKey = useDev
      ? (process.env.GITHUB_APP_PRIVATE_KEY_DEV || process.env.GITHUB_APP_PRIVATE_KEY)
      : process.env.GITHUB_APP_PRIVATE_KEY;

    logger.info('[GitHubApp] Installation token request:', {
      installation_id,
      useDev,
      appId: appId ? `${appId.substring(0, 4)}...` : 'MISSING',
      hasPrivateKey: !!privateKey,
      host: req.headers.host,
      forwardedHost: req.headers['x-forwarded-host']
    });

    if (!appId || !privateKey) {
      return res.status(500).json({
        error: 'GitHub App not configured',
        hint: 'Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables',
        service: 'oauth-server'
      });
    }

    const oauthCredentials = tokenVault.getOAuthCredentials();
    const verificationResult = await verifyInstallationWithOAuth(installation_id, oauthCredentials);
    let verificationRecord = createVerificationRecord(verificationResult, oauthCredentials);
    const verificationSummary = formatVerificationForResponse(verificationRecord);

    logger.debug('[GitHubApp] Installation verification result:', {
      installation_id,
      status: verificationResult.status,
      reason: verificationResult.reason || null,
      oauthLogin: verificationSummary?.oauthLogin || null
    });

    if (verificationResult.status === 'missing_installation') {
      return res.status(400).json({
        error: 'Invalid installation ID',
        code: 'missing_installation',
        verification: verificationSummary,
        service: 'oauth-server'
      });
    }

    if (verificationResult.status === 'account_mismatch' || verificationResult.status === 'not_found') {
      return res.status(403).json({
        error: 'GitHub App installation not accessible for the connected OAuth account',
        code: verificationResult.status,
        verification: verificationSummary,
        service: 'oauth-server'
      });
    }

    if (verificationResult.status === 'oauth_invalid') {
      return res.status(401).json({
        error: 'GitHub OAuth token is invalid or expired. Please reconnect OAuth and retry.',
        code: 'oauth_invalid',
        verification: verificationSummary,
        service: 'oauth-server'
      });
    }

    if (verificationResult.status === 'error') {
      return res.status(502).json({
        error: 'Failed to verify GitHub App installation via OAuth',
        code: 'verification_failed',
        verification: verificationSummary,
        details: verificationResult.details || null,
        service: 'oauth-server'
      });
    }

    logger.debug('[GitHubApp] Generating installation token for installation:', installation_id);

    // Generate JWT for app authentication
    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + (10 * 60),
      iss: parseInt(appId, 10)
    };

    const appJWT = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

    // Get installation access token
    const tokenResponse = await fetch(`https://api.github.com/app/installations/${installation_id}/access_tokens`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${appJWT}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('[GitHubApp] Installation token request failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        installation_id,
        appId: appId ? `${appId.substring(0, 4)}...` : 'MISSING',
        useDev,
        errorText
      });

      // IMPROVED ERROR HANDLING: Provide specific error responses for common failures
      let errorResponse = {
        error: 'Failed to generate installation token',
        status: tokenResponse.status,
        details: errorText,
        service: 'oauth-server'
      };

      if (tokenResponse.status === 401) {
        errorResponse.error = 'GitHub App authentication failed';
        errorResponse.hint = 'The GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY may be incorrect. Please verify environment variables.';
      } else if (tokenResponse.status === 404) {
        errorResponse.error = 'Installation not found';
        errorResponse.hint = `Installation ID ${installation_id} does not exist or the GitHub App does not have access to it.`;
      } else if (tokenResponse.status === 403) {
        errorResponse.error = 'Installation access forbidden';
        errorResponse.hint = 'The GitHub App may have been suspended or uninstalled.';
      }

      return res.status(tokenResponse.status === 404 ? 404 : 502).json(errorResponse);
    }

    const tokenData = await tokenResponse.json();
    logger.info('[GitHubApp] Installation token generated successfully');

    let account = null;
    try {
      const installationInfoResponse = await fetch(`https://api.github.com/app/installations/${installation_id}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${appJWT}`,
          'User-Agent': 'Redstring-GitHubApp-Server/1.0'
        }
      });
      if (installationInfoResponse.ok) {
        const installationInfo = await installationInfoResponse.json();
        account = installationInfo?.account || null;
      } else {
        const text = await installationInfoResponse.text().catch(() => '');
        logger.warn('[GitHubApp] Failed to fetch installation info:', installationInfoResponse.status, text);
      }
    } catch (infoError) {
      logger.warn('[GitHubApp] Installation info fetch error:', infoError.message);
    }

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
        const text = await reposResponse.text().catch(() => '');
        logger.warn('[GitHubApp] Failed to fetch installation repositories:', reposResponse.status, text);
      }
    } catch (repoError) {
      logger.warn('[GitHubApp] Installation repositories fetch error:', repoError.message);
    }

    const tokenExpiresAtTs = tokenData.expires_at
      ? new Date(tokenData.expires_at).getTime()
      : null;

    if (verificationRecord) {
      const numericInstallationId = Number(installation_id);
      verificationRecord = {
        ...verificationRecord,
        installationAccount: account?.login || verificationRecord.installationAccount || null,
        installationId: verificationRecord.installationId ?? (Number.isFinite(numericInstallationId) ? numericInstallationId : null),
        checkedAt: Date.now()
      };
    }

    let storedInstallation = null;
    try {
      storedInstallation = tokenVault.setGitHubAppInstallation({
        installationId: installation_id,
        accessToken: tokenData.token,
        tokenExpiresAt: tokenExpiresAtTs,
        repositories,
        account,
        permissions: tokenData.permissions || null,
        verification: verificationRecord || null
      });
    } catch (vaultError) {
      logger.warn('[GitHubApp] Failed to persist GitHub App credentials:', vaultError.message);
      storedInstallation = {
        installationId: installation_id,
        accessToken: tokenData.token,
        tokenExpiresAt: tokenExpiresAtTs,
        repositories,
        account,
        permissions: tokenData.permissions || null,
        verification: verificationRecord || null
      };
    }

    const verificationForResponse = formatVerificationForResponse(
      storedInstallation?.verification || verificationRecord || null
    );

    const responsePayload = {
      token: tokenData.token,
      expires_at: tokenData.expires_at,
      permissions: tokenData.permissions,
      account,
      repositories,
      service: 'oauth-server'
    };

    if (verificationForResponse) {
      responsePayload.verification = verificationForResponse;
    }

    res.json(responsePayload);

  } catch (error) {
    console.error('[GitHubApp] Installation token generation failed:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

// List GitHub App installations (for fallback when callback params are missing)
app.get('/api/github/app/installations', async (req, res) => {
  try {
    const useDevList = isLocalRequest(req);
    const appId = useDevList
      ? (process.env.GITHUB_APP_ID_DEV || process.env.GITHUB_APP_ID)
      : process.env.GITHUB_APP_ID;
    const privateKey = useDevList
      ? (process.env.GITHUB_APP_PRIVATE_KEY_DEV || process.env.GITHUB_APP_PRIVATE_KEY)
      : process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      return res.status(500).json({
        error: 'GitHub App not configured',
        service: 'oauth-server'
      });
    }

    logger.debug('[GitHubApp] Listing installations...');

    // Generate JWT for app authentication
    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + (10 * 60),
      iss: parseInt(appId, 10)
    };

    const appJWT = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

    // Get all installations for this app
    const installationsResponse = await fetch('https://api.github.com/app/installations', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${appJWT}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });

    if (!installationsResponse.ok) {
      const errorText = await installationsResponse.text();
      console.error('[GitHubApp] List installations failed:', {
        status: installationsResponse.status,
        statusText: installationsResponse.statusText,
        errorText
      });
      throw new Error(`GitHub API error: ${installationsResponse.status} ${errorText}`);
    }

    const installations = await installationsResponse.json();
    logger.info('[GitHubApp] Found installations:', installations.length);

    // Return installations sorted by most recent
    const sortedInstallations = installations.sort((a, b) => 
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

// Get installation data
app.get('/api/github/app/installation/:installation_id', async (req, res) => {
  try {
    const { installation_id } = req.params;
    
    const useDevGet = isLocalRequest(req);
    const appId = useDevGet
      ? (process.env.GITHUB_APP_ID_DEV || process.env.GITHUB_APP_ID)
      : process.env.GITHUB_APP_ID;
    const privateKey = useDevGet
      ? (process.env.GITHUB_APP_PRIVATE_KEY_DEV || process.env.GITHUB_APP_PRIVATE_KEY)
      : process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      return res.status(500).json({
        error: 'GitHub App not configured',
        service: 'oauth-server'
      });
    }

    // Generate JWT for app authentication
    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + (10 * 60),
      iss: parseInt(appId, 10)
    };

    const appJWT = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

    // Get installation data
    const installationResponse = await fetch(`https://api.github.com/app/installations/${installation_id}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${appJWT}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });

    if (!installationResponse.ok) {
      throw new Error(`GitHub API error: ${installationResponse.status}`);
    }

    const installationData = await installationResponse.json();

    // First get installation access token (repositories endpoint requires installation token, not app JWT)
    const tokenResponse = await fetch(`https://api.github.com/app/installations/${installation_id}/access_tokens`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${appJWT}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('[GitHubApp] Installation token request failed:', {
        status: tokenResponse.status,
        error: errorText,
        installation_id
      });
      throw new Error(`Failed to get installation token: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const installationToken = tokenData.token;

    // Now use installation token to get repositories (this is the correct way)
    const reposUrl = `https://api.github.com/installation/repositories`;
    logger.debug('[GitHubApp] Attempting to fetch repositories with installation token:', {
      url: reposUrl,
      installation_id,
      hasInstallationToken: !!installationToken
    });
    
    const reposResponse = await fetch(reposUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${installationToken}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });

    let repositories = [];
    if (reposResponse.ok) {
      const reposData = await reposResponse.json();
      
      // DEBUG: Log the actual response structure to understand the issue
      logger.debug('[GitHubApp] Repositories API response structure:', {
        keys: Object.keys(reposData),
        total_count: reposData.total_count,
        repositories_length: reposData.repositories?.length,
        full_response: JSON.stringify(reposData, null, 2)
      });
      
      // GitHub API returns { total_count: N, repositories: [...] }
      repositories = reposData.repositories || [];
      
      // Additional logging for debugging
      if (repositories.length === 0) {
        logger.warn('[GitHubApp] No repositories found for installation:', installation_id);
        logger.warn('[GitHubApp] Response total_count:', reposData.total_count);
        logger.warn('[GitHubApp] This may indicate: 1) No repos selected during installation, 2) App lacks repository permissions, 3) All repos were deselected');
      }
    } else {
      const errorText = await reposResponse.text();
      logger.error('[GitHubApp] Repositories request failed:', {
        status: reposResponse.status,
        error: errorText,
        installation_id
      });
    }

    res.json({
      installation: installationData,
      repositories,
      account: installationData.account,
      permissions: installationData.permissions,
      service: 'oauth-server'
    });

  } catch (error) {
    console.error('[GitHubApp] Installation data request failed:', error);
    res.status(500).json({
      error: error.message,
      service: 'oauth-server'
    });
  }
});

// Create repository via GitHub App installation
app.post('/api/github/app/create-repository', async (req, res) => {
  try {
    const { installation_id, name, private: isPrivate, description, auto_init } = req.body;
    
    if (!installation_id || !name) {
      return res.status(400).json({
        error: 'Installation ID and repository name are required',
        service: 'oauth-server'
      });
    }

    const useDevCreate = isLocalRequest(req);
    const appId = useDevCreate
      ? (process.env.GITHUB_APP_ID_DEV || process.env.GITHUB_APP_ID)
      : process.env.GITHUB_APP_ID;
    const privateKey = useDevCreate
      ? (process.env.GITHUB_APP_PRIVATE_KEY_DEV || process.env.GITHUB_APP_PRIVATE_KEY)
      : process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      return res.status(500).json({
        error: 'GitHub App not configured',
        hint: 'Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables',
        service: 'oauth-server'
      });
    }

    logger.debug('[GitHubApp] Creating repository via installation:', { installation_id, name, isPrivate });

    // Generate JWT for app authentication
    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + (10 * 60),
      iss: parseInt(appId, 10)
    };

    const appJWT = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

    // Get installation access token first
    const tokenResponse = await fetch(`https://api.github.com/app/installations/${installation_id}/access_tokens`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${appJWT}`,
        'User-Agent': 'Redstring-GitHubApp-Server/1.0'
      }
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[GitHubApp] Installation token failed:', errorText);
      return res.status(tokenResponse.status).json({
        error: `Failed to get installation token: ${errorText}`,
        service: 'oauth-server'
      });
    }

    const tokenData = await tokenResponse.json();
    const installationToken = tokenData.token;

    // Create repository using the installation token
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
      const errorText = await createRepoResponse.text();
      console.error('[GitHubApp] Repository creation failed:', {
        status: createRepoResponse.status,
        statusText: createRepoResponse.statusText,
        errorText
      });
      
      // Return detailed error for 403 Forbidden
      if (createRepoResponse.status === 403) {
        return res.status(403).json({
          error: 'Repository creation forbidden',
          details: 'GitHub App installation does not have permission to create repositories. Please check the app permissions or create the repository manually.',
          github_error: errorText,
          service: 'oauth-server'
        });
      }
      
      return res.status(createRepoResponse.status).json({
        error: `Repository creation failed: ${createRepoResponse.status}`,
        details: errorText,
        service: 'oauth-server'
      });
    }

    const newRepo = await createRepoResponse.json();
    
    logger.info('[GitHubApp] Repository created successfully:', {
      name: newRepo.full_name,
      private: newRepo.private,
      installation_id
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
      error: error.message,
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

// GitHub App webhook handler
app.post('/api/github/app/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const signature = req.headers['x-hub-signature-256'];
  const payload = req.body;

  logger.debug('[GitHubApp] Webhook received:', {
    event,
    action: payload.action,
    installationId: payload.installation?.id
  });

  // TODO: Verify webhook signature for security
  // const isValid = verifyWebhookSignature(signature, JSON.stringify(payload));
  // if (!isValid) {
  //   return res.status(401).json({ error: 'Invalid signature' });
  // }

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

// Start server
app.listen(PORT, () => {
  logger.info(`🔐 OAuth Server running on port ${PORT}`);
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
  } else {
    logger.warn('⚠️  GitHub App not configured - set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY');
    logger.warn('🔍 Check Secret Manager permissions for Cloud Run service account');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('🔐 OAuth Server shutting down...');
  process.exit(0);
});
