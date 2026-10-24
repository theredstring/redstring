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

describe('inspectWorkspace — mode: map, what it leaves out', () => {
  // Webs the map cut for depth are nested, not orphaned.
  it('reports webs past the depth limit as beyond it, not as unplaced', async () => {
    const result = await inspectWorkspace(
      { mode: 'map', depth: 1 },
      { ...nestedUniverse(), activeGraphId: 'g-root' }
    );
    expect(result.unreachedGraphs).toBeUndefined();
    expect(result.unreachedNote).toBeUndefined();
    expect(result.beyondGraphs).toBe(1);
    expect(result.beyondNote).toMatch(/not orphaned/);
  });

  it('reports webs past the size budget as beyond it, not as unplaced', async () => {
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
    expect(result.unreachedGraphs).toBeUndefined();
    expect(result.beyondGraphs).toBeGreaterThan(0);
  });

  it('still reports webs no root reaches', async () => {
    // Each Thing placed only in the other's web: neither is a root.
    const graphs = [
      { id: 'g-a', name: 'A', instances: [{ id: 'i-b', prototypeId: 'p-b' }], edgeIds: [], groups: [] },
      { id: 'g-b', name: 'B', instances: [{ id: 'i-a', prototypeId: 'p-a' }], edgeIds: [], groups: [] },
      ...nestedUniverse().graphs,
    ];
    const nodePrototypes = [
      { id: 'p-a', name: 'A', definitionGraphIds: ['g-a'] },
      { id: 'p-b', name: 'B', definitionGraphIds: ['g-b'] },
      ...nestedUniverse().nodePrototypes,
    ];
    const result = await inspectWorkspace({ mode: 'map' }, { graphs, nodePrototypes, edges: [], activeGraphId: 'g-root' });
    expect(result.unreachedGraphs.map(g => g.graphId).sort()).toEqual(['g-a', 'g-b']);
    expect(result.unreachedNote).toMatch(/^2 web/);
    expect(result.beyondGraphs).toBeUndefined();
  });
});

/**
 * A section web holding equations as the formula bank files them: each
 * equation's Thing placed as a plain node, its web the formula (terms joined
 * by operations), with one part in parentheses whose Thing has a web too.
 */
function formulaUniverse(count, { withEdges = true } = {}) {
  const graphs = [{ id: 'g-thermo', name: 'Thermodynamics', instances: [], edgeIds: [], groups: [] }];
  const nodePrototypes = [
    { id: 'p-thermo', name: 'Thermodynamics', definitionGraphIds: ['g-thermo'] },
    { id: 'op-eq', name: 'Equality', definitionGraphIds: [] },
    { id: 'op-mul', name: 'Multiplication', definitionGraphIds: [] },
    { id: 'p-pressure', name: 'Pressure', definitionGraphIds: [] },
  ];
  const edges = [];
  for (let i = 0; i < count; i++) {
    graphs[0].instances.push({ id: `i-eq${i}`, prototypeId: `p-eq${i}` });
    nodePrototypes.push(
      { id: `p-eq${i}`, name: `Law ${i}`, definitionGraphIds: [`g-eq${i}`] },
      { id: `p-part${i}`, name: `(n R T) ${i}`, definitionGraphIds: [`g-part${i}`] },
      { id: `p-n${i}`, name: `n${i}`, definitionGraphIds: [] },
      { id: `p-r${i}`, name: `R${i}`, definitionGraphIds: [] },
    );
    graphs.push(
      {
        id: `g-eq${i}`, name: `Law ${i}`,
        instances: [
          { id: `e${i}-p`, prototypeId: 'p-pressure' },
          { id: `e${i}-part`, prototypeId: `p-part${i}` },
          { id: `e${i}-n`, prototypeId: `p-n${i}` },
          { id: `e${i}-r`, prototypeId: `p-r${i}` },
        ],
        edgeIds: withEdges ? [`eq${i}-1`, `eq${i}-2`] : [],
        groups: [{ id: `grp-part${i}`, name: `(n R T) ${i}`, linkedNodePrototypeId: `p-part${i}`, anchorInstanceId: `e${i}-part`, memberInstanceIds: [`e${i}-n`, `e${i}-r`] }],
      },
      {
        id: `g-part${i}`, name: `(n R T) ${i}`,
        instances: [{ id: `pt${i}-n`, prototypeId: `p-n${i}` }, { id: `pt${i}-r`, prototypeId: `p-r${i}` }],
        edgeIds: withEdges ? [`pt${i}-1`] : [],
        groups: [],
      },
    );
    if (withEdges) {
      edges.push(
        { id: `eq${i}-1`, sourceId: `e${i}-p`, destinationId: `e${i}-part`, definitionNodeIds: ['op-eq'] },
        { id: `eq${i}-2`, sourceId: `e${i}-n`, destinationId: `e${i}-r`, definitionNodeIds: ['op-mul'] },
        { id: `pt${i}-1`, sourceId: `pt${i}-n`, destinationId: `pt${i}-r`, definitionNodeIds: ['op-mul'] },
      );
    }
  }
  return { graphs, nodePrototypes, edges, activeGraphId: 'g-thermo' };
}

describe('inspectWorkspace — mode: map, formulas', () => {
  it('shows an equation as a formula and never its inside', async () => {
    const result = await inspectWorkspace({ mode: 'map' }, formulaUniverse(2));
    expect(result.map).toMatch(/- Law 0 \[formula\] \{g-eq0\}/);
    expect(result.map).toMatch(/- Law 1 \[formula\] \{g-eq1\}/);
    // Its parts are drawn in it, not nested webs.
    expect(result.map).not.toContain('(n R T)');
    expect(result.formulaWebs).toBe(2);
    expect(result.unreachedGraphs).toBeUndefined();
    expect(result.beyondGraphs).toBeUndefined();
  });

  it('counts a section\'s formulas rather than listing each', async () => {
    const result = await inspectWorkspace({ mode: 'map' }, formulaUniverse(40));
    expect(result.map).toMatch(/- 40 formulas: Law 0, Law 1, Law 2, …/);
    expect(result.map).not.toContain('Law 39');
    expect(result.truncated).toBeUndefined();
    // 40 equation webs summarized, 40 part webs inside them: nothing orphaned.
    expect(result.totalGraphs).toBe(81);
    expect(result.formulaWebs).toBe(40);
    expect(result.unreachedGraphs).toBeUndefined();
    expect(result.beyondGraphs).toBeUndefined();
  });

  it('knows an equation from the snapshot when its web carries no operations', async () => {
    const state = formulaUniverse(1, { withEdges: false });
    const without = await inspectWorkspace({ mode: 'map' }, state);
    expect(without.map).toContain('(n R T)');

    const result = await inspectWorkspace({ mode: 'map' }, {
      ...state,
      universeEquations: [{ protoId: 'p-eq0', name: 'Law 0', text: 'P = n × R' }],
    });
    expect(result.map).toMatch(/- Law 0 \[formula\]/);
    expect(result.map).not.toContain('(n R T)');
  });

  it('skips the parts of a formula shown open in a web', async () => {
    const state = formulaUniverse(1);
    // The lab shows Law 0 as a formula group, its part a Thing-group inside it.
    state.graphs.unshift({
      id: 'g-lab', name: 'Lab',
      instances: [
        { id: 'l-anchor', prototypeId: 'p-eq0' },
        { id: 'l-part', prototypeId: 'p-part0' },
        { id: 'l-n', prototypeId: 'p-n0' },
      ],
      edgeIds: [],
      groups: [
        { id: 'fg', name: 'Law 0', format: 'formula', linkedNodePrototypeId: 'p-eq0', anchorInstanceId: 'l-anchor', memberInstanceIds: ['l-part', 'l-n'] },
        { id: 'pg', name: '(n R T) 0', linkedNodePrototypeId: 'p-part0', anchorInstanceId: 'l-part', memberInstanceIds: ['l-n'] },
      ],
    });
    state.nodePrototypes.push({ id: 'p-lab', name: 'Lab', definitionGraphIds: ['g-lab'] });
    const result = await inspectWorkspace({ mode: 'map' }, state);
    const lab = result.map.split('\n').findIndex(l => l.includes('Lab'));
    expect(lab).toBeGreaterThanOrEqual(0);
    expect(result.map).not.toContain('(n R T)');
    expect(result.map).toMatch(/Law 0 \[formula\]/);
  });

  it('keeps a web that shows only a formula a web', async () => {
    // Its connections are all operations, but a formula group holds them: the
    // web shows a formula, it isn't one's inside.
    const state = formulaUniverse(1);
    const law = state.graphs.find(g => g.id === 'g-eq0');
    state.graphs.push({
      ...law,
      id: 'g-gases', name: 'Gases',
      groups: [...law.groups, { id: 'fg', name: 'Law 0', format: 'formula', linkedNodePrototypeId: 'p-eq0', memberInstanceIds: law.instances.map(i => i.id) }],
    });
    state.nodePrototypes.push({ id: 'p-gases', name: 'Gases', definitionGraphIds: ['g-gases'] });
    state.graphs[0].instances.push({ id: 'i-gases', prototypeId: 'p-gases' });

    const result = await inspectWorkspace({ mode: 'map' }, state);
    expect(result.map).toMatch(/- Gases \(4n\/2e\) \{g-gases\}/);

    // The panel's snapshot reads such a web as an equation (its web reads as
    // one formula); the map still shows it as the web it is.
    const withSnapshot = await inspectWorkspace({ mode: 'map' }, {
      ...state, universeEquations: [{ protoId: 'p-gases', name: 'Gases', text: 'P = n × R' }],
    });
    expect(withSnapshot.map).toMatch(/- Gases \(4n\/2e\) \{g-gases\}/);
  });

  it('walks into a formula when the active graph is inside it', async () => {
    const result = await inspectWorkspace({ mode: 'map' }, { ...formulaUniverse(1), activeGraphId: 'g-part0' });
    expect(result.map).toMatch(/\(n R T\) 0[^\n]*\[formula, ACTIVE\]/);
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
