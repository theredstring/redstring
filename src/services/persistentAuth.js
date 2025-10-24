/**
 * Persistent Authentication Service
 * 
 * Handles GitHub OAuth token management with automatic refresh,
 * secure storage, and connection health monitoring.
 */

import { oauthFetch } from './bridgeConfig.js';

// Token refresh buffer - refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Health check interval - check every 5 minutes
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000;

const LOCAL_STORAGE_KEYS = {
  oauth: {
    accessToken: 'github_access_token',
    refreshToken: 'github_refresh_token',
    scope: 'github_token_scope',
    tokenType: 'github_token_type',
    expiry: 'github_token_expiry',
    user: 'github_user_data',
    storedAt: 'github_token_stored_at'
  },
  app: {
    installationId: 'github_app_installation_id',
    accessToken: 'github_app_access_token',
    repositories: 'github_app_repositories',
    userData: 'github_app_user_data',
    permissions: 'github_app_permissions',
    lastUpdated: 'github_app_last_updated',
    tokenExpiresAt: 'github_app_token_expires'
  }
};

// Browser-side storage helpers (keep user data LOCAL)
function setLocalStorageItem(key, value) {
  try {
    const storage = getLocalStorageHandle();
    if (storage) {
      storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    }
  } catch (error) {
    console.warn('[PersistentAuth] Failed to write to localStorage:', error?.message || error);
  }
  return false;
}

function getLocalStorageItem(key) {
  try {
    const storage = getLocalStorageHandle();
    if (storage) {
      return storage.getItem(key);
    }
  } catch (error) {
    console.warn('[PersistentAuth] Failed to read from localStorage:', error?.message || error);
  }
  return null;
}

function removeLocalStorageItem(key) {
  try {
    const storage = getLocalStorageHandle();
    if (storage) {
      storage.removeItem(key);
      return true;
    }
  } catch (error) {
    console.warn('[PersistentAuth] Failed to remove from localStorage:', error?.message || error);
  }
  return false;
}

function getLocalStorageHandle() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('[PersistentAuth] Local storage unavailable:', error?.message || error);
    return null;
  }
}

function safeParseJSON(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class PersistentAuth {
  constructor() {
    console.log('[PersistentAuth] Constructor called - UPDATED');
    this.isRefreshing = false;
    this.refreshPromise = null;
    this.healthCheckInterval = null;
    this.eventListeners = new Map();
    this.initializeCalled = false;
    this.autoConnectAttempted = false; // Track per instance, not session
    this.oauthCache = null;
    this.githubAppCache = null;
    this.authStateLoaded = false;
    this.authStateLoadingPromise = null;
    this.readyPromise = null;

    this.readyPromise = this.ensureAuthStateLoaded().catch(error => {
      console.warn('[PersistentAuth] Initial auth state load failed:', error);
    }).then(() => {
      const hasOAuthTokens = this.hasValidTokens();
      const hasAppInstallation = this.hasAppInstallation();
      console.log('[PersistentAuth] Constructor auth check:', { hasOAuthTokens, hasAppInstallation });

      if (hasOAuthTokens) {
        console.log('[PersistentAuth] Constructor: Valid OAuth tokens found, starting health monitoring');
        this.startHealthMonitoring();
      } else {
        console.log('[PersistentAuth] Constructor: No valid OAuth tokens found');
      }

      if (hasOAuthTokens || hasAppInstallation) {
        console.log('[PersistentAuth] Constructor: Stored auth data found, will attempt auto-connect');
        setTimeout(() => {
          if (!this.initializeCalled) {
            console.log('[PersistentAuth] Constructor: Auto-triggering initialize() because it wasn\'t called');
            this.initialize().catch(error => {
              console.error('[PersistentAuth] Constructor auto-initialize failed:', error);
            });
          }
        }, 1000);
      }
    });
  }

  async ensureAuthStateLoaded(force = false) {
    if (this.authStateLoaded && !force) {
      return;
    }
    if (this.authStateLoadingPromise) {
      return this.authStateLoadingPromise;
    }

    this.authStateLoadingPromise = (async () => {
      try {
        // PRIMARY: Load from browser localStorage (user data stays local!)
        console.log('[PersistentAuth] Loading tokens from browser localStorage...');
        this.loadFromBrowserStorage();

        // OPTIONAL: Sync from server as backup (stateless server doesn't persist)
        // This is only useful for initial server-side OAuth completion
        try {
          const response = await oauthFetch('/api/github/auth/state?includeTokens=true');
          if (response.ok) {
            const state = await response.json();
            // Only apply server state if browser doesn't have tokens
            if (!this.oauthCache?.accessToken && state?.oauth?.accessToken) {
              console.log('[PersistentAuth] Found tokens from server OAuth completion, saving to browser...');
              this.applyAuthStateFromServer(state);
              this.saveToBrowserStorage(); // Save server tokens to browser
            }
          }
        } catch (serverError) {
          console.log('[PersistentAuth] Server sync skipped (expected for stateless server):', serverError.message);
        }

        this.authStateLoaded = true;
      } catch (error) {
        console.warn('[PersistentAuth] ensureAuthStateLoaded failed:', error);
        throw error;
      } finally {
        this.authStateLoadingPromise = null;
      }
    })();

    return this.authStateLoadingPromise;
  }

  /**
   * Load tokens from browser localStorage (PRIMARY storage - keeps data local!)
   */
  loadFromBrowserStorage() {
    try {
      // Load OAuth credentials
      const accessToken = getLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.accessToken);
      const refreshToken = getLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.refreshToken);
      const scope = getLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.scope);
      const tokenType = getLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.tokenType);
      const expiry = getLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.expiry);
      const userRaw = getLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.user);
      const storedAt = getLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.storedAt);

      if (accessToken) {
        this.oauthCache = {
          accessToken,
          refreshToken: refreshToken || null,
          scope: scope || null,
          tokenType: tokenType || 'bearer',
          expiresAt: expiry ? Number(expiry) : null,
          user: safeParseJSON(userRaw),
          storedAt: storedAt ? Number(storedAt) : Date.now()
        };
        console.log('[PersistentAuth] OAuth tokens loaded from browser localStorage');
      }

      // Load GitHub App installation
      const installationId = getLocalStorageItem(LOCAL_STORAGE_KEYS.app.installationId);
      const appAccessToken = getLocalStorageItem(LOCAL_STORAGE_KEYS.app.accessToken);
      const repositoriesRaw = getLocalStorageItem(LOCAL_STORAGE_KEYS.app.repositories);
      const userDataRaw = getLocalStorageItem(LOCAL_STORAGE_KEYS.app.userData);
      const permissionsRaw = getLocalStorageItem(LOCAL_STORAGE_KEYS.app.permissions);
      const tokenExpiresAt = getLocalStorageItem(LOCAL_STORAGE_KEYS.app.tokenExpiresAt);
      const lastUpdated = getLocalStorageItem(LOCAL_STORAGE_KEYS.app.lastUpdated);

      if (installationId) {
        this.githubAppCache = {
          installationId: Number(installationId),
          accessToken: appAccessToken || null,
          repositories: safeParseJSON(repositoriesRaw) || [],
          userData: safeParseJSON(userDataRaw) || {},
          permissions: safeParseJSON(permissionsRaw) || null,
          tokenExpiresAt: tokenExpiresAt ? Number(tokenExpiresAt) : null,
          verification: null,
          lastUpdated: lastUpdated ? Number(lastUpdated) : Date.now()
        };
        console.log('[PersistentAuth] GitHub App installation loaded from browser localStorage');
      }
    } catch (error) {
      console.warn('[PersistentAuth] Failed to load from browser storage:', error);
    }
  }

  /**
   * Save tokens to browser localStorage (PRIMARY storage - keeps data local!)
   */
  saveToBrowserStorage() {
    try {
      // Save OAuth credentials
      if (this.oauthCache?.accessToken) {
        setLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.accessToken, this.oauthCache.accessToken);
        setLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.refreshToken, this.oauthCache.refreshToken || '');
        setLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.scope, this.oauthCache.scope || '');
        setLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.tokenType, this.oauthCache.tokenType || 'bearer');
        setLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.expiry, this.oauthCache.expiresAt?.toString() || '');
        setLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.user, this.oauthCache.user);
        setLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.storedAt, this.oauthCache.storedAt?.toString() || Date.now().toString());
        console.log('[PersistentAuth] OAuth tokens saved to browser localStorage');
      }

      // Save GitHub App installation
      if (this.githubAppCache?.installationId) {
        setLocalStorageItem(LOCAL_STORAGE_KEYS.app.installationId, this.githubAppCache.installationId.toString());
        setLocalStorageItem(LOCAL_STORAGE_KEYS.app.accessToken, this.githubAppCache.accessToken || '');
        setLocalStorageItem(LOCAL_STORAGE_KEYS.app.repositories, this.githubAppCache.repositories);
        setLocalStorageItem(LOCAL_STORAGE_KEYS.app.userData, this.githubAppCache.userData);
        setLocalStorageItem(LOCAL_STORAGE_KEYS.app.permissions, this.githubAppCache.permissions);
        setLocalStorageItem(LOCAL_STORAGE_KEYS.app.tokenExpiresAt, this.githubAppCache.tokenExpiresAt?.toString() || '');
        setLocalStorageItem(LOCAL_STORAGE_KEYS.app.lastUpdated, this.githubAppCache.lastUpdated?.toString() || Date.now().toString());
        console.log('[PersistentAuth] GitHub App installation saved to browser localStorage');
      }
    } catch (error) {
      console.warn('[PersistentAuth] Failed to save to browser storage:', error);
    }
  }

  applyAuthStateFromServer(state = {}) {
    const prevOAuthToken = this.oauthCache?.accessToken || null;
    const prevAppInstallation = this.githubAppCache?.installationId || null;

    const oauthState = state?.oauth;
    if (oauthState?.hasToken && oauthState.accessToken) {
      const expiresAtNumeric = oauthState.expiresAt != null ? Number(oauthState.expiresAt) : null;
      this.oauthCache = {
        accessToken: oauthState.accessToken,
        refreshToken: oauthState.refreshToken || null,
        scope: oauthState.scope || null,
        tokenType: oauthState.tokenType || 'bearer',
        expiresAt: Number.isFinite(expiresAtNumeric) ? expiresAtNumeric : null,
        user: oauthState.user || null,
        storedAt: oauthState.storedAt || Date.now()
      };
    } else {
      this.oauthCache = null;
    }

    const appState = state?.githubApp;
    if (appState?.isInstalled && appState.installationId) {
      const expiresAtNumeric = appState.tokenExpiresAt != null ? Number(appState.tokenExpiresAt) : null;
      const repositories = Array.isArray(appState.repositories) ? appState.repositories : [];
      this.githubAppCache = {
        installationId: appState.installationId,
        accessToken: appState.accessToken || null,
        tokenExpiresAt: Number.isFinite(expiresAtNumeric) ? expiresAtNumeric : null,
        repositories,
        userData: appState.account || null,
        permissions: appState.permissions || null,
        verification: appState.verification || null,
        lastUpdated: appState.storedAt || Date.now()
      };
    } else {
      this.githubAppCache = null;
    }

    if (this.oauthCache?.accessToken && !prevOAuthToken) {
      const tokenData = {
        access_token: this.oauthCache.accessToken,
        refresh_token: this.oauthCache.refreshToken,
        scope: this.oauthCache.scope,
        token_type: this.oauthCache.tokenType
      };
      this.emit('tokenStored', { tokenData, userData: this.oauthCache.user });
      this.dispatchAuthEvent('oauth', { user: this.oauthCache.user?.login || null });
      this.dispatchConnectedEvent('oauth', { autoConnected: true });
    }

    if (this.githubAppCache?.installationId && !prevAppInstallation) {
      this.emit('appInstallationStored', this.githubAppCache);
      this.dispatchAuthEvent('github-app', {
        installationId: this.githubAppCache.installationId,
        repositoryCount: this.githubAppCache.repositories.length
      });
      this.dispatchConnectedEvent('github-app', {
        installationId: this.githubAppCache.installationId,
        repositoryCount: this.githubAppCache.repositories.length
      });
    }
  }

  /**
   * Initialize the authentication service
   * This is called by universeManager during backend initialization
   */
  async initialize() {
    console.log('[PersistentAuth] ===== INITIALIZE CALLED =====');
    this.initializeCalled = true;

    await this.ensureAuthStateLoaded().catch(error => {
      console.warn('[PersistentAuth] initialize: auth state load failed', error);
    });

    // Check what auth data we have
    const hasOAuthTokens = this.hasValidTokens();
    const hasAppInstallation = this.hasAppInstallation();
    console.log('[PersistentAuth] Auth data check:', { hasOAuthTokens, hasAppInstallation });

    // Start health monitoring if we have tokens
    if (hasOAuthTokens) {
      console.log('[PersistentAuth] Valid OAuth tokens found, starting health monitoring');
      this.startHealthMonitoring();
    } else {
      console.log('[PersistentAuth] No valid OAuth tokens found');
    }

    // CRITICAL FIX: Don't block initialization on auto-connect (network calls can hang)
    // Trigger auto-connect in background instead
    console.log('[PersistentAuth] Triggering auto-connect in background (non-blocking)');
    this.attemptAutoConnect().catch(error => {
      console.warn('[PersistentAuth] Background auto-connect failed:', error);
    });

    console.log('[PersistentAuth] ===== AUTHENTICATION SERVICE INITIALIZED =====');
  }

  /**
   * Attempt auto-connection using stored authentication data
   */
  async attemptAutoConnect() {
    await this.ensureAuthStateLoaded().catch(() => {});

    console.log('[PersistentAuth] Debug: Auth cache snapshot:', {
      oauthToken: this.oauthCache?.accessToken ? 'present' : 'missing',
      oauthUser: this.oauthCache?.user?.login || null,
      githubAppInstallation: this.githubAppCache?.installationId || null,
      githubAppToken: this.githubAppCache?.accessToken ? 'present' : 'missing'
    });

    // Only attempt auto-connect once per instance to be respectful to GitHub API
    if (this.autoConnectAttempted) {
      console.log('[PersistentAuth] Auto-connect already attempted for this instance, skipping to avoid API spam');
      return;
    }

    this.autoConnectAttempted = true;
    console.log('[PersistentAuth] Attempting auto-connect (once per page load, GitHub API friendly)');

    // Check user preference for auto-connect
    const allowAutoConnect = this.getAllowAutoConnect();
    console.log('[PersistentAuth] Allow auto-connect:', allowAutoConnect);

    console.log('[PersistentAuth] Attempting auto-connection...');
    this.markAutoConnectAttempted();

    try {
      // First, try GitHub App auto-connect
      console.log('[PersistentAuth] Trying GitHub App auto-connect...');
      const appConnected = await this.attemptAppAutoConnect();
      if (appConnected) {
        console.log('[PersistentAuth] ===== Successfully auto-connected via GitHub App =====');
        console.log('[PersistentAuth] Emitting autoConnected event...');
        this.emit('autoConnected', { method: 'github-app' });
        console.log('[PersistentAuth] Dispatching auth event...');
        this.dispatchAuthEvent('github-app', { autoConnected: true });
        console.log('[PersistentAuth] Events dispatched, UI should update now');
        return;
      }

      if (!allowAutoConnect) {
        console.log('[PersistentAuth] OAuth auto-connect disabled by user preference');
        return;
      }

      // Then, try OAuth auto-connect
      console.log('[PersistentAuth] Trying OAuth auto-connect...');
      const oauthConnected = await this.attemptOAuthAutoConnect();
      if (oauthConnected) {
        console.log('[PersistentAuth] ===== Successfully auto-connected via OAuth =====');
        this.emit('autoConnected', { method: 'oauth' });
        this.dispatchAuthEvent('oauth', { autoConnected: true });
        return;
      }

      console.log('[PersistentAuth] No stored auth data available for auto-connect');

    } catch (error) {
      console.error('[PersistentAuth] Auto-connect failed:', error);
      this.emit('autoConnectError', error);
    }
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
    // No longer needed - using instance-based tracking instead
    this.autoConnectAttempted = true;
  }

  /**
   * Attempt auto-connect using stored GitHub App installation
   */
  async attemptAppAutoConnect() {
    await this.ensureAuthStateLoaded().catch(() => {});
    let appInstallation = this.getAppInstallation();
    if (!appInstallation) {
      console.log('[PersistentAuth] No stored GitHub App installation found; attempting discovery...');
      try {
        // Ask backend for installations associated with this app
        const listResp = await oauthFetch('/api/github/app/installations');
        if (listResp && listResp.ok) {
          const installations = await listResp.json();
          if (Array.isArray(installations) && installations.length > 0) {
            // Prefer most recent (server already sorts), otherwise first
            const selected = installations[0] || installations.find(Boolean);
            const installationId = selected?.id || selected?.installation?.id;
            if (installationId) {
              // Obtain a fresh installation token
              const tokenResp = await oauthFetch('/api/github/app/installation-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ installation_id: installationId })
              });

              if (tokenResp.ok) {
                const tokenData = await tokenResp.json();
                const accessToken = tokenData?.token;

                // Optionally fetch installation details (repos/account)
                let repositories = [];
                let userData = {};
                try {
                  const instResp = await oauthFetch(`/api/github/app/installation/${installationId}`);
                  if (instResp.ok) {
                    const instData = await instResp.json();
                    repositories = Array.isArray(instData?.repositories) ? instData.repositories : [];
                    userData = instData?.account || {};
                  }
                } catch (_) {}

                // Store and proceed as connected
                await this.storeAppInstallation({
                  installationId,
                  accessToken,
                  repositories,
                  userData
                });

                appInstallation = this.getAppInstallation();
                console.log('[PersistentAuth] Discovered and stored GitHub App installation:', installationId);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[PersistentAuth] Installation discovery failed:', e?.message || e);
      }

      if (!appInstallation) {
        // Still nothing; require explicit install
        return false;
      }
    }

    console.log('[PersistentAuth] Found stored GitHub App installation:', {
      installationId: appInstallation.installationId,
      hasAccessToken: !!appInstallation.accessToken,
      repositoryCount: appInstallation.repositories?.length || 0,
      lastUpdated: appInstallation.lastUpdated
    });

    console.log('[PersistentAuth] Attempting to refresh GitHub App token...');

    try {
      // Use oauthFetch directly since it's already imported at the top

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

      await this.storeAppInstallation(updatedInstallation);
      console.log('[PersistentAuth] GitHub App token refreshed successfully');

      // Verify the token works by making a test request
      const isValid = await this.testGitHubAppToken(freshAccessToken);
      if (isValid) {
        console.log('[PersistentAuth] GitHub App token validated successfully');
        return true;
      } else {
        throw new Error('GitHub App token validation failed');
      }

    } catch (error) {
      console.error('[PersistentAuth] GitHub App auto-connect failed:', error);
      // Clear invalid app installation
      await this.clearAppInstallation();
      return false;
    }
  }

  /**
   * Attempt auto-connect using stored OAuth tokens
   */
  async attemptOAuthAutoConnect() {
    if (!this.hasValidTokens()) {
      console.log('[PersistentAuth] No valid OAuth tokens found');
      return false;
    }

    const accessToken = await this.getAccessToken();
    const userData = this.getUserData();
    console.log('[PersistentAuth] Found stored OAuth tokens:', {
      hasAccessToken: !!accessToken,
      tokenLength: accessToken ? accessToken.length : 0,
      hasUserData: !!userData,
      username: userData?.login || 'unknown'
    });

    console.log('[PersistentAuth] Validating OAuth tokens...');

    try {
      // Test token validity
      const isValid = await this.testTokenValidity();
      if (isValid) {
        console.log('[PersistentAuth] OAuth tokens validated successfully');
        return true;
      } else {
        throw new Error('OAuth token validation failed');
      }

    } catch (error) {
      console.error('[PersistentAuth] OAuth auto-connect failed:', error);
      // Clear invalid tokens
      await this.clearTokens();
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
      console.error('[PersistentAuth] GitHub App token test failed:', error);
      return false;
    }
  }

  dispatchAuthEvent(type, payload = {}) {
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('redstring:auth-token-stored', {
          detail: {
            type,
            timestamp: Date.now(),
            ...payload
          }
        }));
      }
    } catch (error) {
      console.warn('[PersistentAuth] Failed to dispatch auth event:', error);
    }
  }

  dispatchConnectedEvent(type, payload = {}) {
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('redstring:auth-connected', {
          detail: {
            type,
            timestamp: Date.now(),
            ...payload
          }
        }));
      }
    } catch (error) {
      console.warn('[PersistentAuth] Failed to dispatch auth connected event:', error);
    }
  }

  async persistOAuthCache() {
    if (!this.oauthCache?.accessToken) {
      return;
    }

    const payload = {
      access_token: this.oauthCache.accessToken,
      refresh_token: this.oauthCache.refreshToken || null,
      scope: this.oauthCache.scope || null,
      token_type: this.oauthCache.tokenType || 'bearer',
      expires_at: this.oauthCache.expiresAt
        ? new Date(this.oauthCache.expiresAt).toISOString()
        : null,
      user: this.oauthCache.user || null
    };

    const response = await oauthFetch('/api/github/auth/oauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Failed to persist OAuth cache (${response.status} ${text})`);
    }
  }

  /**
   * Store OAuth tokens in browser localStorage (keeps user data LOCAL!)
   */
  async storeTokens(tokenData, userData = null) {
    const {
      access_token,
      refresh_token,
      expires_in,
      token_type,
      scope,
      expires_at
    } = tokenData || {};

    if (!access_token) {
      console.error('[PersistentAuth] Cannot store tokens without access_token');
      return false;
    }

    const computedExpiry = expires_at
      ? new Date(expires_at).getTime()
      : (expires_in
        ? Date.now() + (expires_in * 1000)
        : null); // GitHub OAuth tokens don't expire unless explicitly set

    // PRIMARY: Set cache and save to browser localStorage (user data stays local!)
    this.oauthCache = {
      accessToken: access_token,
      refreshToken: refresh_token || null,
      scope: scope || null,
      tokenType: token_type || 'bearer',
      expiresAt: computedExpiry,
      user: userData || null,
      storedAt: Date.now()
    };

    // Save to browser localStorage - this is the PRIMARY storage
    this.saveToBrowserStorage();

    console.log('[PersistentAuth] Tokens stored in browser localStorage', {
      hasAccessToken: true,
      hasRefreshToken: !!refresh_token,
      expiresIn: expires_in,
      expiryTime: computedExpiry ? new Date(computedExpiry).toISOString() : 'never',
      note: 'GitHub tokens do not expire by default - stored locally in your browser'
    });

    // OPTIONAL: Send to server for temporary OAuth completion handoff
    // (Server is stateless and won't persist - this is just for the OAuth callback flow)
    try {
      const payload = {
        access_token,
        refresh_token: refresh_token || null,
        scope: scope || null,
        token_type: token_type || 'bearer',
        expires_at: computedExpiry ? new Date(computedExpiry).toISOString() : null,
        user: userData || null
      };

      await oauthFetch('/api/github/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {
        // Ignore server errors - browser storage is primary
        console.log('[PersistentAuth] Server sync skipped (expected for stateless server)');
      });
    } catch (error) {
      // Don't fail if server sync fails - browser is the source of truth
      console.log('[PersistentAuth] Optional server sync skipped:', error.message);
    }

    this.startHealthMonitoring();

    this.emit('tokenStored', { tokenData, userData });
    this.dispatchAuthEvent('oauth', { user: userData?.login || null });
    this.dispatchConnectedEvent('oauth', { user: userData?.login || null });

    return true;
  }

  /**
   * Get current access token, refreshing if needed
   */
  async getAccessToken() {
    try {
      await this.ensureAuthStateLoaded().catch(() => {});
      const token = this.oauthCache?.accessToken || null;
      if (!token) {
        return null;
      }
      if (this.shouldRefreshToken()) {
        console.log('[PersistentAuth] Token needs validation/refresh');
        await this.refreshAccessToken();
      }
      return this.oauthCache?.accessToken || null;
    } catch (error) {
      console.error('[PersistentAuth] Failed to get access token:', error);
      this.emit('authError', error);
      return null;
    }
  }

  /**
   * Check if we have valid tokens
   */
  hasValidTokens() {
    const accessToken = this.oauthCache?.accessToken || null;
    const expiryTime = this.oauthCache?.expiresAt || null;
    const now = Date.now();
    
    if (!accessToken) return false;
    if (!expiryTime) return true;
    return expiryTime > now;
  }

  /**
   * Check if token should be refreshed
   * For GitHub, we don't typically need to refresh, but we validate instead
   */
  shouldRefreshToken() {
    // GitHub tokens don't expire by default, so we focus on validation
    // We only "refresh" (re-validate) if the token is very old or we've had recent failures
    const expiryTime = this.oauthCache?.expiresAt || null;
    if (!expiryTime) {
      return false;
    }
    const now = Date.now();
    const refreshTime = expiryTime - REFRESH_BUFFER_MS;
    return now >= refreshTime;
  }

  /**
   * "Refresh" access token by validating it and potentially triggering re-auth
   * For GitHub, this is more of a validation + re-auth flow since true refresh isn't supported
   */
  async refreshAccessToken() {
    // Prevent multiple simultaneous refresh attempts
    if (this.isRefreshing) {
      return this.refreshPromise;
    }
    
    this.isRefreshing = true;
    this.refreshPromise = this.performTokenValidation();
    
    try {
      const result = await this.refreshPromise;
      return result;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Validate current token and trigger re-auth if needed
   */
  async performTokenValidation() {
    try {
      // Check if we have a token before attempting validation
      await this.ensureAuthStateLoaded().catch(() => {});
      const accessToken = this.oauthCache?.accessToken || null;
      if (!accessToken || accessToken.trim().length === 0) {
        console.log('[PersistentAuth] No token to validate, skipping validation');
        throw new Error('No token available for validation');
      }
      
      console.log('[PersistentAuth] Validating current token...');
      
      const isValid = await this.testTokenValidity();
      
      if (isValid) {
        // Token is still valid, extend its life
        const newExpiryTime = Date.now() + (365 * 24 * 60 * 60 * 1000); // Another year
        this.oauthCache = {
          ...this.oauthCache,
          expiresAt: newExpiryTime,
          storedAt: Date.now()
        };

        try {
          await this.persistOAuthCache();
        } catch (persistError) {
          console.warn('[PersistentAuth] Failed to persist refreshed token metadata:', persistError);
        }
        
        console.log('[PersistentAuth] Token validation successful, extended expiry');
        this.emit('tokenValidated', { 
          newExpiryTime: new Date(newExpiryTime).toISOString() 
        });
        this.dispatchConnectedEvent('oauth', { refreshed: true });
        
        return { validated: true };
      } else {
        throw new Error('Token validation failed - token is invalid or revoked');
      }
    } catch (error) {
      console.error('[PersistentAuth] Token validation failed:', error);
      
      // Clear invalid tokens and trigger re-authentication
      await this.clearTokens();
      this.emit('authExpired', error);
      this.emit('reAuthRequired', { reason: error.message });
      
      throw error;
    }
  }

  /**
   * Test if current tokens are valid by making a test request
   */
  async testTokenValidity() {
    const accessToken = this.oauthCache?.accessToken || null;
    
    if (!accessToken) {
      console.log('[PersistentAuth] No access token available for validation');
      return false;
    }

    console.log('[PersistentAuth] Testing token validity, token length:', accessToken.length);

    try {
      // Prefer server-side introspection to avoid mixed token types and browser CORS issues
      console.log('[PersistentAuth] Attempting server-side validation...');
      const validateResp = await oauthFetch('/api/github/oauth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken })
      });

      console.log('[PersistentAuth] Server validation response:', validateResp.status, validateResp.statusText);

      if (validateResp.ok) {
        const data = await validateResp.json();
        console.log('[PersistentAuth] Server validation result:', data);
        return !!data.valid;
      } else {
        const errorText = await validateResp.text();
        console.warn('[PersistentAuth] Server validation failed:', validateResp.status, errorText);
      }

      // Fallback to direct GitHub call if server validation unavailable
      console.log('[PersistentAuth] Falling back to direct GitHub validation...');
      try {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `token ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        console.log('[PersistentAuth] Direct GitHub validation response:', response.status, response.statusText);
        if (!response.ok) {
          console.warn('[PersistentAuth] Token validation failed:', response.status);
          if (response.status === 401) return false;
        }
        return response.ok;
      } catch (fallbackErr) {
        console.error('[PersistentAuth] Token validation fallback failed:', fallbackErr);
        return false;
      }
    } catch (error) {
      console.error('[PersistentAuth] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      return; // Already monitoring
    }
    
    console.log('[PersistentAuth] Starting health monitoring');
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        const isValid = await this.testTokenValidity();
        
        this.emit('healthCheck', {
          isValid,
          timestamp: new Date().toISOString(),
          hasTokens: this.hasValidTokens()
        });
        
        if (!isValid) {
          console.warn('[PersistentAuth] Health check failed - tokens invalid');
          this.emit('authDegraded', { reason: 'Token validation failed' });
        }
      } catch (error) {
        console.error('[PersistentAuth] Health check error:', error);
        this.emit('healthCheckError', error);
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[PersistentAuth] Health monitoring stopped');
    }
  }

  /**
   * Clear all stored tokens from browser localStorage
   */
  async clearTokens() {
    // PRIMARY: Clear from browser localStorage (user data stays local!)
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.accessToken);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.refreshToken);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.scope);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.tokenType);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.expiry);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.user);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.oauth.storedAt);

    this.oauthCache = null;

    // OPTIONAL: Clear from server (stateless server doesn't persist anyway)
    try {
      await oauthFetch('/api/github/auth/oauth', { method: 'DELETE' }).catch(() => {});
    } catch (error) {
      console.log('[PersistentAuth] Server clear skipped (expected for stateless server)');
    }

    try {
      this.stopHealthMonitoring();
    } catch (error) {
      console.warn('[PersistentAuth] Failed to stop health monitoring:', error);
    }

    console.log('[PersistentAuth] Tokens cleared from browser localStorage');
    this.emit('tokensCleared');
    this.dispatchAuthEvent('oauth', { hasTokens: false });
    return true;
  }

  /**
   * Get stored user data
   */
  getUserData() {
    return this.oauthCache?.user || null;
  }

  /**
   * Get authentication status
   */
  getAuthStatus() {
    const hasTokens = this.hasValidTokens();
    const needsRefresh = this.shouldRefreshToken();
    const expiryTime = this.oauthCache?.expiresAt || null;
    const hasApp = this.hasAppInstallation();

    // User is authenticated if they have EITHER OAuth tokens OR GitHub App installation
    const isAuthenticated = hasTokens || hasApp;

    return {
      isAuthenticated,
      hasOAuthTokens: hasTokens,
      hasGitHubApp: hasApp,
      needsRefresh,
      expiryTime: expiryTime ? new Date(expiryTime) : null,
      timeToExpiry: expiryTime ? Math.max(0, expiryTime - Date.now()) : 0,
      authMethod: hasTokens ? 'oauth' : (hasApp ? 'github-app' : null),
      userData: this.getUserData(),
      isRefreshing: this.isRefreshing
    };
  }

  /**
   * Event handling
   */
  on(eventName, callback) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName).push(callback);
  }

  off(eventName, callback) {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(eventName, data) {
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[PersistentAuth] Event listener error for ${eventName}:`, error);
      }
    });
  }

  /**
   * Store GitHub App installation data in browser localStorage (keeps user data LOCAL!)
   */
  async storeAppInstallation(installationData = {}) {
    const {
      installationId,
      accessToken = null,
      repositories = [],
      userData = {},
      permissions = null,
      tokenExpiresAt = null,
      lastUpdated = Date.now(),
      verification = null
    } = installationData;

    if (!installationId) {
      throw new Error('installationId is required');
    }

    // PRIMARY: Set cache and save to browser localStorage (user data stays local!)
    const expiresNumeric = tokenExpiresAt != null ? Number(tokenExpiresAt) : null;
    this.githubAppCache = {
      installationId,
      accessToken,
      repositories: Array.isArray(repositories) ? repositories : [],
      userData: userData || {},
      permissions,
      tokenExpiresAt: Number.isFinite(expiresNumeric) ? expiresNumeric : null,
      verification: verification || null,
      lastUpdated: lastUpdated || Date.now()
    };

    // Save to browser localStorage - this is the PRIMARY storage
    this.saveToBrowserStorage();

    console.log('[PersistentAuth] GitHub App installation stored in browser localStorage');

    // OPTIONAL: Send to server for temporary handoff (server is stateless)
    try {
      await oauthFetch('/api/github/auth/github-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId,
          accessToken,
          repositories,
          account: userData || null,
          permissions,
          tokenExpiresAt: tokenExpiresAt
            ? new Date(tokenExpiresAt).toISOString()
            : null,
          verification: verification || null
        })
      }).catch(() => {
        console.log('[PersistentAuth] Server sync skipped (expected for stateless server)');
      });
    } catch (error) {
      // Don't fail if server sync fails - browser is the source of truth
      console.log('[PersistentAuth] Optional server sync skipped:', error.message);
    }

    this.emit('appInstallationStored', this.githubAppCache);
    this.dispatchAuthEvent('github-app', {
      installationId,
      repositoryCount: this.githubAppCache.repositories.length
    });
    this.dispatchConnectedEvent('github-app', {
      installationId,
      repositoryCount: this.githubAppCache.repositories.length
    });
  }

  /**
   * Get stored GitHub App installation data
   */
  getAppInstallation() {
    if (!this.authStateLoaded && !this.authStateLoadingPromise) {
      this.ensureAuthStateLoaded().catch(() => {});
    }
    return this.githubAppCache;
  }

  /**
   * Check if we have a valid GitHub App installation
   */
  hasAppInstallation() {
    const installation = this.getAppInstallation();
    return !!(installation?.installationId);
  }

  /**
   * Clear GitHub App installation data from browser localStorage
   */
  async clearAppInstallation() {
    // PRIMARY: Clear from browser localStorage (user data stays local!)
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.app.installationId);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.app.accessToken);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.app.repositories);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.app.userData);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.app.permissions);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.app.tokenExpiresAt);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.app.lastUpdated);

    this.githubAppCache = null;

    // OPTIONAL: Clear from server (stateless server doesn't persist anyway)
    try {
      await oauthFetch('/api/github/auth/github-app', { method: 'DELETE' }).catch(() => {});
    } catch (error) {
      console.log('[PersistentAuth] Server clear skipped (expected for stateless server)');
    }

    console.log('[PersistentAuth] GitHub App installation cleared from browser localStorage');
    this.emit('appInstallationCleared');
    this.dispatchAuthEvent('github-app', { hasInstallation: false });
  }

  /**
   * Get comprehensive authentication status including GitHub App
   */
  getComprehensiveAuthStatus() {
    const oauthStatus = this.getAuthStatus();
    const appInstallation = this.getAppInstallation();

    return {
      ...oauthStatus,
      githubApp: {
        isInstalled: this.hasAppInstallation(),
        installation: appInstallation
      }
    };
  }

  /**
   * Force re-attempt auto-connect (for debugging/testing)
   */
  async forceAutoConnect() {
    console.log('[PersistentAuth] Force auto-connect triggered - resetting attempt flag');
    this.autoConnectAttempted = false;
    return this.attemptAutoConnect();
  }

  /**
   * Cleanup when not needed
   */
  destroy() {
    this.stopHealthMonitoring();
    this.eventListeners.clear();
    console.log('[PersistentAuth] Service destroyed');
  }
}

// Export singleton instance
export const persistentAuth = new PersistentAuth();

// Export utility functions
export const getAccessToken = () => persistentAuth.getAccessToken();
export const hasValidTokens = () => persistentAuth.hasValidTokens();
export const getAuthStatus = () => persistentAuth.getAuthStatus();
export const clearTokens = () => persistentAuth.clearTokens();
export const forceAutoConnect = () => persistentAuth.forceAutoConnect();
