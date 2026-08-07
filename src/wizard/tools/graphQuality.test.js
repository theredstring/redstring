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
  it('notes a large single level with no layers at all', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const edges = names.slice(1).map((n, i) => ({ source: names[i], target: n, type: `Rel${i}` }));
    const report = analyzeGraphQuality(names.map(node), edges);
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
