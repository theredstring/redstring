import { describe, it, expect } from 'vitest';
import { normalizeGraphSpec, normalizeLayersOnly, createSpecContext, dropLayerNameCollisions } from './graphSpec.js';

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

describe('layer / node name collision', () => {
  // The grocery-conglomerates failure. The model listed each conglomerate as a
  // top-level node AND as a layer (natural — it wanted edges between them). The
  // plain node won the race into the graph, the layer's shell was then swallowed
  // by name de-duplication, and with no shell to decompose the layer never opened
  // into a node-group. The concept ended up "defined but flat", which reads as
  // success to the model because the definition web really does exist.
  it('drops a top-level node that duplicates a layer name', () => {
    const ctx = createSpecContext('rainbow', state());
    const spec = normalizeGraphSpec({
      nodes: [{ name: 'Kroger' }, { name: 'Albertsons' }, { name: 'Walmart' }],
      layers: [
        { name: 'Kroger', definition: { nodes: [{ name: 'Ralphs' }, { name: 'Fred Meyer' }] } },
        { name: 'Albertsons', definition: { nodes: [{ name: 'Safeway' }, { name: 'Vons' }] } }
      ]
    }, ctx);

    expect(spec.nodes.map(n => n.name)).toEqual(['Walmart']);
    expect(spec.layers.map(l => l.name)).toEqual(['Kroger', 'Albertsons']);
    expect(ctx.warnings.some(w => w.includes('both a plain node and a layer'))).toBe(true);
  });

  it('keeps edges between colliding names working — they resolve to the layer', () => {
    const ctx = createSpecContext('rainbow', state());
    const spec = normalizeGraphSpec({
      nodes: [{ name: 'Kroger' }],
      edges: [{ source: 'Kroger', target: 'Albertsons', type: 'Proposed Merger With' }],
      layers: [
        { name: 'Kroger', definition: { nodes: [{ name: 'Ralphs' }, { name: 'Fred Meyer' }] } },
        { name: 'Albertsons', definition: { nodes: [{ name: 'Safeway' }, { name: 'Vons' }] } }
      ]
    }, ctx);

    expect(spec.edges).toHaveLength(1);
    expect(spec.edges[0].source).toBe('Kroger');
    expect(spec.edges[0].target).toBe('Albertsons');
  });

  it('is case-insensitive about the collision', () => {
    const ctx = createSpecContext('rainbow', state());
    const spec = normalizeGraphSpec({
      nodes: [{ name: 'kroger' }],
      layers: [{ name: 'Kroger', definition: { nodes: [{ name: 'A' }, { name: 'B' }] } }]
    }, ctx);
    expect(spec.nodes).toHaveLength(0);
  });
});

describe('dropLayerNameCollisions', () => {
  it('filters node specs against layer names', () => {
    const { nodes, dropped } = dropLayerNameCollisions(
      [{ name: 'Kroger' }, { name: 'Walmart' }],
      [{ name: 'Kroger' }]
    );
    expect(nodes.map(n => n.name)).toEqual(['Walmart']);
    expect(dropped).toEqual(['Kroger']);
  });

  it('is a no-op when there are no layers', () => {
    const nodes = [{ name: 'Kroger' }];
    expect(dropLayerNameCollisions(nodes, []).nodes).toBe(nodes);
    expect(dropLayerNameCollisions(nodes, []).dropped).toEqual([]);
  });
});

describe('layer collision — folding, not discarding', () => {
  it('carries the duplicate node\'s description onto a layer that lacks one', () => {
    const layers = [{ name: 'Kroger', definition: { nodes: [{ name: 'Ralphs' }, { name: 'Vons' }] } }];
    dropLayerNameCollisions(
      [{ name: 'Kroger', description: 'Largest US supermarket operator', color: '#123456' }],
      layers
    );
    expect(layers[0].description).toBe('Largest US supermarket operator');
    expect(layers[0].color).toBe('#123456');
  });

  it('does not overwrite a description the layer already has', () => {
    const layers = [{ name: 'Kroger', description: 'Kroger and its banners', definition: { nodes: [] } }];
    dropLayerNameCollisions([{ name: 'Kroger', description: 'Something else' }], layers);
    expect(layers[0].description).toBe('Kroger and its banners');
  });

  // A `use:` layer's identity belongs to the web it already has — an incidental
  // duplicate in this graph must not rewrite a Thing shared across the universe.
  it('never rewrites a reused (`use:`) layer', () => {
    const layers = [{ name: 'Engine', use: 'Engine' }];
    dropLayerNameCollisions([{ name: 'Engine', description: 'clobber', color: '#ff0000' }], layers);
    expect(layers[0].description).toBeUndefined();
    expect(layers[0].color).toBeUndefined();
  });

  it('folds through normalizeGraphSpec too', () => {
    const ctx = createSpecContext('rainbow', state());
    const spec = normalizeGraphSpec({
      nodes: [{ name: 'Kroger', description: 'Largest US supermarket operator' }],
      layers: [{ name: 'Kroger', definition: { nodes: [{ name: 'Ralphs' }, { name: 'Vons' }] } }]
    }, ctx);
    expect(spec.nodes).toHaveLength(0);
    expect(spec.layers[0].description).toBe('Largest US supermarket operator');
  });
});
