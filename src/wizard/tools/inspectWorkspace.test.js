import { describe, it, expect } from 'vitest';
import { inspectWorkspace } from './inspectWorkspace.js';

function makeGraph(id, name, nodeCount) {
  const instances = [];
  for (let i = 0; i < nodeCount; i++) {
    instances.push({ id: `${id}-i${i}`, prototypeId: `${id}-p${i}` });
  }
  return { id, name, instances, edgeIds: [], groups: [] };
}

function makeProtos(id, nodeCount) {
  return Array.from({ length: nodeCount }, (_, i) => ({
    id: `${id}-p${i}`,
    name: `${id}Node${i}`,
    color: '#fff'
  }));
}

describe('inspectWorkspace', () => {
  it('returns a counts-only census for includeAllGraphs, never node contents', async () => {
    // The regression that mattered: this path used to serialize every node and
    // edge of every graph, which on a real universe was the single biggest
    // context blowup in the system.
    const graphs = [];
    const nodePrototypes = [];
    for (let i = 0; i < 75; i++) {
      graphs.push(makeGraph(`g${i}`, `Web ${i}`, 40));
      nodePrototypes.push(...makeProtos(`g${i}`, 40));
    }

    const result = await inspectWorkspace({ includeAllGraphs: true }, {
      graphs, nodePrototypes, edges: [], activeGraphId: 'g0'
    });

    expect(result.totalGraphs).toBe(75);
    expect(result.graphs.length).toBe(75);
    // Every entry is shape-only.
    for (const entry of result.graphs) {
      expect(entry.counts.nodes).toBe(40);
      expect(entry.nodes).toBeUndefined();
      expect(entry.edges).toBeUndefined();
    }
    // And the whole payload stays small.
    expect(JSON.stringify(result).length).toBeLessThan(20000);
  });

  it('caps the node listing for a single oversized graph', async () => {
    const graph = makeGraph('big', 'Big', 500);
    const result = await inspectWorkspace({ graphId: 'big' }, {
      graphs: [graph],
      nodePrototypes: makeProtos('big', 500),
      edges: [],
      activeGraphId: 'other'
    });

    expect(result.counts.nodes).toBe(500);
    expect(result.nodes.length).toBeLessThan(500);
    expect(result.truncated).toBe(true);
    expect(result.truncationNote).toMatch(/of 500 nodes/);
  });

  it('still returns the IDs the context header omits', async () => {
    const graph = makeGraph('g', 'Web', 2);
    const result = await inspectWorkspace({ graphId: 'g' }, {
      graphs: [graph],
      nodePrototypes: makeProtos('g', 2),
      edges: [],
      activeGraphId: 'other'
    });

    expect(result.nodes[0].instanceId).toBe('g-i0');
    expect(result.nodes[0].prototypeId).toBe('g-p0');
  });

  it('tells the model not to re-read the active graph for contents', async () => {
    const graph = makeGraph('g', 'Web', 2);
    const result = await inspectWorkspace({ graphId: 'g' }, {
      graphs: [graph],
      nodePrototypes: makeProtos('g', 2),
      edges: [],
      activeGraphId: 'g'
    });

    expect(result.note).toMatch(/already in your context header/);
  });
});
