const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');
const { applyToolResultToStore } = require('../../src/services/toolResultApplier.js');
const { buildComposition } = require('../../src/wizard/tools/buildComposition.js');
const { sketchGraph } = require('../../src/wizard/tools/sketchGraph.js');
const { buildChildGroupIdsIndex, computeGroupDepths } = require('../../src/services/groupLayout.js');

// End-to-end pin for the definition-first composition pipeline: a nested spec
// goes in, and real node-groups come out — prototypes, populated definition
// graphs, anchors, and (critically) inner groups whose members are a strict
// SUBSET of their outer group's, which is the only thing that makes the canvas
// render nesting. Before this pipeline existed the wizard produced plain groups
// with no linkedNodePrototypeId and no nesting at all.
describe('buildComposition applier', () => {
  const resetStore = () => {
    useGraphStore.setState({
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      rightPanelTabs: [{ type: 'home', isActive: true }],
      expandedGraphIds: new Set(),
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      isUniverseLoaded: true,
      isUniverseLoading: false,
      universeLoadingError: null,
      hasUniverseFile: true,
    }, false, 'test_reset');
  };

  const st = () => useGraphStore.getState();

  const makeGraph = (name) => {
    st().createNewGraph({ name, typeNodeId: null, color: '#333' });
    return st().activeGraphId;
  };

  const groupsOf = (graphId) => Array.from(st().graphs.get(graphId).groups.values());
  const groupNamed = (graphId, name) => groupsOf(graphId).find(g => g.name === name);
  const protoNamed = (name) => {
    let found = null;
    for (const [, p] of st().nodePrototypes) {
      if ((p.name || '').toLowerCase() === name.toLowerCase()) found = p; // LAST match
    }
    return found;
  };
  const instanceNames = (graphId) => {
    const graph = st().graphs.get(graphId);
    return Array.from(graph.instances.values())
      .map(i => st().nodePrototypes.get(i.prototypeId)?.name)
      .filter(Boolean);
  };

  // Runs the tool the way the agent loop does, then applies the result.
  const build = async (graphId, args) => {
    const graphState = {
      activeGraphId: graphId,
      graphs: Array.from(st().graphs.values()).map(g => ({ id: g.id, name: g.name, instances: [], definingNodeIds: g.definingNodeIds || [] })),
      nodePrototypes: Array.from(st().nodePrototypes.values())
    };
    const result = await buildComposition({ targetGraphId: graphId, enrich: false, ...args }, graphState);
    applyToolResultToStore('buildComposition', result);
    return result;
  };

  it('builds a two-level nested node-group whose inner members are a subset of the outer', async () => {
    resetStore();
    const mainId = makeGraph('Main');

    await build(mainId, {
      layers: [{
        name: 'Car',
        definition: {
          nodes: [{ name: 'Chassis' }, { name: 'Wheels' }],
          layers: [{
            name: 'Engine',
            definition: { nodes: [{ name: 'Pistons' }, { name: 'Crankshaft' }] }
          }]
        }
      }]
    });

    const car = groupNamed(mainId, 'Car');
    const engine = groupNamed(mainId, 'Engine');
    assert.ok(car, 'outer node-group "Car" exists in the target graph');
    assert.ok(engine, 'inner node-group "Engine" exists in the target graph');

    // Both are real node-groups, not plain groups.
    assert.ok(car.linkedNodePrototypeId, 'Car is a node-group (has linkedNodePrototypeId)');
    assert.ok(engine.linkedNodePrototypeId, 'Engine is a node-group');
    assert.strictEqual(typeof car.linkedDefinitionIndex, 'number', 'Car has a numeric definition index');
    assert.strictEqual(typeof engine.linkedDefinitionIndex, 'number', 'Engine has a numeric definition index');
    assert.ok(car.anchorInstanceId, 'Car has an anchor instance');
    assert.ok(engine.anchorInstanceId, 'Engine has an anchor instance');

    // The nesting predicate the canvas derives containment from.
    const outer = new Set(car.memberInstanceIds);
    assert.ok(engine.memberInstanceIds.length > 0, 'Engine has members');
    assert.ok(engine.memberInstanceIds.length < car.memberInstanceIds.length, 'Engine is a strict subset by size');
    for (const id of engine.memberInstanceIds) {
      assert.ok(outer.has(id), `Engine member ${id} is also a member of Car`);
    }

    // The deepest content was materialized into the target graph.
    const names = instanceNames(mainId);
    assert.ok(names.includes('Pistons'), 'Pistons materialized in the target graph');
    assert.ok(names.includes('Chassis'), 'Chassis materialized in the target graph');
  });

  it('is idempotent — re-running the same spec creates no duplicate groups', async () => {
    resetStore();
    const mainId = makeGraph('Main');
    const spec = {
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Pistons' }, { name: 'Crankshaft' }] } }]
    };

    await build(mainId, spec);
    const afterFirst = groupsOf(mainId).length;
    await build(mainId, spec);

    assert.strictEqual(groupsOf(mainId).length, afterFirst, 'second run adds no new groups');
  });

  it('a collapsed layer gets a populated definition but is NOT spread open', async () => {
    resetStore();
    const mainId = makeGraph('Main');

    await build(mainId, {
      layers: [{
        name: 'Drivetrain',
        display: 'collapsed',
        definition: { nodes: [{ name: 'Gearbox' }, { name: 'Axles' }] }
      }]
    });

    assert.strictEqual(groupNamed(mainId, 'Drivetrain'), undefined, 'no node-group in the parent graph');

    const proto = protoNamed('Drivetrain');
    assert.ok(proto, 'the Thing exists');
    assert.ok(proto.definitionGraphIds?.length > 0, 'the Thing has a definition graph');
    const defGraph = st().graphs.get(proto.definitionGraphIds[0]);
    assert.strictEqual(defGraph.instances.size, 2, 'its web is populated');

    // The Thing itself is on the canvas as an ordinary node.
    assert.ok(instanceNames(mainId).includes('Drivetrain'), 'the collapsed Thing sits in the parent graph');
    assert.ok(!instanceNames(mainId).includes('Gearbox'), 'its contents did NOT leak into the parent');
  });

  it('use: invokes an existing web instead of authoring a new one', async () => {
    resetStore();
    const mainId = makeGraph('Main');

    // An existing Thing with a populated web.
    await build(mainId, {
      layers: [{ name: 'Engine', display: 'collapsed', definition: { nodes: [{ name: 'Pistons' }, { name: 'Crankshaft' }] } }]
    });
    const engineProtoId = protoNamed('Engine').id;

    // A second graph invokes that same web. (createNewGraph mints its own
    // defining prototype, so the baseline is taken after the graph exists.)
    const garageId = makeGraph('Garage');
    const protoCountBefore = st().nodePrototypes.size;
    await build(garageId, { layers: [{ name: 'Engine', use: 'Engine' }] });

    const group = groupNamed(garageId, 'Engine');
    assert.ok(group, 'the invoked web spread open as a node-group');
    assert.strictEqual(group.linkedNodePrototypeId, engineProtoId, 'it reuses the EXISTING Thing, not a copy');
    assert.strictEqual(st().nodePrototypes.size, protoCountBefore, 'no new prototype was minted for the reused Thing');
  });

  it('an empty layer still becomes a node-group (empty placeholder path)', async () => {
    resetStore();
    const mainId = makeGraph('Main');

    await build(mainId, {
      nodes: [{ name: 'Anchor Node' }],
      layers: [{ name: 'Future Work', definition: { nodes: [] } }]
    });

    const group = groupNamed(mainId, 'Future Work');
    assert.ok(group, 'the empty layer became a node-group');
    assert.ok(group.linkedNodePrototypeId, 'it is a node-group');
    assert.ok(group.emptyPlaceholderOrigin, 'it holds a placeholder origin so the shell has a position');
  });

  it('three-deep nesting produces strictly increasing derived depths', async () => {
    resetStore();
    const mainId = makeGraph('Main');

    await build(mainId, {
      layers: [{
        name: 'Car',
        definition: {
          nodes: [{ name: 'Chassis' }],
          layers: [{
            name: 'Engine',
            definition: {
              nodes: [{ name: 'Block' }],
              layers: [{ name: 'Piston Assembly', definition: { nodes: [{ name: 'Piston' }, { name: 'Rod' }] } }]
            }
          }]
        }
      }]
    });

    const car = groupNamed(mainId, 'Car');
    const engine = groupNamed(mainId, 'Engine');
    const pistonAsm = groupNamed(mainId, 'Piston Assembly');
    assert.ok(car && engine && pistonAsm, 'all three layers exist as node-groups');

    const outer = new Set(car.memberInstanceIds);
    for (const id of engine.memberInstanceIds) assert.ok(outer.has(id), 'Engine ⊂ Car');
    const mid = new Set(engine.memberInstanceIds);
    for (const id of pistonAsm.memberInstanceIds) assert.ok(mid.has(id), 'Piston Assembly ⊂ Engine');

    // Run the real depth computation the canvas paints from.
    const groupsById = new Map();
    const groupsByMemberId = new Map();
    for (const g of groupsOf(mainId)) {
      groupsById.set(g.id, g);
      for (const m of g.memberInstanceIds) {
        if (!groupsByMemberId.has(m)) groupsByMemberId.set(m, []);
        groupsByMemberId.get(m).push({ groupId: g.id, memberInstanceIds: g.memberInstanceIds });
      }
    }
    const depths = computeGroupDepths(groupsById, groupsByMemberId, buildChildGroupIdsIndex(groupsById, groupsByMemberId));
    assert.ok(depths.get(engine.id) > depths.get(car.id), 'Engine paints deeper than Car');
    assert.ok(depths.get(pistonAsm.id) > depths.get(engine.id), 'Piston Assembly paints deeper than Engine');
  });

  it('a sketch\'s expandedSpec executes unchanged (sketch IS the build input)', async () => {
    resetStore();
    const mainId = makeGraph('Main');

    const sketch = await sketchGraph({
      name: 'Car',
      nodes: ['Fuel Tank'],
      edges: ['Fuel Tank -> Feeds -> Engine'],
      groups: ['Engine:: Pistons, Crankshaft', 'Drivetrain:: Gearbox, Axles (collapsed)']
    }, { activeGraphId: mainId, graphs: [], nodePrototypes: [] });

    assert.strictEqual(sketch.buildWith, 'buildComposition', 'a sketch with layers routes to buildComposition');
    assert.strictEqual(sketch.expandedSpec.layers.length, 2, 'both "::" entries became layers');

    // Passed straight through — no re-authoring between sketch and build.
    await build(mainId, sketch.expandedSpec);

    const engine = groupNamed(mainId, 'Engine');
    assert.ok(engine?.linkedNodePrototypeId, 'Engine spread open as a node-group');
    assert.strictEqual(groupNamed(mainId, 'Drivetrain'), undefined, 'Drivetrain stayed collapsed');

    const names = instanceNames(mainId);
    assert.ok(names.includes('Pistons'), 'Engine members materialized in the parent');
    assert.ok(names.includes('Drivetrain'), 'the collapsed Thing is on the canvas');
    assert.ok(!names.includes('Gearbox'), 'collapsed contents did not leak into the parent');
  });

  it('an edge naming a layer attaches to that layer\'s anchor', async () => {
    resetStore();
    const mainId = makeGraph('Main');

    await build(mainId, {
      nodes: [{ name: 'Fuel Tank' }],
      edges: [{ source: 'Fuel Tank', target: 'Engine', type: 'Feeds' }],
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Pistons' }, { name: 'Crankshaft' }] } }]
    });

    const group = groupNamed(mainId, 'Engine');
    const graph = st().graphs.get(mainId);
    const edgeIds = graph.edgeIds || [];
    const touchesAnchor = edgeIds
      .map(id => st().edges.get(id))
      .filter(Boolean)
      .some(e => e.sourceId === group.anchorInstanceId || e.destinationId === group.anchorInstanceId);

    assert.ok(edgeIds.length > 0, 'the edge was created');
    assert.ok(touchesAnchor, 'the edge terminates on the node-group\'s anchor instance');
  });
});
