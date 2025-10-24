/**
 * GitHub App Authentication Service
 * 
 * Provides reliable, long-lived authentication using GitHub Apps
 * instead of traditional OAuth tokens that expire.
 */

import { Octokit } from '@octokit/rest';
import { getOAuthBaseUrl, oauthUrl } from './bridgeConfig.js';

// GitHub App configuration (loaded from environment)
const GITHUB_APP_CONFIG = {
  appId: null, // Set via environment variable
  clientId: null, // Set via environment variable
  clientSecret: null, // Set via environment variable
  privateKey: null, // Set via environment variable (PEM format)
  installationId: null // Stored after user installation
};

export class GitHubAppAuth {
  constructor(config = {}) {
    this.appId = config.appId || process.env.VITE_GITHUB_APP_ID;
    this.clientId = config.clientId || process.env.VITE_GITHUB_APP_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.GITHUB_APP_CLIENT_SECRET;
    this.privateKey = config.privateKey || process.env.GITHUB_APP_PRIVATE_KEY;
    
    this.installations = new Map(); // Cache installations and tokens
    this.tokenCache = new Map(); // Cache access tokens with expiry
    
    console.log('[GitHubApp] Service initialized', {
      hasAppId: !!this.appId,
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret,
      hasPrivateKey: !!this.privateKey
    });
  }

  /**
   * Check if GitHub App is properly configured
   */
  isConfigured() {
    return !!(this.appId && this.clientId && this.privateKey);
  }

  /**
   * Generate JWT for GitHub App authentication
   * Valid for 10 minutes, used to authenticate as the app
   */
  generateAppJWT() {
    if (!this.appId || !this.privateKey) {
      throw new Error('GitHub App ID and private key are required');
    }

    // For browser environment, we need to handle JWT generation differently
    // In production, this should be done server-side for security
    if (typeof window !== 'undefined') {
      console.warn('[GitHubApp] JWT generation should be done server-side in production');
      throw new Error('JWT generation not supported in browser environment - use server-side endpoint');
    }

    try {
      // This would work in Node.js environment
      const jwt = require('jsonwebtoken');
      
      const payload = {
        iat: Math.floor(Date.now() / 1000) - 60, // Issued 1 minute ago (clock skew)
        exp: Math.floor(Date.now() / 1000) + (10 * 60), // Expires in 10 minutes
        iss: this.appId // GitHub App ID
      };

      return jwt.sign(payload, this.privateKey, { algorithm: 'RS256' });
    } catch (error) {
      console.error('[GitHubApp] Failed to generate JWT:', error);
      throw new Error(`JWT generation failed: ${error.message}`);
    }
  }

  /**
   * Get GitHub App installation URL for user installation
   */
  getInstallationUrl(repositoryIds = null) {
    if (!this.clientId) {
      throw new Error('GitHub App client ID is required');
    }

    const baseUrl = `https://github.com/apps/${this.getAppSlug()}/installations/new`;
    const params = new URLSearchParams({
      state: Math.random().toString(36).substring(7) // Random state for security
    });

    if (repositoryIds && repositoryIds.length > 0) {
      params.set('repository_ids[]', repositoryIds.join(','));
    }

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Get app slug from client ID (simplified approach)
   * In production, this should be configurable
   */
  getAppSlug() {
    return 'redstring-semantic-sync'; // This should match your actual GitHub App slug
  }

  /**
   * Exchange installation code for installation details
   * This happens after user installs the app
   */
  async handleInstallationCallback(code, installationId, setupAction) {
    console.log('[GitHubApp] Handling installation callback', {
      hasCode: !!code,
      installationId,
      setupAction
    });

    if (setupAction !== 'install') {
      console.log('[GitHubApp] Setup action is not install:', setupAction);
      return null;
    }

    try {
      // Store installation ID for future use
      this.storeInstallationId(installationId);

      // Get installation details and repositories
      const installationData = await this.getInstallationData(installationId);
      
      console.log('[GitHubApp] Installation successful', {
        installationId,
        repositoryCount: installationData.repositories?.length || 0,
        account: installationData.account?.login
      });

      return {
        installationId,
        repositories: installationData.repositories || [],
        account: installationData.account,
        permissions: installationData.permissions
      };
    } catch (error) {
      console.error('[GitHubApp] Installation callback failed:', error);
      throw new Error(`Installation callback failed: ${error.message}`);
    }
  }

  /**
   * Get installation access token (valid for 1 hour, auto-renewable)
   * This is the token used for API calls
   */
  async getInstallationAccessToken(installationId) {
    const cacheKey = `installation_${installationId}`;
    
    // Check cache first
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + (5 * 60 * 1000)) { // 5 min buffer
      console.log('[GitHubApp] Using cached installation token');
      return cached.token;
    }

    try {
      console.log('[GitHubApp] Requesting new installation token for:', installationId);
      
      // This needs to be done server-side with the app's private key
      const response = await this.serverRequest('/api/github/app/installation-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installation_id: installationId })
      });

      if (!response.ok) {
        throw new Error(`Failed to get installation token: ${response.status}`);
      }

      const data = await response.json();
      const token = data.token;
      const expiresAt = new Date(data.expires_at).getTime();

      // Cache the token
      this.tokenCache.set(cacheKey, {
        token,
        expiresAt,
        installationId
      });

      console.log('[GitHubApp] Installation token obtained and cached');
      return token;
    } catch (error) {
      console.error('[GitHubApp] Failed to get installation token:', error);
      throw new Error(`Installation token request failed: ${error.message}`);
    }
  }

  /**
   * Get installation data including repositories
   */
  async getInstallationData(installationId) {
    try {
      const response = await this.serverRequest(`/api/github/app/installation/${installationId}`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Failed to get installation data: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[GitHubApp] Failed to get installation data:', error);
      throw new Error(`Installation data request failed: ${error.message}`);
    }
  }

  /**
   * Get repositories accessible by the installation
   */
  async getInstallationRepositories(installationId) {
    try {
      const token = await this.getInstallationAccessToken(installationId);
      const octokit = new Octokit({ auth: token });

      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: 100
      });

      return data.repositories.map(repo => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        private: repo.private,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        default_branch: repo.default_branch,
        permissions: repo.permissions
      }));
    } catch (error) {
      console.error('[GitHubApp] Failed to get installation repositories:', error);
      throw new Error(`Repository list request failed: ${error.message}`);
    }
  }

  /**
   * Create Octokit instance authenticated as installation
   */
  async createInstallationOctokit(installationId) {
    const token = await this.getInstallationAccessToken(installationId);
    return new Octokit({ auth: token });
  }

  /**
   * Test installation connectivity
   */
  async testInstallationConnection(installationId) {
    try {
      const octokit = await this.createInstallationOctokit(installationId);
      
      // Try to get installation info
      await octokit.rest.apps.getInstallation({
        installation_id: installationId
      });

      return { connected: true, error: null };
    } catch (error) {
      console.error('[GitHubApp] Installation connection test failed:', error);
      return { 
        connected: false, 
        error: error.message,
        needsReinstall: error.status === 404
      };
    }
  }

  /**
   * Store installation ID locally
   */
  storeInstallationId(installationId) {
    try {
      localStorage.setItem('github_app_installation_id', installationId.toString());
      console.log('[GitHubApp] Installation ID stored:', installationId);
    } catch (error) {
      console.warn('[GitHubApp] Failed to store installation ID:', error);
    }
  }

  /**
   * Get stored installation ID
   */
  getStoredInstallationId() {
    try {
      const stored = localStorage.getItem('github_app_installation_id');
      return stored ? parseInt(stored, 10) : null;
    } catch (error) {
      console.warn('[GitHubApp] Failed to get stored installation ID:', error);
      return null;
    }
  }

  /**
   * Clear stored installation data
   */
  clearInstallationData() {
    try {
      localStorage.removeItem('github_app_installation_id');
      this.tokenCache.clear();
      console.log('[GitHubApp] Installation data cleared');
    } catch (error) {
      console.warn('[GitHubApp] Failed to clear installation data:', error);
    }
  }

  /**
   * Make server request (helper for server-side operations)
   */
  async serverRequest(path, options = {}) {
    // Use OAuth server infrastructure for GitHub App endpoints
    const url = oauthUrl(path);

    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  }

  /**
   * Get server base URL for GitHub App operations
   */
  getServerBaseUrl() {
    return getOAuthBaseUrl();
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    const installationId = this.getStoredInstallationId();
    const hasCachedToken = installationId && this.tokenCache.has(`installation_${installationId}`);
    
    return {
      isConfigured: this.isConfigured(),
      hasInstallation: !!installationId,
      installationId,
      hasCachedToken,
      authMethod: 'github_app'
    };
  }

  /**
   * Create a provider-compatible interface
   * This allows GitHub App auth to work with existing provider system
   */
  createProviderInterface(installationId, repositoryName) {
    return {
      name: 'GitHub App',
      type: 'github_app',
      installationId,
      repositoryName,
      
      // Provider interface methods
      isAvailable: async () => {
        const test = await this.testInstallationConnection(installationId);
        return test.connected;
      },
      
      // Get authenticated Octokit instance for repository operations
      getOctokit: () => this.createInstallationOctokit(installationId),
      
      // Additional GitHub App specific methods
      getAccessToken: () => this.getInstallationAccessToken(installationId),
      getRepositories: () => this.getInstallationRepositories(installationId)
    };
  }
}

// Export singleton instance
export const githubAppAuth = new GitHubAppAuth();

// Export utility functions
export const getInstallationUrl = (repositoryIds) => 
  githubAppAuth.getInstallationUrl(repositoryIds);

export const handleInstallationCallback = (code, installationId, setupAction) => 
  githubAppAuth.handleInstallationCallback(code, installationId, setupAction);

export const getConnectionStatus = () => 
  githubAppAuth.getConnectionStatus();

export const createProviderInterface = (installationId, repositoryName) =>
  githubAppAuth.createProviderInterface(installationId, repositoryName);
