// @vitest-environment node
/**
 * The wizard making Thing-groups, end to end, without spending a token: a
 * scripted model (fakeProvider.js) drives the real loop, the tools, the
 * applier and the store. A Thing-group it makes is its Thing opened in place
 * (graphStore convertGroupToThingInPlace, toolResultApplier
 * openCompositionLayersInPlace): the definition itself, drawn in the web, one
 * copy of each Thing. A later ask reads it as the canvas draws it, components
 * and all, connects to a component and combines it.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
// Laying out a web measures its Things' names: the layout bench's canvas shim.
import '../layout-bench/env.js';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { installFakeProvider, transcriptProblems } from './fakeProvider.js';
import { projectGraphView } from '../../src/core/openDefinitions.js';

let useGraphStore;
let applyToolResultToStore;
let collectApplyFailures;
let runWizardInProcess;
let graphStateFromStore;
let provider;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ applyToolResultToStore, collectApplyFailures } = await import('../../src/services/toolResultApplier.js'));
  ({ runWizardInProcess } = await import('../../src/wizard/runWizardInProcess.js'));
  ({ graphStateFromStore } = await import('../../src/druid/graphStateFromStore.js'));
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) vi.spyOn(console, k).mockImplementation(() => {});
});

afterEach(() => provider?.restore());

const st = () => useGraphStore.getState();

/** One ask, applied to the store as the panel applies it; failures the applier raised, too. */
async function ask(message, script) {
  provider = installFakeProvider('google', script);
  const events = [];
  const failures = [];
  for await (const e of runWizardInProcess({
    message,
    graphState: graphStateFromStore(st()),
    apiKey: 'sk-test-not-a-key',
    apiConfig: { provider: 'google', model: 'scripted', modelTier: 'large' },
  })) {
    events.push(e);
    if (e.type === 'tool_result' && !e.result?.cancelled) {
      failures.push(...collectApplyFailures(() => applyToolResultToStore(e.name, e.result, e.id, 'conv-thing-groups', { confirmed: true })));
    }
  }
  return {
    failures,
    results: events.filter(e => e.type === 'tool_result').map(e => ({ name: e.name, result: e.result })),
    requests: provider.model,
    problems: provider.model.flatMap((r, i) => transcriptProblems('google', r.body).map(p => `request ${i}: ${p}`)),
  };
}

const drawn = (graphId) => projectGraphView(st(), graphId);
const nameOf = (instance) => st().nodePrototypes.get(instance?.prototypeId)?.name;
const drawnNamed = (graphId, name) => [...drawn(graphId).instances.values()].filter(i => nameOf(i) === name);
const boxNamed = (graphId, name) => [...drawn(graphId).groups.values()].find(g => g.isOpenDefinition && g.name === name);
const placementsOf = (name) => [...st().graphs.values()].flatMap(g => [...g.instances.values()]).filter(i => nameOf(i) === name);

describe('the wizard with Thing-groups', () => {
  let garage;

  beforeAll(() => {
    st().clearUniverse?.();
    st().createNewGraph({ name: 'Garage' });
    garage = st().activeGraphId;
  });

  it('builds a composition as its Things opened in place, and connects to a component in the same ask', async () => {
    const r = await ask('Build a car with an engine inside it, and connect the driver to the pistons', [
      { tools: [
        { id: 'tu_c', name: 'buildComposition', args: {
          nodes: [{ name: 'Driver' }],
          layers: [{
            name: 'Car', display: 'decomposed',
            definition: {
              nodes: [{ name: 'Chassis' }, { name: 'Wheels' }],
              layers: [{ name: 'Engine', display: 'decomposed', definition: { nodes: [{ name: 'Pistons' }, { name: 'Crankshaft' }] } }],
            },
          }],
          enrich: false,
        } },
        { id: 'tu_e', name: 'createEdge', args: { sourceId: 'Driver', targetId: 'Pistons', type: 'Listens To' } },
      ] },
      { text: 'Built the car with its engine, and connected the driver to the pistons.' },
    ]);
    expect(r.problems).toEqual([]);
    expect(r.failures).toEqual([]);
    expect(r.results.map(x => x.result?.error).filter(Boolean)).toEqual([]);

    // Each layer is its Thing opened in place: no group of copies in the web.
    expect(st().graphs.get(garage).groups.size).toBe(0);
    const car = boxNamed(garage, 'Car');
    const engine = boxNamed(garage, 'Engine');
    expect(car).toBeTruthy();
    expect(engine).toBeTruthy();
    const inCar = new Set(car.memberInstanceIds);
    for (const id of engine.memberInstanceIds) expect(inCar.has(id)).toBe(true);
    // One Pistons in the whole universe, in Engine's definition, drawn here.
    expect(placementsOf('Pistons')).toHaveLength(1);
    const [pistons] = drawnNamed(garage, 'Pistons');
    expect(engine.memberInstanceIds).toContain(pistons.id);

    // The connection reaches that Pistons, through the Things it is inside.
    const [driver] = drawnNamed(garage, 'Driver');
    const reaching = [...st().edges.values()].filter(e => e.sourceId === driver.id);
    expect(reaching.map(e => e.destinationId)).toEqual([pistons.id]);
  });

  it('reads it back on the next ask as Thing-groups of their components', async () => {
    const r = await ask('What is in the garage?', [{ text: 'A car, with an engine in it.' }]);
    const sent = JSON.stringify(r.requests[0].body);
    expect(sent).toMatch(/Car \[Thing-Group: Car\] \(\d+ members\): [^"]*Pistons/);
    expect(sent).toMatch(/Engine \[Thing-Group: Engine\] \(2 members\): (Pistons, Crankshaft|Crankshaft, Pistons)/);
    expect(sent).toContain('Driver --[Listens To]--> Pistons');
  });

  it('combines a Thing-group into its Thing, keeping what connects inside it', async () => {
    const r = await ask('Collapse the engine', [
      { tools: [{ id: 'tu_g', name: 'thingGroup', args: { groupName: 'Engine', action: 'collapse' } }] },
      { text: 'Collapsed the engine.' },
    ]);
    expect(r.failures).toEqual([]);
    expect(r.results.map(x => x.result?.error).filter(Boolean)).toEqual([]);
    expect(boxNamed(garage, 'Engine')).toBeUndefined();
    expect(boxNamed(garage, 'Car')).toBeTruthy();
    // Still the one Pistons, still connected, now inside the closed Engine.
    expect(placementsOf('Pistons')).toHaveLength(1);
    const [driver] = drawnNamed(garage, 'Driver');
    const [pistons] = placementsOf('Pistons');
    expect([...st().edges.values()].some(e => e.sourceId === driver.id && e.destinationId === pistons.id)).toBe(true);
  });
});
