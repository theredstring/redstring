import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { civilizationView, openingZoom } from '../../src/components/canvas/camera/backToCivilization.js';
import { restoreViewForGraph } from '../../src/components/canvas/camera/viewPersistence.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { generateStateHash } from '../../src/services/saveHash.js';

/**
 * Where the person is looking is not part of the universe: no camera and no
 * active web in the file, the save hash or Git. A universe opens on its first
 * open web, and a web with no view this session opens framed on its largest
 * cluster, within the zoom limits.
 */

const dims = () => ({ currentWidth: 100, currentHeight: 60 });
const grid = (prefix, x0, y0, count) => Array.from({ length: count }, (_, k) => ({
  id: `${prefix}${k}`, x: x0 + (k % 6) * 150, y: y0 + Math.floor(k / 6) * 120,
}));
const dimsById = (nodes) => new Map(nodes.map(n => [n.id, dims()]));
const viewportSize = { width: 1200, height: 800 };
const canvasSize = { width: 100000, height: 100000, offsetX: -50000, offsetY: -50000 };

/** The world point at the middle of the viewport, and what the viewport shows. */
const seen = ({ pan, zoom }, canvas = canvasSize) => ({
  centreX: (viewportSize.width / 2 - pan.x) / zoom + canvas.offsetX,
  centreY: (viewportSize.height / 2 - pan.y) / zoom + canvas.offsetY,
  minX: -pan.x / zoom + canvas.offsetX,
  maxX: (viewportSize.width - pan.x) / zoom + canvas.offsetX,
  minY: -pan.y / zoom + canvas.offsetY,
  maxY: (viewportSize.height - pan.y) / zoom + canvas.offsetY,
});
const inView = (view, node) => node.x >= view.minX && node.x + 100 <= view.maxX
  && node.y >= view.minY && node.y + 60 <= view.maxY;

// Three clusters too far apart for one screen: 40 Things, 15 Things 20,000
// units away, 5 Things in a far corner.
const big = grid('big', 0, 0, 40);
const mid = grid('mid', 20000, 3000, 15);
const small = grid('small', -15000, -15000, 5);
const threeClusters = [...small, ...mid, ...big];

describe('framing a web with no view', () => {
  it('lands on the largest of three far-apart clusters, all of it in view', () => {
    const view = civilizationView({ nodes: threeClusters, baseDimsById: dimsById(threeClusters), viewportSize, canvasSize, maxZoom: 1 });
    const box = seen(view);
    big.forEach(n => expect(inView(box, n)).toBe(true));
    [...mid, ...small].forEach(n => expect(inView(box, n)).toBe(false));
  });

  it('opens a cluster of one Thing no closer than zoom 1', () => {
    const nodes = [{ id: 'one', x: 0, y: 0 }];
    expect(civilizationView({ nodes, baseDimsById: dimsById(nodes), viewportSize, canvasSize, maxZoom: 1 }).zoom).toBe(1);
  });

  it('stops at the zoom floor for a cluster too big to fit, centred on a Thing rather than empty space', () => {
    // A ring 40,000 across, joined all the way round: one cluster, empty in the middle.
    const ring = Array.from({ length: 400 }, (_, k) => {
      const a = (k / 400) * Math.PI * 2;
      return { id: `r${k}`, x: Math.round(20000 * Math.cos(a)), y: Math.round(20000 * Math.sin(a)) };
    });
    const view = civilizationView({ nodes: ring, baseDimsById: dimsById(ring), viewportSize, canvasSize, maxZoom: 1 });
    expect(view.zoom).toBe(0.2);
    const box = seen(view);
    expect(ring.some(n => inView(box, n))).toBe(true);
  });

  it('never zooms out past what the canvas allows', () => {
    // A small canvas: fitting it in the viewport needs zoom 0.3, above the usual floor.
    const smallCanvas = { width: 4000, height: 4000, offsetX: -2000, offsetY: -2000 };
    const spread = [{ id: 'a', x: -1900, y: -1900 }, { id: 'b', x: 1800, y: 1800 }];
    const view = civilizationView({ nodes: spread, baseDimsById: dimsById(spread), viewportSize, canvasSize: smallCanvas, maxZoom: 1 });
    expect(view.zoom).toBeCloseTo(0.3, 5);
  });
});

describe('restoring a web\'s view', () => {
  const restore = (overrides = {}) => {
    const jumps = [];
    const ctx = {
      draggingNodeInfoRef: { current: null }, isAnimatingZoomRef: { current: false }, wasDraggingRef: { current: false },
      setIsViewReady: () => {}, activeGraphId: 'w', viewportSize, canvasSize,
      transform: { jumpTo: (pan, zoom) => jumps.push({ pan, zoom }) },
      nodes: threeClusters, baseDimsById: dimsById(threeClusters), connections: null,
      openedGraphRef: { current: null }, newlyOpenedRef: { current: null },
      ...overrides,
    };
    restoreViewForGraph(ctx);
    return { jumps, ctx };
  };

  beforeEach(() => useGraphStore.setState({ graphViews: new Map() }));

  it('frames the largest cluster when the web has no view this session', () => {
    const { jumps } = restore();
    const box = seen(jumps[0]);
    big.forEach(n => expect(inView(box, n)).toBe(true));
  });

  it('frames it again on a resize before the first view is kept, never the empty middle of the canvas', () => {
    const { ctx } = restore();
    const again = [];
    restoreViewForGraph({ ...ctx, transform: { jumpTo: (pan, zoom) => again.push({ pan, zoom }) } });
    const box = seen(again[0]);
    big.forEach(n => expect(inView(box, n)).toBe(true));
  });

  it('returns to the view this session left the web at', () => {
    const kept = { panOffset: { x: -50000, y: -50000 }, zoomLevel: 0.7 };
    // Shows part of the big cluster, so it is not reframed.
    kept.panOffset = { x: viewportSize.width / 2 - (300 + 50000) * 0.7, y: viewportSize.height / 2 - (200 + 50000) * 0.7 };
    useGraphStore.setState({ graphViews: new Map([['w', kept]]) });
    const { jumps } = restore();
    expect(jumps[0]).toEqual({ pan: kept.panOffset, zoom: 0.7 });
  });

  it('opens at zoom 1 on a desktop or tablet, further out on a phone', () => {
    expect(openingZoom({ width: 1440, height: 900 })).toBe(1);
    expect(openingZoom({ width: 820, height: 1100 })).toBe(1);
    expect(openingZoom({ width: 390, height: 664 })).toBeCloseTo(0.6, 5);
    expect(openingZoom({ width: 844, height: 300 })).toBe(0.5);
  });

  it('opens an empty web and a one-Thing web on a phone at the phone\'s opening zoom', () => {
    const phone = { width: 390, height: 664 };
    expect(restore({ viewportSize: phone, nodes: [] }).jumps[0].zoom).toBeCloseTo(0.6, 5);
    const one = [{ id: 'a', x: 50000, y: 50000 }];
    expect(restore({ viewportSize: phone, nodes: one, baseDimsById: dimsById(one) }).jumps[0].zoom).toBeCloseTo(0.6, 5);
  });
});

// --- the file and the store -------------------------------------------------

const web = (id, name, instances = []) => ({
  id, name, description: '', definingNodeIds: [`def-${id}`], edgeIds: [], groups: new Map(),
  instances: new Map(instances.map(([iid, x]) => [iid, { id: iid, prototypeId: 'p1', x, y: 0, scale: 1 }])),
});
const universeState = () => ({
  graphs: new Map([
    ['w1', web('w1', 'First', [['i1', 0]])],
    ['w2', web('w2', 'Second', [['i2', 0]])],
    ['w3', web('w3', 'Third')],
  ]),
  nodePrototypes: new Map([
    ['p1', { id: 'p1', name: 'Thing', typeNodeId: null, definitionGraphIds: [] }],
    ['def-w1', { id: 'def-w1', name: 'First', typeNodeId: null, definitionGraphIds: ['w1'] }],
    ['def-w2', { id: 'def-w2', name: 'Second', typeNodeId: null, definitionGraphIds: ['w2'] }],
    ['def-w3', { id: 'def-w3', name: 'Third', typeNodeId: null, definitionGraphIds: ['w3'] }],
  ]),
  edges: new Map(),
  openGraphIds: ['w1', 'w2'],
  activeGraphId: 'w2',
  activeDefinitionNodeId: 'def-w2',
  graphViews: new Map([['w1', { panOffset: { x: 120, y: -40 }, zoomLevel: 0.5 }]]),
  expandedGraphIds: new Set(),
  savedNodeIds: new Set(),
  savedGraphIds: new Set(),
  rightPanelTabs: [{ type: 'home', isActive: true }],
});

describe('the file holds no camera and no active web', () => {
  it('writes neither', () => {
    // The @context still names the old terms, so older files stay valid JSON-LD.
    const { '@context': _vocabulary, ...document } = exportToRedstring(universeState());
    const text = JSON.stringify(document);
    expect(text).not.toMatch(/panOffset|zoomLevel|activeGraphId|activeDefinitionNodeId|activeInContext/);
  });

  it('reads a universe as open on its first open web, whatever an older file says', () => {
    const data = exportToRedstring(universeState());
    const firstWeb = data.spatialGraphs.graphs.w1;
    firstWeb['redstring:panOffset'] = { x: 999, y: 999 };
    firstWeb['redstring:zoomLevel'] = 3;
    data.userInterface['redstring:activeGraphId'] = 'w2';
    data.userInterface['redstring:activeDefinitionNodeId'] = 'def-w2';
    const { storeState } = importFromRedstring(data);
    expect(storeState.activeGraphId).toBe('w1');
    expect(storeState.activeDefinitionNodeId).toBe('def-w1');
    expect(storeState.graphs.get('w1').panOffset).toBeUndefined();
    expect(storeState.graphs.get('w1').zoomLevel).toBeUndefined();
  });

  it('does not count a web switch or a camera move as a change to save', () => {
    const state = universeState();
    const moved = { ...state, activeGraphId: 'w1', activeDefinitionNodeId: 'def-w1', graphViews: new Map() };
    expect(generateStateHash(moved)).toBe(generateStateHash(state));
    const opened = { ...state, openGraphIds: ['w1', 'w2', 'w3'] };
    expect(generateStateHash(opened)).not.toBe(generateStateHash(state));
  });
});

describe('loading a universe', () => {
  const load = (state) => useGraphStore.getState().loadUniverseFromFile(exportToRedstring(state));

  beforeEach(() => {
    useGraphStore.setState({ graphs: new Map(), graphViews: new Map(), openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null, _isLoadingUniverse: false });
  });

  it('opens a universe on its first open web, with no views', () => {
    expect(load(universeState())).toBe(true);
    const st = useGraphStore.getState();
    expect(st.activeGraphId).toBe('w1');
    expect(st.activeDefinitionNodeId).toBe('def-w1');
    expect(st.graphViews.size).toBe(0);
  });

  it('keeps the web you are on and your views when the same universe reloads (a Git pull)', () => {
    load(universeState());
    useGraphStore.getState().setActiveGraph('w2');
    const view = { panOffset: { x: 5, y: 6 }, zoomLevel: 0.8 };
    useGraphStore.getState().updateGraphView('w2', view.panOffset, view.zoomLevel);
    load(universeState());
    const st = useGraphStore.getState();
    expect(st.activeGraphId).toBe('w2');
    expect(st.activeDefinitionNodeId).toBe('def-w2');
    expect(st.graphViews.get('w2')).toEqual(view);
  });

  it('falls back to the first open web when the one you were on was closed elsewhere', () => {
    load(universeState());
    useGraphStore.getState().setActiveGraph('w2');
    load({ ...universeState(), openGraphIds: ['w1'] });
    expect(useGraphStore.getState().activeGraphId).toBe('w1');
  });
});

describe('the panel is the person\'s, not the universe\'s', () => {
  const panelState = () => ({
    ...universeState(),
    expandedGraphIds: new Set(['w1', 'w2']),
    rightPanelTabs: [{ type: 'home', isActive: false }, { type: 'node', nodeId: 'p1', isActive: true }],
    showConnectionNames: false,
  });
  const load = (state) => useGraphStore.getState().loadUniverseFromFile(exportToRedstring(state));

  beforeEach(() => {
    useGraphStore.setState({ graphs: new Map(), graphViews: new Map(), openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
      expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }], _isLoadingUniverse: false });
  });

  it('writes no tabs, expanded webs or connection-name setting', () => {
    const { '@context': _vocabulary, ...document } = exportToRedstring(panelState());
    expect(JSON.stringify(document)).not.toMatch(/rightPanelTabs|expandedGraphIds|showConnectionNames|redstring:expanded"/);
  });

  it('reads an older file on the home tab with nothing expanded, whatever it says', () => {
    const data = exportToRedstring(panelState());
    data.userInterface['redstring:rightPanelTabs'] = [{ type: 'node', nodeId: 'p1', isActive: true }];
    data.userInterface['redstring:expandedGraphIds'] = ['w1'];
    data.userInterface['redstring:showConnectionNames'] = false;
    const { storeState } = importFromRedstring(data);
    expect(storeState.rightPanelTabs).toEqual([{ type: 'home', isActive: true }]);
    expect(storeState.expandedGraphIds.size).toBe(0);
    expect('showConnectionNames' in storeState).toBe(false);
  });

  it('does not count a tab, an expanded web or the connection names as a change to save', () => {
    const state = universeState();
    expect(generateStateHash(panelState())).toBe(generateStateHash(state));
  });

  it('keeps your tabs and expanded webs when the same universe reloads, minus what is gone', () => {
    load(universeState());
    useGraphStore.setState({
      expandedGraphIds: new Set(['w1', 'w3']),
      rightPanelTabs: [{ type: 'home', isActive: false }, { type: 'node', nodeId: 'p1', isActive: true }, { type: 'node', nodeId: 'def-w3', isActive: false }],
    });
    const pulled = universeState();
    pulled.graphs.delete('w3');
    pulled.nodePrototypes.delete('def-w3');
    load(pulled);
    const st = useGraphStore.getState();
    expect([...st.expandedGraphIds]).toEqual(['w1']);
    expect(st.rightPanelTabs).toEqual([{ type: 'home', isActive: false }, { type: 'node', nodeId: 'p1', isActive: true }]);
  });

  it('opens another universe on the home tab', () => {
    load(universeState());
    useGraphStore.setState({ rightPanelTabs: [{ type: 'home', isActive: false }, { type: 'node', nodeId: 'p1', isActive: true }], expandedGraphIds: new Set(['w1']) });
    const other = universeState();
    other.graphs = new Map([...other.graphs].map(([id, g]) => [`x-${id}`, { ...g, id: `x-${id}` }]));
    other.openGraphIds = ['x-w1'];
    load(other);
    const st = useGraphStore.getState();
    expect(st.rightPanelTabs).toEqual([{ type: 'home', isActive: true }]);
    expect(st.expandedGraphIds.size).toBe(0);
  });
});
