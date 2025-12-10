/**
 * OAuth Adapter
 * 
 * Provides a unified interface for OAuth flows that works in both
 * browser (redirect-based) and Electron (protocol handler) environments.
 */

import { isElectron } from './fileAccessAdapter.js';

/**
 * Start OAuth flow
 * @param {string} authUrl - GitHub OAuth authorization URL
 * @returns {Promise<{code: string, state?: string, error?: string}>} - OAuth callback data
 */
export const startOAuthFlow = async (authUrl) => {
  if (isElectron()) {
    // Electron: Use protocol handler
    return new Promise((resolve, reject) => {
      // Set up callback listener
      const callbackHandler = (data) => {
        window.electron.oauth.onCallback((callbackData) => {
          if (callbackData.error) {
            reject(new Error(callbackData.error));
          } else {
            resolve(callbackData);
          }
        });
      };

      // Start OAuth flow
      window.electron.oauth.start(authUrl)
        .then((result) => {
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        })
        .catch(reject);
    });
  } else {
    // Browser: Redirect to OAuth URL
    // The OAuth server will handle the callback and redirect back
    window.location.href = authUrl;
    // This will never resolve in browser context (page redirects)
    return new Promise(() => {});
  }
};

/**
 * Check if OAuth callback is available (Electron only)
 * @returns {boolean}
 */
export const hasOAuthCallback = () => {
  return isElectron() && window.electron?.oauth;
};

