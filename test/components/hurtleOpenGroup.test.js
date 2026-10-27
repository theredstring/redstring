import { describe, it, expect, vi, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { startHurtle } from '../../src/components/canvas/camera/hurtle.js';

// No canvas to measure text in here.
vi.mock('../../src/utils.js', () => ({ getNodeDimensions: () => ({ currentWidth: 100, currentHeight: 40 }) }));

// Expand on a node inside an open node group: the node lives in the group's
// definition, not the viewed graph, and the flight must still launch from where
// it is drawn.

const graph = (id, instances) => ({
  id, name: id, edgeIds: [], groups: new Map(),
  instances: new Map(instances.map(i => [i.id, i])),
});
const inst = (id, prototypeId, x, y, extra = {}) => ({ id, prototypeId, x, y, scale: 1, ...extra });
const proto = (id, definitionGraphIds = []) => ({ id, name: id, color: '#123456', definitionGraphIds });

const ref = (current) => ({ current });
const makeCtx = () => ({
  canvasSize: { offsetX: 0, offsetY: 0 },
  containerRef: ref({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) }),
  getHeaderTabTarget: () => ({ x: 500, y: 20 }),
  panOffsetRef: ref({ x: 0, y: 0 }),
  previewingNodeId: null,
  setHurtleFlight: vi.fn(),
  zoomLevelRef: ref(1),
});

describe('startHurtle in open node groups', () => {
  beforeEach(() => {
    // main ⊃ box (open) ⊃ sub (open) ⊃ s1
    useGraphStore.setState({
      activeGraphId: 'main',
      graphs: new Map([
        ['main', graph('main', [inst('box', 'p-box', 0, 0, { openDefinition: { index: 0, offset: { x: 1000, y: 0 } } })])],
        ['box-def', graph('box-def', [inst('sub', 'p-sub', 0, 0, { openDefinition: { index: 0, offset: { x: 0, y: 500 } } })])],
        ['sub-def', graph('sub-def', [inst('s1', 'p-s1', 10, 10)])],
        ['s1-def', graph('s1-def', [])],
      ]),
      nodePrototypes: new Map([
        ['p-box', proto('p-box', ['box-def'])],
        ['p-sub', proto('p-sub', ['sub-def'])],
        ['p-s1', proto('p-s1', ['s1-def'])],
      ]),
      edges: new Map(),
    });
  });

  it('launches from a node nested two groups deep, at its drawn position', () => {
    const ctx = makeCtx();
    startHurtle('s1', 's1-def', 'p-s1', null, ctx);
    expect(ctx.setHurtleFlight).toHaveBeenCalledTimes(1);
    const flight = ctx.setHurtleFlight.mock.calls[0][0];
    expect(flight.targetGraphId).toBe('s1-def');
    expect(flight.nodeColor).toBe('#123456');
    // Drawn at its own position plus both groups' offsets.
    expect(flight.startPos).toEqual({ x: 1010 + 50, y: 510 + 20 });
  });
});
