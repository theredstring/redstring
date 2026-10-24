// @vitest-environment node
/**
 * The wizard working with formulas, end to end, without spending a token: a
 * scripted model (fakeProvider.js) drives the real loop, the formula tools,
 * the applier and the store. Each ask's graph state is built from the store
 * as the panel builds it (graphStateFromStore, formulas and all), so a later
 * ask sees an earlier one's formula as its text.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
// Building a formula measures its Things' names: the layout bench's canvas shim.
import '../layout-bench/env.js';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { installFakeProvider, transcriptProblems } from './fakeProvider.js';

let useGraphStore;
let applyToolResultToStore;
let collectApplyFailures;
let runWizardInProcess;
let graphStateFromStore;
let formulasForWizard;
let provider;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ applyToolResultToStore, collectApplyFailures } = await import('../../src/services/toolResultApplier.js'));
  ({ runWizardInProcess } = await import('../../src/wizard/runWizardInProcess.js'));
  ({ graphStateFromStore } = await import('../../src/druid/graphStateFromStore.js'));
  ({ formulasForWizard } = await import('../../src/components/canvas/formats/formula/formulaSnapshot.js'));
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
      failures.push(...collectApplyFailures(() => applyToolResultToStore(e.name, e.result, e.id, 'conv-formulas', { confirmed: true })));
    }
  }
  return {
    events,
    failures,
    results: events.filter(e => e.type === 'tool_result').map(e => ({ name: e.name, result: e.result })),
    requests: provider.model,
    problems: provider.model.flatMap((r, i) => transcriptProblems('google', r.body).map(p => `request ${i}: ${p}`)),
  };
}

const webNamed = (name) => [...st().graphs.values()].filter(g => g.name === name).pop();
const formulasIn = (graphId) => formulasForWizard(st()).formulas.filter(f => f.graphId === graphId);
const protoOf = (graphId, instanceId) => st().nodePrototypes.get(st().graphs.get(graphId)?.instances.get(instanceId)?.prototypeId);
const edgesOf = (graphId) => (st().graphs.get(graphId).edgeIds || []).map(id => st().edges.get(id)).filter(Boolean);

describe('the wizard with formulas', () => {
  let gases;
  let physics;

  beforeAll(() => {
    st().clearUniverse?.();
    st().createNewGraph({ name: 'Physics' });
    physics = st().activeGraphId;
    st().createNewGraph({ name: 'Gases' });
    gases = st().activeGraphId;
    st().applyBulkGraphUpdates(gases, { nodes: [{ name: 'Gas', description: 'Matter that fills its container.', x: 0, y: 0 }] });
  });

  it('writes a formula with meanings, and connects to it and to a term in the same ask', async () => {
    const r = await ask('Add the ideal gas law formula and connect Gas to it', [
      { tools: [
        { id: 'tu_f', name: 'addFormula', args: {
          text: 'P * V = n * R * T', title: 'Ideal Gas Law', description: 'How the pressure, volume and temperature of an ideal gas relate.',
          meanings: [{ symbol: 'P', thing: 'Pressure' }, { symbol: 'V', thing: 'Volume' }, { symbol: 'T', thing: 'Temperature' }],
        } },
        { id: 'tu_e1', name: 'createEdge', args: { sourceId: 'Gas', targetId: 'Ideal Gas Law', type: 'Obeys' } },
        { id: 'tu_e2', name: 'createEdge', args: { sourceId: 'Gas', targetId: 'Pressure', type: 'Exerts' } },
      ] },
      { text: 'Added the Ideal Gas Law and connected Gas to it and to its Pressure.' },
    ]);
    expect(r.problems).toEqual([]);
    expect(r.failures).toEqual([]);
    expect(r.results.map(x => x.result?.error).filter(Boolean)).toEqual([]);

    const [f] = formulasIn(gases);
    expect(f).toMatchObject({ title: 'Ideal Gas Law', text: 'P × V = n × R × T', shown: 'formula' });
    expect(Object.fromEntries(f.terms.map(t => [t.symbol, t.thing]))).toMatchObject({ P: 'Pressure', V: 'Volume', T: 'Temperature', n: 'n', R: 'R' });

    const gas = [...st().graphs.get(gases).instances.values()].find(i => st().nodePrototypes.get(i.prototypeId)?.name === 'Gas');
    const from = edgesOf(gases).filter(e => e.sourceId === gas.id).map(e => protoOf(gases, e.destinationId)?.name).sort();
    expect(from).toEqual(['Ideal Gas Law', 'Pressure']);
    // The term Gas reaches is the formula's own Pressure, and it still reads as one formula.
    const pressure = f.terms.find(t => t.symbol === 'P').instanceId;
    expect(edgesOf(gases).some(e => e.sourceId === gas.id && e.destinationId === pressure)).toBe(true);
  });

  it('reads the formula as its text on the next ask, not as a row of Things', async () => {
    const r = await ask('What formulas are here?', [{ text: 'The Ideal Gas Law.' }]);
    const sent = JSON.stringify(r.requests[0].body);
    expect(sent).toContain('Ideal Gas Law: P × V = n × R × T (P = Pressure, V = Volume, T = Temperature)');
    // Its operations are not listed as connections of the web.
    expect(sent).not.toContain('--[Multiplication]-->');
  });

  it('places it in another web like a Thing, shown as its formula', async () => {
    st().setActiveGraph?.(physics);
    const r = await ask('Put the ideal gas law formula in Physics too', [
      { tools: [{ id: 'tu_p', name: 'formula', args: { formulaName: 'Ideal Gas Law', action: 'place' } }] },
      { text: 'Placed it.' },
    ]);
    expect(r.failures).toEqual([]);
    const [f] = formulasIn(physics);
    expect(f).toMatchObject({ title: 'Ideal Gas Law', shown: 'open', text: 'P × V = n × R × T' });
    // The same equation, not a copy.
    expect(f.equationProtoId).toBe(formulasIn(gases)[0].equationProtoId);
  });

  it('adds a well-known one from the bank, its symbols tied to their concepts', async () => {
    const r = await ask('Find Boyle\'s law in the formula bank and add it', [
      { tools: [{ id: 'tu_s', name: 'searchFormulaBank', args: { query: "boyle's law" } }] },
      { tools: [{ id: 'tu_b', name: 'addFormula', args: { bankId: 'Q175974' } }] },
      { text: "Added Boyle's Law." },
    ]);
    expect(r.failures).toEqual([]);
    const search = r.results.find(x => x.name === 'searchFormulaBank').result;
    expect(search.results[0]).toMatchObject({ bankId: 'Q175974', title: "Boyle's Law" });
    const boyle = formulasIn(physics).find(f => f.title === "Boyle's Law");
    expect(boyle.text).toBe('P × V = k');
    expect(boyle.terms.find(t => t.symbol === 'P').thing).toBe('Pressure');
  });

  it('rewrites a formula in place, keeping what connects to it', async () => {
    st().setActiveGraph?.(gases);
    const before = formulasIn(gases)[0];
    const r = await ask('Rewrite the ideal gas law formula solved for pressure', [
      { tools: [{ id: 'tu_r', name: 'formula', args: {
        formulaName: 'Ideal Gas Law', action: 'rewrite', text: 'P = n * R * T / V',
        meanings: [{ symbol: 'P', thing: 'Pressure' }, { symbol: 'V', thing: 'Volume' }, { symbol: 'T', thing: 'Temperature' }],
      } }] },
      { text: 'Rewritten.' },
    ]);
    expect(r.failures).toEqual([]);
    const after = formulasIn(gases)[0];
    expect(after).toMatchObject({ groupId: before.groupId, equationProtoId: before.equationProtoId, text: 'P = n × R × T ÷ V' });
    const targets = edgesOf(gases).map(e => protoOf(gases, e.destinationId)?.name);
    expect(targets).toEqual(expect.arrayContaining(['Ideal Gas Law', 'Pressure']));
  });

  it('folds it into its Thing, and refuses to ungroup it as a plain group', async () => {
    const r = await ask('Fold the ideal gas law formula, and remove the group', [
      { tools: [
        { id: 'tu_g', name: 'deleteGroup', args: { groupName: 'Ideal Gas Law' } },
        { id: 'tu_fold', name: 'formula', args: { formulaName: 'Ideal Gas Law', action: 'fold' } },
      ] },
      { text: 'Folded.' },
    ]);
    expect(r.results.find(x => x.name === 'deleteGroup').result.error).toMatch(/is a formula/);
    expect(formulasIn(gases)[0].shown).toBe('folded');
  });

  it('deletes a placement, leaving the equation wherever else it is', async () => {
    st().setActiveGraph?.(physics);
    const r = await ask('Delete the ideal gas law formula from Physics', [
      { tools: [{ id: 'tu_d', name: 'formula', args: { formulaName: 'Ideal Gas Law', action: 'delete' } }] },
      { text: 'Deleted.' },
    ]);
    expect(r.failures).toEqual([]);
    expect(formulasIn(physics).map(f => f.title)).toEqual(["Boyle's Law"]);
    expect(formulasIn(gases)[0].title).toBe('Ideal Gas Law');
  });

  it('tells the model when its text is not a formula', async () => {
    const r = await ask('Add the formula', [
      { tools: [{ id: 'tu_bad', name: 'addFormula', args: { text: '= =' } }] },
      { text: 'That was not a formula.' },
    ]);
    expect(r.results[0].result.error).toMatch(/not a formula Redstring can read/);
  });
});

describe('connecting a formula when its symbols are also Things on the web', () => {
  // The web has Pendulum Length drawn as itself, and the formula draws its own
  // L for the same Thing. "Connect the formula to Pendulum Length" means the
  // one drawn as itself: the formula's own L is drawn inside it, and lost there.
  let clock;
  const named = (name, inFormula) => [...st().graphs.get(clock).instances.values()]
    .filter(i => st().nodePrototypes.get(i.prototypeId)?.name === name)
    .find(i => inFormula === formulasIn(clock)[0].memberIds.includes(i.id));

  beforeAll(async () => {
    st().createNewGraph({ name: 'Clock' });
    clock = st().activeGraphId;
    st().applyBulkGraphUpdates(clock, { nodes: ['Pendulum', 'Pendulum Length', 'Gravitational Acceleration', 'Oscillation Period'].map((name, i) => ({ name, x: i * 200, y: 0 })) });
    await ask('Add the pendulum period formula', [
      { tools: [{ id: 'tu_f', name: 'addFormula', args: {
        text: 'T = 2 * L / g', title: 'Pendulum Period',
        meanings: [{ symbol: 'T', thing: 'Oscillation Period' }, { symbol: 'L', thing: 'Pendulum Length' }, { symbol: 'g', thing: 'Gravitational Acceleration' }],
      } }] },
      { text: 'Added it.' },
    ]);
  });

  it('lands on the Thing drawn as itself, reaches a symbol by its full name, and refuses the formula to its own symbol', async () => {
    const r = await ask('Connect the equation to its most relevant stuff', [
      { tools: [
        { id: 'tu_e1', name: 'createEdge', args: { sourceId: 'Pendulum Period', targetId: 'Pendulum Length', type: 'Takes Input' } },
        { id: 'tu_e2', name: 'createEdge', args: { sourceId: 'Pendulum Period', targetId: 'Oscillation Period', type: 'Calculates' } },
        { id: 'tu_e3', name: 'createEdge', args: { sourceId: 'Pendulum', targetId: 'Gravitational Acceleration (in Pendulum Period)', type: 'Swings Under' } },
        { id: 'tu_e4', name: 'createEdge', args: { sourceId: 'Pendulum Period', targetId: 'Pendulum Length (in Pendulum Period)', type: 'Relates' } },
      ] },
      { text: 'Connected it.' },
    ]);
    expect(r.failures).toEqual([]);
    const anchor = formulasIn(clock)[0].anchorId;
    const has = (s, d) => edgesOf(clock).some(e => e.sourceId === s && e.destinationId === d);
    expect(has(anchor, named('Pendulum Length', false).id)).toBe(true);
    expect(has(anchor, named('Oscillation Period', false).id)).toBe(true);
    expect(has(named('Pendulum', false).id, named('Gravitational Acceleration', true).id)).toBe(true);
    expect(has(anchor, named('Pendulum Length', true).id)).toBe(false);
    expect(r.results.find(x => x.name === 'createEdge' && x.result?.error)?.result.error).toMatch(/both inside the formula "Pendulum Period"/);
  });
});
