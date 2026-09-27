import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// App mounts NodeCanvas, so it needs the same hoisted setup as the canvas
// tests (see src/test-utils/canvasHarness.jsx for why each piece exists).
vi.hoisted(() => {
  try { globalThis.localStorage?.setItem('redstring_disable_culling', 'true'); } catch { /* ignore */ }
});

vi.mock('./services/WorkspaceService.js', () => {
  const stub = { initialize: async () => ({ status: 'NOOP' }), getFolderHandle: () => null };
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

import App from './App';
import {
  installCanvasStubs,
  teardownCanvasStubs,
  flushFrames,
  holdUniverseOpen,
  makeGraph,
  makePrototype,
  useGraphStore,
} from './test-utils/canvasHarness.jsx';

// A universe with one open Web ("Main Workspace Graph") holding one Thing whose
// definition is a second Web ("My Definition Graph") that is not open yet.
// Header tabs only show for graphs that have a defining node, so the main Web
// is defined by its own prototype.
const seedUniverse = () => {
  useGraphStore.setState({
    graphs: new Map([
      ['g-main', makeGraph('g-main', { name: 'Main Workspace Graph', definingNodeIds: ['p-main'] })],
      ['g-def', makeGraph('g-def', { name: 'My Definition Graph', definingNodeIds: ['p-def'] })],
    ]),
    graphViews: new Map(),
    nodePrototypes: new Map([
      ['p-main', makePrototype('p-main', 'Main Workspace', { definitionGraphIds: ['g-main'] })],
      ['p-def', makePrototype('p-def', 'Click Me To Open Definition', { definitionGraphIds: ['g-def'] })],
    ]),
    edges: new Map(),
    openGraphIds: ['g-main'],
    activeGraphId: 'g-main',
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
  }, false, 'app_test_seed');
  useGraphStore.getState().addNodeInstance('g-main', 'p-def', { x: 0, y: 0 }, 'i-def');
};

const headerTabIds = () =>
  [...document.querySelectorAll('[data-header-tab-id]')].map((el) => el.getAttribute('data-header-tab-id'));

describe('App Integration Test', () => {
  beforeEach(() => {
    installCanvasStubs();
    // Header holds its tab strip back until its logo images preload, and jsdom
    // never fires image load events.
    vi.stubGlobal('Image', class {
      set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
      get src() { return this._src; }
    });
    seedUniverse();
  });

  afterEach(() => {
    teardownCanvasStubs();
  });

  it('should render layout, load initial data, and open definition graph in a tab on click', async () => {
    render(
      <DndProvider backend={HTML5Backend}>
        <App />
      </DndProvider>
    );
    flushFrames(3);

    // 1. Layout and data: the canvas draws the Thing, the header shows the open Web.
    await waitFor(() => {
      expect(document.querySelector('svg.canvas')).toBeTruthy();
    });
    act(() => { holdUniverseOpen(); });
    flushFrames(3);
    expect(document.querySelector('[data-instance-id="i-def"]')).toBeTruthy();
    await waitFor(() => {
      expect(headerTabIds()).toEqual(['g-main']);
    });
    expect(screen.getByTitle('Main Workspace Graph')).toBeTruthy();
    expect(screen.queryByTitle('My Definition Graph')).toBeNull();

    // 2. Open the Thing's panel tab, then its "Open this Web" button.
    act(() => { useGraphStore.getState().openRightPanelNodeTab('p-def'); });
    flushFrames(3);
    const openWebButton = await screen.findByTitle('Open this Web');

    // The button launches the hurtle orb, which opens the tab when it lands.
    // Its start time comes from performance.now(); pin it to the harness's rAF
    // clock so the flight completes within the frames flushed below.
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    act(() => { openWebButton.click(); });
    nowSpy.mockRestore();
    flushFrames(40);

    // 3. The definition Web is now an open, active header tab.
    await waitFor(() => {
      expect(headerTabIds()).toEqual(['g-main', 'g-def']);
    });
    expect(screen.getByTitle('My Definition Graph')).toBeTruthy();
    expect(useGraphStore.getState().activeGraphId).toBe('g-def');
    expect(screen.getByTitle('This Web is open')).toBeTruthy();
  });
});
