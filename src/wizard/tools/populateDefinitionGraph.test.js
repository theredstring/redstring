/**
 * Tests for populateDefinitionGraph edge endpoints
 */

import { describe, it, expect, vi } from 'vitest';
import { populateDefinitionGraph } from './populateDefinitionGraph.js';

vi.mock('../../ai/palettes.js', () => ({
  resolvePaletteColor: vi.fn((palette, color) => color || '#8B0000'),
  getRandomPalette: vi.fn(() => 'test-palette')
}));

const state = () => ({
  activeGraphId: 'g1',
  graphs: [{ id: 'g1', name: 'Main', instances: [{ id: 'i1', prototypeId: 'p-car' }], edgeIds: [] }],
  nodePrototypes: [
    { id: 'p-car', name: 'Car', description: 'A car', definitionGraphIds: [] },
    { id: 'p-fuel', name: 'Fuel' }
  ]
});

describe('populateDefinitionGraph edges', () => {
  it('drops a non-exact endpoint, names what is close, and keeps edges to its own layers', async () => {
    const result = await populateDefinitionGraph({
      nodeName: 'Car',
      nodes: [{ name: 'Wheel' }, { name: 'Chassis' }],
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Piston' }, { name: 'Cam' }] } }],
      edges: [
        { source: 'Chassis', target: 'Engine', type: 'Holds' },
        { source: 'Chassis', target: 'Front Wheel', type: 'Carries' }
      ]
    }, state());

    expect(result.spec.edges).toEqual([expect.objectContaining({ source: 'Chassis', target: 'Engine', toLayer: true })]);
    expect(result.droppedEdges.map(d => d.target)).toEqual(['Front Wheel']);
    expect(result.edgeWarning).toContain('closest: "Wheel"');
  });

  it('never places the Thing being defined inside its own definition', async () => {
    const result = await populateDefinitionGraph({
      nodeName: 'Car',
      nodes: [{ name: 'Tank' }],
      edges: [
        { source: 'Tank', target: 'Fuel', type: 'Holds' },
        { source: 'Tank', target: 'Car', type: 'Part Of' }
      ]
    }, state());

    expect(result.placedExisting).toEqual(['Fuel']);
    expect(result.droppedEdges.map(d => d.target)).toEqual(['Car']);
  });
});
