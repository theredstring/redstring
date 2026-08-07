import { describe, it, expect } from 'vitest';
import { analyzeGraphQuality } from './graphQuality.js';

const node = (name) => ({ name, description: `${name} description` });

/**
 * The failure this whole file exists to catch: asked to build a cell, the model
 * produced nine organelles each connected to Cytoplasm by "Suspended In". Under
 * the old metric that scored perfectly — no orphans, one component, high average
 * degree — so nothing ever told it to stop.
 */
function cytoplasmStar() {
  const organelles = [
    'Mitochondria', 'Golgi Apparatus', 'Ribosome', 'Nucleus',
    'Lysosome', 'Endoplasmic Reticulum', 'Vacuole', 'Centrosome'
  ];
  return {
    nodes: [node('Cytoplasm'), ...organelles.map(node)],
    edges: organelles.map(o => ({ source: o, target: 'Cytoplasm', type: 'Suspended In' }))
  };
}

describe('analyzeGraphQuality — hub detection', () => {
  it('flags the cytoplasm star instead of scoring it perfectly', () => {
    const { nodes, edges } = cytoplasmStar();
    const report = analyzeGraphQuality(nodes, edges);

    expect(report.orphanedNodes).toHaveLength(0);
    expect(report.disconnectedComponents).toBe(1);
    // The old metric stopped here and called it good.
    expect(report.hub).not.toBeNull();
    expect(report.hub.name).toBe('Cytoplasm');
    expect(report.hub.edgeShare).toBeGreaterThanOrEqual(50);
    expect(report.feedback).toMatch(/HUB/);
  });

  it('names the layer as the remedy rather than just reporting a number', () => {
    const { nodes, edges } = cytoplasmStar();
    const report = analyzeGraphQuality(nodes, edges);
    expect(report.feedback).toMatch(/layer/i);
  });

  it('does not flag a hub in a small graph, where one is unremarkable', () => {
    const report = analyzeGraphQuality(
      [node('A'), node('B'), node('C')],
      [{ source: 'B', target: 'A' }, { source: 'C', target: 'A' }]
    );
    expect(report.hub).toBeNull();
  });

  it('does not flag a well-connected peer graph', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'].map(node);
    const edges = [
      { source: 'A', target: 'B', type: 'Feeds' },
      { source: 'B', target: 'C', type: 'Triggers' },
      { source: 'C', target: 'D', type: 'Limits' },
      { source: 'D', target: 'E', type: 'Reinforces' },
      { source: 'E', target: 'A', type: 'Closes' }
    ];
    const report = analyzeGraphQuality(nodes, edges);
    expect(report.hub).toBeNull();
    expect(report.feedback).toMatch(/Good structure/);
  });

  // A layer at the center IS the composed form — that is the shape the hub
  // warning is steering toward, so warning about it would be a loop.
  it('accepts a hub that is already a layer', () => {
    const organelles = ['Mitochondria', 'Golgi Apparatus', 'Ribosome', 'Lysosome'];
    const report = analyzeGraphQuality(
      organelles.map(node),
      organelles.map(o => ({ source: o, target: 'Cytoplasm', type: 'Part Of' })),
      { layers: [{ name: 'Cytoplasm' }] }
    );
    expect(report.hub.isLayer).toBe(true);
    expect(report.feedback).not.toMatch(/HUB:/);
  });

  it('does not let a hub inflate the average degree past the guidance bar', () => {
    const { nodes, edges } = cytoplasmStar();
    const report = analyzeGraphQuality(nodes, edges);
    // Every spoke has exactly one connection; only the hub has eight.
    expect(report.avgConnectionsPerNode).toBeCloseTo(1, 1);
    expect(report.medianConnectionsPerNode).toBe(1);
  });
});

describe('analyzeGraphQuality — repeated relation', () => {
  it('flags one relation used for nearly everything', () => {
    const { nodes, edges } = cytoplasmStar();
    const report = analyzeGraphQuality(nodes, edges);
    expect(report.dominantRelation).not.toBeNull();
    expect(report.dominantRelation.type).toBe('Suspended In');
    expect(report.feedback).toMatch(/REPETITION/);
  });

  it('reads the relation from definitionNode when type is absent', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'].map(node);
    const edges = [
      { source: 'A', target: 'B', definitionNode: { name: 'Contains' } },
      { source: 'A', target: 'C', definitionNode: { name: 'Contains' } },
      { source: 'A', target: 'D', definitionNode: { name: 'Contains' } },
      { source: 'B', target: 'E', definitionNode: { name: 'Contains' } }
    ];
    const report = analyzeGraphQuality(nodes, edges);
    expect(report.dominantRelation.type).toBe('Contains');
  });

  it('leaves a varied graph alone', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'].map(node);
    const edges = [
      { source: 'A', target: 'B', type: 'Feeds' },
      { source: 'B', target: 'C', type: 'Triggers' },
      { source: 'C', target: 'D', type: 'Limits' },
      { source: 'D', target: 'E', type: 'Reinforces' }
    ];
    expect(analyzeGraphQuality(nodes, edges).dominantRelation).toBeNull();
  });

  it('says nothing about repetition below the edge-count floor', () => {
    const report = analyzeGraphQuality(
      [node('A'), node('B'), node('C')],
      [{ source: 'A', target: 'B', type: 'Same' }, { source: 'B', target: 'C', type: 'Same' }]
    );
    expect(report.dominantRelation).toBeNull();
  });
});

describe('analyzeGraphQuality — layers', () => {
  // The bug that made composed graphs look broken: buildComposition passed only
  // `nodes`, so an edge pointing at a layer was dropped from the adjacency and
  // its other endpoint was reported orphaned.
  it('counts edges to a layer as real connections', () => {
    const report = analyzeGraphQuality(
      [node('Chassis'), node('Wheels')],
      [
        { source: 'Chassis', target: 'Engine', type: 'Mounts' },
        { source: 'Wheels', target: 'Engine', type: 'Driven By' }
      ],
      { layers: [{ name: 'Engine' }] }
    );
    expect(report.orphanedNodes).toHaveLength(0);
  });

  it('reports a node orphaned when it truly connects to nothing', () => {
    const report = analyzeGraphQuality(
      [node('Chassis'), node('Spare Tyre')],
      [{ source: 'Chassis', target: 'Engine' }],
      { layers: [{ name: 'Engine' }] }
    );
    expect(report.orphanedNodes).toEqual(['Spare Tyre']);
  });

  it('reports how many layers a level has', () => {
    const report = analyzeGraphQuality(
      [node('A')],
      [],
      { layers: [{ name: 'L1' }, { name: 'L2' }] }
    );
    expect(report.layerCount).toBe(2);
  });

  it('does not demand descriptions of layers', () => {
    const report = analyzeGraphQuality([], [], { layers: [{ name: 'Engine' }] });
    expect(report.noDescriptionNodes).toHaveLength(0);
  });
});

describe('analyzeGraphQuality — flatness', () => {
  it('notes a large single level whose clusters were left as plain groups', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const edges = names.slice(1).map((n, i) => ({ source: names[i], target: n, type: `Rel${i}` }));
    const report = analyzeGraphQuality(names.map(node), edges, { groups: [{ name: 'Cluster One' }] });
    expect(report.feedback).toMatch(/FLAT/);
  });

  it('says nothing about flatness once a layer exists', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const edges = names.slice(1).map((n, i) => ({ source: names[i], target: n, type: `Rel${i}` }));
    const report = analyzeGraphQuality(names.map(node), edges, { layers: [{ name: 'Grouped' }] });
    expect(report.feedback).not.toMatch(/FLAT/);
  });

  it('leaves small flat graphs alone — not everything needs depth', () => {
    const report = analyzeGraphQuality(
      [node('A'), node('B'), node('C')],
      [{ source: 'A', target: 'B', type: 'Feeds' }, { source: 'B', target: 'C', type: 'Triggers' }]
    );
    expect(report.feedback).not.toMatch(/FLAT/);
  });
});

describe('analyzeGraphQuality — existing behaviour preserved', () => {
  it('still reports orphans, components and missing descriptions', () => {
    const report = analyzeGraphQuality(
      [node('A'), node('B'), { name: 'C' }],
      [{ source: 'A', target: 'B' }]
    );
    expect(report.orphanedNodes).toEqual(['C']);
    expect(report.disconnectedComponents).toBe(2);
    expect(report.noDescriptionNodes).toEqual(['C']);
  });

  it('handles an empty graph', () => {
    const report = analyzeGraphQuality([], []);
    expect(report.feedback).toBe('No nodes to analyze.');
    expect(report.layerCount).toBe(0);
  });
});

describe('analyzeGraphQuality — collapsed layers', () => {
  // A collapsed layer renders identically to a plain node. Collapse them all and
  // the user sees a flat graph however much structure sits behind it — which is
  // exactly what "it's trying to make node groups but they're just nodes" was.
  it('flags a build where every layer is collapsed', () => {
    const report = analyzeGraphQuality(
      [node('Carmy'), node('Sydney')],
      [{ source: 'Carmy', target: 'Sydney', type: 'Mentors' }],
      {
        layers: [
          { name: 'The Bear Restaurant', display: 'collapsed' },
          { name: 'The Beef', display: 'collapsed' }
        ]
      }
    );
    expect(report.feedback).toMatch(/ALL COLLAPSED/);
    expect(report.decomposedLayerCount).toBe(0);
  });

  it('stays quiet when at least one layer opens', () => {
    const report = analyzeGraphQuality(
      [node('Carmy')],
      [],
      {
        layers: [
          { name: 'The Bear Restaurant', display: 'decomposed' },
          { name: 'The Beef', display: 'collapsed' }
        ]
      }
    );
    expect(report.feedback).not.toMatch(/ALL COLLAPSED/);
    expect(report.decomposedLayerCount).toBe(1);
  });

  it('treats an unset display as decomposed', () => {
    const report = analyzeGraphQuality([node('A')], [], { layers: [{ name: 'L' }] });
    expect(report.feedback).not.toMatch(/ALL COLLAPSED/);
  });
});

describe('analyzeGraphQuality — flatness is evidence-based', () => {
  // A cast of characters with varied relationships is a genuinely flat graph and
  // correctly modelled as one. Complaining sent the model back to re-sketch a
  // structure that was right, three times, burning the token budget.
  it('does not call a relational graph flat just for having many nodes', () => {
    const names = ['Carmy', 'Sydney', 'Richie', 'Marcus', 'Tina', 'Natalie', 'Uncle Jimmy', 'Fak', 'Claire'];
    const edges = [
      { source: 'Carmy', target: 'Sydney', type: 'Mentors' },
      { source: 'Richie', target: 'Carmy', type: 'Resents' },
      { source: 'Marcus', target: 'Carmy', type: 'Learns From' },
      { source: 'Tina', target: 'Sydney', type: 'Warms To' },
      { source: 'Natalie', target: 'Carmy', type: 'Sister Of' },
      { source: 'Uncle Jimmy', target: 'Natalie', type: 'Funds' },
      { source: 'Fak', target: 'Richie', type: 'Befriends' },
      { source: 'Claire', target: 'Carmy', type: 'Dates' }
    ];
    const report = analyzeGraphQuality(names.map(node), edges);
    expect(report.feedback).not.toMatch(/FLAT/);
  });

  // But if it already found the clusters and made them merely visual, say so.
  it('flags plain groups that should have been layers', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const edges = names.slice(1).map((n, i) => ({ source: names[i], target: n, type: `Rel${i}` }));
    const report = analyzeGraphQuality(names.map(node), edges, {
      groups: [{ name: 'Kitchen Brigade' }, { name: 'Front of House' }]
    });
    expect(report.feedback).toMatch(/FLAT/);
    expect(report.feedback).toMatch(/Kitchen Brigade/);
  });
});
