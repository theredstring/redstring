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
 * Merges autoLayoutSettings with forceTunerSettings (forceTunerSettings takes precedence for individual force params)
 */
export function getAutoLayoutSettings() {
  const store = getBridgeStore();
  const autoSettings = store.autoLayoutSettings || {};
  const tunerSettings = store.forceTunerSettings || {};

  // Merge settings: use tuner settings if available, otherwise fall back to auto settings or defaults
  const defaults = {
    layoutScale: 'balanced',
    layoutScaleMultiplier: 1.6,
    layoutIterations: 'balanced',
    repulsionStrength: 2200,
    attractionStrength: 0.05,
    linkDistance: 400,
    minLinkDistance: 280,
    centerStrength: 0.015,
    collisionRadius: 90,
    edgeAvoidance: 0.95,
    alphaDecay: 0.008,
    velocityDecay: 0.85,
    // Group forces
    groupAttractionStrength: 0.6,
    groupRepulsionStrength: 4.8,
    groupExclusionStrength: 1.5,
    minGroupDistance: 800,
    groupBoundaryPadding: 100,
    stiffness: 0.6
  };

  return {
    // Scale/iteration presets: prefer autoLayoutSettings (these are synced)
    layoutScale: autoSettings.layoutScale || tunerSettings.layoutScale || defaults.layoutScale,
    layoutScaleMultiplier: autoSettings.layoutScaleMultiplier ?? tunerSettings.layoutScaleMultiplier ?? defaults.layoutScaleMultiplier,
    iterationPreset: autoSettings.layoutIterations || tunerSettings.layoutIterations || defaults.layoutIterations,
    // Individual force parameters: prefer forceTunerSettings (user-tuned values)
    repulsionStrength: tunerSettings.repulsionStrength ?? defaults.repulsionStrength,
    attractionStrength: tunerSettings.attractionStrength ?? defaults.attractionStrength,
    linkDistance: tunerSettings.linkDistance ?? defaults.linkDistance,
    minLinkDistance: tunerSettings.minLinkDistance ?? defaults.minLinkDistance,
    centerStrength: tunerSettings.centerStrength ?? defaults.centerStrength,
    collisionRadius: tunerSettings.collisionRadius ?? defaults.collisionRadius,
    edgeAvoidance: tunerSettings.edgeAvoidance ?? defaults.edgeAvoidance,
    alphaDecay: tunerSettings.alphaDecay ?? defaults.alphaDecay,
    velocityDecay: tunerSettings.velocityDecay ?? defaults.velocityDecay,
    // Group force parameters
    groupAttractionStrength: tunerSettings.groupAttractionStrength ?? defaults.groupAttractionStrength,
    groupRepulsionStrength: tunerSettings.groupRepulsionStrength ?? defaults.groupRepulsionStrength,
    groupExclusionStrength: tunerSettings.groupExclusionStrength ?? defaults.groupExclusionStrength,
    minGroupDistance: tunerSettings.minGroupDistance ?? defaults.minGroupDistance,
    groupBoundaryPadding: tunerSettings.groupBoundaryPadding ?? defaults.groupBoundaryPadding,
    stiffness: tunerSettings.stiffness ?? defaults.stiffness
  };
}

