/**
 * OAuth Adapter
 * 
 * Browser redirect into GitHub's OAuth authorize page. Desktop and native
 * builds sign in with the device flow instead (see githubDeviceFlow.js).
 */

import { safeExternalHref } from './safeUrl.js';

/** The URL, normalized, when it is an https page on github.com; else null. */
export const githubAuthUrl = (url) => {
  const href = safeExternalHref(url);
  if (!href) return null;
  const parsed = new URL(href);
  return parsed.protocol === 'https:' && parsed.hostname === 'github.com' ? href : null;
};

/**
 * Start OAuth flow
 * @param {string} authUrl - GitHub OAuth authorization URL
 * @returns {Promise<{code: string, state?: string, error?: string}>} - OAuth callback data
 */
export const startOAuthFlow = async (rawAuthUrl) => {
  // Only ever GitHub's own https pages: this navigates the whole app, so
  // nothing else may pass.
  const authUrl = githubAuthUrl(rawAuthUrl);
  if (!authUrl) {
    throw new Error('Refusing to start OAuth: not a https://github.com URL');
  }
  // Redirect to GitHub; the OAuth callback page brings the user back.
  // authUrl already passed githubAuthUrl; safeExternalHref again keeps the
  // sink itself visibly guarded.
  window.location.href = safeExternalHref(authUrl);
  // Never resolves: the page navigates away.
  return new Promise(() => {});
};
