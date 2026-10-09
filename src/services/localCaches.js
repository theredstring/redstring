/**
 * What this device keeps that can be thrown away (Settings → Data).
 *
 * Two groups, because they mean different things to the person clearing them:
 *
 * - Cached data: copies Redstring makes again on its own. Label images baked
 *   for the canvas (the only cache that lives on disk), model lists, and the
 *   semantic web lookups held for this session. Clearing costs a little time
 *   while they rebuild and changes nothing anyone can see.
 * - Discovery history: the searches and results in Discover. That one is a
 *   record, so it gets its own row and its own button.
 *
 * Deliberately not here: Wikipedia images on the canvas (memory only, gone on
 * restart, and clearing them would shrink every pictured Thing until it is
 * fetched again), Wizard conversations (the user's own, and on the web the
 * only copy), and anything universes, file links, Git or keys depend on.
 */

const MODEL_LIST_KEYS = ['redstring_model_catalog_v1', 'redstring_gemini_models_cache'];
const DISCOVERY_KEYS = ['redstring_semantic_discovery_history', 'redstring_semantic_search_results'];

// localStorage holds UTF-16, two bytes a character.
const storedBytes = (key) => {
  try {
    return (localStorage.getItem(key)?.length || 0) * 2;
  } catch {
    return 0;
  }
};

const removeKeys = (keys) => {
  for (const key of keys) {
    try { localStorage.removeItem(key); } catch { /* nothing kept to remove */ }
  }
};

/** @returns {Promise<{bytes: number}>} what the on-device caches take */
export async function measureCachedData() {
  const { measurePersistedSprites } = await import('./labelSpriteStore.js');
  const sprites = await measurePersistedSprites();
  return { bytes: sprites.bytes + MODEL_LIST_KEYS.reduce((sum, key) => sum + storedBytes(key), 0) };
}

/** Throw away every cache Redstring rebuilds on its own. */
export async function clearCachedData() {
  removeKeys(MODEL_LIST_KEYS);
  const settle = (load, clear) => load().then(clear).catch((error) => {
    console.warn('[localCaches] A cache could not be cleared:', error?.message || error);
  });
  await Promise.all([
    settle(() => import('./labelSpriteStore.js'), (m) => m.purgePersistedSprites()),
    settle(() => import('./sparqlClient.js'), (m) => m.sparqlClient.clearCache()),
    settle(() => import('./rdfResolver.js'), (m) => m.clearCache()),
    settle(() => import('./semanticSearchEngine.js'), (m) => m.clearSemanticCache()),
    settle(() => import('./automaticEnrichment.js'), (m) => m.clearEnrichmentCache())
  ]);
}

/** @returns {{entries: number, bytes: number}} Discover's searches and results */
export function measureDiscoveryHistory() {
  let entries = 0;
  try {
    const history = JSON.parse(localStorage.getItem(DISCOVERY_KEYS[0]) || '[]');
    entries = Array.isArray(history) ? history.length : 0;
  } catch { /* unreadable counts as none */ }
  return { entries, bytes: DISCOVERY_KEYS.reduce((sum, key) => sum + storedBytes(key), 0) };
}

/** Forget Discover's searches and results, here and in an open Discover view. */
export function clearDiscoveryHistory() {
  removeKeys(DISCOVERY_KEYS);
  try {
    window.dispatchEvent(new CustomEvent('redstring:discovery-history-cleared'));
  } catch { /* no window, nothing open to tell */ }
}
