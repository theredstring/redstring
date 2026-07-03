/**
 * daemonCoexistence.js
 *
 * Browser-side controller for running the app alongside a headless daemon
 * (Phase 6). Truth model: daemon-canonical-when-present. When a headless daemon
 * is detected, the browser:
 *   1. hydrates from the daemon (GET /api/store/export → loadUniverseFromFile),
 *   2. suspends its own local file writes (saveCoordinator.setEnabled(false)),
 *   3. forwards local edits to the daemon (POST /api/store/import) with
 *      optimistic concurrency (baseVersion), re-hydrating on 409, and
 *   4. re-hydrates when the daemon advances externally (MCP/CLI mutations).
 * When the daemon disappears, it resumes standalone (setEnabled(true)).
 *
 * Fully dependency-injected (no static graphStore import) so it stays browser-
 * safe AND can be integration-tested in Node against a real daemon.
 */

/**
 * @param {object}   deps
 * @param {object}   deps.useGraphStore
 * @param {object}   [deps.saveCoordinator]   needs setEnabled(bool); optional
 * @param {function} deps.bridgeFetch         (path, options) => Promise<Response>
 * @param {function} deps.exportToRedstring   (state) => redstring JSON
 * @param {number}   [deps.pollMs=3000]
 * @param {number}   [deps.debounceMs=800]
 * @param {function} [deps.log]
 */
export function createDaemonCoexistence({
  useGraphStore,
  saveCoordinator = null,
  bridgeFetch,
  exportToRedstring,
  pollMs = 3000,
  debounceMs = 800,
  log = () => {}
}) {
  let engaged = false;
  let lastVersion = null;     // daemon stateVersion we last observed/synced
  let applyingRemote = false; // suppress forward while we apply a daemon snapshot
  let pollTimer = null;
  let unsub = null;
  let forwardTimer = null;

  async function getJson(path, options) {
    const r = await bridgeFetch(path, options);
    if (!r.ok) {
      const err = new Error(`${path} → ${r.status}`);
      err.status = r.status;
      try { err.body = await r.json(); } catch { err.body = null; }
      throw err;
    }
    return r.json();
  }

  async function hydrate(version) {
    applyingRemote = true;
    try {
      const redstring = await getJson('/api/store/export');
      // loadUniverseFromFile notifies subscribers synchronously; the flag keeps
      // that from bouncing straight back to the daemon as a "local edit".
      useGraphStore.getState().loadUniverseFromFile(redstring);
      if (typeof version === 'number') lastVersion = version;
    } finally {
      applyingRemote = false;
    }
  }

  async function engage(health) {
    if (engaged) return;
    engaged = true;
    log('[coexist] engaging daemon-authoritative mode');
    try { saveCoordinator?.setEnabled?.(false); } catch { /* non-fatal */ }
    await hydrate(health.stateVersion);
    unsub = useGraphStore.subscribe(() => { if (!applyingRemote) scheduleForward(); });
  }

  function disengage() {
    if (!engaged) return;
    engaged = false;
    log('[coexist] disengaging — daemon gone, resuming standalone');
    if (unsub) { unsub(); unsub = null; }
    if (forwardTimer) { clearTimeout(forwardTimer); forwardTimer = null; }
    try { saveCoordinator?.setEnabled?.(true); } catch { /* non-fatal */ }
  }

  function scheduleForward() {
    if (forwardTimer) clearTimeout(forwardTimer);
    forwardTimer = setTimeout(() => { forwardTimer = null; forwardEdit(); }, debounceMs);
  }

  async function forwardEdit() {
    if (!engaged) return;
    const redstring = exportToRedstring(useGraphStore.getState());
    try {
      const resp = await getJson('/api/store/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion: lastVersion, redstring })
      });
      lastVersion = resp.stateVersion;
    } catch (err) {
      if (err.status === 409) {
        log('[coexist] forward conflict — re-hydrating');
        await hydrate(err.body?.stateVersion);
      } else {
        log(`[coexist] forward failed: ${err.message}`);
      }
    }
  }

  async function tick() {
    let health = null;
    try { health = await getJson('/api/bridge/health'); } catch { health = null; }

    if (health?.headless) {
      if (!engaged) return engage(health);
      // Engaged: pick up daemon-side changes (MCP/CLI) that advanced the version,
      // but not while our own forward is pending/in-flight.
      if (typeof health.stateVersion === 'number' && lastVersion != null
          && health.stateVersion > lastVersion && !forwardTimer) {
        log('[coexist] daemon advanced externally — re-hydrating');
        await hydrate(health.stateVersion);
      }
    } else if (engaged) {
      disengage();
    }
  }

  function start() {
    if (pollTimer) return;
    tick();
    pollTimer = setInterval(tick, pollMs);
  }

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    disengage();
  }

  return {
    start,
    stop,
    tick,                         // exposed for tests / manual pumping
    forwardNow: forwardEdit,      // exposed for tests
    isEngaged: () => engaged,
    getLastVersion: () => lastVersion
  };
}
