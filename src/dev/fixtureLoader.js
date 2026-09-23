/**
 * fixtureLoader.js: DEV-ONLY fixture loader for the canvas harness.
 *
 * NodeCanvas refactor P0.02. main.jsx dynamic-imports this module only when
 * `import.meta.env.DEV` is true and `?fixture=<name>` is in the URL, and it
 * mounts the app only after `bootFixtureMode()` resolves. Production builds
 * never reference it (verify: `npm run build` then grep dist for __loadFixture).
 *
 *   /?fixture=small    committed, test/fixtures/canvas/small.redstring
 *   /?fixture=stress   committed, test/fixtures/canvas/stress.redstring
 *
 * Optional URL params: `labels=0|1` forces connection labels off/on.
 *
 * Test hook, available in fixture mode only:
 *   await window.__loadFixture(jsonObjectOrString, { label?, activeGraphId? })
 *     → { label, graphs, prototypes, edges, activeGraphId, instancesOnActive }
 * This is how the local-only chambers universe is injected (Playwright reads
 * the file in Node and passes it in); it is never served or committed.
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

/**
 * Load a `.redstring` document (object or text) through the real open-file
 * steps. Throws on anything the Universes panel would refuse.
 */
export async function loadFixtureData(data, { label = 'injected', activeGraphId = null } = {}) {
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

  const ok = useGraphStore.getState().loadUniverseFromFile(storeState);
  if (ok === false) {
    throw new Error(`${tag} ${label}: loadUniverseFromFile refused the data (${useGraphStore.getState().universeLoadingError || 'see console'})`);
  }

  if (activeGraphId) {
    const st = useGraphStore.getState();
    if (!st.graphs.has(activeGraphId)) throw new Error(`${tag} ${label}: no graph ${activeGraphId}`);
    st.openGraphTab(activeGraphId);
    useGraphStore.getState().setActiveGraph(activeGraphId);
  }

  const summary = summarize(label);
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
