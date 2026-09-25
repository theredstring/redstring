// Connection-label DOM baselines (NodeCanvas refactor P1.12a).
//
// Pins WHERE labels land, not just that the label DOM exists (that's the render
// contract): each label's frame, text, x/y/transform, and the `d` of every
// stroke, rounded to 0.5, in every routing style, at rest and after selecting
// the hub (the selection that changes the most geometry; F-21) or a leaf.
//
// P1.12b and P3.05 change WHEN labels re-solve. They must not change where
// labels go at rest, so the "at rest" snapshots must not change. If one does,
// that's a placement change: look at it before updating anything.
//
// Selecting a node must not re-solve a routed label unless that label's own
// drawn route changed (P1.12b, D-18). Before P1.12b every label re-solved, and
// since a re-solve can move a label even where nothing moved (F-72), selecting
// reshuffled a few; the "labels that moved" lists were not empty then.
// Straight labels sit on the drawn line itself, which a selected node's 6 px
// outline shortens, so they still move.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

vi.hoisted(() => {
  // Culling decides what mounts from a jsdom layout that doesn't exist.
  try { globalThis.localStorage?.setItem('redstring_disable_culling', 'true'); } catch { /* ignore */ }
  globalThis.__labelSolves = [];
});
// Records which edge each routed label solve was for.
vi.mock('./utils/canvas/edgeLabelPlacement.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    chooseRoutedLabelPlacement: (...args) => {
      globalThis.__labelSolves.push(args[7]);
      return actual.chooseRoutedLabelPlacement(...args);
    },
  };
});
vi.mock('./services/WorkspaceService.js', () => {
  const stub = { initialize: async () => ({ status: 'NOOP' }), getFolderHandle: () => null };
  return { default: stub, workspaceService: stub };
});
vi.mock('./useCanvasWorker.js', () => ({
  useCanvasWorker: () => ({
    calculatePan: vi.fn(), calculateNodePositions: vi.fn(),
    calculateZoom: vi.fn(), calculateSelection: vi.fn(),
  }),
}));

import { installCanvasStubs, teardownCanvasStubs, mountCanvas, flushFrames } from './test-utils/canvasHarness.jsx';
import {
  seedLabelFixture, readLabelSnapshot, LABEL_EDGE_IDS, LABEL_ROUTING_STYLES, HUB_ID, LEAF_ID,
} from './test-utils/labelFixture.js';
import { clearLabelStabilization } from './utils/canvas/labelStabilization.js';

const edgesMounted = () => document.querySelectorAll('[data-edge-id]').length >= LABEL_EDGE_IDS.length;
const snap = () => readLabelSnapshot(document.querySelector('.canvas-area'));
const movedLabels = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k].labels) !== JSON.stringify(b[k].labels));

const clickNode = async (id) => {
  const el = document.querySelector(`.canvas-area [data-instance-id="${id}"]`);
  act(() => { fireEvent.mouseDown(el, { clientX: 500, clientY: 400, button: 0, detail: 1 }); });
  act(() => { fireEvent.mouseUp(el, { clientX: 500, clientY: 400, button: 0, detail: 1 }); });
  // Past the single/double click delay, so the selection lands.
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  flushFrames(3);
};

beforeEach(() => { installCanvasStubs(); clearLabelStabilization(); });
afterEach(() => { teardownCanvasStubs(); });

describe.each(LABEL_ROUTING_STYLES)('connection labels, %s routing', (routingStyle) => {
  it.each([HUB_ID, LEAF_ID])('at rest, then with %s selected', async (target) => {
    seedLabelFixture({ routingStyle });
    await mountCanvas(edgesMounted);
    flushFrames(5);
    const atRest = snap();
    // Every connection is drawn, and every named one has a label.
    for (const id of LABEL_EDGE_IDS) {
      expect(atRest[id].wrappers, `${id} drawn`).toBeGreaterThan(0);
    }
    expect(atRest).toMatchSnapshot('at rest');

    globalThis.__labelSolves.length = 0;
    await clickNode(target);
    expect(document.querySelector(`.canvas-area [data-instance-id="${target}"]`).classList.contains('selected')).toBe(true);
    const selected = snap();
    expect(selected).toMatchSnapshot(`${target} selected`);
    expect(movedLabels(atRest, selected)).toMatchSnapshot(`${target} selected: labels that moved`);
    if (routingStyle !== 'straight') {
      const routeChanged = Object.keys(atRest).filter((k) => JSON.stringify(atRest[k].strokes) !== JSON.stringify(selected[k].strokes));
      for (const id of new Set(globalThis.__labelSolves)) {
        expect(routeChanged, `${id} re-solved on select, but its drawn route didn't change`).toContain(id);
      }
    }
  });
});
