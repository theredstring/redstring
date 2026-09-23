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
    selectedEdgeIds: new Set(),
    selectedEdgeId: null,
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
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
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
});
