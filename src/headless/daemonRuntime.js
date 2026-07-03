/**
 * daemonRuntime.js
 *
 * Wires the headless store + persistent universe + shared action modules into a
 * single runtime the wizard-server mounts when a universe is configured. This is
 * the Node analogue of the browser's BridgeClient: it owns the store, executes
 * pending actions in-process (no browser to poll), and persists to disk.
 *
 * Executor mirrors BridgeClient's dispatch exactly (BridgeClient.jsx ~666/672
 * and the __rs_applyToolResultToStore fallback ~735): try storeActions[action]
 * first, else route through applyToolResultToStore.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { createHeadlessStore } from './createHeadlessStore.js';
import { openHeadlessUniverse } from './HeadlessUniverse.js';
import { buildBridgeState } from '../services/bridgeStateSerializer.js';
import { exportToRedstring } from '../formats/redstringFormat.js';
// NOTE: storeActions and toolResultApplier statically import graphStore, so they
// are dynamic-imported inside initDaemonRuntime AFTER createHeadlessStore installs
// the localStorage shim (ordering is load-bearing).

/**
 * Resolve the universe file path from (in order): --universe flag, the
 * REDSTRING_UNIVERSE env var, or ~/.redstring/daemon.json { "universe": "..." }.
 * Returns an absolute path or null if none configured (daemon stays in the
 * legacy browser-relay mode).
 */
export function resolveUniversePath(argv = process.argv) {
  try {
    const { values } = parseArgs({
      args: argv.slice(2),
      options: { universe: { type: 'string' } },
      allowPositionals: true,
      strict: false
    });
    if (values.universe) return path.resolve(values.universe);
  } catch { /* ignore malformed args */ }

  if (process.env.REDSTRING_UNIVERSE) return path.resolve(process.env.REDSTRING_UNIVERSE);

  try {
    const cfgPath = path.join(os.homedir(), '.redstring', 'daemon.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg?.universe) return path.resolve(cfg.universe);
    }
  } catch { /* ignore malformed config */ }

  return null;
}

/**
 * Boot the headless runtime around a universe file.
 * @param {object} opts
 * @param {string} opts.universePath  absolute path to the .redstring file
 * @param {number} [opts.debounceMs=1000]
 * @param {function} [opts.log=console.error]
 */
export async function initDaemonRuntime({ universePath, debounceMs = 1000, log = console.error }) {
  if (!universePath) throw new Error('initDaemonRuntime requires a universePath');

  // Shim-before-store ordering is handled inside createHeadlessStore.
  const { useGraphStore } = await createHeadlessStore();

  // storeActions + toolResultApplier statically import graphStore, so import them
  // AFTER the shim is installed (createHeadlessStore did that).
  const { createStoreActions, priority } = await import('../services/storeActions.js');
  const { applyToolResultToStore, configureToolResultApplier } = await import('../services/toolResultApplier.js');
  configureToolResultApplier({}); // keep no-op enrich hooks headless

  const universe = await openHeadlessUniverse({ filePath: universePath, useGraphStore, debounceMs, log });

  // All browser-only injections default to no-ops in Node. bridgeStateFetch's
  // default ({ok:false}) is correct here: the daemon IS the canonical store, so
  // the applyMutations ensurePrototype HTTP fallback is unnecessary — mutation
  // ordering via priority() ensures prototypes exist before instances.
  const storeActions = createStoreActions({ useGraphStore });

  /**
   * Execute one action against the live store. Mirrors BridgeClient dispatch.
   * @returns {Promise<object>} the handler result (or applier acknowledgement)
   */
  async function executeAction(action, params) {
    if (typeof storeActions[action] === 'function') {
      if (action === 'chat') {
        const { message, context } = params || {};
        return await storeActions.chat(message, context);
      }
      const args = Array.isArray(params) ? params : [params];
      return await storeActions[action](...args);
    }
    // Fallback: route through the tool-result applier (same wrapping as browser).
    let resultObj;
    if (Array.isArray(params) && params.length === 1) {
      resultObj = { action, ...params[0] };
    } else {
      resultObj = { action, ...params };
    }
    applyToolResultToStore(action, resultObj, null);
    return { success: true, viaApplier: true };
  }

  return {
    useGraphStore,
    universe,
    storeActions,
    priority,
    executeAction,
    getState: () => useGraphStore.getState(),
    /** Full bridge-state payload (+ daemon metadata) for GET /api/bridge/state. */
    buildBridgeStatePayload: () => ({
      ...buildBridgeState(useGraphStore.getState(), { fileStatus: null }),
      storeMode: 'daemon',
      stateVersion: universe.stateVersion,
      pendingActions: [],
      source: 'wizard-server-daemon'
    }),
    get stateVersion() { return universe.stateVersion; },
    get universePath() { return universe.filePath; },
    /** Full lossless universe JSON (the daemon↔browser sync format). */
    exportRedstring: () => exportToRedstring(useGraphStore.getState()),
    /**
     * Replace the store with an incoming universe (browser→daemon forward-edit).
     * Returns true if loadUniverseFromFile accepted it. The autosave subscriber
     * bumps stateVersion + persists as a side effect.
     */
    importRedstring: (json) => useGraphStore.getState().loadUniverseFromFile(json),
    async flush() { await universe.flush(); },
    async shutdown() { await universe.close(); }
  };
}
