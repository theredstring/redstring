/**
 * GitHub API Wrapper with timeout and retry logic
 * Fixes authentication and hanging request issues in cloud deployments
 */

import { persistentAuth } from './persistentAuth.js';

export class GitHubAPIWrapper {
  constructor() {
    this.DEFAULT_TIMEOUT = 15000; // 15 seconds for cloud deployments
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY = 1000; // Start with 1s, exponential backoff
  }

  /**
   * Make a GitHub API request with timeout and retry logic
   */
  async request(url, options = {}, timeout = this.DEFAULT_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[GitHubAPIWrapper] Request timeout after ${timeout}ms:`, url);
      controller.abort();
    }, timeout);

    try {
      // Ensure we have proper auth headers
      const authHeaders = await this.getAuthHeaders();
      const finalOptions = {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          ...authHeaders,
          ...options.headers
        }
      };

      console.log(`[GitHubAPIWrapper] Making request to:`, url.replace(/\/repos\/[^\/]+\/[^\/]+/, '/repos/****/****'));

      const response = await fetch(url, finalOptions);
      clearTimeout(timeoutId);

      // Check for authentication issues
      if (response.status === 401) {
        console.error('[GitHubAPIWrapper] Authentication failed - token may be invalid');
        await this.handleAuthError();
        throw new Error('GitHub authentication failed - please re-authenticate');
      }

      // Check for rate limiting
      if (response.status === 403) {
        const resetTime = response.headers.get('X-RateLimit-Reset');
        const remaining = response.headers.get('X-RateLimit-Remaining');

        console.warn(`[GitHubAPIWrapper] Rate limited. Remaining: ${remaining}, Reset: ${resetTime}`);

        if (resetTime) {
          const resetDate = new Date(parseInt(resetTime) * 1000);
          const waitTime = Math.max(0, resetDate.getTime() - Date.now());
          throw new Error(`Rate limited. Try again in ${Math.ceil(waitTime / 1000)}s`);
        }

        throw new Error('GitHub API rate limit exceeded');
      }

      // Check for other errors
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[GitHubAPIWrapper] API error ${response.status}:`, errorText);
        throw new Error(`GitHub API error ${response.status}: ${errorText}`);
      }

      return response;

    } catch (error) {
      clearTimeout(timeoutId);

      // Handle specific error types
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      if (error.message.includes('Failed to fetch')) {
        throw new Error('Network error - check your internet connection');
      }

      throw error;
    }
  }

  /**
   * Make request with automatic retry logic
   */
  async requestWithRetry(url, options = {}, maxRetries = this.MAX_RETRIES) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[GitHubAPIWrapper] Attempt ${attempt}/${maxRetries} for:`, url.replace(/\/repos\/[^\/]+\/[^\/]+/, '/repos/****/****'));
        return await this.request(url, options);
      } catch (error) {
        lastError = error;
        console.warn(`[GitHubAPIWrapper] Attempt ${attempt} failed:`, error.message);

        // Don't retry auth errors or rate limits
        if (error.message.includes('authentication') || error.message.includes('rate limit')) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
        console.log(`[GitHubAPIWrapper] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Get authentication headers
   */
  async getAuthHeaders() {
    if (persistentAuth.readyPromise) {
      await persistentAuth.readyPromise.catch(() => {});
    }

    let appInstallation = persistentAuth.getAppInstallation();
    if (appInstallation?.installationId) {
      const expiresAt = appInstallation.tokenExpiresAt || null;
      const tokenStillValid = !expiresAt || expiresAt > Date.now() + (2 * 60 * 1000);
      if (!tokenStillValid) {
        try {
          await persistentAuth.attemptAppAutoConnect();
          appInstallation = persistentAuth.getAppInstallation();
        } catch (error) {
          console.warn('[GitHubAPIWrapper] Failed to refresh GitHub App token:', error);
        }
      }

      if (appInstallation?.accessToken) {
        console.log('[GitHubAPIWrapper] Using GitHub App token');
        return { 'Authorization': `token ${appInstallation.accessToken}` };
      }
    }

    const accessToken = await persistentAuth.getAccessToken();
    if (accessToken) {
      console.log('[GitHubAPIWrapper] Using OAuth token');
      return { 'Authorization': `token ${accessToken}` };
    }

    console.warn('[GitHubAPIWrapper] No authentication token available');
    throw new Error('No GitHub authentication token available');
  }

  /**
   * Handle authentication errors
   */
  async handleAuthError() {
    console.log('[GitHubAPIWrapper] Clearing invalid tokens...');

    try {
      await persistentAuth.clearTokens();
    } catch (error) {
      console.warn('[GitHubAPIWrapper] Failed to clear OAuth tokens:', error);
    }

    try {
      await persistentAuth.clearAppInstallation();
    } catch (error) {
      console.warn('[GitHubAPIWrapper] Failed to clear GitHub App installation:', error);
    }

    // Dispatch event to notify other components
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('redstring:auth-error', {
        detail: { message: 'Authentication failed, tokens cleared' }
      }));
    }
  }

  /**
   * Check if authentication is available
   */
  hasValidAuth() {
    return persistentAuth.hasValidTokens() || persistentAuth.hasAppInstallation();
  }

  /**
   * Test connection to GitHub API
   */
  async testConnection() {
    try {
      const response = await this.request('https://api.github.com/user');
      const userData = await response.json();
      console.log('[GitHubAPIWrapper] Connection test successful:', userData.login);
      return { success: true, user: userData };
    } catch (error) {
      console.error('[GitHubAPIWrapper] Connection test failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export const githubAPI = new GitHubAPIWrapper();
export default githubAPI;
