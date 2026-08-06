import { describe, it, expect } from 'vitest';
import { buildComposition } from './buildComposition.js';
import { sketchGraph } from './sketchGraph.js';

const graphState = (protoNames = []) => ({
  activeGraphId: 'g1',
  graphs: [{ id: 'g1', name: 'Main', instances: [], definingNodeIds: [] }],
  nodePrototypes: protoNames.map((n, i) => ({ id: `p${i}`, name: n, definitionGraphIds: [] }))
});

describe('buildComposition (validation + normalization)', () => {
  it('normalizes a nested spec and reports what it will do', async () => {
    const r = await buildComposition({
      layers: [{
        name: 'Car',
        definition: {
          nodes: [{ name: 'Chassis' }, { name: 'Wheels' }],
          layers: [{ name: 'Engine', display: 'collapsed', definition: { nodes: [{ name: 'Pistons' }, { name: 'Rods' }] } }]
        }
      }]
    }, graphState());

    expect(r.action).toBe('buildComposition');
    expect(r.layerCount).toBe(2);
    expect(r.maxDepth).toBe(2);
    expect(r.decomposedLayers).toEqual(['Car']);
    expect(r.collapsedLayers).toEqual(['Engine']);
    expect(r.spec.layers[0].definition.layers[0].name).toBe('Engine');
    // display defaults to decomposed
    expect(r.spec.layers[0].display).toBe('decomposed');
  });

  it('requires at least one layer and says what to use instead', async () => {
    await expect(buildComposition({ layers: [] }, graphState()))
      .rejects.toThrow(/at least one layer/i);
  });

  it('warns when a use: target does not exist but still builds', async () => {
    const r = await buildComposition({
      layers: [{ name: 'Engine', use: 'Engine' }]
    }, graphState([]));

    expect(r.spec.layers).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/no Thing with that name/i);
  });

  it('accepts a use: target that exists without warning', async () => {
    const r = await buildComposition({
      layers: [{ name: 'Engine', use: 'Engine' }]
    }, graphState(['Engine']));

    expect(r.reusedLayers).toEqual(['Engine']);
    expect(r.warnings.join(' ')).not.toMatch(/no Thing with that name/i);
  });

  it('prefers use: over definition when both are given, and says so', async () => {
    const r = await buildComposition({
      layers: [{ name: 'Engine', use: 'Engine', definition: { nodes: [{ name: 'Ignored' }] } }]
    }, graphState(['Engine']));

    expect(r.spec.layers[0].use).toBe('Engine');
    expect(r.spec.layers[0].definition).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/both "use" and "definition"/i);
  });

  it('drops edges whose endpoints are neither a node nor a layer at that level', async () => {
    const r = await buildComposition({
      nodes: [{ name: 'Fuel Tank' }],
      edges: [
        { source: 'Fuel Tank', target: 'Engine', type: 'feeds' },
        { source: 'Fuel Tank', target: 'Nonexistent', type: 'feeds' }
      ],
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Pistons' }, { name: 'Rods' }] } }]
    }, graphState());

    expect(r.spec.edges).toHaveLength(1);
    expect(r.spec.edges[0].target).toBe('Engine');
    expect(r.spec.edges[0].type).toBe('Feeds'); // Title Cased
    expect(r.warnings.join(' ')).toMatch(/Nonexistent/);
  });

  it('warns about layers too thin to be a web', async () => {
    const r = await buildComposition({
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Pistons' }] } }]
    }, graphState());

    expect(r.warnings.join(' ')).toMatch(/too thin|plain node/i);
  });

  it('drops layers past the depth cap rather than building them', async () => {
    const deep = (n) => (n === 0
      ? { nodes: [{ name: 'Leaf' }, { name: 'Leaf2' }] }
      : { nodes: [{ name: `N${n}` }], layers: [{ name: `L${n}`, definition: deep(n - 1) }] });

    const r = await buildComposition({
      layers: [{ name: 'Top', definition: deep(6) }]
    }, graphState());

    expect(r.maxDepth).toBeLessThanOrEqual(4);
    expect(r.warnings.join(' ')).toMatch(/max nesting depth/i);
  });

  it('tolerates a JSON string where an array was expected', async () => {
    const r = await buildComposition({
      layers: JSON.stringify([{ name: 'Engine', definition: { nodes: [{ name: 'A' }, { name: 'B' }] } }])
    }, graphState());

    expect(r.layerCount).toBe(1);
  });
});

describe('sketchGraph layer shorthand', () => {
  it('parses "::" as a layer and "single colon" as a plain group', async () => {
    const s = await sketchGraph({
      name: 'Car',
      nodes: ['Fuel Tank', 'Radiator'],
      edges: [],
      groups: ['Cooling: Radiator', 'Engine:: Pistons, Crankshaft']
    }, graphState());

    expect(s.expandedSpec.groups.map(g => g.name)).toEqual(['Cooling']);
    expect(s.expandedSpec.layers).toHaveLength(1);
    expect(s.expandedSpec.layers[0].name).toBe('Engine');
    expect(s.expandedSpec.layers[0].definition.nodes.map(n => n.name)).toEqual(['Pistons', 'Crankshaft']);
    expect(s.buildWith).toBe('buildComposition');
  });

  it('marks "(collapsed)" layers and reports them separately', async () => {
    const s = await sketchGraph({
      name: 'Car',
      nodes: ['Fuel Tank'],
      edges: [],
      groups: ['Drivetrain:: Gearbox, Axles (collapsed)']
    }, graphState());

    expect(s.expandedSpec.layers[0].display).toBe('collapsed');
    expect(s.preview.collapsedLayers).toEqual(['Drivetrain']);
    expect(s.preview.decomposedLayers).toEqual([]);
  });

  it('"Name:: use" becomes a use: layer', async () => {
    const s = await sketchGraph({
      name: 'Garage',
      nodes: ['Toolbox'],
      edges: [],
      groups: ['Engine:: use']
    }, graphState(['Engine']));

    expect(s.expandedSpec.layers[0].use).toBe('Engine');
    expect(s.expandedSpec.layers[0].definition).toBeUndefined();
  });

  it('moves a member off the top level when it is also named in a layer', async () => {
    const s = await sketchGraph({
      name: 'Car',
      nodes: ['Fuel Tank', 'Pistons'],
      edges: [],
      groups: ['Engine:: Pistons, Crankshaft']
    }, graphState());

    expect(s.expandedSpec.nodes.map(n => n.name)).toEqual(['Fuel Tank']);
    expect(s.warnings.join(' ')).toMatch(/Moved Pistons/);
  });

  it('treats a layer name as a valid edge endpoint', async () => {
    const s = await sketchGraph({
      name: 'Car',
      nodes: ['Fuel Tank'],
      edges: ['Fuel Tank -> Feeds -> Engine'],
      groups: ['Engine:: Pistons, Crankshaft']
    }, graphState());

    expect(s.expandedSpec.edges).toHaveLength(1);
    expect(s.warnings.join(' ')).not.toMatch(/Invalid edges/);
  });

  it('expands the structured layers param with real nesting', async () => {
    const s = await sketchGraph({
      name: 'Car',
      nodes: ['Chassis'],
      edges: [],
      layers: [{
        name: 'Engine',
        definition: {
          nodes: ['Block'],
          layers: [{ name: 'Piston Assembly', definition: { nodes: ['Piston', 'Rod'] } }]
        }
      }]
    }, graphState());

    expect(s.preview.maxDepth).toBe(2);
    expect(s.expandedSpec.layers[0].definition.layers[0].name).toBe('Piston Assembly');
  });

  it('routes a flat sketch to createPopulatedGraph', async () => {
    const s = await sketchGraph({
      name: 'Car',
      nodes: ['Fuel Tank', 'Radiator'],
      edges: ['Fuel Tank -> Cools -> Radiator'],
      groups: ['Cooling: Radiator']
    }, graphState());

    expect(s.buildWith).toBe('createPopulatedGraph');
    expect(s.expandedSpec.layers).toEqual([]);
  });
});
