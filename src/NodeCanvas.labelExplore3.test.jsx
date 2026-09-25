import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

vi.hoisted(() => {
  try { globalThis.localStorage?.setItem('redstring_disable_culling', 'true'); } catch { /* ignore */ }
  globalThis.__labelProbe = { solves: [], builds: 0, variant: 'V0', lastSig: null, lastIndex: null };
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
vi.mock('./utils/canvas/nodeHitbox.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getNodeHitbox: (node, dims, isSelected) => {
      const v = globalThis.__labelProbe.variant;
      if (isSelected && (v === 'V2' || v === 'V3') && new Error().stack.includes('occluderFor')) {
        return actual.getNodeHitbox(node, dims, false);
      }
      return actual.getNodeHitbox(node, dims, isSelected);
    },
  };
});
vi.mock('./utils/canvas/edgeLabelPlacement.js', async (importOriginal) => {
  const actual = await importOriginal();
  const sigOf = (polylines) => {
    let s = '';
    polylines.forEach((pts, id) => { s += `${id}:${(pts || []).map((p) => `${p.x},${p.y}`).join(';')}|`; });
    return s;
  };
  return {
    ...actual,
    chooseRoutedLabelPlacement: (...args) => {
      globalThis.__labelProbe.solves.push(args[7]);
      return actual.chooseRoutedLabelPlacement(...args);
    },
    getVisibleObstacleRects: (nodes, visible, dims, pad, selected) => (
      globalThis.__labelProbe.variant === 'V3'
        ? actual.getVisibleObstacleRects(nodes, visible, dims, pad, new Set())
        : actual.getVisibleObstacleRects(nodes, visible, dims, pad, selected)
    ),
    buildEdgeSegmentIndex: (polylines, ...rest) => {
      const p = globalThis.__labelProbe;
      p.builds++;
      if (p.variant === 'V0') return actual.buildEdgeSegmentIndex(polylines, ...rest);
      const sig = sigOf(polylines);
      if (p.lastIndex && p.lastSig === sig) return p.lastIndex;
      const idx = actual.buildEdgeSegmentIndex(polylines, ...rest);
      if (idx) {
        let gen;
        Object.defineProperty(idx, 'generation', {
          get: () => gen, set: (v) => { if (gen === undefined) gen = v; }, configurable: true,
        });
      }
      p.lastSig = sig; p.lastIndex = idx;
      p.gens = (p.gens || 0) + 1;
      return idx;
    },
  };
});

import { installCanvasStubs, teardownCanvasStubs, mountCanvas, flushFrames, useGraphStore } from './test-utils/canvasHarness.jsx';
import { seedLabelFixture, readLabelSnapshot, LABEL_EDGE_IDS, HUB_ID, LEAF_ID } from './test-utils/labelFixture.js';
import { clearLabelStabilization } from './utils/canvas/labelStabilization.js';

const probe = () => globalThis.__labelProbe;
const edgesMounted = () => document.querySelectorAll('[data-edge-id]').length >= LABEL_EDGE_IDS.length;
const snap = () => readLabelSnapshot(document.querySelector('.canvas-area'));
const moved = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k].labels) !== JSON.stringify(b[k].labels));
const strokesMoved = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k].strokes) !== JSON.stringify(b[k].strokes));

const clickNode = async (id) => {
  const el = document.querySelector(`.canvas-area [data-instance-id="${id}"]`);
  act(() => { fireEvent.mouseDown(el, { clientX: 500, clientY: 400, button: 0, detail: 1 }); });
  act(() => { fireEvent.mouseUp(el, { clientX: 500, clientY: 400, button: 0, detail: 1 }); });
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  flushFrames(3);
};

const results = {};
afterEach(() => { teardownCanvasStubs(); });

describe.each(['V0', 'V1', 'V2', 'V3'])('%s', (variant) => {
  beforeEach(() => {
    installCanvasStubs(); clearLabelStabilization();
    Object.assign(probe(), { solves: [], builds: 0, variant, lastSig: null, lastIndex: null, gens: 0 });
  });
  describe.each(['manhattan', 'clean', 'lombardi'])('%s', (routingStyle) => {
    it.each([LEAF_ID, HUB_ID])('select %s', async (target) => {
      seedLabelFixture({ routingStyle });
      await mountCanvas(edgesMounted);
      flushFrames(5);
      const s0 = snap();
      const mountSolves = probe().solves.length;
      probe().solves = []; probe().builds = 0;

      // Pure churn: the edges Map gets a new identity with identical contents.
      act(() => { useGraphStore.setState({ edges: new Map(useGraphStore.getState().edges) }); });
      flushFrames(2);
      const churnSolves = probe().solves.length;
      const churnBuilds = probe().builds;
      const s1 = snap();
      probe().solves = []; probe().builds = 0;

      act(() => { useGraphStore.setState({ edges: new Map(useGraphStore.getState().edges) }); });
      flushFrames(2);
      const s2 = snap();
      const churn2Solves = probe().solves.length;
      probe().solves = []; probe().builds = 0;

      await clickNode(target);
      const s3 = snap();
      const selSolves = probe().solves.slice();
      const r = {
        variant, routingStyle, target, mountSolves,
        churnSolves, churnBuilds, churnMoved: moved(s0, s1), churn2Solves, churn2Moved: moved(s1, s2),
        selSolves: selSolves.length, selIds: [...new Set(selSolves)].join(','), selBuilds: probe().builds,
        selMovedLabels: moved(s2, s3), selMovedStrokes: strokesMoved(s2, s3),
      };
      results[`${variant}|${routingStyle}|${target}`] = { s0, s3 };
      if (variant !== 'V0') {
        const base = results[`V0|${routingStyle}|${target}`];
        r.settledVsV0 = moved(base.s0, s0);
        r.afterSelVsV0 = moved(base.s3, s3);
      }
      console.error(JSON.stringify(r));
      expect(true).toBe(true);
    });
  });
});
