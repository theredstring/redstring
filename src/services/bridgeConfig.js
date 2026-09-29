// Bridge configuration helpers for building URLs and cross-device access

// Capacitor serves the bundle from capacitor://localhost, which matches none of
// the hostname heuristics below and would otherwise resolve to the nonsense
// origin capacitor://localhost:3001.
//
// The native app deliberately has NO default remote origin: it is not a client
// of redstring.io or of any other host. Server-backed features are opt-in, via
// an endpoint the user configures themselves (getConfiguredRemoteOrigin below).
// When nothing is configured, these resolvers return null and callers degrade —
// bridgeFetch rejects instead of hitting a stranger's server.
const REMOTE_ORIGIN_STORAGE_KEY = 'redstring_remote_origin';

function isCapacitorOrigin() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.Capacitor?.isNativePlatform?.() === true) return true;
    const protocol = window.location?.protocol || '';
    return protocol === 'capacitor:' || protocol === 'ionic:';
  } catch {
    return false;
  }
}

/**
 * A remote origin the user explicitly pointed this install at (their own
 * self-hosted instance, a machine on their LAN, or a public deployment they
 * chose). Empty by default — nothing is assumed.
 */
export function getConfiguredRemoteOrigin() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem(REMOTE_ORIGIN_STORAGE_KEY);
    const trimmed = typeof stored === 'string' ? stored.trim().replace(/\/+$/, '') : '';
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function setConfiguredRemoteOrigin(origin) {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
    if (trimmed) {
      localStorage.setItem(REMOTE_ORIGIN_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(REMOTE_ORIGIN_STORAGE_KEY);
    }
  } catch { /* storage unavailable — setting simply doesn't persist */ }
}

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

  // Native app: only ever an origin the user configured. No default.
  if (isCapacitorOrigin()) {
    return getConfiguredRemoteOrigin();
  }

  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;

    // Electron production loads via app://redstring (formerly file://) — the
    // agent server runs on localhost:3001. (resolveAgentConnection() prefers
    // the exact URL + token from the preload when it is available.)
    if (protocol === 'file:' || protocol === 'app:') {
      return 'http://localhost:3001';
    }

    // In production (Cloud Run / Cloudflare Pages / Workers), use the main
    // server URL (AI endpoints are proxied or BYOK-direct).
    if (hostname === 'redstring.io' ||
      hostname.includes('.redstring.io') ||
      hostname.includes('run.app') ||
      hostname.endsWith('.pages.dev') ||
      hostname.endsWith('.workers.dev') ||
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

  // Native app: GitHub auth uses the device flow (no OAuth server), so this is
  // only ever an origin the user configured. No default.
  if (isCapacitorOrigin()) {
    return getConfiguredRemoteOrigin();
  }

  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;

    // Electron production loads via app:// (formerly file://) — OAuth runs on localhost:3002
    if (protocol === 'file:' || protocol === 'app:') {
      return 'http://localhost:3002';
    }

    // In production (Cloud Run / Cloudflare Pages / Workers / custom domain),
    // use the same origin as the main app — the OAuth endpoints live at the
    // same host. On Cloudflare Pages the Worker handles them at /api/github/*.
    if (hostname.includes('run.app') ||
        hostname === 'redstring.io' ||
        hostname.includes('.redstring.io') ||
        hostname.endsWith('.pages.dev') ||
        hostname.endsWith('.workers.dev')) {
      return `${protocol}//${hostname}${port && port !== '443' && port !== '80' ? ':' + port : ''}`;
    }

    // For development, prefer dedicated OAuth port even if served over https locally,
    // unless explicitly overridden via VITE_OAUTH_URL above.
    const oauthPort = 3002;
    return `${protocol}//${hostname}:${oauthPort}`;
  }

  // Server-side or unknown: prefer explicitly configured origin, otherwise fall back to localhost
  const fallback = readEnvValue(
    'OAUTH_PUBLIC_FALLBACK',
    'SERVER_OAUTH_URL',
    'APP_BASE_URL'
  );
  return (fallback || 'http://localhost:3002').replace(/\/+$/, '');
}

/** Thrown when a server-backed feature is used with no endpoint configured. */
export class NoRemoteOriginError extends Error {
  constructor(what = 'This feature') {
    super(`${what} needs a Redstring server endpoint. None is configured — set one in AI settings, or run one locally.`);
    this.name = 'NoRemoteOriginError';
    this.isNoRemoteOrigin = true;
  }
}

export function bridgeUrl(path = '') {
  const base = getBridgeBaseUrl();
  if (!base) throw new NoRemoteOriginError('The AI wizard');
  const normalized = String(path || '');
  return normalized.startsWith('/') ? `${base}${normalized}` : `${base}/${normalized}`;
}

export function oauthUrl(path = '') {
  const base = getOAuthBaseUrl();
  if (!base) throw new NoRemoteOriginError('GitHub web sign-in');
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

// ─────────────────────────────────────────────────────────────
// Agent server connection + auth (C-6)
//
// The local agent server (wizard-server.js) requires `X-Redstring-Token` on
// every request. Where the renderer gets the URL and token:
//   - Electron: window.electron.agent.getConnection() → { baseUrl, token }
//     (older preloads without it fall back to the URL below, with no token)
//   - web dev (vite dev server on localhost): same-origin requests under
//     DEV_AGENT_PROXY_PREFIX; the vite proxy adds the token server-side from
//     ~/.redstring/agent.json, so the page never holds it
//   - Node (Committer / role runners inside the agent server, legacy servers):
//     REDSTRING_AGENT_TOKEN, or a provider registered on globalThis
//   - production web / Capacitor: no local agent; no token is ever attached
// ─────────────────────────────────────────────────────────────
export const AGENT_TOKEN_HEADER = 'X-Redstring-Token';
export const DEV_AGENT_PROXY_PREFIX = '/__redstring_agent';

let __agentConnection = null;        // { baseUrl, token } once resolved
let __agentConnectionPromise = null;

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isViteDevServer() {
  try {
    return typeof import.meta !== 'undefined' && !!import.meta.env && import.meta.env.DEV === true && import.meta.env.MODE !== 'test';
  } catch {
    return false;
  }
}

function hasBridgeUrlOverride() {
  return !!readEnvValue('VITE_BRIDGE_URL', 'BRIDGE_PUBLIC_URL', 'PUBLIC_BRIDGE_URL', 'PUBLIC_BASE_URL', 'PUBLIC_ORIGIN', 'APP_PUBLIC_URL');
}

function nodeAgentToken() {
  if (typeof window !== 'undefined') return null; // never in a browser
  try {
    const fromEnv = globalThis.process?.env?.REDSTRING_AGENT_TOKEN;
    if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  } catch { /* no process */ }
  try {
    const provider = globalThis.__redstringAgentTokenProvider;
    const t = typeof provider === 'function' ? provider() : null;
    if (typeof t === 'string' && t) return t;
  } catch { /* provider failed */ }
  return null;
}

async function computeAgentConnection() {
  const agentApi = typeof window !== 'undefined' ? window.electron?.agent : null;
  if (agentApi && typeof agentApi.getConnection === 'function') {
    try {
      const conn = await agentApi.getConnection();
      if (conn && typeof conn.baseUrl === 'string' && conn.baseUrl) {
        return {
          baseUrl: conn.baseUrl.replace(/\/+$/, ''),
          token: typeof conn.token === 'string' && conn.token ? conn.token : null
        };
      }
    } catch { /* fall through to the URL heuristics */ }
  }

  if (typeof window !== 'undefined' && window.location && !hasBridgeUrlOverride() && isViteDevServer()) {
    const { protocol, hostname, origin } = window.location;
    if (protocol === 'http:' && isLoopbackHostname(hostname)) {
      return { baseUrl: `${origin}${DEV_AGENT_PROXY_PREFIX}`, token: null };
    }
  }

  return { baseUrl: getBridgeBaseUrl(), token: nodeAgentToken() };
}

/** Resolve (and cache) where the agent server is and which token it wants. */
export function resolveAgentConnection() {
  if (__agentConnection) return Promise.resolve(__agentConnection);
  if (!__agentConnectionPromise) {
    __agentConnectionPromise = computeAgentConnection()
      .then((conn) => { __agentConnection = conn; return conn; })
      .finally(() => { __agentConnectionPromise = null; });
  }
  return __agentConnectionPromise;
}

/** Forget the cached connection (after a 401, or in tests). */
export function resetAgentConnection() {
  __agentConnection = null;
  __agentConnectionPromise = null;
}

function joinUrl(base, path) {
  const normalized = String(path || '');
  return normalized.startsWith('/') ? `${base}${normalized}` : `${base}/${normalized}`;
}

function withAgentToken(options, token) {
  if (!token) return options;
  const init = { ...(options || {}) };
  if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
    const headers = new Headers(init.headers);
    headers.set(AGENT_TOKEN_HEADER, token);
    init.headers = headers;
  } else {
    init.headers = { ...(init.headers || {}), [AGENT_TOKEN_HEADER]: token };
  }
  return init;
}

// Electron: start the (async) preload lookup now, so the first event stream
// usually opens directly rather than through the deferred stand-in below.
try {
  if (typeof window !== 'undefined' && window.electron?.agent?.getConnection) {
    resolveAgentConnection().catch(() => {});
  }
} catch { /* ignore */ }

export function bridgeFetch(path, options) {
  // Resolve inside the promise chain so a missing endpoint surfaces as a
  // rejection like any other failure, rather than a synchronous throw that
  // callers using .catch() would miss.
  let conn = null;
  return resolveAgentConnection()
    .then((resolved) => {
      conn = resolved;
      if (!conn.baseUrl) throw new NoRemoteOriginError('The AI wizard');
      // Cooldown removed to prevent development friction
      return fetch(joinUrl(conn.baseUrl, path), withAgentToken(options, conn.token));
    })
    .then((res) => {
      // Any response means the listener exists; reset failures
      __bridgeHealth.consecutiveFailures = 0;
      // A 401 means our token is stale (agent restarted): look it up afresh next time.
      if (res && res.status === 401) resetAgentConnection();
      return res;
    })
    .catch((err) => {
      if (isLikelyNetworkRefusal(err)) {
        __bridgeHealth.consecutiveFailures += 1;
      }
      throw err;
    });
}

function openAgentEventSource(conn, path) {
  if (!conn || !conn.baseUrl) throw new NoRemoteOriginError('The AI wizard');
  let url = joinUrl(conn.baseUrl, path);
  // EventSource cannot send headers; the agent accepts the token as a query
  // parameter on its event stream only (loopback, never logged).
  if (conn.token) url += `${url.includes('?') ? '&' : '?'}rs_token=${encodeURIComponent(conn.token)}`;
  const eventSource = new EventSource(url);

  // Add error handler to suppress console errors when server is not available
  eventSource.addEventListener('error', () => {
    // Silently handle connection errors - don't log to console
    // The error event will still fire, but we prevent console spam
    if (eventSource.readyState === EventSource.CLOSED) {
      // Connection closed - server likely not available
      try { eventSource.close(); } catch { /* ignore */ }
    }
  }, { once: false });

  return eventSource;
}

/**
 * Stand-in returned while the agent connection is still being looked up
 * (Electron's preload call is async; EventSource construction is not). It
 * mirrors the subset of the EventSource API callers use and forwards to the
 * real stream once it opens.
 */
class DeferredEventSource {
  constructor(openReal) {
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this._listeners = [];
    this._closed = false;
    this._es = null;
    openReal().then((es) => {
      if (this._closed) { try { es.close(); } catch { /* ignore */ } return; }
      this._es = es;
      es.onopen = (e) => { this.readyState = es.readyState; if (typeof this.onopen === 'function') this.onopen(e); };
      es.onmessage = (e) => { if (typeof this.onmessage === 'function') this.onmessage(e); };
      es.onerror = (e) => { this.readyState = es.readyState; if (typeof this.onerror === 'function') this.onerror(e); };
      for (const [type, fn, opts] of this._listeners) es.addEventListener(type, fn, opts);
    }).catch(() => {
      this._closed = true;
      this.readyState = 2; // CLOSED
      try { if (typeof this.onerror === 'function') this.onerror({ type: 'error' }); } catch { /* ignore */ }
    });
  }

  addEventListener(type, fn, opts) {
    this._listeners.push([type, fn, opts]);
    if (this._es) this._es.addEventListener(type, fn, opts);
  }

  removeEventListener(type, fn, opts) {
    this._listeners = this._listeners.filter(([t, f]) => !(t === type && f === fn));
    if (this._es) this._es.removeEventListener(type, fn, opts);
  }

  close() {
    this._closed = true;
    this.readyState = 2;
    if (this._es) { try { this._es.close(); } catch { /* ignore */ } }
  }
}

export function bridgeEventSource(path) {
  // Consumers should pass a path like '/events/stream'
  if (__agentConnection) return openAgentEventSource(__agentConnection, path);
  return new DeferredEventSource(() => resolveAgentConnection().then((conn) => openAgentEventSource(conn, path)));
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

// OAuth-specific fetch function with aggressive error suppression.
// Accepts a non-standard `bypassCooldown` option (extracted before passing to fetch)
// so user-initiated actions can always attempt a real request even during cooldown.
export async function oauthFetch(path, options = {}) {
  const { bypassCooldown = false, ...fetchInit } = options || {};
  const now = Date.now();

  // Background callers respect the cooldown to avoid console/network spam.
  // User-initiated callers pass bypassCooldown: true.
  if (!bypassCooldown && __oauthHealth.cooldownUntil > now) {
    return Promise.reject(new Error('OAuth server unavailable (cooldown)'));
  }

  // GitHub App endpoints now require the caller's OAuth user token so the
  // server can confirm ownership of the installation before minting a token or
  // returning installation data (installation IDs are enumerable). Attach it
  // here for all /api/github/app/ calls unless the caller already set one.
  // Lazy-import persistentAuth to avoid a static circular dependency (it
  // imports oauthFetch). If no token is stored, the header is omitted and the
  // server responds 401 — the correct "connect OAuth first" outcome.
  if (/\/api\/github\/app\//.test(path)) {
    const hasAuthHeader = fetchInit.headers && Object.keys(fetchInit.headers)
      .some((k) => k.toLowerCase() === 'authorization');
    if (!hasAuthHeader) {
      try {
        const { persistentAuth } = await import('./persistentAuth.js');
        const oauthToken = await persistentAuth.getAccessToken?.();
        if (oauthToken) {
          fetchInit.headers = { ...(fetchInit.headers || {}), Authorization: `token ${oauthToken}` };
        }
      } catch { /* no token available — server will 401 for app endpoints */ }
    }
  }

  // Resolve the URL before arming the timeout — with no endpoint configured
  // this throws, and a timer set first would never be cleared.
  const url = oauthUrl(path);

  // Make the request with a timeout to fail fast
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 2000) : null; // 2 second timeout

  const fetchOptions = {
    ...fetchInit,
    ...(controller ? { signal: controller.signal } : {})
  };

  return fetch(url, fetchOptions)
    .then((res) => {
      if (timeoutId) clearTimeout(timeoutId);
      // Reset failures on any response (even errors) so background polling resumes immediately
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

        // Set cooldown immediately after first failure (prevents spam from background pollers)
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

// Read-only snapshot of OAuth server health for UI use.
export function getOAuthHealthSnapshot() {
  return {
    isAvailable: __oauthHealth.isAvailable,
    cooldownUntil: __oauthHealth.cooldownUntil,
    consecutiveFailures: __oauthHealth.consecutiveFailures,
    lastChecked: __oauthHealth.lastChecked
  };
}

// True when the cooldown rejection comes from oauthFetch (vs. a real network/HTTP error).
export function isOAuthCooldownError(err) {
  return err && typeof err.message === 'string' && err.message === 'OAuth server unavailable (cooldown)';
}

// True when the error looks like the OAuth server is unreachable
// (network refusal, abort/timeout, or a synthetic cooldown rejection).
export function isOAuthUnreachableError(err) {
  if (!err) return false;
  if (isOAuthCooldownError(err)) return true;
  if (err.name === 'AbortError') return true;
  return isLikelyNetworkRefusal(err);
}

