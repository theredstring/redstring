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
    } catch {}

    try {
      if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
        const value = process.env[key];
        if (value && value.trim().length > 0) {
          return value.trim();
        }
      }
    } catch {}
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
    
    // In production (custom domain or Cloud Run), use the same origin
    if (hostname === 'redstring.io' || 
        hostname.includes('.redstring.io') ||
        hostname.includes('run.app') ||
        protocol === 'https:') {
      return `${protocol}//${hostname}${port && port !== '443' && port !== '80' ? ':' + port : ''}`;
    }
    
    // Default development bridge port for AI/MCP
    const bridgePort = 3001;
    return `${protocol}//${hostname}:${bridgePort}`;
  }

  // Server-side or unknown: prefer explicitly configured origin, otherwise fall back to localhost
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

// Check if we're in test environment (no MCP bridge)
const isTestEnvironment = () => {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.hostname.includes('test');
  }
  return false;
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
  // In test environment, completely disable MCP bridge
  if (isTestEnvironment()) {
    return Promise.reject(new Error('MCP Bridge disabled in test environment'));
  }
  
  const now = Date.now();
  if (__bridgeHealth.cooldownUntil && now < __bridgeHealth.cooldownUntil) {
    // Short-circuit without hitting the network to prevent console spam
    const cooldownRemaining = Math.ceil((__bridgeHealth.cooldownUntil - now) / 1000);
    return Promise.reject(new Error(`bridge_unavailable_cooldown: ${cooldownRemaining}s remaining`));
  }
  return fetch(bridgeUrl(path), options)
    .then((res) => {
      // Any response means the listener exists; reset failures
      __bridgeHealth.consecutiveFailures = 0;
      __bridgeHealth.cooldownUntil = 0;
      return res;
    })
    .catch((err) => {
      if (isLikelyNetworkRefusal(err)) {
        __bridgeHealth.consecutiveFailures += 1;
        if (__bridgeHealth.consecutiveFailures >= 3) {
          // Stop trying for a while; panel Refresh/manual reconnect can reset this
          __bridgeHealth.cooldownUntil = Date.now() + 60_000; // 60s cooldown
          // console.log(`🔌 MCP Bridge: Connection failed ${__bridgeHealth.consecutiveFailures} times, entering ${60}s cooldown period`);
        } else {
          // console.log(`🔌 MCP Bridge: Connection attempt ${__bridgeHealth.consecutiveFailures}/3 failed`);
        }
      }
      // Re-throw so callers can handle softly; no network call will be attempted during cooldown
      throw err;
    });
}

export function bridgeEventSource(path) {
  // In test environment, completely disable MCP bridge
  if (isTestEnvironment()) {
    // Return a dummy EventSource that immediately closes
    const dummySource = new EventSource('data:text/plain,');
    setTimeout(() => dummySource.close(), 1);
    return dummySource;
  }
  
  // Consumers should pass a path like '/events/stream'
  return new EventSource(bridgeUrl(path));
}

// OAuth-specific fetch function (separate server, no circuit breaker needed)
export function oauthFetch(path, options) {
  return fetch(oauthUrl(path), options);
}

