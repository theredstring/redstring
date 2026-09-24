/**
 * fixtureSandbox.js: DEV/PROFILE-ONLY isolation for fixture mode (`?fixture=<name>`).
 *
 * NodeCanvas refactor P0.02. Imported FIRST by main.jsx so it runs before any
 * app module evaluates (several of them read localStorage at import time).
 * The companion loader is src/dev/fixtureLoader.js.
 *
 * With no `?fixture` in the URL, or in a normal production build, this module
 * does nothing: its whole body sits behind
 * `import.meta.env.DEV || import.meta.env.MODE === 'profile'`, which Vite
 * folds to `false` in production so Rollup drops it. The profiling build
 * (`npm run build:profile`) keeps it for the perf scenarios (P0.04); that
 * build is never shipped.
 *
 * In fixture mode a fixture must never reach real storage or a real server, so
 * this installs:
 *   1. An in-memory localStorage. Starts empty (plus the onboarding-seen flags),
 *      so runs are reproducible and never read or write the developer's prefs.
 *      A test can pre-seed keys by setting `window.__fixtureStorageSeed = {…}`
 *      in an init script.
 *   2. A network guard. Only same-origin requests outside `/api/` go through.
 *      That blocks the bridge (:3001, and `/api` which Vite proxies there), the
 *      MCP/daemon (BridgeClient's daemon coexistence would otherwise forward the
 *      fixture to a running daemon, which persists it), OAuth, git hosts and
 *      remote images. Vite's own module and HMR traffic is same-origin and
 *      unaffected. Blocked calls fail like a refused connection.
 *
 * Persistence itself (SaveCoordinator, universeBackend, WorkspaceService) is
 * neutralised by the loader, which has to import those modules.
 */

function createMemoryStorage(seed) {
  const map = new Map();
  for (const [k, v] of Object.entries(seed || {})) map.set(String(k), String(v));
  const storage = {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { k = String(k); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
  };
  return storage;
}

function isAllowedUrl(raw) {
  try {
    const url = new URL(typeof raw === 'string' ? raw : (raw?.url ?? String(raw)), window.location.href);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
    if (url.origin !== window.location.origin) return false;
    return !url.pathname.startsWith('/api/') && url.pathname !== '/api';
  } catch {
    return false;
  }
}

function installNetworkGuard(blocked) {
  const note = (kind, url) => {
    blocked.push({ kind, url: String(url).slice(0, 200) });
    if (blocked.length > 500) blocked.shift();
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (isAllowedUrl(input)) return realFetch(input, init);
    note('fetch', typeof input === 'string' ? input : input?.url);
    // Same shape as a refused connection, so callers take their offline path.
    return Promise.reject(new TypeError('Failed to fetch (blocked in fixture mode)'));
  };

  const RealXHR = window.XMLHttpRequest;
  if (RealXHR) {
    const realOpen = RealXHR.prototype.open;
    const realSend = RealXHR.prototype.send;
    RealXHR.prototype.open = function open(method, url, ...rest) {
      this.__fixtureBlocked = !isAllowedUrl(url);
      if (this.__fixtureBlocked) note('xhr', url);
      return realOpen.call(this, method, this.__fixtureBlocked ? 'data:,' : url, ...rest);
    };
    RealXHR.prototype.send = function send(body) {
      if (this.__fixtureBlocked) {
        setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 0);
        return undefined;
      }
      return realSend.call(this, body);
    };
  }

  // An EventSource that never connects: CLOSED, one async error, like a server
  // that isn't there.
  class BlockedEventSource extends EventTarget {
    constructor(url) {
      super();
      note('eventsource', url);
      this.url = String(url);
      this.readyState = 2;
      this.withCredentials = false;
      this.onerror = null;
      this.onmessage = null;
      this.onopen = null;
      setTimeout(() => {
        const ev = new Event('error');
        this.dispatchEvent(ev);
        try { this.onerror?.(ev); } catch { /* ignore */ }
      }, 0);
    }
    close() { this.readyState = 2; }
  }
  BlockedEventSource.CONNECTING = 0;
  BlockedEventSource.OPEN = 1;
  BlockedEventSource.CLOSED = 2;
  const RealEventSource = window.EventSource;
  if (RealEventSource) {
    window.EventSource = function EventSource(url, config) {
      if (isAllowedUrl(url)) return new RealEventSource(url, config);
      return new BlockedEventSource(url);
    };
    Object.assign(window.EventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
  }

  // WebSockets: Vite's HMR socket is same-origin (ws: on the dev server's
  // host:port) and must keep working. Anything else gets a socket that closes.
  const RealWebSocket = window.WebSocket;
  if (RealWebSocket) {
    const Guarded = function WebSocket(url, protocols) {
      let sameOrigin = false;
      try { sameOrigin = new URL(url, window.location.href).host === window.location.host; } catch { /* ignore */ }
      if (sameOrigin) return new RealWebSocket(url, protocols);
      note('websocket', url);
      const fake = new EventTarget();
      Object.assign(fake, {
        url: String(url), readyState: 3, protocol: '', extensions: '', bufferedAmount: 0, binaryType: 'blob',
        send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null,
      });
      setTimeout(() => {
        const err = new Event('error');
        fake.dispatchEvent(err);
        try { fake.onerror?.(err); } catch { /* ignore */ }
        const close = new Event('close');
        fake.dispatchEvent(close);
        try { fake.onclose?.(close); } catch { /* ignore */ }
      }, 0);
      return fake;
    };
    Guarded.prototype = RealWebSocket.prototype;
    Object.assign(Guarded, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Guarded;
  }

  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (isAllowedUrl(url)) return realBeacon(url, data);
      note('beacon', url);
      return false;
    };
  }
}

function installFixtureSandbox(name) {
  const seed = {
    // Returning-user flags, so nothing routes to first-run onboarding. Both the
    // plain key and the `?test=true` scoped key (storageUtils.getStorageKey).
    'redstring-welcome-seen': 'true',
    'test_redstring-welcome-seen': 'true',
    // The "Download App" pill floats over the bottom of the canvas after a
    // delay and would intercept clicks there.
    'redstring_desktop_download_dismissed': 'true',
    ...(window.__fixtureStorageSeed || {}),
  };
  const memory = createMemoryStorage(seed);
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => memory });
  } catch (err) {
    // If the property can't be replaced we must not continue: the app would
    // read and write the developer's real storage.
    throw new Error(`[fixture] could not isolate localStorage: ${err?.message || err}`);
  }

  const blocked = [];
  installNetworkGuard(blocked);

  window.__REDSTRING_FIXTURE_MODE__ = { name, blockedRequests: blocked };
  document.documentElement.setAttribute('data-fixture-mode', name);
  console.info(`[fixture] sandbox on for "${name}": in-memory localStorage, network limited to same-origin non-/api`);
}

// Dev server, plus the profiling build (`npm run build:profile`, Vite mode
// "profile") so the perf scenarios (P0.04) can load fixtures in an optimised
// bundle. Vite replaces both values at build time; in any other production
// build the condition is `false || "production" === "profile"` and Rollup
// drops this block and, with it, every reference to the loader.
if ((import.meta.env.DEV || import.meta.env.MODE === 'profile') && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  if (params.has('fixture')) {
    installFixtureSandbox(params.get('fixture') || 'small');
  }
}
