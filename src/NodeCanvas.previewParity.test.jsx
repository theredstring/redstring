import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Web previews draw connections exactly as the canvas does.
//
// The Open Webs list, a definition in the right panel and a node's
// decomposition preview all draw connections from settledConnectionGeometry
// (utils/canvas/settledConnection.js), through the same layout
// (components/webPreview/webPreviewLayout.js). This renders the real canvas
// with the contract fixture in every routing style and checks that geometry
// against what renderConnectionEdge / SelfLoopEdge put in the DOM: the stroke,
// the arrowheads, the parallel pair's curves and the connection into a
// Thing-group's title. If this fails, the renderer's resting geometry changed
// and settledConnection.js has to follow it.
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

import { installCanvasStubs, teardownCanvasStubs, mountCanvas, useGraphStore } from './test-utils/canvasHarness.jsx';
import {
  ROUTING_STYLES, CONTRACT_VIEW, CONNECTION_EDGE_IDS, SELECTED_EDGE_ID, SELF_LOOP_EDGE_ID,
  canvasRoot, seedContractFixture,
} from './test-utils/canvasContract.js';
import { connectionRoutingSettings } from './utils/canvas/settledConnection.js';
import { layoutWebPreview, layoutPreviewConnections } from './components/webPreview/webPreviewLayout.js';

const EDGE_COUNT = 9;
const edgesMounted = () => document.querySelectorAll('[data-edge-id]').length >= EDGE_COUNT;
// The selected connection draws its hover affordances, not its resting shape.
const RESTING_EDGE_IDS = [...CONNECTION_EDGE_IDS.filter(id => id !== SELECTED_EDGE_ID), SELF_LOOP_EDGE_ID];
const TOLERANCE = 1e-3;

const numbersIn = (text) => (String(text || '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);

const expectSameNumbers = (actual, expected, what) => {
  const a = numbersIn(actual);
  const e = numbersIn(expected);
  expect(a.length, `${what}: ${actual} vs ${expected}`).toBe(e.length);
  a.forEach((n, i) => expect(Math.abs(n - e[i]), `${what}: ${actual} vs ${expected}`).toBeLessThan(TOLERANCE));
};

/** The preview's view of the canvas's web, built as LeftGridView builds it. */
const previewConnections = () => {
  const state = useGraphStore.getState();
  const graph = state.graphs.get('g1');
  const nodes = [];
  graph.instances.forEach((instance) => {
    const prototype = state.nodePrototypes.get(instance.prototypeId);
    if (prototype) nodes.push({ ...prototype, ...instance, name: prototype.name });
  });
  const edges = graph.edgeIds.map(id => state.edges.get(id)).filter(Boolean);
  const layout = layoutWebPreview({
    nodes, groups: graph.groups, nodePrototypes: state.nodePrototypes,
    textSettings: state.textSettings, gridSize: state.gridSettings?.size || 200,
  });
  const settings = connectionRoutingSettings(state);
  return new Map(layoutPreviewConnections(layout, nodes, edges, settings, CONTRACT_VIEW.zoomLevel)
    .map(c => [c.edge.id, c.geometry]));
};

beforeEach(() => { installCanvasStubs(); });
afterEach(() => { teardownCanvasStubs(); });

describe('web previews draw connections as the canvas does', () => {
  describe.each(ROUTING_STYLES)('%s routing', (routingStyle) => {
    it('matches the canvas stroke and arrowheads for every resting connection', async () => {
      seedContractFixture({ routingStyle });
      await mountCanvas(edgesMounted);
      const root = canvasRoot();
      const preview = previewConnections();

      RESTING_EDGE_IDS.forEach((edgeId) => {
        const what = `${routingStyle} ${edgeId}`;
        const geometry = preview.get(edgeId);
        expect(geometry, `${what}: the preview drew nothing`).toBeTruthy();
        const wrapper = root.querySelector(`[data-edge-id="${edgeId}"]`);

        // The stroke.
        const main = edgeId === SELF_LOOP_EDGE_ID
          ? Array.from(wrapper.querySelectorAll('path')).find(p => p.getAttribute('stroke') !== 'transparent')
          : wrapper.querySelector('[data-edge-main]');
        expect(main, `${what}: no visible stroke on the canvas`).toBeTruthy();
        if (main.tagName.toLowerCase() === 'line') {
          expect(geometry.kind, what).toBe('line');
          expectSameNumbers(
            ['x1', 'y1', 'x2', 'y2'].map(k => main.getAttribute(k)).join(' '),
            `${geometry.x1} ${geometry.y1} ${geometry.x2} ${geometry.y2}`,
            `${what} line`,
          );
        } else {
          expect(geometry.kind, what).not.toBe('line');
          expectSameNumbers(main.getAttribute('d'), geometry.d, `${what} path`);
        }

        // Manhattan's centre-to-port stubs: the canvas draws them as sibling <line>s.
        const canvasStubs = Array.from(main.parentElement.querySelectorAll(':scope > line'))
          .filter(l => !l.hasAttribute('data-edge-main') && !l.hasAttribute('data-edge-hit') && l.getAttribute('stroke') !== 'transparent');
        expect(canvasStubs.length, `${what}: stub count`).toBe(geometry.stubs.length);
        canvasStubs.forEach((l, i) => expectSameNumbers(
          ['x1', 'y1', 'x2', 'y2'].map(k => l.getAttribute(k)).join(' '),
          Object.values(geometry.stubs[i]).join(' '),
          `${what} stub ${i}`,
        ));

        // The arrowheads.
        const canvasArrows = Array.from(wrapper.querySelectorAll('[data-arrow]'));
        expect(canvasArrows.map(a => a.getAttribute('data-arrow')).sort(), `${what}: arrows`)
          .toEqual(geometry.arrows.map(a => a.end).sort());
        canvasArrows.forEach((el) => {
          const arrow = geometry.arrows.find(a => a.end === el.getAttribute('data-arrow'));
          const scale = numbersIn(el.getAttribute('transform')).pop();
          expectSameNumbers(
            el.getAttribute('transform'),
            `translate(${arrow.x}, ${arrow.y}) rotate(${arrow.angle + 90}) scale(${scale})`,
            `${what} ${arrow.end} arrow`,
          );
        });

        // The shell cutout on a connection into a Thing-group's title.
        const clipped = !!wrapper.querySelector('[data-shell-clip]');
        expect(clipped, `${what}: shell cutout`).toBe(geometry.clipShells.length > 0);
      });
    });
  });
});
