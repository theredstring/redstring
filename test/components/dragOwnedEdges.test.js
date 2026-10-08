import { describe, it, expect } from 'vitest';
import { collectDragOwnedEdges, dragNodeIdsOf } from '../../src/components/canvas/edges/dragOwnedEdges.js';

// a - b - c - d, plus e - f off on its own, and a thing-group G (anchor g)
// holding b, with g wired to e.
const allEdges = [
  { id: 'ab', sourceId: 'a', destinationId: 'b' },
  { id: 'bc', sourceId: 'b', destinationId: 'c' },
  { id: 'cd', sourceId: 'c', destinationId: 'd' },
  { id: 'ef', sourceId: 'e', destinationId: 'f' },
  { id: 'ge', sourceId: 'g', destinationId: 'e' },
];
const edgesByNode = new Map();
for (const e of allEdges) {
  for (const n of [e.sourceId, e.destinationId]) {
    if (!edgesByNode.has(n)) edgesByNode.set(n, new Set());
    edgesByNode.get(n).add(e.id);
  }
}
const indexes = (over = {}) => ({
  edgesByNode,
  groupsByNode: new Map(),
  groupsById: new Map(),
  allEdges,
  lombardi: false,
  ...over,
});

describe('collectDragOwnedEdges', () => {
  it('owns only the connections touching a dragged node', () => {
    const { edgeIds } = collectDragOwnedEdges(['a'], indexes());
    expect([...edgeIds]).toEqual(['ab']);
  });

  it('leaves every connection the drag cannot move to its settled form', () => {
    const { edgeIds } = collectDragOwnedEdges(['b'], indexes());
    expect(edgeIds.has('cd')).toBe(false);
    expect(edgeIds.has('ef')).toBe(false);
  });

  it("takes in a moved group anchor's connections", () => {
    const { edgeIds, movedAnchorIds } = collectDragOwnedEdges(['b'], indexes({
      groupsByNode: new Map([['b', [{ groupId: 'G' }]]]),
      groupsById: new Map([['G', { anchorInstanceId: 'g' }]]),
    }));
    expect(edgeIds.has('ge')).toBe(true);
    expect([...movedAnchorIds]).toEqual(['g']);
  });

  it("takes in an ancestor group's anchor when the drag's box pass moves it", () => {
    // G (anchor g, holds b) sits inside H (anchor e) by its anchor alone: H
    // holds g, not b. Dragging b moves both boxes, so e's connections move too.
    const over = {
      groupsByNode: new Map([['b', [{ groupId: 'G' }]], ['g', [{ groupId: 'H' }]]]),
      groupsById: new Map([['G', { anchorInstanceId: 'g' }], ['H', { anchorInstanceId: 'e' }]]),
    };
    const direct = collectDragOwnedEdges(['b'], indexes(over));
    expect(direct.edgeIds.has('ef')).toBe(false);
    const { edgeIds, movedAnchorIds } = collectDragOwnedEdges(['b'], indexes({ ...over, affectedGroupIds: ['G', 'H'] }));
    expect(edgeIds.has('ef')).toBe(true);
    expect([...movedAnchorIds].sort()).toEqual(['e', 'g']);
  });

  it('reaches two hops out under Lombardi, and only then', () => {
    const plain = collectDragOwnedEdges(['a'], indexes());
    expect(plain.edgeIds.has('bc')).toBe(false);
    const lombardi = collectDragOwnedEdges(['a'], indexes({ lombardi: true }));
    expect(lombardi.edgeIds.has('bc')).toBe(true);
    expect([...lombardi.lombardiExtraEdgeIds]).toEqual(['bc']);
    expect(lombardi.edgeIds.has('cd')).toBe(false);
  });
});

describe('dragNodeIdsOf', () => {
  it('reads all three drag shapes', () => {
    expect(dragNodeIdsOf(null)).toEqual([]);
    expect(dragNodeIdsOf({ instanceId: 'a' })).toEqual(['a']);
    expect(dragNodeIdsOf({ primaryId: 'a', relativeOffsets: { b: {}, c: {} } })).toEqual(['a', 'b', 'c']);
    expect(dragNodeIdsOf({ groupId: 'G', memberOffsets: [{ id: 'x' }, { id: 'y' }] })).toEqual(['x', 'y']);
  });
});
