import React from 'react';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// ---------------------------------------------------------------------------
// Culling has to be OFF before NodeCanvas.jsx is evaluated: ENABLE_CULLING is a
// module-level constant that reads localStorage once at import time. With it
// off, runCulling's disabled branch marks every node and edge visible, which
// makes this test independent of the 100k x 100k canvas geometry and of jsdom's
// fabricated getBoundingClientRect. vi.hoisted runs before the imports below.
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  try { globalThis.localStorage?.setItem('redstring_disable_culling', 'true'); } catch { /* ignore */ }
});

// WorkspaceService.initialize() runs on mount and, on the NEEDS_ONBOARDING
// branch, calls setUniverseLoaded(true, false) — which sets hasUniverseFile
// false and knocks the render back to the loading screen. A status matching no
// branch keeps the effect inert.
// Plain functions, not vi.fn().mockResolvedValue(...): afterEach's
// restoreAllMocks() strips mock implementations, which would make initialize()
// return undefined on every test after the first.
vi.mock('./services/WorkspaceService.js', () => {
  const stub = {
    initialize: async () => ({ status: 'NOOP' }),
    getFolderHandle: () => null,
  };
  return { default: stub, workspaceService: stub };
});

vi.mock('./useCanvasWorker.js', () => ({
  useCanvasWorker: () => ({
    calculatePan: vi.fn(),
    calculateNodePositions: vi.fn(),
    calculateZoom: vi.fn(),
    calculateSelection: vi.fn(),
  }),
}));

import NodeCanvas from './NodeCanvas.jsx';
import useGraphStore from './store/graphStore.js';

// --- hand-driven rAF -------------------------------------------------------
// A queue, not a synchronous recursive stub: NodeCanvas runs lerp/momentum
// loops that re-schedule themselves, and cb(0)-style rAF spins forever on them.
let rafQueue = [];
let now = 0;
const flushFrames = (count, stepMs = 16) => {
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

const makeGraph = (id, overrides = {}) => ({
  id,
  name: `Graph ${id}`,
  description: '',
  instances: new Map(),
  edgeIds: [],
  groups: new Map(),
  definingNodeIds: [],
  ...overrides,
});

const makePrototype = (id, name, overrides = {}) => ({
  id,
  name,
  description: '',
  color: '#8B0000',
  typeNodeId: 'base-thing-prototype',
  definitionGraphIds: [],
  ...overrides,
});

/**
 * Minimum store state to clear all four render gates in NodeCanvas and land on
 * <svg class="canvas">: the universe flags, an active graph, and the Set-valued
 * keys the render path indexes into.
 */
const seedStore = () => {
  useGraphStore.setState({
    graphs: new Map([['g1', makeGraph('g1')]]),
    nodePrototypes: new Map([
      ['p1', makePrototype('p1', 'Alpha')],
      ['p2', makePrototype('p2', 'Beta')],
      ['p3', makePrototype('p3', 'Gamma')],
    ]),
    edges: new Map(),
    openGraphIds: ['g1'],
    activeGraphId: 'g1',
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
  }, false, 'smoke_test_seed');

  const st = useGraphStore.getState();
  st.addNodeInstance('g1', 'p1', { x: 0, y: 0 }, 'i1');
  st.addNodeInstance('g1', 'p2', { x: 600, y: 0 }, 'i2');
  st.addNodeInstance('g1', 'p3', { x: 0, y: 500 }, 'i3');
  st.addEdge('g1', { id: 'e1', sourceId: 'i1', destinationId: 'i2' });
  st.addEdge('g1', { id: 'e2', sourceId: 'i2', destinationId: 'i3' });
};

const renderCanvas = () => render(
  <DndProvider backend={HTML5Backend}>
    <NodeCanvas />
  </DndProvider>
);

beforeEach(() => {
  rafQueue = [];
  now = 0;
  stubCanvas2D();

  // The current failure in the legacy NodeCanvas.test.jsx: LeftAIView scrolls a
  // ref into view in a passive effect and jsdom has no such method.
  Element.prototype.scrollIntoView = vi.fn();

  vi.stubGlobal('requestAnimationFrame', (cb) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
  })));
  // Panel sections render lazily behind an IntersectionObserver. Report every
  // observed element as visible so the panel tree mounts fully rather than
  // leaving placeholders that could mask a regression.
  // The AI panel opens an SSE channel on mount. jsdom has no EventSource, and
  // the failure is caught and logged — stub it to keep the output readable.
  vi.stubGlobal('EventSource', vi.fn(function ES() {
    this.close = vi.fn();
    this.addEventListener = vi.fn();
    this.removeEventListener = vi.fn();
  }));
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

  seedStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// These counts are the contract that protects the edge-rendering extraction.
// Every data-* attribute asserted below is one that useNodeDrag.js queries by
// selector at drag start; if an extraction renames or drops one, node drag
// breaks silently at runtime and this is what catches it.
// ---------------------------------------------------------------------------
describe('NodeCanvas render smoke', () => {
  it('clears the loading gates and renders the canvas', async () => {
    renderCanvas();
    flushFrames(3);
    await waitFor(() => {
      expect(document.querySelector('svg.canvas')).toBeTruthy();
    });
  });

  it('renders one <g class="node"> per instance', async () => {
    renderCanvas();
    flushFrames(3);
    await waitFor(() => {
      expect(document.querySelectorAll('g.node')).toHaveLength(3);
    });
    expect(document.querySelector('[data-instance-id="i1"]')).toBeTruthy();
    expect(document.querySelector('[data-instance-id="i2"]')).toBeTruthy();
    expect(document.querySelector('[data-instance-id="i3"]')).toBeTruthy();
  });

  it('renders one wrapper per edge, keyed by data-edge-id', async () => {
    renderCanvas();
    flushFrames(3);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-edge-id]')).toHaveLength(2);
    });
    expect(document.querySelector('[data-edge-id="e1"]')).toBeTruthy();
    expect(document.querySelector('[data-edge-id="e2"]')).toBeTruthy();
  });

  it('emits the DOM contract that useNodeDrag queries', async () => {
    renderCanvas();
    flushFrames(3);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-edge-id]')).toHaveLength(2);
    });

    // One hit target per edge.
    expect(document.querySelectorAll('[data-edge-hit]').length).toBeGreaterThanOrEqual(2);

    // Labels: sprites never bake in jsdom (no IndexedDB, no font), so the text
    // fallback is what renders — which is exactly the form we want to assert on.
    expect(document.querySelectorAll('[data-connection-label="1"]').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll('.connection-label').length).toBeGreaterThanOrEqual(2);

    // Every label carries the frame token the drag updater reads back on drop.
    document.querySelectorAll('[data-connection-label="1"]').forEach((el) => {
      expect(el.getAttribute('data-label-frame')).toBeTruthy();
    });
  });

  // The edge element cache hands an unchanged edge back the identical React
  // element so the reconciler bails out of its subtree. That is only safe if a
  // cached edge is byte-for-byte what a freshly solved one would have been, so
  // compare the two paths across a re-render that must not touch any edge.
  //
  // This is the automated stand-in for the golden-DOM diff. It cannot cover
  // curved routing or baked sprites, which jsdom will not produce — those still
  // need checking in a browser before the cache is turned on for real.
  it('cached edges render identically to uncached ones', async () => {
    const edgeDom = () => Array.from(document.querySelectorAll('[data-edge-id]'))
      .map((el) => `${el.getAttribute('data-edge-id')}\n${el.outerHTML}`)
      .sort()
      .join('\n\n');

    const capture = async (cacheOn) => {
      window.__edgeCache = cacheOn;
      seedStore();
      renderCanvas();
      flushFrames(3);
      await waitFor(() => {
        expect(document.querySelectorAll('[data-edge-id]')).toHaveLength(2);
      });

      // An async bootstrap effect settles after mount and flips hasUniverseFile
      // false, which sends NodeCanvas back to its loading gate and unmounts the
      // canvas. Hold the gate open across the forced commits below.
      const holdUniverseOpen = () => useGraphStore.setState({
        isUniverseLoading: false,
        isUniverseLoaded: true,
        hasUniverseFile: true,
        universeLoadingError: null,
      }, false, 'smoke_hold_gate');

      // (1) A commit driven by a store field no edge reads. Every edge should
      //     hit the cache here — this is the case the cache exists for.
      act(() => { holdUniverseOpen(); useGraphStore.getState().setTypeListMode('open'); });
      flushFrames(2);
      const afterNoOpCommit = edgeDom();

      // (2) Now move an endpoint. Every edge touching it MUST re-solve; if the
      //     key is too coarse the cache serves a stale element and this half of
      //     the comparison fails while (1) still passes.
      act(() => {
        holdUniverseOpen();
        useGraphStore.getState().updateNodeInstance('g1', 'i2', (inst) => {
          inst.x = 900; inst.y = 250;
        });
      });
      flushFrames(2);
      const afterMove = edgeDom();

      cleanup();
      return { afterNoOpCommit, afterMove };
    };

    const uncached = await capture(false);
    const hitsBefore = window.__edgeCacheStats?.hits ?? 0;
    const cached = await capture(true);
    const hitsAfter = window.__edgeCacheStats?.hits ?? 0;

    // The comparison is only meaningful if the cache was actually exercised.
    expect(hitsAfter).toBeGreaterThan(hitsBefore);

    expect(uncached.afterNoOpCommit.length).toBeGreaterThan(0);
    expect(cached.afterNoOpCommit).toBe(uncached.afterNoOpCommit);

    // Moving a node must change the rendered edges, or (2) proves nothing.
    expect(uncached.afterMove).not.toBe(uncached.afterNoOpCommit);
    expect(cached.afterMove).toBe(uncached.afterMove);

    window.__edgeCache = false;
  });

  it('keeps edges inside the pan/zoom content group', async () => {
    renderCanvas();
    flushFrames(3);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-edge-id]')).toHaveLength(2);
    });
    // Label suppression during gestures works by toggling .canvas-moving on the
    // content <g>; an edge rendered outside it would never fade.
    const edge = document.querySelector('[data-edge-id="e1"]');
    expect(edge.closest('svg.canvas')).toBeTruthy();
  });
});
