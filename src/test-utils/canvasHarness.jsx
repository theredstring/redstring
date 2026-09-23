/**
 * Shared jsdom harness for mounting <NodeCanvas /> in a vitest file.
 *
 * Lifted from src/NodeCanvas.smoke.test.jsx (which is left as is) so the
 * contract tests and any later render-budget tests all mount the canvas the
 * same way. Two things can NOT live here and stay in each test file:
 *
 *   1. `vi.hoisted(...)` that sets or clears `redstring_disable_culling`.
 *      ENABLE_CULLING is a module-level constant read from localStorage when
 *      NodeCanvas.jsx is evaluated, and only a hoisted block in the test file
 *      itself runs early enough.
 *   2. `vi.mock(...)` calls. Vitest only hoists them out of the test file.
 *      Every file that mounts the canvas needs at least:
 *
 *        vi.mock('./services/WorkspaceService.js', () => {
 *          const stub = { initialize: async () => ({ status: 'NOOP' }), getFolderHandle: () => null };
 *          return { default: stub, workspaceService: stub };
 *        });
 *        vi.mock('./useCanvasWorker.js', () => ({ useCanvasWorker: () => ({
 *          calculatePan: vi.fn(), calculateNodePositions: vi.fn(),
 *          calculateZoom: vi.fn(), calculateSelection: vi.fn(),
 *        }) }));
 *
 *      (paths relative to the test file; these are for a file in src/).
 *
 * Why each stub exists is documented in the smoke test; the short version is
 * repeated inline below.
 */
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import NodeCanvas from '../NodeCanvas.jsx';
import useGraphStore from '../store/graphStore.js';

// --- hand-driven rAF ---------------------------------------------------------
// A queue, not a synchronous recursive stub: NodeCanvas runs lerp/momentum
// loops that re-schedule themselves, and cb(0)-style rAF spins forever on them.
let rafQueue = [];
let now = 0;

export const flushFrames = (count, stepMs = 16) => {
  for (let i = 0; i < count; i++) {
    const due = rafQueue;
    rafQueue = [];
    now += stepMs;
    act(() => { due.forEach((cb) => cb(now)); });
  }
};

// jsdom has no 2D context and the text measurement layer wants one.
const stubCanvas2D = () => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    let font = '';
    return {
      get font() { return font; },
      set font(v) { font = v; },
      measureText: (text) => {
        const size = Number((font.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16;
        return {
          width: text.length * size * 0.55,
          actualBoundingBoxAscent: size * 0.8,
          actualBoundingBoxDescent: size * 0.2,
        };
      },
    };
  };
};

const identityMatrix = () => ({
  a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
  inverse() { return identityMatrix(); },
  multiply() { return identityMatrix(); },
});

/** Call from beforeEach, before seeding the store. */
export const installCanvasStubs = () => {
  rafQueue = [];
  now = 0;
  stubCanvas2D();

  // LeftAIView scrolls a ref into view in a passive effect; jsdom lacks it.
  Element.prototype.scrollIntoView = vi.fn();

  vi.stubGlobal('requestAnimationFrame', (cb) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
  })));
  // The AI panel opens an SSE channel on mount; jsdom has no EventSource.
  vi.stubGlobal('EventSource', vi.fn(function ES() {
    this.close = vi.fn();
    this.addEventListener = vi.fn();
    this.removeEventListener = vi.fn();
  }));
  // Panel sections mount lazily behind an IntersectionObserver: report every
  // observed element visible so the panel tree mounts fully.
  vi.stubGlobal('IntersectionObserver', vi.fn(function IO(cb) {
    this.observe = (el) => cb([{ isIntersecting: true, target: el }], this);
    this.unobserve = vi.fn();
    this.disconnect = vi.fn();
    this.takeRecords = () => [];
  }));

  SVGElement.prototype.getBBox = vi.fn(() => ({ x: 0, y: 0, width: 100, height: 50 }));
  SVGElement.prototype.getScreenCTM = vi.fn(() => identityMatrix());
  SVGSVGElement.prototype.createSVGPoint = vi.fn(() => ({
    x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; },
  }));
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800,
    toJSON() { return this; },
  }));
};

/** Call from afterEach. */
export const teardownCanvasStubs = () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
};

export const makeGraph = (id, overrides = {}) => ({
  id,
  name: `Graph ${id}`,
  description: '',
  instances: new Map(),
  edgeIds: [],
  groups: new Map(),
  definingNodeIds: [],
  ...overrides,
});

export const makePrototype = (id, name, overrides = {}) => ({
  id,
  name,
  description: '',
  color: '#8B0000',
  typeNodeId: 'base-thing-prototype',
  definitionGraphIds: [],
  ...overrides,
});

/**
 * Replace the store with a single-graph universe that clears all four render
 * gates in NodeCanvas: the universe flags, an active graph, and the Set-valued
 * keys the render path indexes into.
 *
 * `graphViews` is reset every time so a camera saved by one test can never
 * leak into the next one's view restore. Pass `view` to pin the camera.
 *
 * @param {object} opts
 * @param {string} [opts.graphId='g1']
 * @param {Array<[string, string]>} opts.prototypes  [id, name] pairs
 * @param {{panOffset:{x:number,y:number}, zoomLevel:number}} [opts.view]
 * @param {object} [opts.state]  extra top-level store keys
 */
export const seedUniverse = ({ graphId = 'g1', prototypes = [], view = null, state = {} } = {}) => {
  useGraphStore.setState({
    graphs: new Map([[graphId, makeGraph(graphId)]]),
    graphViews: view ? new Map([[graphId, view]]) : new Map(),
    nodePrototypes: new Map(prototypes.map(([id, name]) => [id, makePrototype(id, name)])),
    edges: new Map(),
    openGraphIds: [graphId],
    activeGraphId: graphId,
    activeDefinitionNodeId: null,
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    selectedEdgeIds: new Set(),
    selectedEdgeId: null,
    typeListMode: 'closed',
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
    showConnectionNames: true,
    ...state,
  }, false, 'canvas_harness_seed');
};

/**
 * An async bootstrap effect settles after mount and flips hasUniverseFile
 * false, which sends NodeCanvas back to its loading gate and unmounts the
 * canvas. Call this inside the act() of any commit you force after mount.
 */
export const holdUniverseOpen = () => useGraphStore.setState({
  isUniverseLoading: false,
  isUniverseLoaded: true,
  hasUniverseFile: true,
  universeLoadingError: null,
}, false, 'canvas_harness_hold_gate');

export const renderCanvas = () => render(
  <DndProvider backend={HTML5Backend}>
    <NodeCanvas />
  </DndProvider>
);

/**
 * Mount, run the first frames (culling is rAF-scheduled), and wait until
 * `ready()` holds. Then pin the universe gate open and take a couple more
 * frames so every assertion reads a settled commit rather than racing the
 * bootstrap teardown.
 */
export const mountCanvas = async (ready = () => !!document.querySelector('svg.canvas')) => {
  const utils = renderCanvas();
  flushFrames(3);
  await waitFor(() => { expect(ready()).toBe(true); });
  act(() => { holdUniverseOpen(); });
  flushFrames(3);
  return utils;
};

export { useGraphStore };
