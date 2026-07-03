/**
 * runtime.js
 *
 * Wires the headless store + a workspace of universes + the shared action
 * modules into a single runtime the wizard-server mounts when a workspace is
 * configured. Node analogue of the browser's BridgeClient + universeBackend: it
 * owns the store, manages universes (create/list/switch/delete), executes
 * pending actions in-process, and persists to disk.
 *
 * Executor mirrors BridgeClient's dispatch exactly (BridgeClient.jsx ~666/672
 * and the __rs_applyToolResultToStore fallback ~735): try storeActions[action]
 * first, else route through applyToolResultToStore.
 */
import path from 'node:path';
import { createHeadlessStore } from './createHeadlessStore.js';
import { openHeadlessWorkspace } from './HeadlessWorkspace.js';
import { buildBridgeState } from '../services/bridgeStateSerializer.js';
import { exportToRedstring } from '../formats/redstringFormat.js';
import { resolveWorkspace } from './config.js';
// NOTE: storeActions and toolResultApplier statically import graphStore, so they
// are dynamic-imported inside initRuntime AFTER createHeadlessStore installs
// the localStorage shim (ordering is load-bearing).

export { resolveWorkspace };

/**
 * Boot the headless runtime around a workspace folder.
 * @param {object}  opts
 * @param {string}  [opts.workspaceDir]     the workspace folder (required unless universePath given)
 * @param {string}  [opts.universePath]     back-compat: a single .redstring file → its parent is the workspace
 * @param {string}  [opts.activeFileHint]   a specific .redstring file to activate
 * @param {boolean} [opts.autoCreateDefault=true]
 * @param {number}  [opts.debounceMs=1000]
 * @param {function}[opts.log=console.error]
 */
export async function initRuntime({
  workspaceDir,
  universePath,
  activeFileHint = null,
  autoCreateDefault = true,
  debounceMs = 1000,
  log = console.error
}) {
  if (!workspaceDir && universePath) {
    workspaceDir = path.dirname(path.resolve(universePath));
    activeFileHint = path.resolve(universePath);
  }
  if (!workspaceDir) throw new Error('initRuntime requires a workspaceDir (or universePath)');

  // Shim-before-store ordering is handled inside createHeadlessStore.
  const { useGraphStore } = await createHeadlessStore();

  // storeActions + toolResultApplier statically import graphStore, so import them
  // AFTER the shim is installed (createHeadlessStore did that).
  const { createStoreActions, priority } = await import('../services/storeActions.js');
  const { applyToolResultToStore, configureToolResultApplier } = await import('../services/toolResultApplier.js');
  configureToolResultApplier({}); // keep no-op enrich hooks headless

  const workspace = await openHeadlessWorkspace(
    { dir: workspaceDir, useGraphStore, debounceMs, log },
    { autoCreateDefault, activeFileHint }
  );

  // All browser-only injections default to no-ops in Node. bridgeStateFetch's
  // default ({ok:false}) is correct here: the runtime IS the canonical store, so
  // the applyMutations ensurePrototype HTTP fallback is unnecessary — mutation
  // ordering via priority() ensures prototypes exist before instances.
  const storeActions = createStoreActions({ useGraphStore });

  /** Execute one action against the live store. Mirrors BridgeClient dispatch. */
  async function executeAction(action, params) {
    if (typeof storeActions[action] === 'function') {
      if (action === 'chat') {
        const { message, context } = params || {};
        return await storeActions.chat(message, context);
      }
      const args = Array.isArray(params) ? params : [params];
      return await storeActions[action](...args);
    }
    let resultObj;
    if (Array.isArray(params) && params.length === 1) resultObj = { action, ...params[0] };
    else resultObj = { action, ...params };
    applyToolResultToStore(action, resultObj, null);
    return { success: true, viaApplier: true };
  }

  return {
    useGraphStore,
    workspace,
    storeActions,
    priority,
    executeAction,
    getState: () => useGraphStore.getState(),

    /** Full bridge-state payload (+ runtime metadata) for GET /api/bridge/state. */
    buildBridgeStatePayload: () => ({
      ...buildBridgeState(useGraphStore.getState(), { fileStatus: null }),
      storeMode: 'runtime',
      stateVersion: workspace.stateVersion,
      pendingActions: [],
      source: 'wizard-server-runtime'
    }),

    get stateVersion() { return workspace.stateVersion; },
    get universePath() { return workspace.activeFilePath; },
    get universe() { return workspace.universe; },
    get workspaceDir() { return workspace.dir; },

    // ── Universe management (delegates to the workspace) ──────────────────
    listUniverses: () => workspace.listUniverses(),
    getActiveUniverse: () => workspace.getActive(),
    createUniverse: (name, opts) => workspace.createUniverse(name, opts),
    switchUniverse: (slug) => workspace.switchActive(slug),
    deleteUniverse: (slug, opts) => workspace.deleteUniverse(slug, opts),
    unlinkUniverse: (slug, slot) => workspace.unlink(slug, slot),
    setGitLink: (slug, linkedRepo, opts) => workspace.setGitLink(slug, linkedRepo, opts),
    pullUniverse: (sync, opts) => workspace.pullUniverse(sync, opts),
    pushUniverse: (sync, slug, opts) => workspace.pushUniverse(sync, slug, opts),

    /** Full lossless universe JSON (the runtime↔browser sync format). */
    exportRedstring: () => exportToRedstring(useGraphStore.getState()),
    /** Replace the active universe with an incoming one (browser→runtime forward-edit). */
    importRedstring: (json) => useGraphStore.getState().loadUniverseFromFile(json),

    async flush() { await workspace.universe?.flush(); },
    async shutdown() { await workspace.close(); }
  };
}
