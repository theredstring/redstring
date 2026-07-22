/**
 * Post-redirect GitHub auth callback processing, shared between the
 * Universes panel (UniverseManager) and the onboarding GitHub wizard.
 *
 * The oauth-server-hosted callback page (outside this repo) writes
 * sessionStorage `github_oauth_result` / `github_app_result` before
 * bouncing back to the app; GitHub may also deliver params directly on the
 * URL. Both read paths must be preserved verbatim.
 *
 * All entry points are single-flight guarded: the sessionStorage result keys
 * are consumed-on-read, and both the wizard and the panel call these on
 * mount — the second caller must await the first run, not find nothing.
 */
import { persistentAuth } from './persistentAuth.js';
import { oauthFetch } from './bridgeConfig.js';
import universeManagerService from './universeManagerService.js';
import { isElectron } from '../utils/fileAccessAdapter.js';
import { findAppInstallationDirect } from './githubAuthFlows.js';

const { log: __nativeLog, warn: __nativeWarn, error: __nativeError } = console;
const gcLog = (...args) => __nativeLog.call(console, '[GitHubAuthCallbacks]', ...args);
const gcWarn = (...args) => __nativeWarn.call(console, '[GitHubAuthCallbacks]', ...args);
const gcError = (...args) => __nativeError.call(console, '[GitHubAuthCallbacks]', ...args);

const safeSessionGet = (key) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSessionRemove = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const readSessionJSON = (key) => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    sessionStorage.removeItem(key);
    return data;
  } catch (err) {
    gcWarn(`Failed to parse session data for ${key}:`, err);
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    return null;
  }
};

const cleanupUrl = () => {
  try {
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch {
    // ignore
  }
};

/**
 * Exchange a pending OAuth redirect result for stored tokens.
 * Returns { handled, error? } — handled=true means tokens were stored.
 */
async function processOAuthCallbackInner() {
  const storedResult = readSessionJSON('github_oauth_result');
  const urlParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const code = storedResult?.code || urlParams.get('code') || hashParams.get('code');
  const stateValue = storedResult?.state || urlParams.get('state') || hashParams.get('state');
  const expectedState = safeSessionGet('github_oauth_state');
  const pending = safeSessionGet('github_oauth_pending') === 'true';

  if (!code || !stateValue || !pending) {
    return { handled: false };
  }

  if (expectedState && stateValue !== expectedState) {
    safeSessionRemove('github_oauth_pending');
    safeSessionRemove('github_oauth_state');
    cleanupUrl();
    return { handled: false, error: 'GitHub authentication state mismatch. Please retry.' };
  }

  const redirectUri = universeManagerService.getOAuthRedirectUri();

  try {
    const resp = await oauthFetch('/api/github/oauth/token', {
      bypassCooldown: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state: stateValue, redirect_uri: redirectUri })
    });

    if (!resp.ok) {
      const message = await resp.text().catch(() => 'unknown error');
      throw new Error(`Token exchange failed (${resp.status} ${message})`);
    }

    const tokenData = await resp.json();
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });

    if (!userResp.ok) {
      const message = await userResp.text().catch(() => 'unknown error');
      throw new Error(`Failed to fetch GitHub user (${userResp.status} ${message})`);
    }

    const userData = await userResp.json();
    await persistentAuth.storeTokens(tokenData, userData);
    // NOTE: onboarding resume flags intentionally survive this point —
    // repo attachment is what completes onboarding and clears them.
    return { handled: true };
  } catch (err) {
    gcError('OAuth callback failed:', err);
    return { handled: false, error: `GitHub OAuth failed: ${err.message}` };
  } finally {
    safeSessionRemove('github_oauth_pending');
    safeSessionRemove('github_oauth_state');
    cleanupUrl();
  }
}

/**
 * Complete a pending GitHub App install: resolve the installation_id
 * (callback result, URL params, or discovery via the user's OAuth token),
 * mint an installation token, and store the installation.
 * Returns { handled, error? }.
 */
async function processAppCallbackInner() {
  const storedResult = readSessionJSON('github_app_result');
  const urlParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  let installationId =
    storedResult?.installation_id || urlParams.get('installation_id') || hashParams.get('installation_id');

  const pending = safeSessionGet('github_app_pending') === 'true';

  // If no installation_id, try to discover it via the installations API
  if (!installationId && pending) {
    gcLog('No installation_id in callback, attempting discovery...');
    try {
      // The listings endpoint requires the user's OAuth token so it can
      // scope results to this account (previously it returned every install
      // of this App across every GitHub account, which let a stranger's
      // install hijack this client). Pass it explicitly.
      const userOauthToken = persistentAuth?.oauthCache?.accessToken
        || persistentAuth?.githubAppCache?.accessToken
        || null;
      if (!userOauthToken) {
        gcWarn('Cannot discover install without OAuth token — connect OAuth first');
      } else {
        const listResp = await oauthFetch('/api/github/app/installations', {
          bypassCooldown: true,
          headers: { 'Authorization': `token ${userOauthToken}` }
        });
        if (listResp.ok) {
          const installations = await listResp.json();
          if (Array.isArray(installations) && installations.length > 0) {
            // Prefer install whose account matches the OAuth user; fall
            // back to most recent only if no account match. Belt-and-
            // suspenders since the server now filters by user already.
            const oauthLogin = (persistentAuth?.oauthCache?.user?.login || '').toLowerCase();
            const accountMatch = oauthLogin
              ? installations.find((i) => (i?.account?.login || '').toLowerCase() === oauthLogin)
              : null;
            const latest = accountMatch || installations[0];
            installationId = latest?.id;
            gcLog('Discovered installation:', installationId, accountMatch ? `(account-matched ${oauthLogin})` : '(most recent fallback)');
          } else {
            gcWarn('/api/github/app/installations returned empty list — App may not be installed on this account, or env vars are misconfigured');
          }
        } else {
          const errText = await listResp.text().catch(() => '');
          gcWarn('Install discovery failed:', listResp.status, errText.slice(0, 200));
        }
      }
    } catch (discoveryErr) {
      gcWarn('Installation discovery failed:', discoveryErr);
    }
  }

  if (!installationId) return { handled: false };

  try {
    gcLog('Requesting installation token for:', installationId);

    const resp = await oauthFetch('/api/github/app/installation-token', {
      bypassCooldown: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId })
    });

    if (!resp.ok) {
      const message = await resp.text().catch(() => 'unknown error');

      // Provide specific guidance for common errors
      let errorMessage = `Failed to obtain installation token (${resp.status})`;

      if (resp.status === 401) {
        errorMessage = 'GitHub OAuth authentication required. Please connect OAuth first, then retry the GitHub App installation.';
      } else if (resp.status === 403) {
        errorMessage = 'Installation not accessible. The GitHub App installation may not match your authenticated GitHub account.';
      } else if (resp.status === 502) {
        errorMessage = 'GitHub API gateway error. This may indicate the GitHub App configuration is incorrect. Please check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables.';
      } else if (resp.status === 404) {
        errorMessage = 'Installation not found. Please reinstall the GitHub App.';
      } else {
        errorMessage += `: ${message}`;
      }

      throw new Error(errorMessage);
    }

    const tokenData = await resp.json();
    const token = tokenData?.token;
    if (!token) {
      throw new Error('GitHub App token response missing token');
    }

    const tokenExpiresAtMs = tokenData.expires_at ? Date.parse(tokenData.expires_at) : null;

    gcLog('Storing GitHub App installation...');
    await persistentAuth.storeAppInstallation({
      installationId,
      accessToken: token,
      repositories: tokenData.repositories || [],
      userData: tokenData.account || {},
      permissions: tokenData.permissions || null,
      tokenExpiresAt: Number.isFinite(tokenExpiresAtMs) ? tokenExpiresAtMs : null,
      verification: tokenData.verification || null,
      lastUpdated: Date.now()
    });

    // NOTE: onboarding resume flags intentionally survive this point —
    // repo attachment is what completes onboarding and clears them.
    return { handled: true };
  } catch (err) {
    gcError('GitHub App callback failed:', err);
    return { handled: false, error: `GitHub App connection failed: ${err.message}` };
  } finally {
    if (pending) safeSessionRemove('github_app_pending');
  }
}

let pendingCallbacksInFlight = null;

/**
 * Run both pending-callback processors once. Safe to call from multiple
 * mounts concurrently — the first caller does the work, later callers await
 * the same promise. Resolves { oauth: {handled,error?}, app: {handled,error?} }.
 */
export function runPendingCallbacks() {
  if (typeof window === 'undefined') {
    return Promise.resolve({ oauth: { handled: false }, app: { handled: false } });
  }
  if (pendingCallbacksInFlight) return pendingCallbacksInFlight;

  pendingCallbacksInFlight = (async () => {
    const oauth = await processOAuthCallbackInner();
    const app = await processAppCallbackInner();
    if (app.handled) cleanupUrl();
    return { oauth, app };
  })().finally(() => {
    pendingCallbacksInFlight = null;
  });

  return pendingCallbacksInFlight;
}

// Debounce for background (non-pending) App discovery on tab focus
let lastBackgroundAppDiscovery = 0;

/**
 * Tab-focus App re-detection. Two modes:
 * - `github_app_pending` set (user just went to the install page): force a
 *   fresh discovery — Electron uses the parked user-to-server token against
 *   api.github.com directly; web uses forceAppDiscovery (clears sticky
 *   disconnect since this is a user-initiated install attempt). Then re-run
 *   the URL-based callback in case GitHub included installation_id.
 * - No pending flag but OAuth connected and no App known: quiet, debounced
 *   attemptAppAutoConnect (honors sticky disconnect — a deliberate App
 *   disconnect is never silently overridden). Web only.
 *
 * Returns { detected: bool } — detected=true when an App install is now stored.
 */
export async function recheckAppOnFocus() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
    return { detected: false };
  }
  const pending = safeSessionGet('github_app_pending') === 'true';

  if (pending) {
    try {
      gcLog('Tab regained focus with pending App install — re-running discovery');
      if (isElectron()) {
        const parkedToken = persistentAuth.getAppUserToServerToken?.() || null;
        if (parkedToken) {
          try {
            const install = await findAppInstallationDirect(parkedToken);
            if (install) {
              await persistentAuth.storeAppInstallation({
                installationId: install.id,
                accessToken: parkedToken,
                repositories: [],
                userData: install.account || {}
              });
              persistentAuth.clearAppUserToServerToken?.();
            }
          } catch (electronErr) {
            gcWarn('Electron focus App discovery failed:', electronErr?.message || electronErr);
          }
        }
      } else {
        await persistentAuth.forceAppDiscovery?.();
      }
      const app = await processAppCallbackInner();
      if (app.handled || persistentAuth.hasAppInstallation?.()) {
        safeSessionRemove('github_app_pending');
        return { detected: true };
      }
    } catch (err) {
      gcWarn('Visibility-triggered App discovery failed:', err?.message || err);
    }
    return { detected: false };
  }

  if (isElectron()) return { detected: false };
  const canDiscover = persistentAuth.hasValidTokens?.() && !persistentAuth.hasAppInstallation?.();
  if (!canDiscover) return { detected: false };
  const now = Date.now();
  if (now - lastBackgroundAppDiscovery < 60000) return { detected: false };
  lastBackgroundAppDiscovery = now;
  try {
    const ok = await persistentAuth.attemptAppAutoConnect?.();
    if (ok && persistentAuth.hasAppInstallation?.()) {
      return { detected: true };
    }
  } catch (err) {
    gcWarn('Background App discovery failed:', err?.message || err);
  }
  return { detected: false };
}
