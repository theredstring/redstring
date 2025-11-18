/**
 * Client-side User Tracking
 * Tracks user actions in the browser and sends to analytics API
 */

class UserTracking {
  constructor() {
    this.userId = null;
    this.userLogin = null;
    this.sessionId = null;
    this.lastActivity = Date.now();
    this.activityQueue = [];
    this.flushInterval = null;
    
    // Load user info from localStorage
    this.loadUserInfo();
    
    // Track page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.track('page_visible');
      } else {
        this.track('page_hidden');
      }
    });
    
    // Track page unload
    window.addEventListener('beforeunload', () => {
      this.track('page_unload', {}, true);
    });
    
    // Flush queue periodically (every 30 seconds)
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 30000);
  }

  loadUserInfo() {
    try {
      const userData = localStorage.getItem('github_user_data');
      if (userData) {
        const user = JSON.parse(userData);
        this.userId = String(user.id);
        this.userLogin = user.login;
      }
    } catch (error) {
      console.debug('[UserTracking] Failed to load user info:', error);
    }
  }

  /**
   * Track a user action
   * @param {string} action - Action name (e.g., 'node_created', 'graph_saved')
   * @param {Object} metadata - Additional metadata
   * @param {boolean} immediate - Send immediately (don't queue)
   */
  track(action, metadata = {}, immediate = false) {
    const activity = {
      action,
      metadata,
      timestamp: Date.now(),
      userId: this.userId,
      userLogin: this.userLogin,
      path: window.location.pathname,
      url: window.location.href
    };

    this.lastActivity = Date.now();

    if (immediate) {
      this.sendActivity(activity);
    } else {
      this.activityQueue.push(activity);
      
      // Auto-flush if queue gets large
      if (this.activityQueue.length >= 10) {
        this.flush();
      }
    }
  }

  /**
   * Send activity to analytics API
   */
  async sendActivity(activity) {
    try {
      // Try to get the base URL from environment or current location
      const baseUrl = import.meta.env.VITE_API_URL || 
                     window.location.origin;
      
      await fetch(`${baseUrl}/api/analytics/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(activity),
        keepalive: true // Important for beforeunload events
      });
    } catch (error) {
      console.debug('[UserTracking] Failed to send activity:', error);
    }
  }

  /**
   * Flush queued activities
   */
  async flush() {
    if (this.activityQueue.length === 0) return;

    const activities = [...this.activityQueue];
    this.activityQueue = [];

    for (const activity of activities) {
      await this.sendActivity(activity);
    }
  }

  /**
   * Update user info (called after OAuth login)
   */
  updateUser(userId, userLogin) {
    this.userId = String(userId);
    this.userLogin = userLogin;
    this.track('user_identified', { userId, userLogin });
  }

  /**
   * Track page view
   */
  trackPageView() {
    this.track('page_view', {
      path: window.location.pathname,
      referrer: document.referrer
    });
  }

  /**
   * Track custom event
   */
  trackEvent(eventName, properties = {}) {
    this.track(eventName, properties);
  }
}

// Create singleton instance
const userTracking = new UserTracking();

// Track initial page view
if (document.readyState === 'complete') {
  userTracking.trackPageView();
} else {
  window.addEventListener('load', () => {
    userTracking.trackPageView();
  });
}

export default userTracking;




