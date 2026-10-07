import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

// The panel's own rendering isn't under test: capture the triplets it builds.
const captured = { triples: null };
vi.mock('../../src/UnifiedBottomControlPanel', () => ({
  default: (props) => { captured.triples = props.triples; return null; },
}));

import ConnectionControlPanel from '../../src/ConnectionControlPanel.jsx';
import useGraphStore from '../../src/store/graphStore.js';

const inst = (id, prototypeId, x, y, extra = {}) => ({ id, prototypeId, x, y, scale: 1, ...extra });
const proto = (id, definitionGraphIds = []) => ({ id, name: id, color: '#111', definitionGraphIds });

// Main holds Box, open in place; Box's definition holds a → b.
const seed = () => {
  const graphs = new Map([
    ['main', {
      id: 'main', name: 'main', edgeIds: [], groups: new Map(),
      instances: new Map([['box', inst('box', 'p-box', 0, 0, { openDefinition: { index: 0, offset: { x: 0, y: 0 } } })]]),
    }],
    ['box-def', {
      id: 'box-def', name: 'box-def', edgeIds: ['e-in'], groups: new Map(),
      instances: new Map([['a', inst('a', 'p-a', 300, 0)], ['b', inst('b', 'p-b', 0, 0)]]),
    }],
  ]);
  const nodePrototypes = new Map([
    ['p-box', proto('p-box', ['box-def'])], ['p-a', proto('p-a')], ['p-b', proto('p-b')],
  ]);
  const edges = new Map([
    ['e-in', { id: 'e-in', sourceId: 'a', destinationId: 'b', directionality: { arrowsToward: new Set(['b']) } }],
  ]);
  useGraphStore.setState({ graphs, nodePrototypes, edges, activeGraphId: 'main' });
  return edges.get('e-in');
};

afterEach(() => { cleanup(); captured.triples = null; });

describe('ConnectionControlPanel inside an open Thing group', () => {
  it('builds the triplet from the Things projected into the view', () => {
    const edge = seed();
    render(<ConnectionControlPanel selectedEdge={edge} />);
    expect(captured.triples).toHaveLength(1);
    const [t] = captured.triples;
    // b sits left of a on the canvas, so it reads on the left.
    expect(t.subject).toMatchObject({ id: 'b', name: 'p-b' });
    expect(t.object).toMatchObject({ id: 'a', name: 'p-a' });
    expect(t.hasLeftArrow).toBe(true);
    expect(t.hasRightArrow).toBe(false);
  });
});
