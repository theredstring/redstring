/**
 * GitHub connect/disconnect flows, shared between the Universes panel
 * (UniverseManager) and the onboarding GitHub wizard (StorageSetupModal).
 *
 * Platform split:
 * - Web: OAuth is a full-page redirect through the oauth-server; the App is
 *   discovered via the server's /api/github/app/installations (scoped to the
 *   user's OAuth token) — we ALWAYS try discovery before sending the user to
 *   the install page, so an existing install is never re-prompted.
 * - Electron: no oauth-server. GitHub Device Flow for both OAuth and the App
 *   (caller supplies `runDeviceFlow` from useGitHubDeviceFlow), with direct
 *   api.github.com installation lookup.
 */
import { isElectron } from '../utils/fileAccessAdapter.js';
import { persistentAuth } from './persistentAuth.js';
import { oauthFetch } from './bridgeConfig.js';
import universeManagerService from './universeManagerService.js';
import universeBackend from './universeBackend.js';
import {
  openVerificationUrl,
  getOAuthClientId,
  getAppClientId,
  getAppSlug
} from './githubDeviceFlow.js';

const { log: __nativeLog, warn: __nativeWarn } = console;
const gaLog = (...args) => __nativeLog.call(console, '[GitHubAuthFlows]', ...args);
const gaWarn = (...args) => __nativeWarn.call(console, '[GitHubAuthFlows]', ...args);

// `repo` covers private repo file IO. `read:org` is required by
// /user/installations so we can list GitHub App installs across orgs.
export const GITHUB_OAUTH_SCOPES = 'repo read:org';

/**
 * Query api.github.com/user/installations with a user-to-server token and
 * pick the best matching install. Returns null if the App hasn't been
 * installed on any account this user has access to.
 */
export async function findAppInstallationDirect(userToServerToken) {
  const appSlug = getAppSlug();
  const resp = await fetch('https://api.github.com/user/installations', {
    headers: {
      Authorization: `Bearer ${userToServerToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`/user/installations failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const installations = Array.isArray(data?.installations) ? data.installations : [];

  // The user-to-server token already scopes to this App, but on shared
  // /user/installations responses we double-check by slug. App slugs are
  // case-insensitive on GitHub's side.
  const slugLc = String(appSlug || '').toLowerCase();
  const filtered = slugLc
    ? installations.filter((inst) => {
        const candidate = String(inst?.app_slug || inst?.app?.slug || '').toLowerCase();
        return !candidate || candidate === slugLc;
      })
    : installations;

  if (filtered.length === 0) return null;

  // Prefer install on the OAuth user's personal account; otherwise newest.
  const oauthLogin = (
    persistentAuth.oauthCache?.user?.login
    || persistentAuth.oauthCache?.user?.username
    || null
  );
  let chosen = null;
  if (oauthLogin) {
    const lc = String(oauthLogin).toLowerCase();
    chosen = filtered.find((inst) => String(inst?.account?.login || '').toLowerCase() === lc) || null;
  }
  if (!chosen) {
    chosen = filtered.slice().sort((a, b) => {
      const at = new Date(a?.created_at || 0).getTime();
      const bt = new Date(b?.created_at || 0).getTime();
      return bt - at;
    })[0] || filtered[0] || null;
  }
  return chosen;
}

/**
 * Start the OAuth connection. Web: arms sessionStorage state and performs a
 * full-page redirect — the returned promise never resolves in that case.
 * Electron: runs the device flow and stores tokens.
 * Returns { connected: true } (Electron success) or { redirecting: true }.
 */
export async function connectOAuth({ runDeviceFlow } = {}) {
  try {
    sessionStorage.removeItem('github_oauth_pending');
    sessionStorage.removeItem('github_oauth_state');
    sessionStorage.removeItem('github_oauth_result');
  } catch {
    // ignore
  }

  if (isElectron()) {
    // Electron: no oauth-server, no redstring.io. Use GitHub Device Flow
    // directly against github.com with the embedded OAuth App client_id.
    if (typeof runDeviceFlow !== 'function') {
      throw new Error('Device flow runner required for Electron OAuth');
    }
    const clientId = getOAuthClientId();
    if (!clientId) {
      throw new Error('Missing VITE_GITHUB_CLIENT_ID. Set it at build time before packaging Electron.');
    }
    gaLog('Starting GitHub OAuth device flow');
    const tokenData = await runDeviceFlow({
      clientId,
      scope: GITHUB_OAUTH_SCOPES,
      title: 'Connect to GitHub',
      subtitle: 'Authorize the Redstring OAuth App.'
    });

    if (!tokenData?.access_token) {
      throw new Error('GitHub returned no access_token');
    }

    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });
    if (!userResp.ok) {
      throw new Error(`Failed to fetch GitHub user (${userResp.status})`);
    }
    const userData = await userResp.json();
    await persistentAuth.storeTokens(tokenData, userData);
    return { connected: true };
  }

  const resp = await oauthFetch('/api/github/oauth/client-id', { bypassCooldown: true });
  if (!resp.ok) throw new Error('Failed to load OAuth configuration');
  const { clientId } = await resp.json();
  if (!clientId) throw new Error('GitHub OAuth client ID not configured');

  const stateValue = Math.random().toString(36).slice(2);
  const redirectUri = universeManagerService.getOAuthRedirectUri();

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(
    GITHUB_OAUTH_SCOPES
  )}&state=${encodeURIComponent(stateValue)}`;

  // Browser: store state and redirect (page unloads — caller gets no resolve)
  sessionStorage.setItem('github_oauth_state', stateValue);
  sessionStorage.setItem('github_oauth_pending', 'true');
  window.location.href = authUrl;
  return { redirecting: true };
}

/**
 * Connect / install the GitHub App — discovery-first on BOTH platforms:
 * if the App is already installed for this user, it is linked without ever
 * showing the install page.
 *
 * Returns one of:
 *   { connected: true, installationId }  — existing install discovered+linked
 *   { managing: true }                   — already linked; opened management page
 *   { installRedirect: true }            — sent the user to the install page
 *   { installPending: true }             — Electron: install page opened externally
 */
export async function connectApp({ runDeviceFlow } = {}) {
  const existingInstallationId = persistentAuth.hasAppInstallation?.()
    ? persistentAuth.githubAppCache?.installationId
    : null;

  if (isElectron()) {
    // Electron path — fully local, no oauth-server.
    if (existingInstallationId) {
      const url = `https://github.com/settings/installations/${existingInstallationId}`;
      gaLog('App already installed, opening management page', url);
      await openVerificationUrl(url);
      return { managing: true };
    }

    // First-time install: device-flow to get a user-to-server token,
    // then check if the App is already on any of the user's accounts.
    // If yes, store it as the install. If no, open the install URL and
    // park the token so Detect can find the install afterward.
    if (typeof runDeviceFlow !== 'function') {
      throw new Error('Device flow runner required for Electron App install');
    }
    const appClientId = getAppClientId();
    if (!appClientId) {
      throw new Error('Missing VITE_GITHUB_APP_CLIENT_ID. Set it at build time before packaging Electron.');
    }
    const appSlug = getAppSlug();

    let token = persistentAuth.getAppUserToServerToken?.() || null;
    if (!token) {
      const tokenData = await runDeviceFlow({
        clientId: appClientId,
        title: 'Authorize Redstring App',
        subtitle: 'Authorize the GitHub App to enable live sync.'
      });
      token = tokenData?.access_token;
      if (!token) throw new Error('GitHub returned no access_token');
    }

    const install = await findAppInstallationDirect(token);
    if (install) {
      await persistentAuth.storeAppInstallation({
        installationId: install.id,
        accessToken: token,
        repositories: [],
        userData: install.account || {}
      });
      persistentAuth.clearAppUserToServerToken?.();
      return { connected: true, installationId: install.id };
    }

    // Not installed yet — park the token and direct the user to install.
    persistentAuth.saveAppUserToServerToken?.(token);
    sessionStorage.setItem('github_app_pending', 'true');
    await openVerificationUrl(`https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`);
    return { installPending: true };
  }

  // Web path — relies on the oauth-server.
  if (existingInstallationId) {
    try {
      const resp = await oauthFetch(`/api/github/app/installation/${existingInstallationId}`, { bypassCooldown: true });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.account?.login) {
          window.location.href = `https://github.com/settings/installations/${existingInstallationId}`;
          return { managing: true };
        }
      }
    } catch (e) {
      gaWarn('Could not fetch installation details:', e);
    }
    window.location.href = 'https://github.com/settings/installations';
    return { managing: true };
  }

  // Discovery FIRST: the user may already have the App installed (from
  // another device or a direct GitHub install). The oauth-server's
  // /api/github/app/installations is the standard source of truth — surface
  // it before ever redirecting to the install page.
  if (persistentAuth.hasValidTokens?.()) {
    try {
      const discovered = await persistentAuth.forceAppDiscovery?.();
      if (discovered && persistentAuth.hasAppInstallation?.()) {
        const installationId = persistentAuth.githubAppCache?.installationId;
        gaLog('Existing App install discovered — no install redirect needed', installationId);
        return { connected: true, installationId };
      }
    } catch (discoveryErr) {
      gaWarn('Pre-install App discovery failed (continuing to install page):', discoveryErr?.message || discoveryErr);
    }
  }

  let appName = 'redstring-semantic-sync';
  try {
    const resp = await oauthFetch('/api/github/app/info', { bypassCooldown: true });
    if (resp.ok) {
      const data = await resp.json();
      appName = data.name || appName;
    }
  } catch {
    // ignore
  }

  sessionStorage.setItem('github_app_pending', 'true');
  const stateValue = Date.now().toString();
  window.location.href = `https://github.com/apps/${appName}/installations/new?state=${stateValue}`;
  return { installRedirect: true };
}

/**
 * Explicit App-install detection (the manual "Detect install" button).
 * Returns { found, installationId? }.
 */
export async function detectAppInstall({ runDeviceFlow } = {}) {
  gaLog('User-triggered App install detection');

  if (isElectron()) {
    // Electron: skip oauth-server entirely. If we already have a stored
    // user-to-server token (from a prior Install click), re-query
    // installations with it. Otherwise kick off the device flow first.
    let token =
      persistentAuth.githubAppCache?.accessToken
      || persistentAuth.getAppUserToServerToken?.()
      || null;
    if (!token) {
      if (typeof runDeviceFlow !== 'function') {
        throw new Error('Device flow runner required for Electron App detection');
      }
      const appClientId = getAppClientId();
      if (!appClientId) {
        throw new Error('Missing VITE_GITHUB_APP_CLIENT_ID. Set it at build time before packaging Electron.');
      }
      const tokenData = await runDeviceFlow({
        clientId: appClientId,
        title: 'Authorize Redstring App',
        subtitle: 'Authorize the GitHub App so Redstring can find your installation.'
      });
      token = tokenData?.access_token;
      if (!token) throw new Error('GitHub returned no access_token');
    }

    const install = await findAppInstallationDirect(token);
    if (install) {
      await persistentAuth.storeAppInstallation({
        installationId: install.id,
        accessToken: token,
        repositories: [],
        userData: install.account || {}
      });
      persistentAuth.clearAppUserToServerToken?.();
      try { sessionStorage.removeItem('github_app_pending'); } catch { /* best effort */ }
      return { found: true, installationId: install.id };
    }

    // Park the token for the next Detect attempt — don't pollute the
    // install slot (which would make hasAppInstallation() return true).
    persistentAuth.saveAppUserToServerToken?.(token);
    return { found: false };
  }

  const ok = await persistentAuth.forceAppDiscovery?.();
  if (ok && persistentAuth.hasAppInstallation?.()) {
    try { sessionStorage.removeItem('github_app_pending'); } catch { /* best effort */ }
    return { found: true, installationId: persistentAuth.githubAppCache?.installationId };
  }
  return { found: false };
}

export async function disconnectOAuth() {
  await persistentAuth.clearTokens();
}

export async function disconnectApp() {
  // Sticky: blocks attemptAppAutoConnect from silently re-discovering
  // and re-installing the same install on the next init. Without this,
  // clearing the App only "works" until the next page load.
  await persistentAuth.clearAppInstallation({ sticky: true });
  // Tear down any sync engines that were using the App provider so the
  // next save attempt creates a fresh provider (OAuth, or nothing).
  try {
    const slugs = Array.from(universeBackend.gitSyncEngines?.keys?.() || []);
    for (const slug of slugs) {
      await universeBackend.removeGitSyncEngine?.(slug);
    }
  } catch (engineErr) {
    gaWarn('App disconnect: engine cleanup failed:', engineErr?.message || engineErr);
  }
}
