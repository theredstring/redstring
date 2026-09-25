import { describe, it, expect } from 'vitest';
import { computeCleanLaneOffsets } from '../../src/utils/canvas/cleanLaneOffsets.js';

// The clean routing style's port assignment (moved out of NodeCanvas).
const dims = { currentWidth: 200, currentHeight: 80, scaledCornerRadius: 20 };
const node = (id, x, y) => ({ id, x, y });

function ctx(nodes, edges, extra = {}) {
  return {
    anchorGeometryFor: (n, d) => ({ node: n, dims: d }),
    baseDimsById: new Map(nodes.map((n) => [n.id, dims])),
    cleanLaneSpacing: 24,
    draggingNodeInfo: null,
    edges,
    enableAutoRouting: true,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    nodes,
    prevCleanLaneOffsetsRef: { current: null },
    routingStyle: 'clean',
    textSettings: { nodeScale: 1 },
    ...extra,
  };
}

const a = node('a', 0, 0);
const b = node('b', 600, 0);
const c = node('c', 0, 600);

describe('computeCleanLaneOffsets', () => {
  it('is empty unless auto-routing is on in the clean style', () => {
    const edges = [{ id: 'e1', sourceId: 'a', destinationId: 'b' }];
    expect(computeCleanLaneOffsets(ctx([a, b], edges, { routingStyle: 'manhattan' })).size).toBe(0);
    expect(computeCleanLaneOffsets(ctx([a, b], edges, { enableAutoRouting: false })).size).toBe(0);
  });

  it('uses facing sides: left/right when horizontal, top/bottom when strongly vertical', () => {
    const got = computeCleanLaneOffsets(ctx([a, b, c], [
      { id: 'h', sourceId: 'a', destinationId: 'b' },
      { id: 'v', sourceId: 'a', destinationId: 'c' },
    ]));
    expect([got.get('h').sourceSide, got.get('h').destSide]).toEqual(['right', 'left']);
    expect([got.get('v').sourceSide, got.get('v').destSide]).toEqual(['bottom', 'top']);
  });

  it('gives parallel connections between one pair distinct ports', () => {
    const edges = [1, 2, 3].map((i) => ({ id: `p${i}`, sourceId: 'a', destinationId: 'b' }));
    const got = computeCleanLaneOffsets(ctx([a, b], edges));
    const ys = edges.map((e) => got.get(e.id).sourcePort.y);
    expect(new Set(ys).size).toBe(3);
  });

  it('reuses the last result while a node is dragged, and records each result', () => {
    const edges = [{ id: 'e1', sourceId: 'a', destinationId: 'b' }];
    const ref = { current: null };
    const first = computeCleanLaneOffsets(ctx([a, b], edges, { prevCleanLaneOffsetsRef: ref }));
    expect(ref.current).toBe(first);
    const during = computeCleanLaneOffsets(ctx([a, b], edges, { prevCleanLaneOffsetsRef: ref, draggingNodeInfo: { instanceId: 'a' } }));
    expect(during).toBe(first);
  });
});
