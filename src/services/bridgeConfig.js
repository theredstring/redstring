// Bridge configuration helpers for building URLs and cross-device access

function readEnvValue(...keys) {
  for (const key of keys) {
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env && Object.prototype.hasOwnProperty.call(import.meta.env, key)) {
        const value = import.meta.env[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    } catch { }

    try {
      if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
        const value = process.env[key];
        if (value && value.trim().length > 0) {
          return value.trim();
        }
      }
    } catch { }
  }
  return null;
}

export function getBridgeBaseUrl() {
  // Allow override via environment for advanced setups
  // Vite exposes env vars prefixed with VITE_
  const envUrl = readEnvValue(
    'VITE_BRIDGE_URL',
    'BRIDGE_PUBLIC_URL',
    'PUBLIC_BRIDGE_URL',
    'PUBLIC_BASE_URL',
    'PUBLIC_ORIGIN',
    'APP_PUBLIC_URL'
  );
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;

    // In production (Cloud Run), use the main server URL (AI endpoints are proxied)
    if (hostname === 'redstring.io' ||
      hostname.includes('.redstring.io') ||
      hostname.includes('run.app') ||
      protocol === 'https:') {
      return `${protocol}//${hostname}${port && port !== '443' && port !== '80' ? ':' + port : ''}`;
    }

    // In development, bridge daemon runs on port 3001
    const bridgePort = 3001;
    return `${protocol}//${hostname}:${bridgePort}`;
  }

  // Server-side or unknown: prefer explicitly configured origin, otherwise fall back to localhost:3001
  const fallback = readEnvValue(
    'BRIDGE_PUBLIC_FALLBACK',
    'SERVER_BRIDGE_URL',
    'APP_BASE_URL'
  );
  return (fallback || 'http://localhost:3001').replace(/\/+$/, '');
}

export function getOAuthBaseUrl() {
  // OAuth server runs on separate port for clean separation
  const envUrl = readEnvValue(
    'VITE_OAUTH_URL',
    'OAUTH_PUBLIC_URL',
    'PUBLIC_OAUTH_URL',
    'PUBLIC_BASE_URL',
    'PUBLIC_ORIGIN',
    'APP_PUBLIC_URL'
  );
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;

    // In production (Cloud Run or custom domain), use the same origin as the main app
    if (hostname.includes('run.app') || hostname === 'redstring.io' || hostname.includes('.redstring.io')) {
      return `${protocol}//${hostname}${port && port !== '443' && port !== '80' ? ':' + port : ''}`;
    }

    // For development, prefer dedicated OAuth port even if served over https locally,
    // unless explicitly overridden via VITE_OAUTH_URL above.
    const oauthPort = 3003;
    return `${protocol}//${hostname}:${oauthPort}`;
  }

  // Server-side or unknown: prefer explicitly configured origin, otherwise fall back to localhost
  const fallback = readEnvValue(
    'OAUTH_PUBLIC_FALLBACK',
    'SERVER_OAUTH_URL',
    'APP_BASE_URL'
  );
  return (fallback || 'http://localhost:3003').replace(/\/+$/, '');
}

export function bridgeUrl(path = '') {
  const base = getBridgeBaseUrl();
  const normalized = String(path || '');
  return normalized.startsWith('/') ? `${base}${normalized}` : `${base}/${normalized}`;
}

export function oauthUrl(path = '') {
  const base = getOAuthBaseUrl();
  const normalized = String(path || '');
  return normalized.startsWith('/') ? `${base}${normalized}` : `${base}/${normalized}`;
}

// Simple connectivity circuit breaker to avoid console/network spam when bridge is down
const __bridgeHealth = {
  consecutiveFailures: 0,
  cooldownUntil: 0
};

export function resetBridgeBackoff() {
  __bridgeHealth.consecutiveFailures = 0;
  __bridgeHealth.cooldownUntil = 0;
}

function isLikelyNetworkRefusal(err) {
  try {
    const msg = String(err && (err.message || err)).toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('net::err_connection_refused') ||
      msg.includes('econnrefused')
    );
  } catch { return false; }
}

export function bridgeFetch(path, options) {
  // Cooldown removed to prevent development friction
  return fetch(bridgeUrl(path), options)
    .then((res) => {
      // Any response means the listener exists; reset failures
      __bridgeHealth.consecutiveFailures = 0;
      return res;
    })
    .catch((err) => {
      if (isLikelyNetworkRefusal(err)) {
        __bridgeHealth.consecutiveFailures += 1;
      }
      throw err;
    });
}

export function bridgeEventSource(path) {
  // Consumers should pass a path like '/events/stream'
  const eventSource = new EventSource(bridgeUrl(path));
  
  // Add error handler to suppress console errors when server is not available
  eventSource.addEventListener('error', (event) => {
    // Silently handle connection errors - don't log to console
    // The error event will still fire, but we prevent console spam
    if (eventSource.readyState === EventSource.CLOSED) {
      // Connection closed - server likely not available
      // Silently close and don't log
      try {
        eventSource.close();
      } catch (e) {
        // Ignore errors during close
      }
    }
  }, { once: false });
  
  return eventSource;
}

// OAuth server availability cache
// Try to restore from sessionStorage to persist across page reloads
function loadOAuthHealth() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem('redstring_oauth_health');
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        // Only use stored data if cooldown is still active
        if (parsed.cooldownUntil > now) {
          return {
            consecutiveFailures: parsed.consecutiveFailures || 0,
            cooldownUntil: parsed.cooldownUntil,
            isAvailable: false,
            lastChecked: parsed.lastChecked || 0,
            firstFailureTime: parsed.firstFailureTime || 0
          };
        }
      }
    }
  } catch (e) {
    // Ignore storage errors
  }
  return {
    consecutiveFailures: 0,
    cooldownUntil: 0,
    isAvailable: true,
    lastChecked: 0,
    firstFailureTime: 0
  };
}

function saveOAuthHealth(health) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('redstring_oauth_health', JSON.stringify({
        consecutiveFailures: health.consecutiveFailures,
        cooldownUntil: health.cooldownUntil,
        lastChecked: health.lastChecked,
        firstFailureTime: health.firstFailureTime
      }));
    }
  } catch (e) {
    // Ignore storage errors
  }
}

const __oauthHealth = loadOAuthHealth();

// OAuth-specific fetch function with aggressive error suppression
export function oauthFetch(path, options) {
  const now = Date.now();
  
  // If in cooldown period, don't make the request at all (prevents browser console errors)
  if (__oauthHealth.cooldownUntil > now) {
    // Return a rejected promise that won't trigger network request
    return Promise.reject(new Error('OAuth server unavailable (cooldown)'));
  }
  
  // Make the request with a timeout to fail fast
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 2000) : null; // 2 second timeout
  
  const fetchOptions = {
    ...options,
    ...(controller ? { signal: controller.signal } : {})
  };
  
  return fetch(oauthUrl(path), fetchOptions)
    .then((res) => {
      if (timeoutId) clearTimeout(timeoutId);
      // Reset failures on any response (even errors)
      __oauthHealth.consecutiveFailures = 0;
      __oauthHealth.isAvailable = true;
      __oauthHealth.lastChecked = now;
      __oauthHealth.firstFailureTime = 0;
      __oauthHealth.cooldownUntil = 0;
      saveOAuthHealth(__oauthHealth);
      return res;
    })
    .catch((err) => {
      if (timeoutId) clearTimeout(timeoutId);
      __oauthHealth.lastChecked = now;
      
      if (isLikelyNetworkRefusal(err) || err.name === 'AbortError') {
        __oauthHealth.consecutiveFailures += 1;
        __oauthHealth.isAvailable = false;
        
        // Set cooldown immediately after first failure (prevents spam)
        if (__oauthHealth.consecutiveFailures === 1) {
          __oauthHealth.firstFailureTime = now;
          __oauthHealth.cooldownUntil = now + 300000; // 5 minute cooldown after first failure
        } else if (__oauthHealth.consecutiveFailures > 1) {
          // Extend cooldown with each failure
          __oauthHealth.cooldownUntil = now + Math.min(300000, 60000 * __oauthHealth.consecutiveFailures);
        }
        saveOAuthHealth(__oauthHealth);
      }
      // Re-throw but the caller should handle it gracefully
      throw err;
    });
}

