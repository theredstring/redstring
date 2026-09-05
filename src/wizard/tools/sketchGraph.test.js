/**
 * sketchGraph — the {size} shorthand.
 *
 * The sketch is the only place sizes can be decided: the prompt tells the model to
 * pass `expandedSpec` to the build tool without re-authoring it, so a size the
 * shorthand can't express is a size the graph can never get. These tests pin the
 * whole hop — shorthand → expandedSpec → the build tools' re-normalization.
 */

import { describe, it, expect } from 'vitest';
import { sketchGraph } from './sketchGraph.js';
import { normalizeGraphSpec, createSpecContext } from './utils/graphSpec.js';
import { parseSizeShorthand } from './utils/nodeSize.js';

const emptyState = { graphs: [], nodePrototypes: [], activeGraphId: null };

describe('parseSizeShorthand', () => {
  it('reads a size marker in either position and tolerates its absence', () => {
    expect(parseSizeShorthand('Sun {large}')).toMatchObject({ text: 'Sun', size: 'large' });
    expect(parseSizeShorthand('{xl} Andromeda')).toMatchObject({ text: 'Andromeda', size: 'extra-large' });
    expect(parseSizeShorthand('Plain')).toMatchObject({ text: 'Plain', size: null });
  });

  it('leaves a [Type] suffix intact for the type parser', () => {
    expect(parseSizeShorthand('Ceres [Dwarf Planet] {small}'))
      .toMatchObject({ text: 'Ceres [Dwarf Planet]', size: 'small' });
  });

  it('reports an unrecognized token rather than swallowing it', () => {
    expect(parseSizeShorthand('Weird {gigantic}')).toMatchObject({ text: 'Weird', unknown: 'gigantic' });
  });
});

describe('sketchGraph sizing', () => {
  it('carries sizes into expandedSpec and omits medium', async () => {
    const result = await sketchGraph({
      name: 'Solar System',
      nodes: ['Sun {large}', 'Earth', 'Ceres [Dwarf Planet] {small}'],
      layers: [{ name: 'Outer Planets', definition: { nodes: ['Jupiter {large}', 'Neptune'] } }]
    }, emptyState);

    const byName = Object.fromEntries(result.expandedSpec.nodes.map(n => [n.name, n]));
    expect(byName['Sun'].size).toBe('large');
    expect(byName['Ceres'].size).toBe('small');
    expect(byName['Ceres'].type).toBe('Dwarf Planet');
    // Medium is the default and is deliberately not serialized.
    expect('size' in byName['Earth']).toBe(false);

    const layerNodes = result.expandedSpec.layers[0].definition.nodes;
    expect(layerNodes.find(n => n.name === 'Jupiter').size).toBe('large');
    expect('size' in layerNodes.find(n => n.name === 'Neptune')).toBe(false);
  });

  it('strips the marker where a name is only being referenced', async () => {
    const result = await sketchGraph({
      name: 'Solar System',
      nodes: ['Sun {large}', 'Earth', 'Ceres {small}'],
      edges: ['Earth -> Orbits -> Sun {large}'],
      groups: ['Rocky: Earth, Ceres {small}']
    }, emptyState);

    // A decorated reference must still resolve, or the edge is silently dropped.
    expect(result.expandedSpec.edges).toHaveLength(1);
    expect(result.expandedSpec.edges[0].target).toBe('Sun');
    expect(result.expandedSpec.groups[0].memberNames).toEqual(['Earth', 'Ceres']);
  });

  it('survives the build tools re-normalizing expandedSpec into sizeMul', async () => {
    const result = await sketchGraph({
      name: 'Solar System',
      nodes: ['Sun {large}', 'Earth', 'Ceres {small}'],
      layers: [{ name: 'Outer Planets', definition: { nodes: ['Jupiter {large}', 'Neptune'] } }]
    }, emptyState);

    const normalized = normalizeGraphSpec(result.expandedSpec, createSpecContext('default', emptyState));
    const byName = Object.fromEntries(normalized.nodes.map(n => [n.name, n]));

    expect(byName['Sun'].sizeMul).toBeGreaterThan(1);
    expect(byName['Ceres'].sizeMul).toBeLessThan(1);
    expect(byName['Earth'].sizeMul).toBeUndefined();
    expect(normalized.layers[0].definition.nodes.find(n => n.name === 'Jupiter').sizeMul).toBeGreaterThan(1);
  });

  it('warns on an unrecognized size instead of failing the sketch', async () => {
    const result = await sketchGraph({ name: 'W', nodes: ['A {gigantic}', 'B'] }, emptyState);

    expect(result.warnings.join(' ')).toMatch(/gigantic/);
    expect(result.expandedSpec.nodes.find(n => n.name === 'A')).toBeTruthy();
  });
});

describe('sketchGraph is-a ladders', () => {
  it('parses caret rungs alongside [Type] and {size}, and carries them into expandedSpec', async () => {
    const result = await sketchGraph({
      name: 'Automotive',
      nodes: ['Ford Motor Company [Company] {large} ^Automaker ^Company', 'Pistons [Component]'],
      edges: []
    }, { graphs: [], nodePrototypes: [] });

    const ford = result.expandedSpec.nodes.find(n => n.name === 'Ford Motor Company');
    expect(ford).toBeTruthy();
    expect(ford.type).toBe('Company');
    expect(ford.isA).toEqual(['Automaker', 'Company']);

    // Conditional spread: a node with no ladder must not carry an empty array.
    const pistons = result.expandedSpec.nodes.find(n => n.name === 'Pistons');
    expect('isA' in pistons).toBe(false);
  });

  it('still resolves an edge that repeats the decorated node string', async () => {
    // Models repeat the full decorated name when referring back to a node. bareName
    // strips {size}; it has to strip ^Rung too, or every edge touching a laddered
    // node is silently dropped.
    const result = await sketchGraph({
      name: 'Automotive',
      nodes: ['Ford Motor Company ^Automaker', 'Pistons'],
      edges: ['Ford Motor Company ^Automaker -> Manufactures -> Pistons']
    }, { graphs: [], nodePrototypes: [] });

    expect(result.expandedSpec.edges).toHaveLength(1);
    expect(result.expandedSpec.edges[0].source).toBe('Ford Motor Company');
    expect(result.expandedSpec.edges[0].target).toBe('Pistons');
  });
});
