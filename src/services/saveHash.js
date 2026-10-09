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
/**
 * An image the file never holds: an auto-enriched Wikipedia image, fetched
 * again from its thumbnail URL (the export writes null for it, and the save
 * worker's copy drops it). Counted as absent, so the worker's hash and the
 * main thread's agree, and so its bytes changing alone isn't a change to save.
 */
const isReFetchable = (proto) => !!(proto?.semanticMetadata?.autoEnriched && proto?.semanticMetadata?.wikipediaThumbnail);

/** A prototype as the hash sees it: images as length fingerprints. */
const hashedPrototype = (proto) => {
  const { imageSrc, thumbnailSrc, ...rest } = proto;
  const kept = !isReFetchable(proto);
  return {
    ...rest,
    // Cheap fingerprints: detect image replacement without hashing MBs.
    __imageLen: kept && typeof imageSrc === 'string' ? imageSrc.length : 0,
    __thumbLen: kept && typeof thumbnailSrc === 'string' ? thumbnailSrc.length : 0
  };
};

export const buildContentState = (state) => ({
  graphs: state.graphs ? Array.from(state.graphs.entries()).map(([id, graph]) => {
    // Exclude viewport; everything else (including the groups Map and the
    // instances Map) is covered via mapSetReplacer.
    const { panOffset, zoomLevel, ...rest } = graph || {};
    return [id, rest];
  }) : [],
  nodePrototypes: state.nodePrototypes ? Array.from(state.nodePrototypes.entries()).map(
    ([id, proto]) => [id, hashedPrototype(proto)]
  ) : [],
  edges: state.edges ? Array.from(state.edges.entries()) : [],
  edgePrototypes: state.edgePrototypes ? Array.from(state.edgePrototypes.entries()) : [],
  ...buildPersistedUiState(state)
});

/**
 * Persisted UI state — written to the file, so its changes must be able to
 * schedule a save without waiting for an unrelated content edit.
 */
const buildPersistedUiState = (state) => ({
  openGraphIds: Array.isArray(state.openGraphIds) ? state.openGraphIds : [],
  activeGraphId: state.activeGraphId || null,
  activeDefinitionNodeId: state.activeDefinitionNodeId || null,
  expandedGraphIds: state.expandedGraphIds || [],
  savedNodeIds: state.savedNodeIds || [],
  savedGraphIds: state.savedGraphIds || [],
  showConnectionNames: !!state.showConnectionNames,
  rightPanelTabs: Array.isArray(state.rightPanelTabs) ? state.rightPanelTabs : [],
  wizardPlansByConversation: state.wizardPlansByConversation || {},
  wizardGoalsByConversation: state.wizardGoalsByConversation || {}
});

/** One FNV-1a step over more text, carrying on from `hash`. */
const fnvMore = (hash, str) => {
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
};

/** What an entry contributes, as buildContentState writes it. */
const NORMALIZE = {
  graphs: (graph) => {
    const { panOffset, zoomLevel, ...rest } = graph || {};
    return rest;
  },
  nodePrototypes: hashedPrototype,
  edges: (edge) => edge,
  edgePrototypes: (edgePrototype) => edgePrototype,
};
const SECTIONS = Object.keys(NORMALIZE);

const entryHash = (section, value) => generateHash(String(JSON.stringify(NORMALIZE[section](value), mapSetReplacer)));

/**
 * Per-entry hashes kept by the save worker between saves, keyed by the entry
 * object: its copy of the universe replaces an entry whenever the store
 * changes it (saveMirror.js), so an entry that's the same object hashes the
 * same. Only for that copy; the store's own objects are hashed afresh.
 *
 * @returns {Object} a cache for generateStateHash's `cache` option
 */
export const createStateHashCache = () => Object.fromEntries(SECTIONS.map((section) => [section, new WeakMap()]));

/**
 * Content hash of a store snapshot — the value compared against
 * `lastSaveHash` to decide whether a save is needed.
 *
 * Built from a hash of each graph, prototype, edge and edge prototype (each as
 * buildContentState writes it) with its ID, in order, then the persisted UI
 * state, so the save worker can keep each entry's hash while the entry is
 * unchanged (createStateHashCache) and hash only what changed: for a big
 * universe, hashing everything took longer than writing the file. With or
 * without a cache, the same state gives the same hash.
 *
 * @param {Object} state - Zustand store snapshot.
 * @param {Object} [options]
 * @param {Object} [options.cache] - from createStateHashCache (the save worker only)
 * @returns {string} 32-bit unsigned integer as a decimal string.
 */
export const generateStateHash = (state, { cache = null } = {}) => {
  let hash = 2166136261;
  for (const section of SECTIONS) {
    hash = fnvMore(hash, `\u0002${section}`);
    const entries = state[section];
    if (!entries) continue;
    const known = cache?.[section];
    for (const [id, value] of entries.entries()) {
      let h;
      if (known && value !== null && typeof value === 'object') {
        h = known.get(value);
        if (h === undefined) {
          h = entryHash(section, value);
          known.set(value, h);
        }
      } else {
        h = entryHash(section, value);
      }
      hash = fnvMore(hash, `\u0000${String(id)}\u0001${h}`);
    }
  }
  hash = fnvMore(hash, `\u0003${JSON.stringify(buildPersistedUiState(state), mapSetReplacer)}`);
  return hash.toString();
};
