/**
 * Bridge Store Accessor
 * Provides read-only access to the mirrored bridge store data from orchestrator components
 */

let storeRef = null;

/**
 * Set the bridge store reference (called by bridge-daemon on startup)
 */
export function setBridgeStoreRef(store) {
  storeRef = store;
}

/**
 * Get the current bridge store data (read-only)
 */
export function getBridgeStore() {
  if (!storeRef) {
    console.warn('[BridgeStoreAccessor] Store not initialized yet');
    return {
      graphs: [],
      nodePrototypes: [],
      edges: [],
      activeGraphId: null,
      summaries: {}
    };
  }
  return storeRef;
}

/**
 * Get a specific graph by ID
 */
export function getGraphById(graphId) {
  const store = getBridgeStore();
  return store.graphs.find(g => g.id === graphId) || null;
}

/**
 * Get the active graph
 */
export function getActiveGraph() {
  const store = getBridgeStore();
  if (!store.activeGraphId) return null;
  return getGraphById(store.activeGraphId);
}

/**
 * Get auto-layout settings from the store
 * Returns the same settings used by the UI's Auto-Layout button
 */
export function getAutoLayoutSettings() {
  const store = getBridgeStore();
  const settings = store.autoLayoutSettings || {};
  return {
    layoutScale: settings.layoutScale || 'balanced',
    layoutScaleMultiplier: settings.layoutScaleMultiplier ?? 1,
    iterationPreset: settings.layoutIterations || 'balanced'
  };
}

