import React, { Profiler } from 'react';
import { render, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// ---------------------------------------------------------------------------
// Render-budget regression tests: count React commits under NodeCanvas while an
// interaction runs, and fail if a gesture that should live entirely in refs and
// direct DOM writes starts committing once per frame again.
//
// The harness mirrors NodeCanvas.smoke.test.jsx (see the comments there for why
// each stub exists). Culling must be off before NodeCanvas.jsx is evaluated: it
// is a module-level constant read from localStorage at import time.
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  try { globalThis.localStorage?.setItem('redstring_disable_culling', 'true'); } catch { /* ignore */ }
});

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
import { resetServerAvailabilityCache } from './utils/debugLogger.js';
import useCanvasUIStore from './store/canvasUIStore.js';
import useImageCache from './services/imageCache.js';
import { renderProbe } from './utils/perf/renderProbe.js';

// --- hand-driven rAF -------------------------------------------------------
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

const makeGraph = (id) => ({
  id,
  name: `Graph ${id}`,
  description: '',
  instances: new Map(),
  edgeIds: [],
  groups: new Map(),
  definingNodeIds: [],
});

const makePrototype = (id, name) => ({
  id,
  name,
  description: '',
  color: '#8B0000',
  typeNodeId: 'base-thing-prototype',
  definitionGraphIds: [],
});

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
    typeListMode: 'closed',
    isUniverseLoaded: true,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
    showConnectionNames: true,
  }, false, 'render_budget_seed');

  const st = useGraphStore.getState();
  st.addNodeInstance('g1', 'p1', { x: 0, y: 0 }, 'i1');
  st.addNodeInstance('g1', 'p2', { x: 600, y: 0 }, 'i2');
  st.addNodeInstance('g1', 'p3', { x: 0, y: 500 }, 'i3');
  st.addEdge('g1', { id: 'e1', sourceId: 'i1', destinationId: 'i2' });
  st.addEdge('g1', { id: 'e2', sourceId: 'i2', destinationId: 'i3' });
};

// An async bootstrap effect settles after mount and can flip hasUniverseFile
// false, which unmounts the canvas. Pin the gates open around the gesture.
const holdUniverseOpen = () => useGraphStore.setState({
  isUniverseLoading: false,
  isUniverseLoaded: true,
  hasUniverseFile: true,
  universeLoadingError: null,
}, false, 'render_budget_hold_gate');

// Every commit that touches anything under NodeCanvas (NodeCanvas itself or any
// descendant that re-renders on its own) lands here.
let commits = [];
const onRender = (id, phase, actualDuration) => { commits.push({ phase, actualDuration }); };

const renderCanvas = () => render(
  <DndProvider backend={HTML5Backend}>
    <Profiler id="NodeCanvas" onRender={onRender}>
      <NodeCanvas />
    </Profiler>
  </DndProvider>
);

// Mount, then let the mount-time effects and their follow-up commits settle so
// the measured window contains only what the gesture causes.
const mountAndSettle = async () => {
  renderCanvas();
  flushFrames(3);
  await waitFor(() => {
    expect(document.querySelector('svg.canvas')).toBeTruthy();
    expect(document.querySelectorAll('g.node')).toHaveLength(3);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  act(() => { holdUniverseOpen(); });
  flushFrames(5);
  // NodeCanvas sets isInitialLoadComplete 2 s after mount (a real timer). Let it
  // fire here: otherwise it lands wherever the test has got to by then, which
  // under a loaded full run was the marquee's hold window. Scheduled after
  // mount, this wait always fires after it.
  await act(async () => { await new Promise((r) => setTimeout(r, 2100)); });
  flushFrames(5);
  return document.querySelector('svg.canvas');
};

beforeEach(() => {
  rafQueue = [];
  now = 0;
  commits = [];
  stubCanvas2D();
  Element.prototype.scrollIntoView = vi.fn();

  vi.stubGlobal('requestAnimationFrame', (cb) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
  })));
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

describe('NodeCanvas render budget', () => {
  // S1 (mouse drag-pan on empty canvas). Pan is applied by writing the content
  // <g>'s transform attribute from a rAF; nothing about it needs React until the
  // gesture settles. Allowed: the press, the first move past the threshold, the
  // release, and the settle — never one commit per frame.
  it('drag-pan on empty canvas does not commit per frame', async () => {
    const svg = await mountAndSettle();
    const contentGroup = svg.querySelector(':scope > g');
    const transformBefore = contentGroup.getAttribute('transform');

    const START = { x: 500, y: 400 };
    const MOVES = 30;
    const STEP = -6; // toward negative pan so the clamp at 0 never stops the view

    commits = [];
    act(() => { fireEvent.mouseDown(svg, { clientX: START.x, clientY: START.y, button: 0 }); });
    const pressCommits = commits.length;

    // Two warm-up moves take the gesture past the movement threshold, which is
    // allowed to commit once.
    let x = START.x;
    let y = START.y;
    for (let i = 0; i < 2; i++) {
      x += STEP; y += STEP;
      act(() => { fireEvent.mouseMove(svg, { clientX: x, clientY: y, buttons: 1 }); });
      flushFrames(1);
    }
    const warmupCommits = commits.length - pressCommits;

    commits = [];
    for (let i = 0; i < MOVES; i++) {
      x += STEP; y += STEP;
      act(() => { fireEvent.mouseMove(svg, { clientX: x, clientY: y, buttons: 1 }); });
      flushFrames(1);
    }
    const steadyCommits = commits.length;
    const transformAfter = contentGroup.getAttribute('transform');

    act(() => { fireEvent.mouseUp(svg, { clientX: x, clientY: y, button: 0 }); });
    flushFrames(3);

    // Printed so a failing run (or a before/after comparison) shows the numbers.
    console.error(`[render-budget] drag-pan: press=${pressCommits} warmup=${warmupCommits} steady=${steadyCommits}/${MOVES} moves`);

    // The pan path really ran: the view moved.
    expect(transformAfter).toBeTruthy();
    expect(transformAfter).not.toBe(transformBefore);

    // No per-frame commits while the drag continues.
    expect(steadyCommits).toBe(0);
  });

  // P1.07 / F-26: render must not do debug I/O. The old edges pass POSTed to a
  // local debug server whenever parallel edges existed, and warned about edges
  // whose arrowsToward named a non-endpoint. Seed exactly those conditions,
  // then force re-renders with a store field no debug path reads.
  it('re-rendering makes no network requests and no debug warnings', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);
    const st = useGraphStore.getState();
    st.addEdge('g1', { id: 'e3', sourceId: 'i1', destinationId: 'i2' }); // parallel to e1
    useGraphStore.setState((s) => {
      const edges = new Map(s.edges);
      edges.set('e3', { ...edges.get('e3'), directionality: { arrowsToward: new Set(['not-an-endpoint']) } });
      return { edges };
    }, false, 'render_budget_stale_arrow');

    await mountAndSettle();

    // debugLogger goes quiet for five minutes after a failed request (its
    // import-time health check fails in jsdom), which would hide render-time
    // POSTs. Clear that so any request from render reaches the spy.
    resetServerAvailabilityCache();
    fetchSpy.mockClear();
    const warnSpy = vi.spyOn(console, 'warn');

    commits = [];
    for (let i = 0; i < 3; i++) {
      act(() => { holdUniverseOpen(); useGraphStore.getState().setTypeListMode(i % 2 ? 'closed' : 'open'); });
      flushFrames(2);
    }

    expect(commits.length).toBeGreaterThan(0); // the re-renders really happened
    expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual([]);
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toEqual([]);
  });

  // S1t (one-finger touch pan). useCanvasTouch synthesises mouse events and
  // feeds the same handleMouseMove pan path, so the same budget applies.
  it('one-finger touch pan does not commit per frame', async () => {
    const svg = await mountAndSettle();
    const contentGroup = svg.querySelector(':scope > g');
    const transformBefore = contentGroup.getAttribute('transform');

    const touchAt = (x, y) => [{ identifier: 0, clientX: x, clientY: y, target: svg }];
    const START = { x: 500, y: 400 };
    const MOVES = 30;
    const STEP = -6;

    commits = [];
    act(() => { fireEvent.touchStart(svg, { touches: touchAt(START.x, START.y), changedTouches: touchAt(START.x, START.y) }); });
    const pressCommits = commits.length;

    let x = START.x;
    let y = START.y;
    for (let i = 0; i < 2; i++) {
      x += STEP; y += STEP;
      act(() => { fireEvent.touchMove(svg, { touches: touchAt(x, y), changedTouches: touchAt(x, y) }); });
      flushFrames(1);
    }
    const warmupCommits = commits.length - pressCommits;

    commits = [];
    for (let i = 0; i < MOVES; i++) {
      x += STEP; y += STEP;
      act(() => { fireEvent.touchMove(svg, { touches: touchAt(x, y), changedTouches: touchAt(x, y) }); });
      flushFrames(1);
    }
    const steadyCommits = commits.length;
    const transformAfter = contentGroup.getAttribute('transform');

    act(() => { fireEvent.touchEnd(svg, { touches: [], changedTouches: touchAt(x, y) }); });
    flushFrames(3);

    console.error(`[render-budget] touch-pan: press=${pressCommits} warmup=${warmupCommits} steady=${steadyCommits}/${MOVES} moves`);

    expect(transformAfter).toBeTruthy();
    expect(transformAfter).not.toBe(transformBefore);
    expect(steadyCommits).toBe(0);
  });

  // S5 (marquee, P1.04 / F-03). The box is written straight to the <rect> and
  // the selection is re-derived at most once a frame; React hears about it only
  // when the set of selected nodes changes. Before P1.04 every move committed
  // (a worker round trip, then setSelectionRect and a fresh Set).
  it('marquee commits only when the selection changes, not per move', async () => {
    // A known camera: zoom 1, world (0,0) at client (500,400). The canvas is
    // offset by -50000 on both axes, and the container rect is stubbed at 0,0.
    useGraphStore.setState({
      graphViews: new Map([['g1', { panOffset: { x: -49500, y: -49600 }, zoomLevel: 1 }]]),
    }, false, 'render_budget_camera');
    const svg = await mountAndSettle();
    const at = (wx, wy) => ({ clientX: wx + 500, clientY: wy + 400, metaKey: true, ctrlKey: true, buttons: 1 });
    const selectedIds = () => [...document.querySelectorAll('g.node.selected')]
      .map((el) => el.getAttribute('data-instance-id')).sort().join(',');
    // async so a handler that awaits (the pre-P1.04 worker path) is measured fairly.
    const moveTo = async (wx, wy) => {
      await act(async () => { fireEvent.mouseMove(svg, at(wx, wy)); });
      flushFrames(1);
    };

    // Seeded nodes sit at (0,0), (600,0) and (0,500). Sweep a box over all
    // three, then keep dragging inside the region where all three stay selected.
    const FROM = { x: -300, y: -300 };
    const TO = { x: 1100, y: 900 };
    const SWEEP = 40;
    const HOLD = 30;

    commits = [];
    act(() => { fireEvent.mouseDown(svg, { ...at(FROM.x, FROM.y), button: 0 }); });
    flushFrames(1);
    const pressCommits = commits.length;

    commits = [];
    let membershipChanges = 0;
    let last = selectedIds();
    for (let i = 1; i <= SWEEP; i++) {
      await moveTo(FROM.x + ((TO.x - FROM.x) * i) / SWEEP, FROM.y + ((TO.y - FROM.y) * i) / SWEEP);
      const now = selectedIds();
      if (now !== last) { membershipChanges++; last = now; }
    }
    flushFrames(3);
    const sweepCommits = commits.length;
    const liveWidth = Number(svg.querySelector('rect[stroke="red"]')?.getAttribute('width'));

    commits = [];
    for (let i = 1; i <= HOLD; i++) await moveTo(TO.x + i * 5, TO.y + i * 5);
    const holdCommits = commits.length;
    const holdSelection = selectedIds();

    commits = [];
    await act(async () => { fireEvent.mouseUp(svg, { ...at(TO.x + HOLD * 5, TO.y + HOLD * 5), button: 0 }); });
    flushFrames(3);
    const releaseCommits = commits.length;

    console.error(`[render-budget] marquee: press=${pressCommits} sweep=${sweepCommits}/${SWEEP} moves `
      + `(membershipChanges=${membershipChanges}) hold=${holdCommits}/${HOLD} moves release=${releaseCommits}`);

    // The box was drawn to the size of the drag without React.
    expect(liveWidth).toBeCloseTo(TO.x - FROM.x, 0);
    expect(holdSelection).toBe('i1,i2,i3');
    // Moves that don't change who is selected cost nothing.
    expect(holdCommits).toBe(0);
    // Moves that do cost one selection commit each, plus the cascade any
    // selection change already triggers: NodeCanvas's lastSelected* effects
    // commit a nested update, and follow-up work commits once or twice more
    // (P1.12 / P5 territory). Measured 12-14 here; before P1.04 it was 115,
    // with 90 more over the 30 hold moves. Bounded by changes, not by moves.
    expect(membershipChanges).toBe(3);
    expect(sweepCommits).toBeLessThanOrEqual(membershipChanges * 5 + 2);
    // The release keeps the selection and drops the rectangle.
    expect(selectedIds()).toBe('i1,i2,i3');
    expect(svg.querySelector('rect[stroke="red"]')).toBeNull();
  });

  // Guardrails from the refactor's close (P6.04; success criteria 2 and 3, perf
  // scenarios S8, S10b and S11). A hover lives in canvasUIStore and is drawn by
  // EdgeLayer, so NodeCanvas itself must not render for it. Writes that don't
  // touch the active graph (another graph's data, thumbnails for prototypes not
  // on it) must not commit anything under the canvas at all.
  //
  // "NodeCanvas rendered" is read off HitboxDebugLayer: a ctx layer with no
  // subscriptions of its own, so it renders exactly when NodeCanvas does (the
  // perf harness's S6 shows the two counts equal).
  it('a hover change does not render NodeCanvas (S8)', async () => {
    await mountAndSettle();
    renderProbe.enable();
    renderProbe.start('hover');
    act(() => { useCanvasUIStore.getState().setHoveredEdgeInfo({ edgeId: 'e1' }); });
    flushFrames(2);
    act(() => { useCanvasUIStore.getState().setHoveredEdgeInfo({ edgeId: 'e2' }); });
    flushFrames(2);
    act(() => { useCanvasUIStore.getState().setHoveredEdgeInfo(null); });
    flushFrames(2);
    const r = renderProbe.stop();
    console.error(`[render-budget] hover: ${JSON.stringify(Object.fromEntries(Object.entries(r.byId).map(([k, v]) => [k, v.commits])))}`);
    expect(r.byId.HitboxDebugLayer).toBeUndefined();
  });

  it('writes that do not touch the active graph commit nothing under the canvas (S10b, S11)', async () => {
    await mountAndSettle();
    // A second graph and a prototype that only it uses.
    act(() => {
      const st = useGraphStore.getState();
      useGraphStore.setState({
        graphs: new Map([...st.graphs, ['g2', makeGraph('g2')]]),
        nodePrototypes: new Map([...st.nodePrototypes, ['p9', makePrototype('p9', 'Elsewhere')]]),
      }, false, 'render_budget_other_graph');
      useGraphStore.getState().addNodeInstance('g2', 'p9', { x: 0, y: 0 }, 'i9');
    });
    flushFrames(5);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    flushFrames(5);

    commits = [];
    // S10b: thumbnails for a prototype that is not on the active graph.
    for (let i = 0; i < 5; i++) {
      act(() => { useImageCache.getState().setImage('p9', { thumbnailSrc: `https://example.invalid/${i}.png`, imageAspectRatio: 1 }); });
      flushFrames(1);
    }
    const thumbnailCommits = commits.length;

    commits = [];
    // S11: edits to a graph that is not active.
    for (let i = 0; i < 5; i++) {
      act(() => { useGraphStore.getState().updateGraph('g2', (draft) => { draft.description = `edit ${i}`; }); });
      flushFrames(1);
    }
    const otherGraphCommits = commits.length;

    console.error(`[render-budget] off-graph writes: thumbnails=${thumbnailCommits} otherGraph=${otherGraphCommits}`);
    expect(thumbnailCommits).toBe(0);
    expect(otherGraphCommits).toBe(0);
  });
});
