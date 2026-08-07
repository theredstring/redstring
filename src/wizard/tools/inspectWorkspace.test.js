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

/**
 * A small nested universe:
 *   Root ── contains "Cell" ── whose web contains "Cytoplasm"
 *                                whose web contains two organelles
 */
function nestedUniverse() {
  const graphs = [
    {
      id: 'g-root',
      name: 'Biology',
      instances: [{ id: 'i-cell', prototypeId: 'p-cell' }],
      edgeIds: [],
      groups: []
    },
    {
      id: 'g-cell',
      name: 'Cell',
      instances: [
        { id: 'i-cyto', prototypeId: 'p-cyto' },
        { id: 'i-nuc', prototypeId: 'p-nuc' }
      ],
      edgeIds: [],
      groups: []
    },
    {
      id: 'g-cyto',
      name: 'Cytoplasm',
      instances: [
        { id: 'i-mito', prototypeId: 'p-mito' },
        { id: 'i-golgi', prototypeId: 'p-golgi' }
      ],
      edgeIds: [],
      groups: []
    }
  ];
  const nodePrototypes = [
    { id: 'p-cell', name: 'Cell', definitionGraphIds: ['g-cell'] },
    { id: 'p-cyto', name: 'Cytoplasm', definitionGraphIds: ['g-cyto'] },
    { id: 'p-nuc', name: 'Nucleus', definitionGraphIds: [] },
    { id: 'p-mito', name: 'Mitochondria', definitionGraphIds: [] },
    { id: 'p-golgi', name: 'Golgi Apparatus', definitionGraphIds: [] }
  ];
  return { graphs, nodePrototypes, edges: [] };
}

describe('inspectWorkspace — mode: map', () => {
  it('renders the composition structure as nesting, not a flat list', async () => {
    const result = await inspectWorkspace(
      { mode: 'map' },
      { ...nestedUniverse(), activeGraphId: 'g-cell', openGraphIds: ['g-cell'] }
    );

    expect(result.mode).toBe('map');
    const lines = result.map.split('\n');
    const rootLine = lines.find(l => l.includes('Biology'));
    const cellLine = lines.find(l => l.includes('Cell') && !l.includes('Biology'));
    const cytoLine = lines.find(l => l.includes('Cytoplasm'));

    // Indentation IS the composition relationship.
    const indent = (l) => l.length - l.trimStart().length;
    expect(indent(rootLine)).toBe(0);
    expect(indent(cellLine)).toBeGreaterThan(indent(rootLine));
    expect(indent(cytoLine)).toBeGreaterThan(indent(cellLine));
  });

  it('marks the active graph and the open tabs', async () => {
    const result = await inspectWorkspace(
      { mode: 'map' },
      { ...nestedUniverse(), activeGraphId: 'g-cyto', openGraphIds: ['g-cell', 'g-cyto'] }
    );
    expect(result.map).toMatch(/Cytoplasm[^\n]*\[ACTIVE\]/);
    expect(result.map).toMatch(/Cell[^\n]*\[open\]/);
  });

  it('gives the breadcrumb from the root down to the active graph', async () => {
    const result = await inspectWorkspace(
      { mode: 'map' },
      { ...nestedUniverse(), activeGraphId: 'g-cyto' }
    );
    expect(result.activeGraphPath).toEqual(['Biology', 'Cell', 'Cytoplasm']);
  });

  // A map that stops short of where the user actually is has failed at its job.
  it('expands the path to the active graph past the depth limit', async () => {
    const result = await inspectWorkspace(
      { mode: 'map', depth: 1 },
      { ...nestedUniverse(), activeGraphId: 'g-cyto' }
    );
    expect(result.map).toContain('Cytoplasm');
  });

  it('summarizes rather than expanding branches beyond the depth limit', async () => {
    const result = await inspectWorkspace(
      { mode: 'map', depth: 1 },
      { ...nestedUniverse(), activeGraphId: 'g-root' }
    );
    expect(result.map).toMatch(/nested web/);
    expect(result.map).not.toContain('Mitochondria');
  });

  // The regression that mattered: this path used to serialize every node and
  // edge of every graph, which on a real universe was the single biggest
  // context blowup in the system.
  it('never emits node or edge contents, and stays small on a large universe', async () => {
    const graphs = [];
    const nodePrototypes = [];
    for (let i = 0; i < 75; i++) {
      graphs.push(makeGraph(`g${i}`, `Web ${i}`, 40));
      nodePrototypes.push(...makeProtos(`g${i}`, 40));
    }

    const result = await inspectWorkspace(
      { includeAllGraphs: true }, // deprecated alias must still work
      { graphs, nodePrototypes, edges: [], activeGraphId: 'g0' }
    );

    expect(result.mode).toBe('map');
    expect(result.totalGraphs).toBe(75);
    expect(result.nodes).toBeUndefined();
    expect(result.edges).toBeUndefined();
    expect(result.map).not.toContain('g0Node0');
    expect(JSON.stringify(result).length).toBeLessThan(20000);
  });

  it('says so when the map is truncated instead of quietly ending', async () => {
    const graphs = [];
    const nodePrototypes = [];
    for (let i = 0; i < 400; i++) {
      graphs.push(makeGraph(`g${i}`, `A Reasonably Long Web Name Number ${i}`, 3));
      nodePrototypes.push(...makeProtos(`g${i}`, 3));
    }
    const result = await inspectWorkspace(
      { mode: 'map' },
      { graphs, nodePrototypes, edges: [], activeGraphId: 'g0' }
    );
    expect(result.truncated).toBe(true);
    expect(result.truncationNote).toMatch(/omitted/);
  });

  // Recursive composition is legal in Redstring; the walk must not chase it forever.
  it('terminates on a web that contains the Thing it defines', async () => {
    const graphs = [{
      id: 'g-rec',
      name: 'Recursion',
      instances: [{ id: 'i-rec', prototypeId: 'p-rec' }],
      edgeIds: [],
      groups: []
    }];
    const nodePrototypes = [{ id: 'p-rec', name: 'Recursion', definitionGraphIds: ['g-rec'] }];

    const result = await inspectWorkspace(
      { mode: 'map' },
      { graphs, nodePrototypes, edges: [], activeGraphId: 'g-rec' }
    );
    expect(result.map).toContain('Recursion');
    expect(result.activeGraphPath).toEqual(['Recursion']);
  });
});

describe('inspectWorkspace — mode: reusable', () => {
  it('lists Things that already have webs, richest first', async () => {
    const result = await inspectWorkspace(
      { mode: 'reusable' },
      { ...nestedUniverse(), activeGraphId: 'g-root' }
    );

    expect(result.mode).toBe('reusable');
    const names = result.things.map(t => t.name);
    expect(names).toContain('Cell');
    expect(names).toContain('Cytoplasm');
    // Things with no web are not reusable and must not appear.
    expect(names).not.toContain('Nucleus');
  });

  it('reports where each Thing is already used and how big its web is', async () => {
    const result = await inspectWorkspace(
      { mode: 'reusable' },
      { ...nestedUniverse(), activeGraphId: 'g-root' }
    );
    const cell = result.things.find(t => t.name === 'Cell');
    expect(cell.componentCount).toBe(2);
    expect(cell.usedInGraphs).toBe(1);
    expect(cell.definitionGraphId).toBe('g-cell');
  });

  it('filters by query', async () => {
    const result = await inspectWorkspace(
      { mode: 'reusable', query: 'cyto' },
      { ...nestedUniverse(), activeGraphId: 'g-root' }
    );
    expect(result.things.map(t => t.name)).toEqual(['Cytoplasm']);
  });

  it('points at the `use:` form rather than leaving the model to guess', async () => {
    const result = await inspectWorkspace(
      { mode: 'reusable' },
      { ...nestedUniverse(), activeGraphId: 'g-root' }
    );
    expect(result.note).toMatch(/use/);
  });
});

describe('inspectWorkspace — mode: graph', () => {
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

  it('reports nested webs and the path, so one graph is not seen in isolation', async () => {
    const result = await inspectWorkspace(
      { mode: 'graph', graphId: 'g-cell' },
      { ...nestedUniverse(), activeGraphId: 'g-root' }
    );
    expect(result.counts.nestedWebs).toBe(1);
    expect(result.path).toEqual(['Biology', 'Cell']);
  });
});
