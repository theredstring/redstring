import { describe, it, expect } from 'vitest';
import {
  buildContext,
  buildPlanContext,
  assignGraphTiers,
  CONTEXT_TOKEN_BUDGET,
  NEIGHBOR_RADIUS
} from './ContextBuilder.js';
import { estimateTokens } from './tokenEstimate.js';

/** Build a graph with `n` instances whose prototypes carry long descriptions. */
function makeGraph(id, name, nodeCount = 3, { descLength = 0 } = {}) {
  const instances = [];
  for (let i = 0; i < nodeCount; i++) {
    instances.push({ id: `${id}-inst-${i}`, prototypeId: `${id}-proto-${i}` });
  }
  return { id, name, instances, edgeIds: [], groups: [] };
}

function makeProtos(graphId, nodeCount, descLength = 0) {
  const protos = [];
  for (let i = 0; i < nodeCount; i++) {
    protos.push({
      id: `${graphId}-proto-${i}`,
      name: `${graphId}Node${i}`,
      description: 'x'.repeat(descLength)
    });
  }
  return protos;
}

describe('assignGraphTiers', () => {
  const graphs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    .map(id => makeGraph(id, id.toUpperCase(), 1));

  it('places tabs within the radius in the near tier and the rest in open', () => {
    // Active is index 0, so b..d (indices 1-3) are within radius 3.
    const openIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    const tiers = assignGraphTiers(graphs, 'a', openIds);

    expect(tiers.active.id).toBe('a');
    expect(tiers.near.map(g => g.id)).toEqual(['b', 'c', 'd']);
    expect(tiers.open.map(g => g.id)).toEqual(['e', 'f']);
  });

  it('measures distance in both directions from the active tab', () => {
    // Active at index 4 → indices 1..7 are within radius 3.
    const openIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const tiers = assignGraphTiers(graphs, 'e', openIds);

    expect(tiers.near.map(g => g.id).sort()).toEqual(['b', 'c', 'd', 'f', 'g', 'h']);
    expect(tiers.open.map(g => g.id).sort()).toEqual(['a', 'i']);
  });

  it('treats graphs that are not open as closed', () => {
    const tiers = assignGraphTiers(graphs, 'a', ['a', 'b']);
    expect(tiers.closed.map(g => g.id)).toEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
  });

  it('treats every non-active graph as closed when tab state is unavailable', () => {
    // The MCP entry point builds its own graphState and may omit openGraphIds.
    const tiers = assignGraphTiers(graphs, 'a', undefined);
    expect(tiers.near).toEqual([]);
    expect(tiers.open).toEqual([]);
    expect(tiers.closed.length).toBe(9);
  });

  it('does not classify anything as near when the active graph is not an open tab', () => {
    const tiers = assignGraphTiers(graphs, 'a', ['b', 'c', 'd']);
    expect(tiers.near).toEqual([]);
    expect(tiers.open.map(g => g.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('buildContext detail tiering', () => {
  it('renders the active graph with descriptions and neighbours without them', () => {
    const active = makeGraph('act', 'Active Web', 2);
    const near = makeGraph('nb', 'Neighbour Web', 2);
    const graphState = {
      graphs: [active, near],
      nodePrototypes: [
        ...makeProtos('act', 2, 20),
        ...makeProtos('nb', 2, 20)
      ],
      edges: [],
      activeGraphId: 'act',
      openGraphIds: ['act', 'nb']
    };

    const ctx = buildContext(graphState);

    // Active graph nodes carry their descriptions.
    expect(ctx).toContain('actNode0: xxxxxxxxxxxxxxxxxxxx');
    // Neighbour nodes appear by name but without description text.
    expect(ctx).toContain('nbNode0');
    expect(ctx).not.toContain('nbNode0: xxxxxxxxxxxxxxxxxxxx');
    expect(ctx).toContain('Nearby open webs');
  });

  it('reduces distant open tabs to counts, not node names', () => {
    const graphs = [makeGraph('act', 'Active', 1)];
    const openIds = ['act'];
    // Push a graph well past the neighbour radius.
    for (let i = 0; i < NEIGHBOR_RADIUS + 2; i++) {
      graphs.push(makeGraph(`g${i}`, `Web ${i}`, 2));
      openIds.push(`g${i}`);
    }
    const nodePrototypes = [
      ...makeProtos('act', 1),
      ...graphs.slice(1).flatMap(g => makeProtos(g.id, 2))
    ];

    const ctx = buildContext({
      graphs,
      nodePrototypes,
      edges: [],
      activeGraphId: 'act',
      openGraphIds: openIds
    });

    const farGraph = graphs[graphs.length - 1];
    expect(ctx).toContain('Other open webs:');
    // The far graph is present, but only as a count line.
    expect(ctx).toContain(`"${farGraph.name}"`);
    expect(ctx).not.toContain(`${farGraph.id}Node0`);
  });

  it('lists closed graphs by name only', () => {
    const ctx = buildContext({
      graphs: [makeGraph('act', 'Active', 1), makeGraph('cl', 'Closed Web', 5)],
      nodePrototypes: [...makeProtos('act', 1), ...makeProtos('cl', 5)],
      edges: [],
      activeGraphId: 'act',
      openGraphIds: ['act']
    });

    expect(ctx).toContain('Other webs available (not open): "Closed Web"');
    expect(ctx).not.toContain('clNode0');
  });
});

describe('buildContext budget enforcement', () => {
  it('stays within the token budget on a universe far larger than it', () => {
    // 75 graphs of 40 nodes each with long descriptions — the shape that used to
    // put a six-figure token count into every single iteration.
    const graphs = [];
    const nodePrototypes = [];
    const openGraphIds = [];
    for (let i = 0; i < 75; i++) {
      const id = `g${i}`;
      graphs.push(makeGraph(id, `Web Number ${i}`, 40));
      nodePrototypes.push(...makeProtos(id, 40, 120));
      openGraphIds.push(id);
    }

    const ctx = buildContext({
      graphs,
      nodePrototypes,
      edges: [],
      activeGraphId: 'g0',
      openGraphIds
    });

    // Some slack for the framing text that sits outside the per-graph accounting.
    expect(estimateTokens(ctx)).toBeLessThan(CONTEXT_TOKEN_BUDGET * 1.3);
  });

  it('announces when neighbouring webs are demoted below their tier', () => {
    // Neighbour tabs too large to render at their normal detail. They still
    // appear — demoted to counts — but silently swapping node lists for a count
    // would read to the model as "that web is empty", so it must be stated.
    const graphs = [makeGraph('act', 'Active', 2)];
    const nodePrototypes = [...makeProtos('act', 2, 10)];
    const openGraphIds = ['act'];
    for (let i = 0; i < NEIGHBOR_RADIUS; i++) {
      const id = `nb${i}`;
      graphs.push(makeGraph(id, `Neighbour ${i}`, 2000));
      nodePrototypes.push(...makeProtos(id, 2000, 40));
      openGraphIds.push(id);
    }

    const ctx = buildContext({
      graphs,
      nodePrototypes,
      edges: [],
      activeGraphId: 'act',
      openGraphIds
    });

    expect(ctx).toContain('This snapshot is partial');
    expect(ctx).toMatch(/nearby webs? (is|are) shown at reduced detail/);
    // Demoted, not dropped: the neighbours are still named.
    expect(ctx).toContain('"Neighbour 0"');
    expect(estimateTokens(ctx)).toBeLessThan(CONTEXT_TOKEN_BUDGET * 1.3);
  });

  it('degrades the active graph rather than blowing the budget on it alone', () => {
    // One enormous active graph: it must not consume the entire header.
    const active = makeGraph('act', 'Huge', 3000);
    const ctx = buildContext({
      graphs: [active],
      nodePrototypes: makeProtos('act', 3000, 200),
      edges: [],
      activeGraphId: 'act',
      openGraphIds: ['act']
    });

    expect(estimateTokens(ctx)).toBeLessThan(CONTEXT_TOKEN_BUDGET * 1.3);
    expect(ctx).toContain('This snapshot is partial');
    expect(ctx).toMatch(/reduced detail/);
  });

  it('renders a small active graph in full with no partial-snapshot warning', () => {
    const ctx = buildContext({
      graphs: [makeGraph('act', 'Small', 3)],
      nodePrototypes: makeProtos('act', 3, 30),
      edges: [],
      activeGraphId: 'act',
      openGraphIds: ['act']
    });

    expect(ctx).toContain('actNode0: ');
    expect(ctx).not.toContain('This snapshot is partial');
  });
});

describe('buildContext edges', () => {
  it('renders active-graph edges as triplets with resolved type names', () => {
    const active = {
      id: 'act',
      name: 'Active',
      instances: [
        { id: 'i1', prototypeId: 'p1' },
        { id: 'i2', prototypeId: 'p2' }
      ],
      edgeIds: ['e1'],
      groups: []
    };

    const ctx = buildContext({
      graphs: [active],
      nodePrototypes: [
        { id: 'p1', name: 'Source' },
        { id: 'p2', name: 'Target' },
        { id: 'p3', name: 'Depends On' }
      ],
      edges: [{ id: 'e1', sourceId: 'i1', destinationId: 'i2', definitionNodeIds: ['p3'] }],
      activeGraphId: 'act',
      openGraphIds: ['act']
    });

    expect(ctx).toContain('Source --[Depends On]--> Target');
  });

  it('handles an empty active graph', () => {
    const ctx = buildContext({
      graphs: [{ id: 'act', name: 'Blank', instances: [], edgeIds: [], groups: [] }],
      nodePrototypes: [],
      edges: [],
      activeGraphId: 'act',
      openGraphIds: ['act']
    });

    expect(ctx).toContain('Empty (perfect for populating!)');
  });

  it('reports no active web when there is none', () => {
    const ctx = buildContext({
      graphs: [makeGraph('a', 'A', 1)],
      nodePrototypes: makeProtos('a', 1),
      edges: [],
      activeGraphId: null,
      openGraphIds: []
    });

    expect(ctx).toContain('No active web');
  });
});

describe('buildPlanContext', () => {
  const plan = [
    { description: 'Build layer 1', status: 'done' },
    { description: 'Build layer 2', status: 'pending' }
  ];

  it('announces a carried-over plan and forbids re-planning', () => {
    const out = buildPlanContext(plan, 0, 77, { isResumed: true });

    expect(out).toContain('carried over from your previous turn');
    expect(out).toContain('Do NOT re-plan');
    expect(out).toContain('1/2 complete');
  });

  it('says nothing about resuming for a fresh plan', () => {
    const out = buildPlanContext(plan, 0, 77);
    expect(out).not.toContain('carried over');
  });

  it('counts a skipped step as settled and renders it distinctly', () => {
    const out = buildPlanContext(
      [
        { description: 'Build it', status: 'done' },
        { description: 'Optional polish', status: 'skipped' }
      ],
      0,
      77
    );

    expect(out).toContain('2/2 complete');
    expect(out).toContain('[SKIPPED] Optional polish');
    expect(out).toContain('All steps are settled');
  });

  it('offers skipping as an exit when steps remain', () => {
    const out = buildPlanContext(plan, 0, 77);
    expect(out).toContain('mark it "skipped"');
  });

  it('does not tell a finished resumed plan to keep going', () => {
    const out = buildPlanContext(
      [{ description: 'A', status: 'done' }, { description: 'B', status: 'done' }],
      0,
      77,
      { isResumed: true }
    );
    expect(out).not.toContain('carried over');
    expect(out).toContain('All steps are settled');
  });
});
