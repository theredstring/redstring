import { describe, it, expect } from 'vitest';
import { normalizeGraphSpec, normalizeLayersOnly, createSpecContext } from './graphSpec.js';

const state = (protoNames = []) => ({
  nodePrototypes: protoNames.map((name, i) => ({ id: `p${i}`, name }))
});

describe('normalizeLayersOnly', () => {
  it('returns null when no layers were given, so flat tools stay flat', () => {
    expect(normalizeLayersOnly([], { palette: 'rainbow', graphState: state() })).toBeNull();
    expect(normalizeLayersOnly(undefined, { palette: 'rainbow', graphState: state() })).toBeNull();
  });

  it('normalizes a layer with its definition intact', () => {
    const out = normalizeLayersOnly(
      [{
        name: 'Cytoplasm',
        description: 'The cell interior',
        definition: { nodes: [{ name: 'Mitochondria' }, { name: 'Ribosome' }] }
      }],
      { palette: 'rainbow', graphState: state() }
    );

    expect(out.layers).toHaveLength(1);
    expect(out.layers[0].name).toBe('Cytoplasm');
    expect(out.layers[0].display).toBe('decomposed');
    expect(out.layers[0].definition.nodes.map(n => n.name)).toEqual(['Mitochondria', 'Ribosome']);
  });

  it('carries nesting through arbitrary depth', () => {
    const out = normalizeLayersOnly(
      [{
        name: 'Car',
        definition: {
          nodes: [{ name: 'Chassis' }, { name: 'Wheels' }],
          layers: [{
            name: 'Engine',
            definition: { nodes: [{ name: 'Pistons' }, { name: 'Crankshaft' }] }
          }]
        }
      }],
      { palette: 'rainbow', graphState: state() }
    );

    const engine = out.layers[0].definition.layers[0];
    expect(engine.name).toBe('Engine');
    expect(engine.definition.nodes.map(n => n.name)).toEqual(['Pistons', 'Crankshaft']);
    expect(out.stats.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it('honours collapsed display', () => {
    const out = normalizeLayersOnly(
      [{ name: 'Engine', display: 'collapsed', definition: { nodes: [{ name: 'A' }, { name: 'B' }] } }],
      { palette: 'rainbow', graphState: state() }
    );
    expect(out.layers[0].display).toBe('collapsed');
    expect(out.stats.collapsedLayers).toEqual(['Engine']);
  });

  it('passes `use:` through and warns when the target does not exist', () => {
    const ok = normalizeLayersOnly(
      [{ name: 'Engine', use: 'Engine' }],
      { palette: 'rainbow', graphState: state(['Engine']) }
    );
    expect(ok.layers[0].use).toBe('Engine');
    expect(ok.warnings.filter(w => w.includes('no Thing with that name'))).toHaveLength(0);

    const missing = normalizeLayersOnly(
      [{ name: 'Engine', use: 'Engine' }],
      { palette: 'rainbow', graphState: state() }
    );
    expect(missing.warnings.some(w => w.includes('no Thing with that name'))).toBe(true);
  });

  it('warns when a layer definition is too thin to be a web', () => {
    const out = normalizeLayersOnly(
      [{ name: 'Thin', definition: { nodes: [{ name: 'Only' }] } }],
      { palette: 'rainbow', graphState: state() }
    );
    expect(out.warnings.some(w => w.includes('too thin'))).toBe(true);
  });
});

describe('layer naming — collision warning', () => {
  // A layer creates a real, reusable prototype. Authoring a fresh definition
  // under a name that already exists is the precise case where the name fails to
  // identify anything: either this IS that Thing, or it needs qualifying.
  it('warns when a fresh layer reuses an existing Thing name', () => {
    const out = normalizeLayersOnly(
      [{ name: 'Back of House', definition: { nodes: [{ name: 'Kitchen' }, { name: 'Walk-in' }] } }],
      { palette: 'rainbow', graphState: state(['Back of House']) }
    );
    const warning = out.warnings.find(w => w.includes('already exists'));
    expect(warning).toBeDefined();
    // Both remedies, because only the author knows which applies.
    expect(warning).toMatch(/"use": "Back of House"/);
    expect(warning).toMatch(/qualify/i);
  });

  it('stays silent for a name nothing else uses', () => {
    const out = normalizeLayersOnly(
      [{ name: 'Back of House for Texas Roadhouse', definition: { nodes: [{ name: 'Kitchen' }, { name: 'Walk-in' }] } }],
      { palette: 'rainbow', graphState: state(['Back of House']) }
    );
    expect(out.warnings.some(w => w.includes('already exists'))).toBe(false);
  });

  // Reuse is the other correct answer to a collision, so it must not be nagged at.
  it('stays silent when the collision is a deliberate `use:`', () => {
    const out = normalizeLayersOnly(
      [{ name: 'Engine', use: 'Engine' }],
      { palette: 'rainbow', graphState: state(['Engine']) }
    );
    expect(out.warnings.some(w => w.includes('already exists'))).toBe(false);
  });

  it('is case- and whitespace-insensitive about the collision', () => {
    const out = normalizeLayersOnly(
      [{ name: '  back of HOUSE ', definition: { nodes: [{ name: 'A' }, { name: 'B' }] } }],
      { palette: 'rainbow', graphState: state(['Back of House']) }
    );
    expect(out.warnings.some(w => w.includes('already exists'))).toBe(true);
  });
});

describe('normalizeGraphSpec — endpoints and depth', () => {
  it('accepts a layer name as an edge endpoint', () => {
    const ctx = createSpecContext('rainbow', state());
    const spec = normalizeGraphSpec({
      nodes: [{ name: 'Chassis' }],
      edges: [{ source: 'Chassis', target: 'Engine', type: 'Mounts' }],
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Pistons' }, { name: 'Crank' }] } }]
    }, ctx);

    expect(spec.edges).toHaveLength(1);
    expect(spec.edges[0].target).toBe('Engine');
  });

  it('drops an edge whose endpoint is neither a node nor a layer', () => {
    const ctx = createSpecContext('rainbow', state());
    const spec = normalizeGraphSpec({
      nodes: [{ name: 'Chassis' }],
      edges: [{ source: 'Chassis', target: 'Nowhere' }]
    }, ctx);
    expect(spec.edges).toHaveLength(0);
    expect(ctx.warnings.some(w => w.includes('dropped edge'))).toBe(true);
  });

  it('refuses to nest past the depth cap', () => {
    const ctx = createSpecContext('rainbow', state());
    const deep = (d) => (d === 0
      ? { nodes: [{ name: 'Leaf A' }, { name: 'Leaf B' }] }
      : { layers: [{ name: `L${d}`, definition: deep(d - 1) }] });

    normalizeGraphSpec(deep(8), ctx);
    expect(ctx.warnings.some(w => w.includes('exceeds max nesting depth'))).toBe(true);
  });

  it('flags duplicate layer names at one level', () => {
    const ctx = createSpecContext('rainbow', state());
    normalizeGraphSpec({
      layers: [
        { name: 'Engine', definition: { nodes: [{ name: 'A' }, { name: 'B' }] } },
        { name: 'Engine', definition: { nodes: [{ name: 'C' }, { name: 'D' }] } }
      ]
    }, ctx);
    expect(ctx.warnings.some(w => w.includes('duplicate layer name'))).toBe(true);
  });
});
