/**
 * OAuth Auto-Connect Service
 *
 * Provides robust OAuth auto-connection functionality that is independent
 * of any UI component. Handles both OAuth tokens and GitHub App installations.
 */

import { persistentAuth } from './persistentAuth.js';
import { oauthFetch } from './bridgeConfig.js';

class OAuthAutoConnect {
  constructor() {
    this.autoConnectAttempted = false;
    this.isAttempting = false;
    this.listeners = new Map();
  }

  /**
   * Initialize the auto-connect service
   * Should be called during app startup, before any UI components
   */
  async initialize() {
    console.log('[OAuthAutoConnect] Initializing auto-connect service...');

    // Check if auto-connect has been attempted in this session
    try {
      const attempted = sessionStorage.getItem('oauth_autoconnect_attempted');
      this.autoConnectAttempted = attempted === 'true';
    } catch (e) {
      this.autoConnectAttempted = false;
    }

    if (this.autoConnectAttempted) {
      console.log('[OAuthAutoConnect] Auto-connect already attempted this session');
      return;
    }

    // Check user preference for auto-connect
    const allowAutoConnect = this.getAllowAutoConnect();
    if (!allowAutoConnect) {
      console.log('[OAuthAutoConnect] Auto-connect disabled by user preference');
      this.markAutoConnectAttempted();
      return;
    }

    // Attempt auto-connection
    await this.attemptAutoConnect();
  }

  /**
   * Check if user allows auto-connect
   */
  getAllowAutoConnect() {
    try {
      const setting = localStorage.getItem('allow_oauth_backup');
      return setting !== 'false'; // Default to true
    } catch (e) {
      return true; // Default to true if storage fails
    }
  }

  /**
   * Mark that auto-connect has been attempted this session
   */
  markAutoConnectAttempted() {
    this.autoConnectAttempted = true;
    try {
      sessionStorage.setItem('oauth_autoconnect_attempted', 'true');
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Main auto-connect logic
   */
  async attemptAutoConnect() {
    if (this.isAttempting) {
      console.log('[OAuthAutoConnect] Auto-connect already in progress');
      return;
    }

    if (persistentAuth.readyPromise) {
      try {
        await persistentAuth.readyPromise;
      } catch (error) {
        console.warn('[OAuthAutoConnect] Failed to preload auth state:', error);
      }
    }

    this.isAttempting = true;
    this.markAutoConnectAttempted();

    try {
      console.log('[OAuthAutoConnect] Starting auto-connect process...');

      // First, try GitHub App auto-connect
      const appConnected = await this.attemptAppAutoConnect();
      if (appConnected) {
        console.log('[OAuthAutoConnect] Successfully auto-connected via GitHub App');
        this.emit('connected', { method: 'github-app' });
        return true;
      }

      // Then, try OAuth auto-connect
      const oauthConnected = await this.attemptOAuthAutoConnect();
      if (oauthConnected) {
        console.log('[OAuthAutoConnect] Successfully auto-connected via OAuth');
        this.emit('connected', { method: 'oauth' });
        return true;
      }

      // If neither worked, try triggering OAuth flow if we have no tokens at all
      const hasAnyAuth = persistentAuth.hasValidTokens() || persistentAuth.hasAppInstallation();
      if (!hasAnyAuth) {
        console.log('[OAuthAutoConnect] No stored auth found, triggering OAuth flow...');
        await this.triggerOAuthFlow();
        return true;
      }

      console.log('[OAuthAutoConnect] Auto-connect completed - no action needed');
      return false;

    } catch (error) {
      console.error('[OAuthAutoConnect] Auto-connect failed:', error);
      this.emit('error', error);
      return false;
    } finally {
      this.isAttempting = false;
    }
  }

  /**
   * Attempt auto-connect using stored GitHub App installation
   */
  async attemptAppAutoConnect() {
    if (persistentAuth.readyPromise) {
      try {
        await persistentAuth.readyPromise;
      } catch (error) {
        console.warn('[OAuthAutoConnect] Failed to preload auth state for app auto-connect:', error);
      }
    }
    const appInstallation = persistentAuth.getAppInstallation();
    if (!appInstallation) {
      console.log('[OAuthAutoConnect] No GitHub App installation found');
      return false;
    }

    console.log('[OAuthAutoConnect] Found stored GitHub App installation, attempting to refresh token...');

    try {
      // Get fresh installation token
      const tokenResponse = await oauthFetch('/api/github/app/installation-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installation_id: appInstallation.installationId })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => '');
        throw new Error(`Failed to refresh GitHub App token (${tokenResponse.status}): ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      const freshAccessToken = tokenData.token;

      if (!freshAccessToken) {
        throw new Error('GitHub App token response missing token field');
      }

      // Update stored installation with fresh token
      const updatedInstallation = {
        ...appInstallation,
        accessToken: freshAccessToken,
        lastUpdated: Date.now()
      };

      await persistentAuth.storeAppInstallation(updatedInstallation);
      console.log('[OAuthAutoConnect] GitHub App token refreshed successfully');

      // Verify the token works by making a test request
      const isValid = await this.testGitHubAppToken(freshAccessToken);
      if (isValid) {
        console.log('[OAuthAutoConnect] GitHub App token validated successfully');
        return true;
      } else {
        throw new Error('GitHub App token validation failed');
      }

    } catch (error) {
      console.error('[OAuthAutoConnect] GitHub App auto-connect failed:', error);
      // Clear invalid app installation
      await persistentAuth.clearAppInstallation();
      return false;
    }
  }

  /**
   * Attempt auto-connect using stored OAuth tokens
   */
  async attemptOAuthAutoConnect() {
    if (persistentAuth.readyPromise) {
      try {
        await persistentAuth.readyPromise;
      } catch (error) {
        console.warn('[OAuthAutoConnect] Failed to preload auth state for OAuth auto-connect:', error);
      }
    }
    if (!persistentAuth.hasValidTokens()) {
      console.log('[OAuthAutoConnect] No valid OAuth tokens found');
      return false;
    }

    console.log('[OAuthAutoConnect] Found stored OAuth tokens, validating...');

    try {
      // Get and validate access token
      const accessToken = await persistentAuth.getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      // Test token validity
      const isValid = await persistentAuth.testTokenValidity();
      if (isValid) {
        console.log('[OAuthAutoConnect] OAuth tokens validated successfully');
        return true;
      } else {
        throw new Error('OAuth token validation failed');
      }

    } catch (error) {
      console.error('[OAuthAutoConnect] OAuth auto-connect failed:', error);
      // Clear invalid tokens
      await persistentAuth.clearTokens();
      return false;
    }
  }

  /**
   * Test if a GitHub App token is valid
   */
  async testGitHubAppToken(token) {
    try {
      const response = await fetch('https://api.github.com/installation/repositories', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      return response.ok;
    } catch (error) {
      console.error('[OAuthAutoConnect] GitHub App token test failed:', error);
      return false;
    }
  }

  /**
   * Trigger OAuth flow automatically
   */
  async triggerOAuthFlow() {
    try {
      console.log('[OAuthAutoConnect] Triggering OAuth flow...');

      // Clear any existing session data
      try {
        sessionStorage.removeItem('github_oauth_pending');
        sessionStorage.removeItem('github_oauth_state');
        sessionStorage.removeItem('github_oauth_result');
      } catch (e) {
        // Ignore session storage errors
      }

      // Get OAuth client configuration
      const clientResponse = await oauthFetch('/api/github/oauth/client-id');
      if (!clientResponse.ok) {
        throw new Error('Failed to load OAuth configuration from server');
      }

      const { clientId } = await clientResponse.json();
      if (!clientId) {
        throw new Error('GitHub OAuth client ID is not configured');
      }

      // Generate state and prepare OAuth flow
      const state = Math.random().toString(36).slice(2);
      const redirectUri = `${window.location.origin}/oauth/callback`;
      const scopes = 'repo';

      // Store OAuth state
      sessionStorage.setItem('github_oauth_state', state);
      sessionStorage.setItem('github_oauth_pending', 'true');

      // Construct authorization URL
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;

      console.log('[OAuthAutoConnect] Redirecting to GitHub OAuth...');
      this.emit('redirecting', { url: authUrl });

      // Redirect to GitHub
      window.location.href = authUrl;

    } catch (error) {
      console.error('[OAuthAutoConnect] Failed to trigger OAuth flow:', error);
      throw error;
    }
  }

  /**
   * Force attempt auto-connect (for manual triggers)
   */
  async forceAutoConnect() {
    this.autoConnectAttempted = false;
    this.isAttempting = false;
    try {
      sessionStorage.removeItem('oauth_autoconnect_attempted');
    } catch (e) {
      // Ignore
    }
    return this.attemptAutoConnect();
  }

  /**
   * Event handling
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
  }

  off(eventName, callback) {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(eventName, data) {
    const listeners = this.listeners.get(eventName) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[OAuthAutoConnect] Event listener error for ${eventName}:`, error);
      }
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      autoConnectAttempted: this.autoConnectAttempted,
      isAttempting: this.isAttempting,
      allowAutoConnect: this.getAllowAutoConnect(),
      hasOAuthTokens: persistentAuth.hasValidTokens(),
      hasAppInstallation: persistentAuth.hasAppInstallation()
    };
  }
}

// Export singleton instance
export const oauthAutoConnect = new OAuthAutoConnect();
export default oauthAutoConnect;
