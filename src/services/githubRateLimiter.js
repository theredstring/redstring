/**
 * GitHub API Rate Limiter
 * Tracks API usage across all GitSyncEngines to prevent exceeding limits
 * GitHub Free Plan: 5,000 requests/hour per authentication method
 */

class GitHubRateLimiter {
  constructor() {
    this.requests = new Map(); // authMethod -> { count, windowStart, lastRequest }
    this.windowDuration = 3600000; // 1 hour in milliseconds
    this.limits = {
      'github-app': 4500, // Conservative limit for GitHub App (5000 - 500 buffer)
      'oauth': 4500, // Conservative limit for OAuth (5000 - 500 buffer)
      'token': 4500 // Conservative limit for personal tokens
    };
  }

  // Check if we can make a request
  canMakeRequest(authMethod = 'oauth') {
    const now = Date.now();
    const requestData = this.requests.get(authMethod) || { 
      count: 0, 
      windowStart: now, 
      lastRequest: 0 
    };

    // Reset window if it's been more than an hour
    if (now - requestData.windowStart >= this.windowDuration) {
      requestData.count = 0;
      requestData.windowStart = now;
    }

    const limit = this.limits[authMethod] || this.limits.oauth;
    const canMake = requestData.count < limit;
    
    // Add minimum delay between requests (250ms) to prevent API abuse
    const timeSinceLastRequest = now - requestData.lastRequest;
    const hasMinDelay = timeSinceLastRequest >= 250;
    
    return canMake && hasMinDelay;
  }

  // Record a request
  recordRequest(authMethod = 'oauth') {
    const now = Date.now();
    const requestData = this.requests.get(authMethod) || { 
      count: 0, 
      windowStart: now, 
      lastRequest: 0 
    };

    // Reset window if needed
    if (now - requestData.windowStart >= this.windowDuration) {
      requestData.count = 0;
      requestData.windowStart = now;
    }

    requestData.count++;
    requestData.lastRequest = now;
    this.requests.set(authMethod, requestData);

    const limit = this.limits[authMethod] || this.limits.oauth;
    const remaining = limit - requestData.count;
    
    if (remaining < 100) {
      console.warn(`[GitHubRateLimiter] API usage high for ${authMethod}: ${requestData.count}/${limit} (${remaining} remaining)`);
    }

    return {
      used: requestData.count,
      limit,
      remaining,
      resetTime: requestData.windowStart + this.windowDuration
    };
  }

  // Get current usage stats
  getUsageStats(authMethod = 'oauth') {
    const now = Date.now();
    const requestData = this.requests.get(authMethod) || { 
      count: 0, 
      windowStart: now, 
      lastRequest: 0 
    };

    // Reset window if needed
    if (now - requestData.windowStart >= this.windowDuration) {
      requestData.count = 0;
      requestData.windowStart = now;
    }

    const limit = this.limits[authMethod] || this.limits.oauth;
    return {
      used: requestData.count,
      limit,
      remaining: limit - requestData.count,
      resetTime: requestData.windowStart + this.windowDuration,
      percentUsed: (requestData.count / limit) * 100
    };
  }

  // Wait until we can make a request
  async waitForAvailability(authMethod = 'oauth') {
    if (this.canMakeRequest(authMethod)) {
      return; // Can make request immediately
    }

    const stats = this.getUsageStats(authMethod);
    const now = Date.now();
    
    // If we've hit the hourly limit, wait until reset
    if (stats.remaining <= 0) {
      const waitTime = stats.resetTime - now;
      console.warn(`[GitHubRateLimiter] Rate limit exceeded for ${authMethod}, waiting ${Math.round(waitTime / 60000)} minutes until reset`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return;
    }

    // Otherwise, just wait the minimum delay
    const requestData = this.requests.get(authMethod);
    if (requestData) {
      const timeSinceLastRequest = now - requestData.lastRequest;
      if (timeSinceLastRequest < 250) {
        await new Promise(resolve => setTimeout(resolve, 250 - timeSinceLastRequest));
      }
    }
  }
}

// Export singleton instance
export const githubRateLimiter = new GitHubRateLimiter();
export default githubRateLimiter;
