/**
 * Debug Logger Utility
 * Provides a centralized way to log debug events to the MCP server
 * with automatic error suppression and availability checking
 * Works in both browser and Node.js environments
 */

// Check if we're in Node.js environment
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

// Cache for server availability to avoid repeated checks
// Try to restore from sessionStorage to persist across page reloads
function loadDebugServerHealth() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem('redstring_debug_server_health');
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        // Only use stored data if cooldown is still active
        if (parsed.cooldownUntil > now) {
          return {
            isAvailable: false,
            lastChecked: parsed.lastChecked || 0,
            checkInterval: 30000,
            cooldownUntil: parsed.cooldownUntil,
            consecutiveFailures: parsed.consecutiveFailures || 0
          };
        }
      }
    }
  } catch (e) {
    // Ignore storage errors
  }
  return {
    isAvailable: false,
    lastChecked: 0,
    checkInterval: 30000,
    cooldownUntil: 0,
    consecutiveFailures: 0
  };
}

function saveDebugServerHealth(health) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('redstring_debug_server_health', JSON.stringify({
        lastChecked: health.lastChecked,
        cooldownUntil: health.cooldownUntil,
        consecutiveFailures: health.consecutiveFailures
      }));
    }
  } catch (e) {
    // Ignore storage errors
  }
}

let serverAvailabilityCache = loadDebugServerHealth();

// On module load, do a quick async check to see if server is available
// This prevents the first request from being made if server is known to be down
if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
  // Check server availability in the background
  (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`${DEBUG_SERVER_URL}/health`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        serverAvailabilityCache.isAvailable = true;
        serverAvailabilityCache.consecutiveFailures = 0;
        serverAvailabilityCache.cooldownUntil = 0;
      } else {
        // Server responded but with error - mark as unavailable
        serverAvailabilityCache.isAvailable = false;
        serverAvailabilityCache.cooldownUntil = Date.now() + 300000; // 5 min cooldown
        saveDebugServerHealth(serverAvailabilityCache);
      }
    } catch (error) {
      // Server not available - set cooldown immediately
      serverAvailabilityCache.isAvailable = false;
      serverAvailabilityCache.consecutiveFailures = 1;
      serverAvailabilityCache.cooldownUntil = Date.now() + 300000; // 5 min cooldown
      serverAvailabilityCache.lastChecked = Date.now();
      saveDebugServerHealth(serverAvailabilityCache);
    }
  })();
}

// Universe ID for debug logging (can be configured)
const DEFAULT_UNIVERSE_ID = '52d0fe28-158e-49a4-b331-f013fcb14181';
const DEBUG_SERVER_URL = 'http://127.0.0.1:7242';

/**
 * Check if the debug logging server is available
 * Uses a cache to avoid excessive checks
 * Works in both browser and Node.js
 */
async function checkServerAvailability() {
  const now = Date.now();
  
  // Use cached result if recent
  if (now - serverAvailabilityCache.lastChecked < serverAvailabilityCache.checkInterval) {
    return serverAvailabilityCache.isAvailable;
  }

  // Check server availability
  try {
    // AbortController is available in Node.js 15+ and all modern browsers
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500); // 500ms timeout
    
    const response = await fetch(`${DEBUG_SERVER_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    serverAvailabilityCache.isAvailable = response.ok;
    serverAvailabilityCache.lastChecked = now;
    return response.ok;
  } catch (error) {
    // Server not available - silently fail
    serverAvailabilityCache.isAvailable = false;
    serverAvailabilityCache.lastChecked = now;
    return false;
  }
}

/**
 * Log a debug event to the MCP server
 * Silently fails if server is not available
 * 
 * @param {string} location - Location identifier (e.g., 'NodeCanvas.jsx:handleWheel')
 * @param {string} message - Log message
 * @param {object} data - Additional data to log
 * @param {string} sessionId - Session identifier (optional)
 * @param {string} hypothesisId - Hypothesis identifier (optional)
 */
export async function debugLog(location, message, data = {}, sessionId = 'debug-session', hypothesisId = null) {
  // Only attempt logging if server might be available
  // Check availability asynchronously without blocking
  checkServerAvailability().then(isAvailable => {
    if (!isAvailable) {
      return; // Silently skip if server not available
    }

    // Attempt to send log (with silent error handling)
    fetch(`${DEBUG_SERVER_URL}/ingest/${DEFAULT_UNIVERSE_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location,
        message,
        data,
        timestamp: Date.now(),
        sessionId,
        hypothesisId
      })
    }).catch(() => {
      // Silently handle errors - don't log to console
      // Update cache to mark server as unavailable
      serverAvailabilityCache.isAvailable = false;
      serverAvailabilityCache.lastChecked = Date.now();
    });
  }).catch(() => {
    // Silently handle promise rejection
  });
}

/**
 * Synchronous version that doesn't check availability first
 * Use this for high-frequency events where we want minimal overhead
 * Still silently handles errors
 * Works in both browser and Node.js
 */
export function debugLogSync(location, message, data = {}, sessionId = 'debug-session', hypothesisId = null) {
  // Silently skip if fetch is not available (shouldn't happen in modern environments)
  if (typeof fetch === 'undefined') {
    return;
  }

  const now = Date.now();
  
  // If we're in cooldown, don't make the request at all (prevents browser console errors)
  if (serverAvailabilityCache.cooldownUntil > now) {
    return; // Silently skip - no network request = no console error
  }
  
  // If we've had failures recently, skip the request (even if cooldown expired, wait a bit)
  if (serverAvailabilityCache.consecutiveFailures > 0) {
    // If we've had failures, only retry after a longer interval
    const timeSinceLastCheck = now - serverAvailabilityCache.lastChecked;
    if (timeSinceLastCheck < 10000) { // Wait 10 seconds between retries after failures
      return; // Silently skip
    }
  }

  // Use AbortController for timeout (available in Node.js 15+ and all modern browsers)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 100); // 100ms timeout
  
  fetch(`${DEBUG_SERVER_URL}/ingest/${DEFAULT_UNIVERSE_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location,
      message,
      data,
      timestamp: now,
      sessionId,
      hypothesisId
    }),
    signal: controller.signal
  })
    .then(() => {
      clearTimeout(timeoutId);
      // Mark server as available on success
      serverAvailabilityCache.isAvailable = true;
      serverAvailabilityCache.lastChecked = now;
      serverAvailabilityCache.consecutiveFailures = 0;
      serverAvailabilityCache.cooldownUntil = 0;
      saveDebugServerHealth(serverAvailabilityCache);
    })
    .catch(() => {
      clearTimeout(timeoutId);
      // Silently handle errors - don't log to console
      serverAvailabilityCache.isAvailable = false;
      serverAvailabilityCache.lastChecked = now;
      serverAvailabilityCache.consecutiveFailures += 1;
      
      // Set cooldown after first failure (prevents spam)
      if (serverAvailabilityCache.consecutiveFailures === 1) {
        serverAvailabilityCache.cooldownUntil = now + 300000; // 5 minute cooldown
      } else if (serverAvailabilityCache.consecutiveFailures > 1) {
        // Extend cooldown with each failure
        serverAvailabilityCache.cooldownUntil = now + Math.min(300000, 60000 * serverAvailabilityCache.consecutiveFailures);
      }
      saveDebugServerHealth(serverAvailabilityCache);
    });
}

/**
 * Reset the server availability cache
 * Useful for testing or when server status changes
 */
export function resetServerAvailabilityCache() {
  serverAvailabilityCache = {
    isAvailable: false,
    lastChecked: 0,
    checkInterval: 30000,
    cooldownUntil: 0,
    consecutiveFailures: 0
  };
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('redstring_debug_server_health');
    }
  } catch (e) {
    // Ignore storage errors
  }
}

/**
 * Get current server availability status
 */
export async function getServerAvailability() {
  return await checkServerAvailability();
}

