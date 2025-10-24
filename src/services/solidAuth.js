/**
 * Solid Pod Authentication Service
 * Handles WebID authentication and session management for Solid Pods
 */

import { 
  login, 
  logout, 
  handleIncomingRedirect, 
  getDefaultSession,
  fetch as authenticatedFetch
} from '@inrupt/solid-client-authn-browser';

class SolidAuthService {
  constructor() {
    this.session = getDefaultSession();
    this.sessionCallbacks = new Set();
    
    // Note: Solid session doesn't have built-in event listeners
    // We'll handle session changes through manual polling and explicit calls
  }

  /**
   * Subscribe to session state changes
   * @param {Function} callback - Called when session state changes
   * @returns {Function} - Unsubscribe function
   */
  onSessionChange(callback) {
    this.sessionCallbacks.add(callback);
    return () => this.sessionCallbacks.delete(callback);
  }

  notifySessionChange() {
    this.sessionCallbacks.forEach(callback => {
      try {
        callback(this.getSessionInfo());
      } catch (error) {
        console.error('[SolidAuth] Error in session change callback:', error);
      }
    });
  }

  /**
   * Get current session information
   * @returns {Object} Session info
   */
  getSessionInfo() {
    return {
      isLoggedIn: this.session.info.isLoggedIn,
      webId: this.session.info.webId,
      sessionId: this.session.info.sessionId,
      clientAppId: this.session.info.clientAppId
    };
  }

  /**
   * Start login process
   * @param {string} oidcIssuer - The Solid Identity Provider URL
   * @param {string} [clientName] - Optional client name for display
   * @returns {Promise<void>}
   */
  async startLogin(oidcIssuer, clientName = 'Redstring') {
    try {
      await login({
        oidcIssuer,
        redirectUrl: new URL('/callback', window.location.href).toString(),
        clientName,
        // Handle session restore
        handleIncomingRedirect: false
      });
    } catch (error) {
      console.error('[SolidAuth] Login failed:', error);
      throw new Error(`Failed to start login: ${error.message}`);
    }
  }

  /**
   * Handle the redirect from Solid Identity Provider
   * This should be called on page load to complete login
   * @returns {Promise<void>}
   */
  async handleRedirect() {
    try {
      await handleIncomingRedirect({
        restorePreviousSession: true
      });
      this.notifySessionChange();
    } catch (error) {
      console.error('[SolidAuth] Failed to handle redirect:', error);
      throw new Error(`Failed to handle login redirect: ${error.message}`);
    }
  }

  /**
   * Logout from Solid Pod
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      await logout();
      this.notifySessionChange();
    } catch (error) {
      console.error('[SolidAuth] Logout failed:', error);
      throw new Error(`Failed to logout: ${error.message}`);
    }
  }

  /**
   * Get authenticated fetch function for making requests to Solid Pods
   * @returns {Function} Authenticated fetch function
   */
  getAuthenticatedFetch() {
    if (!this.session.info.isLoggedIn) {
      throw new Error('Not logged in to Solid Pod');
    }
    return authenticatedFetch;
  }

  /**
   * Check if user is currently logged in
   * @returns {boolean}
   */
  isLoggedIn() {
    return this.session.info.isLoggedIn;
  }

  /**
   * Get the current user's WebID
   * @returns {string|null} WebID or null if not logged in
   */
  getWebId() {
    return this.session.info.webId || null;
  }

  /**
   * Extract Pod URL from WebID
   * @param {string} webId - The WebID to extract Pod URL from
   * @returns {string} Pod URL
   */
  extractPodUrl(webId = this.getWebId()) {
    if (!webId) return null;
    
    try {
      const url = new URL(webId);
      // Most WebIDs follow the pattern: https://pod.example.com/profile/card#me
      // Pod URL would be: https://pod.example.com/
      return `${url.protocol}//${url.host}/`;
    } catch (error) {
      console.error('[SolidAuth] Failed to extract Pod URL from WebID:', webId, error);
      return null;
    }
  }

  /**
   * Manually check and notify session changes
   * This can be called periodically or after specific actions
   */
  checkSessionStatus() {
    this.notifySessionChange();
  }
}

// Create and export singleton instance
export const solidAuth = new SolidAuthService();
export default solidAuth; 