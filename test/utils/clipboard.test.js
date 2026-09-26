/**
 * Copying a selection copies the connections between the selected things.
 * Not every connection carries `definitionNodeIds` or `directionality`
 * (Wizard-made ones and ones from older files can lack them), and copying a
 * selection with such a connection threw "edge.definitionNodeIds is not
 * iterable" and copied nothing (2026-09-26).
 */
import { describe, it, expect, vi } from 'vitest';
import { copySelection, pasteClipboard } from '../../src/utils/clipboard.js';

const graph = {
  id: 'g1',
  instances: new Map([
    ['a', { id: 'a', prototypeId: 'pa', x: 0, y: 0 }],
    ['b', { id: 'b', prototypeId: 'pb', x: 200, y: 0 }],
  ]),
  edgeIds: ['bare', 'full'],
};
const edges = new Map([
  // A connection with neither field.
  ['bare', { id: 'bare', sourceId: 'a', destinationId: 'b', name: 'bare' }],
  ['full', {
    id: 'full', sourceId: 'b', destinationId: 'a', name: 'full',
    definitionNodeIds: ['def1'], directionality: { arrowsToward: new Set(['a']) },
  }],
]);

describe('copySelection / pasteClipboard', () => {
  it('copies connections that lack definitions and directionality', () => {
    const data = copySelection(new Set(['a', 'b']), graph, new Map(), edges);
    expect(data.edges).toHaveLength(2);
    const bare = data.edges.find((e) => e.edgeData.name === 'bare');
    expect(bare.edgeData.definitionNodeIds).toEqual([]);
    expect([...bare.edgeData.directionality.arrowsToward]).toEqual([]);
  });

  it('pastes them, remapping the arrows of the ones that have them', () => {
    const data = copySelection(new Set(['a', 'b']), graph, new Map(), edges);
    const pasteNodesAndEdges = vi.fn();
    const { newInstanceIds, newEdgeIds } = pasteClipboard(
      data, 'g2', { x: 0, y: 0 }, { pasteNodesAndEdges },
      { instances: new Map() }, () => ({ currentWidth: 100, currentHeight: 50 })
    );
    expect(newInstanceIds).toHaveLength(2);
    expect(newEdgeIds).toHaveLength(2);
    const [, , pastedEdges] = pasteNodesAndEdges.mock.calls[0];
    const full = pastedEdges.find((e) => e.name === 'full');
    expect(full.definitionNodeIds).toEqual(['def1']);
    expect([...full.directionality.arrowsToward]).toEqual([full.destinationId]);
  });
});
