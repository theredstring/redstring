/**
 * fixtureLoader.js: DEV/PROFILE-ONLY fixture loader for the canvas harness.
 *
 * NodeCanvas refactor P0.02. main.jsx dynamic-imports this module only when
 * `import.meta.env.DEV` is true (or the build is the profiling build, Vite mode
 * "profile", which the perf scenarios of P0.04 run on) and `?fixture=<name>`
 * is in the URL, and it mounts the app only after `bootFixtureMode()`
 * resolves. Normal production builds never reference it (verify: `npm run
 * build` then grep dist for __loadFixture, excluding .map files).
 *
 *   /?fixture=small    committed, test/fixtures/canvas/small.redstring
 *   /?fixture=stress   committed, test/fixtures/canvas/stress.redstring
 *
 * Optional URL params: `labels=0|1` forces connection labels off/on.
 *
 * Test hook, available in fixture mode only:
 *   await window.__loadFixture(jsonObjectOrString, { label?, activeGraphId?, frame?, thumbnails? })
 *     → { label, graphs, prototypes, edges, activeGraphId, instancesOnActive }
 *   activeGraphId: a graph id, or 'largest' (most instances, then edges, then
 *   groups). frame: true stores a camera that fits that graph on screen.
 *   thumbnails: 'placeholder' seeds the image cache so Wikipedia thumbnails
 *   render (as a 1x1 image) instead of being fetched, retried and failed.
 * This is how the local-only chambers universe is injected (Playwright reads
 * the file in Node and passes it in); it is never served or committed.
 *
 *   window.__imageCache   the thumbnail store (services/imageCache.js), so the
 *                         perf scenarios S10a/S10b can write to it directly.
 *
 * Loading goes through the same steps as opening a file from the Universes
 * panel (UniverseManager): JSON.parse → validateFormatVersion →
 * importFromRedstring → graphStore.loadUniverseFromFile(storeState).
 *
 * Before the app mounts this also:
 *   - turns SaveCoordinator off for the whole session, so no load or edit is
 *     ever written to a file, browser storage or git;
 *   - makes universeBackend.initialize() and WorkspaceService.initialize()
 *     inert (the same stub the smoke test uses), so onboarding, auto-connect
 *     and git engines never start and never load a different universe on top
 *     of the fixture.
 * The sandbox (fixtureSandbox.js) has already isolated localStorage and the
 * network by the time this runs.
 */
import useGraphStore from '../store/graphStore.js';
import { saveCoordinator } from '../services/SaveCoordinator.js';
import workspaceService from '../services/WorkspaceService.js';
import { importFromRedstring, validateFormatVersion } from '../formats/redstringFormat.js';
import useImageCache from '../services/imageCache.js';

// Explicit per-name imports so Vite can resolve them statically. `?raw` hands
// back the file text, exactly what reading the file from disk would produce.
const COMMITTED_FIXTURES = {
  small: () => import('../../test/fixtures/canvas/small.redstring?raw'),
  stress: () => import('../../test/fixtures/canvas/stress.redstring?raw'),
};

// Per-fixture view defaults applied after load.
const FIXTURE_DEFAULTS = {
  small: { showConnectionNames: true },
  stress: { showConnectionNames: true },
};

const tag = '[fixture]';

function neutralizePersistence(universeBackend) {
  // SaveCoordinator: off now, and nothing may switch it back on (the backend's
  // initialize and BridgeClient's daemon coexistence both try).
  saveCoordinator.setEnabled(false);
  saveCoordinator.setEnabled = (enabled) => {
    if (enabled) console.info(`${tag} ignored SaveCoordinator.setEnabled(true)`);
  };
  saveCoordinator.initialize = () => {
    console.info(`${tag} SaveCoordinator.initialize skipped: fixture mode never saves`);
  };
  saveCoordinator.flush = async () => ({ skipped: 'fixture-mode' });
  saveCoordinator.hasUnsavedChanges = () => false;

  // Same stub as src/NodeCanvas.smoke.test.jsx: a status that matches no branch
  // of NodeCanvas's workspace effect, so it neither onboards nor auto-connects.
  workspaceService.initialize = async () => ({ status: 'NOOP' });
  workspaceService.getFolderHandle = () => null;

  // universeBackend.initialize would read the universe list, start git engines,
  // initialise SaveCoordinator with real storage adapters, and load the active
  // universe over the fixture.
  if (universeBackend) {
    // getAuthStatus() and friends call initialize() on every poll while the
    // backend reports uninitialised, so only the first skip is logged.
    let logged = false;
    universeBackend.initialize = async () => {
      if (!logged) console.info(`${tag} universeBackend.initialize skipped (fixture mode)`);
      logged = true;
    };
  }
}

/**
 * The graph with the most instances; ties go to more edges, then more groups.
 * For the chambers universe that is the 54-instance / ~40-edge / 13-group
 * graph METRICS.md calls "medium" (F-66). Group anchors count as instances,
 * the way F-66 counted them.
 */
function largestGraphId(st) {
  let best = null;
  let bestKey = null;
  for (const [id, g] of st.graphs) {
    const key = [g.instances?.size || 0, g.edgeIds?.length || 0, g.groups?.size || 0];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
      best = id;
      bestKey = key;
    }
  }
  return best;
}

/**
 * [panOffset, zoom] that fits a graph's instances into the canvas area, using
 * NodeCanvas's mapping: world = (client - rect - pan) / zoom + CANVAS_OFFSET.
 * Node size is approximated; this only has to put everything on screen.
 */
function fitView(graph) {
  const CANVAS_OFFSET = -50000; // NodeCanvas canvasSize.offsetX/Y
  const area = document.querySelector('.canvas-area')?.getBoundingClientRect();
  const width = area?.width || window.innerWidth;
  const height = area?.height || window.innerHeight - 50;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const inst of graph.instances?.values() || []) {
    minX = Math.min(minX, inst.x);
    minY = Math.min(minY, inst.y);
    maxX = Math.max(maxX, inst.x + 260);
    maxY = Math.max(maxY, inst.y + 140);
  }
  if (!Number.isFinite(minX)) return [{ x: width / 2 + CANVAS_OFFSET, y: height / 2 + CANVAS_OFFSET }, 1];
  const margin = 80;
  const zoom = Math.max(0.1, Math.min(1, (width - 2 * margin) / (maxX - minX), (height - 2 * margin - 60) / (maxY - minY)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return [{ x: width / 2 - (cx - CANVAS_OFFSET) * zoom, y: (height - 60) / 2 - (cy - CANVAS_OFFSET) * zoom }, zoom];
}

function summarize(label) {
  const st = useGraphStore.getState();
  const active = st.activeGraphId ? st.graphs.get(st.activeGraphId) : null;
  return {
    label,
    graphs: st.graphs.size,
    prototypes: st.nodePrototypes.size,
    edges: st.edges.size,
    activeGraphId: st.activeGraphId,
    instancesOnActive: active?.instances?.size ?? 0,
  };
}

// A 1x1 PNG. Stands in for Wikipedia thumbnails, which fixture mode can't fetch.
const PLACEHOLDER_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
let placeholderUrl = null;

/**
 * Put a placeholder thumbnail in the image cache for every prototype whose
 * image is an auto-enriched Wikipedia thumbnail (and not a user upload), so
 * the canvas renders those nodes with an image and never queues a fetch.
 *
 * Why (perf scenarios, P0.04): the sandbox blocks the fetch, imageCache
 * retries it (0.8 s, then 1.6 s), then marks the image failed. On a real
 * universe that is a burst of commits every ~3 s for ~15 s after load, which
 * lands inside whatever is being measured. Seeding before the store is loaded
 * means the canvas's thumbnail effect finds every image already cached.
 * Aspect ratios come from semanticMetadata, so nodes keep their real sizes.
 */
function seedPlaceholderThumbnails(nodePrototypes) {
  if (!placeholderUrl) {
    const bytes = Uint8Array.from(atob(PLACEHOLDER_PNG_BASE64), (c) => c.charCodeAt(0));
    placeholderUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  }
  const seed = {};
  for (const [protoId, proto] of nodePrototypes || []) {
    const meta = proto?.semanticMetadata;
    if (!meta?.wikipediaThumbnail || proto.thumbnailSrc) continue;
    seed[protoId] = { thumbnailSrc: placeholderUrl, imageAspectRatio: meta.imageAspectRatio || 1 };
  }
  // One write for the whole batch.
  useImageCache.setState((state) => ({ images: { ...state.images, ...seed } }));
  return Object.keys(seed).length;
}

/**
 * Load a `.redstring` document (object or text) through the real open-file
 * steps. Throws on anything the Universes panel would refuse.
 *
 * `thumbnails: 'placeholder'` seeds the image cache first; see
 * seedPlaceholderThumbnails.
 */
export async function loadFixtureData(data, { label = 'injected', activeGraphId = null, frame = false, thumbnails = null } = {}) {
  let parsedData = data;
  if (typeof data === 'string') {
    try {
      parsedData = JSON.parse(data);
    } catch (err) {
      throw new Error(`${tag} ${label}: invalid JSON: ${err.message}`);
    }
  }
  if (!parsedData || typeof parsedData !== 'object') {
    throw new Error(`${tag} ${label}: not a redstring document`);
  }

  const validation = validateFormatVersion(parsedData);
  if (!validation.valid) {
    throw new Error(`${tag} ${label}: ${validation.error || `unsupported format version ${validation.version}`}`);
  }

  const { storeState, errors } = importFromRedstring(parsedData);
  if (errors?.length) console.warn(`${tag} ${label}: import reported ${errors.length} error(s)`, errors.slice(0, 5));
  if (!storeState?.graphs?.size && !storeState?.nodePrototypes?.size) {
    throw new Error(`${tag} ${label}: import produced no graphs or prototypes`);
  }

  const thumbnailsSeeded = thumbnails === 'placeholder' ? seedPlaceholderThumbnails(storeState.nodePrototypes) : 0;

  const ok = useGraphStore.getState().loadUniverseFromFile(storeState);
  if (ok === false) {
    throw new Error(`${tag} ${label}: loadUniverseFromFile refused the data (${useGraphStore.getState().universeLoadingError || 'see console'})`);
  }

  if (activeGraphId) {
    const st = useGraphStore.getState();
    const targetId = activeGraphId === 'largest' ? largestGraphId(st) : activeGraphId;
    if (!st.graphs.has(targetId)) throw new Error(`${tag} ${label}: no graph ${activeGraphId}`);
    // Store a camera that fits the graph BEFORE activating it: NodeCanvas
    // jumps to the stored view on a graph switch.
    if (frame) st.updateGraphView(targetId, ...fitView(st.graphs.get(targetId)));
    useGraphStore.getState().openGraphTab(targetId);
    useGraphStore.getState().setActiveGraph(targetId);
  }

  const summary = { ...summarize(label), thumbnailsSeeded };
  window.__fixture = { ...summary, ready: true };
  return summary;
}

export async function bootFixtureMode(name) {
  const t0 = performance.now();
  const universeBackendModule = await import('../services/universeBackend.js');
  neutralizePersistence(universeBackendModule.default || universeBackendModule.universeBackend);

  // The harness reads the store through this. App.jsx also sets it, but its
  // comment marks that as temporary; fixture mode must not depend on it.
  window.useGraphStore = useGraphStore;
  window.__loadFixture = (data, opts) => loadFixtureData(data, opts);
  window.__imageCache = useImageCache;

  const loadCommitted = COMMITTED_FIXTURES[name];
  if (!loadCommitted) {
    throw new Error(`${tag} unknown fixture "${name}". Committed fixtures: ${Object.keys(COMMITTED_FIXTURES).join(', ')}. Inject others with window.__loadFixture().`);
  }
  const text = (await loadCommitted()).default;
  const summary = await loadFixtureData(text, { label: name });

  const params = new URLSearchParams(window.location.search);
  const defaults = { ...(FIXTURE_DEFAULTS[name] || {}) };
  if (params.has('labels')) defaults.showConnectionNames = params.get('labels') !== '0';
  if (Object.keys(defaults).length) useGraphStore.setState(defaults);

  console.info(`${tag} loaded "${name}" in ${Math.round(performance.now() - t0)} ms`, summary);
  return summary;
}
