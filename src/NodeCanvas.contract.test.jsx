import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The NodeCanvas render contract, with culling OFF.
//
// useNodeDrag.js finds the canvas DOM by selector at drag start and writes it
// directly every frame. Nothing throws when that DOM changes shape, so a
// renamed attribute or a moved element breaks node drag silently. This file
// pins every selector the drag reads that a static render can produce, in
// every routing style and in both label forms. The culling-ON twin is
// NodeCanvas.contract.culling.test.jsx.
//
// Culling has to be off before NodeCanvas.jsx is evaluated: ENABLE_CULLING is
// a module-level constant that reads localStorage at import time. vi.hoisted
// runs before the imports below.
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  try { globalThis.localStorage?.setItem('redstring_disable_culling', 'true'); } catch { /* ignore */ }
});

// Keep WorkspaceService.initialize inert (see NodeCanvas.smoke.test.jsx for why
// these are plain functions rather than vi.fn()).
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

// Sprites never bake in jsdom. This lets a test switch on stand-in bitmaps so
// the sprite label forms render too. Off by default: pass-through.
vi.mock('./services/labelSpriteCache.js', async (importOriginal) => {
  const { withFakeLabelSprites } = await import('./test-utils/fakeLabelSprites.js');
  return withFakeLabelSprites(await importOriginal());
});

import { installCanvasStubs, teardownCanvasStubs, mountCanvas } from './test-utils/canvasHarness.jsx';
import { setFakeLabelSprites } from './test-utils/fakeLabelSprites.js';
import {
  ROUTING_STYLES, FAR_NODE_ID, canvasRoot, seedContractFixture,
  assertNodeContract, assertEdgeGeometryContract, assertTextLabelContract,
  assertSpriteLabelContract, assertGroupContract,
} from './test-utils/canvasContract.js';

const EDGE_COUNT = 9;
const edgesMounted = () => document.querySelectorAll('[data-edge-id]').length >= EDGE_COUNT;

beforeEach(() => {
  setFakeLabelSprites(false);
  installCanvasStubs();
});

afterEach(() => {
  setFakeLabelSprites(false);
  teardownCanvasStubs();
});

describe('NodeCanvas render contract (culling off)', () => {
  it('culling really is off: the far node is mounted', async () => {
    seedContractFixture();
    await mountCanvas(edgesMounted);
    // The same node is culled in the culling-on file. If this ever fails, the
    // hoisted flag above stopped reaching ENABLE_CULLING, and every "culling
    // off" assertion here is quietly running with it on.
    expect(canvasRoot().querySelector(`[data-instance-id="${FAR_NODE_ID}"]`)).toBeTruthy();
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

    it('emits the sprite label contract when sprites are available', async () => {
      setFakeLabelSprites(true);
      seedContractFixture({ routingStyle });
      await mountCanvas(edgesMounted);
      const root = canvasRoot();

      assertSpriteLabelContract(root, routingStyle);
      // The sprite swap must not disturb any other part of the contract.
      assertEdgeGeometryContract(root, routingStyle);
    });
  });
});
