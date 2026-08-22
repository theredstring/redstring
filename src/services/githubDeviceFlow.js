/**
 * GitHub Device Flow (native shells: Electron and Capacitor/iOS).
 *
 * Fully local OAuth: requests a device code from github.com, has the user
 * approve it in their browser, polls until GitHub returns a token. No
 * client_secret, no callback server, no reliance on redstring.io.
 *
 * Used for both the OAuth App (general repo access) and the GitHub App
 * (live sync). The only difference between the two flows is the client_id
 * — the App's device flow returns a user-to-server token (`ghu_*`) which
 * acts with the App's permissions on installations the user has access to.
 *
 * Transport differs by shell because github.com's device endpoints send no
 * CORS headers: Electron proxies them through the main process, Capacitor
 * uses CapacitorHttp (native requests aren't subject to CORS).
 */

import { isElectron } from '../utils/fileAccessAdapter.js';
import { isCapacitor, capHttpJSON } from '../utils/capacitorAdapter.js';
import {
  DEFAULT_OAUTH_CLIENT_ID,
  DEFAULT_APP_CLIENT_ID,
  DEFAULT_APP_SLUG
} from '../config/githubClientIds.js';

const DEVICE_CODE_VERIFICATION_FALLBACK = 'https://github.com/login/device';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function assertNativeShell() {
  const hasElectronBridge = isElectron() && !!window.electron?.github;
  if (!hasElectronBridge && !isCapacitor()) {
    throw new Error('GitHub device flow is only available in the desktop or iOS app');
  }
}

/** Request a device code through whichever native transport is available. */
async function requestDeviceCodeNative(clientId, scope) {
  if (isCapacitor()) {
    const params = new URLSearchParams({ client_id: clientId });
    if (scope) params.set('scope', scope);
    return await capHttpJSON(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString()
    });
  }
  return await window.electron.github.requestDeviceCode(clientId, scope || undefined);
}

/** Poll for the access token through whichever native transport is available. */
async function pollDeviceTokenNative(clientId, deviceCode) {
  if (isCapacitor()) {
    const params = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });
    return await capHttpJSON(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString()
    });
  }
  return await window.electron.github.pollDeviceToken(clientId, deviceCode);
}

/**
 * Request a fresh device + user code from GitHub.
 *
 * @param {Object} opts
 * @param {string} opts.clientId  OAuth App or GitHub App client_id
 * @param {string} [opts.scope]   Space-separated scopes (OAuth App only; ignored by GitHub Apps)
 * @returns {Promise<{
 *   deviceCode: string,
 *   userCode: string,
 *   verificationUri: string,
 *   verificationUriComplete: string|null,
 *   intervalMs: number,
 *   expiresAt: number
 * }>}
 */
export async function requestDeviceCode({ clientId, scope } = {}) {
  assertNativeShell();
  if (!clientId) {
    throw new Error('Missing GitHub client_id. Set VITE_GITHUB_CLIENT_ID (OAuth App) or VITE_GITHUB_APP_CLIENT_ID (GitHub App) at build time.');
  }
  const result = await requestDeviceCodeNative(clientId, scope);
  if (!result?.ok || !result.body) {
    const errMsg = result?.body?.error_description || result?.body?.error || `HTTP ${result?.status || '?'}`;
    throw new Error(`Device code request failed: ${errMsg}`);
  }
  const body = result.body;
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri || DEVICE_CODE_VERIFICATION_FALLBACK,
    verificationUriComplete: body.verification_uri_complete || null,
    intervalMs: Math.max(1, Number(body.interval) || 5) * 1000,
    expiresAt: Date.now() + (Number(body.expires_in) || 900) * 1000
  };
}

/**
 * Open the verification URL in the user's default browser.
 * Falls back silently if the IPC isn't wired up.
 */
export async function openVerificationUrl(url) {
  if (!url) return false;
  try {
    if (isCapacitor()) {
      // SFSafariViewController — the user enters the code and swipes back.
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return true;
    }
    if (isElectron() && window.electron?.github?.openExternal) {
      return await window.electron.github.openExternal(url);
    }
    window.open(url, '_blank', 'noopener');
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll GitHub until the user authorizes the device, the code expires, or
 * the caller signals cancellation. Calls `onTick` once per poll with the
 * current status so the UI can show progress.
 *
 * @param {Object} opts
 * @param {string} opts.clientId
 * @param {string} opts.deviceCode
 * @param {number} opts.intervalMs
 * @param {number} opts.expiresAt
 * @param {{ cancelled: boolean }} [opts.cancelSignal]
 * @param {(status: string) => void} [opts.onTick]
 * @returns {Promise<{
 *   access_token: string,
 *   token_type: string,
 *   scope: string,
 *   refresh_token?: string,
 *   expires_in?: number,
 *   refresh_token_expires_in?: number
 * }>}
 */
export async function pollForToken({
  clientId,
  deviceCode,
  intervalMs,
  expiresAt,
  cancelSignal,
  onTick
} = {}) {
  assertNativeShell();
  let currentInterval = Math.max(1000, intervalMs || 5000);

  while (true) {
    if (cancelSignal && cancelSignal.cancelled) {
      throw new Error('Device flow cancelled');
    }
    if (Date.now() > expiresAt) {
      throw new Error('Device code expired. Click Connect again to retry.');
    }

    await new Promise((resolve) => setTimeout(resolve, currentInterval));

    if (cancelSignal && cancelSignal.cancelled) {
      throw new Error('Device flow cancelled');
    }

    let result;
    try {
      result = await pollDeviceTokenNative(clientId, deviceCode);
    } catch (err) {
      // Network blip — keep polling. Surface to UI via onTick.
      if (onTick) onTick('network-error');
      continue;
    }

    const body = result?.body || {};

    if (body.access_token) {
      return body;
    }

    switch (body.error) {
      case 'authorization_pending':
        if (onTick) onTick('pending');
        break;
      case 'slow_down':
        // GitHub asks us to back off. Add 5s as required by the spec.
        currentInterval += 5000;
        if (onTick) onTick('slow-down');
        break;
      case 'expired_token':
        throw new Error('Device code expired. Click Connect again to retry.');
      case 'access_denied':
        throw new Error('Authorization denied. You declined the request on GitHub.');
      case 'unsupported_grant_type':
        throw new Error('GitHub rejected the grant type. Make sure "Enable Device Flow" is on for this app.');
      case 'incorrect_client_credentials':
        throw new Error('GitHub rejected the client_id. Check VITE_GITHUB_CLIENT_ID / VITE_GITHUB_APP_CLIENT_ID.');
      case 'incorrect_device_code':
        throw new Error('Device code rejected. Start the flow again.');
      default:
        if (!result?.ok) {
          throw new Error(body.error_description || body.error || `HTTP ${result?.status || '?'}`);
        }
        // Unknown but ok — keep waiting.
        if (onTick) onTick('pending');
        break;
    }
  }
}

/**
 * Resolved client IDs. Defaults to the upstream Redstring public IDs (see
 * src/config/githubClientIds.js); forks point at their own registrations
 * by setting the matching VITE_GITHUB_* env vars at build time.
 */
export function getOAuthClientId() {
  return (import.meta.env && import.meta.env.VITE_GITHUB_CLIENT_ID) || DEFAULT_OAUTH_CLIENT_ID;
}

export function getAppClientId() {
  return (import.meta.env && import.meta.env.VITE_GITHUB_APP_CLIENT_ID) || DEFAULT_APP_CLIENT_ID;
}

export function getAppSlug() {
  return (import.meta.env && import.meta.env.VITE_GITHUB_APP_SLUG) || DEFAULT_APP_SLUG;
}
