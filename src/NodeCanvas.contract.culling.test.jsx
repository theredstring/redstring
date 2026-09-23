import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The NodeCanvas render contract, with culling ON (the production default).
//
// ENABLE_CULLING is a module-level constant that NodeCanvas.jsx reads from
// localStorage once, at import time. That is why this is its own file: vitest
// gives every file a fresh module graph and jsdom, so clearing the key here,
// before the imports, is what turns culling on. The smoke test and
// NodeCanvas.contract.test.jsx both set it to force culling off.
//
// How visibility is decided in jsdom (runCulling, NodeCanvas.jsx):
//   - viewport = getAppViewportSize(). jsdom has no #root, so this is
//     window.innerWidth x innerHeight, i.e. 1024 x 768.
//   - camera = the graph's graphViews entry, restored by the view-restore
//     layout effect. The fixture pins it (CONTRACT_VIEW) so the viewport covers
//     world x -124..1924, y -118..1418, plus 1000 units of inner padding.
//   - a node counts if its box (instance x/y plus baseDimsById) meets that
//     rect. An edge counts if either endpoint does.
// Nothing reads getBoundingClientRect, so no extra stub is needed. The node
// `far`, 30,000 units out, is the control: it must NOT mount.
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  try { globalThis.localStorage?.removeItem('redstring_disable_culling'); } catch { /* ignore */ }
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

import { installCanvasStubs, teardownCanvasStubs, mountCanvas } from './test-utils/canvasHarness.jsx';
import {
  ROUTING_STYLES, FAR_NODE_ID, NEAR_NODE_IDS, canvasRoot, seedContractFixture,
  assertNodeContract, assertEdgeGeometryContract, assertTextLabelContract, assertGroupContract,
} from './test-utils/canvasContract.js';

const EDGE_COUNT = 9;
const edgesMounted = () => document.querySelectorAll('[data-edge-id]').length >= EDGE_COUNT;

beforeEach(() => {
  installCanvasStubs();
});

afterEach(() => {
  teardownCanvasStubs();
});

describe('NodeCanvas render contract (culling on)', () => {
  it('culls the far node and mounts every node in view', async () => {
    seedContractFixture();
    await mountCanvas(edgesMounted);
    const root = canvasRoot();
    expect(root.querySelector(`[data-instance-id="${FAR_NODE_ID}"]`),
      'far node mounted: culling is not on, or the pinned camera did not apply').toBeNull();
    expect(root.querySelectorAll('[data-instance-id]').length).toBe(NEAR_NODE_IDS.length);
  });

  describe.each(ROUTING_STYLES)('%s routing', (routingStyle) => {
    it('emits the node, edge, group and <text> label contract', async () => {
      const ids = seedContractFixture({ routingStyle });
      await mountCanvas(edgesMounted);
      const root = canvasRoot();

      assertNodeContract(root);
      assertEdgeGeometryContract(root, routingStyle);
      assertTextLabelContract(root, routingStyle);
      assertGroupContract(root, ids);
    });
  });
});
