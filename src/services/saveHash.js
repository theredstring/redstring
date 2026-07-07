/**
 * @module saveHash
 * @description The single source of truth for save change-detection hashing.
 *
 * Used by both save.worker.js (off-main-thread path) and SaveCoordinator
 * (main-thread fallback) — the two implementations previously drifted, and
 * both were blind to Maps/Sets nested inside hashed objects: `graph.groups`
 * (a Map) and `edge.directionality.arrowsToward` (a Set) stringify as `{}`
 * under plain JSON.stringify, so group edits and edge-direction toggles never
 * changed the hash and were NEVER saved.
 *
 * Exclusions (deliberate):
 * - `panOffset`/`zoomLevel` per graph — viewport moves must not trigger saves.
 * - `imageSrc`/`thumbnailSrc` — multi-MB data URLs OOM V8 when stringified;
 *   replaced with a length fingerprint so image *changes* are still detected.
 */

/** FNV-1a — fast 32-bit content hash. */
export const generateHash = (str) => {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString();
};

/**
 * JSON.stringify replacer that makes Maps and Sets visible to the hash.
 * Sets are sorted so insertion order doesn't produce spurious changes.
 */
export const mapSetReplacer = (key, value) => {
  if (value instanceof Map) return { __map: Array.from(value.entries()) };
  if (value instanceof Set) return { __set: Array.from(value).sort() };
  return value;
};

/**
 * Builds the normalized content snapshot that the hash covers. Everything
 * persisted in the .redstring file that a user can change must appear here —
 * a field missing from this snapshot is a field whose edits never save on
 * their own (bookmarks were the canonical victim).
 *
 * @param {Object} state - Zustand store snapshot.
 * @returns {Object} Plain structure ready for JSON.stringify(_, mapSetReplacer).
 */
export const buildContentState = (state) => ({
  graphs: state.graphs ? Array.from(state.graphs.entries()).map(([id, graph]) => {
    // Exclude viewport; everything else (including the groups Map and the
    // instances Map) is covered via mapSetReplacer.
    const { panOffset, zoomLevel, ...rest } = graph || {};
    return [id, rest];
  }) : [],
  nodePrototypes: state.nodePrototypes ? Array.from(state.nodePrototypes.entries()).map(
    ([id, proto]) => {
      const { imageSrc, thumbnailSrc, ...rest } = proto;
      return [id, {
        ...rest,
        // Cheap fingerprints: detect image replacement without hashing MBs.
        __imageLen: typeof imageSrc === 'string' ? imageSrc.length : 0,
        __thumbLen: typeof thumbnailSrc === 'string' ? thumbnailSrc.length : 0
      }];
    }
  ) : [],
  edges: state.edges ? Array.from(state.edges.entries()) : [],
  edgePrototypes: state.edgePrototypes ? Array.from(state.edgePrototypes.entries()) : [],
  // Persisted UI state — written to the file, so its changes must be able to
  // schedule a save without waiting for an unrelated content edit.
  openGraphIds: Array.isArray(state.openGraphIds) ? state.openGraphIds : [],
  activeGraphId: state.activeGraphId || null,
  activeDefinitionNodeId: state.activeDefinitionNodeId || null,
  expandedGraphIds: state.expandedGraphIds || [],
  savedNodeIds: state.savedNodeIds || [],
  savedGraphIds: state.savedGraphIds || [],
  showConnectionNames: !!state.showConnectionNames,
  rightPanelTabs: Array.isArray(state.rightPanelTabs) ? state.rightPanelTabs : [],
  wizardPlansByConversation: state.wizardPlansByConversation || {}
});

/**
 * Content hash of a store snapshot — the value compared against
 * `lastSaveHash` to decide whether a save is needed.
 *
 * @param {Object} state - Zustand store snapshot.
 * @returns {string} FNV-1a hash as a decimal string.
 */
export const generateStateHash = (state) => {
  const contentString = JSON.stringify(buildContentState(state), mapSetReplacer);
  return generateHash(contentString);
};
