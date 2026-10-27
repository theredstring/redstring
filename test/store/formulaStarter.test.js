import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { loadFormulaBank } from '../../src/components/canvas/formats/formula/bank/formulaBank.js';
import { starterPlan, mergeFormulaStarter, formulaStarterHere } from '../../src/components/canvas/formats/formula/bank/formulaStarter.js';
import { buildBankEquation } from '../../src/components/canvas/formats/formula/buildFormula.js';
import { formulasForWizard } from '../../src/components/canvas/formats/formula/formulaSnapshot.js';

// The formula starter, built in a store of its own (as the worker builds it),
// then merged: what comes in, and that nothing comes in twice.

const st = () => useGraphStore.getState();
const IDEAL_GAS = 'Q191785';
const BOYLE = 'Q175974';
const ENTHALPY = 'Q161064';
const COMPRESSIBILITY = 'Q736895'; // Chemistry, with Pressure in it too
// Both hold 1 − exp(−(K_J × C_e)), of the same concepts.
const JOVANOVIC = 'mardi:Q6821055';
const MULTILAYER_JOVANOVIC = 'mardi:Q6821059';
const SHARED_PARTS = ['1 − exp(−(K_J × C_e))', 'exp(−(K_J × C_e))', '−(K_J × C_e)'];

const reset = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([['main', { id: 'main', name: 'main', description: '', instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds: [] }]]),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
};

/** Build in a second store, as the worker does: a fresh copy of every module. */
async function buildApart(equationIds) {
  vi.resetModules();
  const apart = await import('../../src/components/canvas/formats/formula/bank/formulaStarter.js');
  const apartBank = await (await import('../../src/components/canvas/formats/formula/bank/formulaBank.js')).loadFormulaBank();
  return apart.buildStarterState(apartBank, equationIds);
}

const named = (name) => [...st().nodePrototypes.values()].filter(p => p.name === name);
const webOf = (name) => st().graphs.get(named(name)[0]?.definitionGraphIds?.[0]);
const namesIn = (web) => [...(web?.instances.values() || [])].filter(i => !i.isGroupAnchor).map(i => st().nodePrototypes.get(i.prototypeId)?.name);
const formulasIn = (web) => formulasForWizard(st()).formulas.filter(f => f.graphId === web?.id).map(f => f.title).sort();

describe('the formula starter', () => {
  let bank;
  beforeEach(async () => {
    vi.useRealTimers();
    reset();
    bank = await loadFormulaBank();
  });

  it('comes in filed by section and discipline, under Formulas, each shown as its formula', async () => {
    mergeFormulaStarter(await buildApart([IDEAL_GAS, BOYLE]));
    expect(formulasIn(webOf('Thermodynamics'))).toEqual(["Boyle's Law", 'Ideal Gas Law']);
    expect(namesIn(webOf('Physics'))).toEqual(['Thermodynamics']);
    expect(namesIn(webOf('Formulas'))).toEqual(['Physics']);
    // Built apart, it opens no webs here.
    expect(st().openGraphIds).toEqual(['main']);
  });

  it('the universe says it was added by holding Formulas, not by a field', async () => {
    expect(formulaStarterHere()).toBe(false);
    // An equation of the bank's built by hand (the wizard's way) isn't the starter.
    const { discipline, equation } = bank.equations.find(({ equation: e }) => e.id === BOYLE);
    buildBankEquation(discipline, equation, 'main', { x: 0, y: 0 });
    expect(formulaStarterHere()).toBe(false);
    mergeFormulaStarter(await buildApart([IDEAL_GAS]));
    expect(formulaStarterHere()).toBe(true);
  });

  it('plans only what the universe lacks, and adds nothing twice', async () => {
    buildBankEquation(bank.disciplines.find(d => d.id === 'physics'), bank.equations.find(e => e.equation.id === IDEAL_GAS).equation, 'main', { x: 0, y: 0 });
    const plan = starterPlan(bank, ['physics']);
    expect(plan.entries.some(e => e.equation.id === IDEAL_GAS)).toBe(false);
    expect(plan.already).toBe(1);

    mergeFormulaStarter(await buildApart([BOYLE, ENTHALPY]));
    for (const name of ['Pressure', 'Volume', 'Thermodynamics', 'Physics', 'Multiplication', 'Equality']) {
      expect(named(name)).toHaveLength(1);
    }
    // The section web the universe had already, grown: what was there kept, the rest under it.
    const thermo = webOf('Thermodynamics');
    expect(formulasIn(thermo)).toEqual(["Boyle's Law", 'Definition of Enthalpy']);
    expect(namesIn(thermo)).toContain('Ideal Gas Law');
    const anchors = [...thermo.instances.values()];
    const law = anchors.find(i => st().nodePrototypes.get(i.prototypeId)?.name === 'Ideal Gas Law');
    expect(anchors.filter(i => i !== law).every(i => i.y > law.y)).toBe(true);
  });

  it('a second discipline later joins the same Formulas and the same concepts', async () => {
    mergeFormulaStarter(await buildApart([BOYLE]));
    mergeFormulaStarter(await buildApart([COMPRESSIBILITY]));
    expect(named('Formulas')).toHaveLength(1);
    expect(namesIn(webOf('Formulas')).sort()).toEqual(['Chemistry', 'Physics']);
    expect(named('Pressure')).toHaveLength(1);
    expect(named('Division')).toHaveLength(1);
  });

  it('a part two equations share is one Thing, built together', async () => {
    mergeFormulaStarter(await buildApart([JOVANOVIC, MULTILAYER_JOVANOVIC]));
    for (const name of SHARED_PARTS) {
      expect(named(name)).toHaveLength(1);
      expect(named(name)[0].definitionGraphIds).toHaveLength(1);
    }
  });

  it('a part two equations share is one Thing, built apart: its definition here not grown', async () => {
    mergeFormulaStarter(await buildApart([JOVANOVIC]));
    const definitionOf = (name) => webOf(name);
    const before = Object.fromEntries(SHARED_PARTS.map(name => [name, definitionOf(name).instances.size]));
    mergeFormulaStarter(await buildApart([MULTILAYER_JOVANOVIC]));
    for (const name of SHARED_PARTS) {
      expect(named(name)).toHaveLength(1);
      expect(named(name)[0].definitionGraphIds).toHaveLength(1);
      expect(definitionOf(name).instances.size).toBe(before[name]);
    }
    // Both read as their formulas, the second's part linked to the definition here.
    const texts = formulasForWizard(st()).formulas.map(f => f.text);
    expect(texts).toContain('q_e = q_m × (1 − exp(−(K_J × C_e)))');
    expect(texts.some(t => t.includes('(1 − exp(−(K_J × C_e))) × exp(K_J,m × C_e)'))).toBe(true);
  });

  it('adding the same again changes nothing', async () => {
    mergeFormulaStarter(await buildApart([BOYLE]));
    const things = st().nodePrototypes.size;
    expect(starterPlan(bank, ['physics']).entries.some(e => e.equation.id === BOYLE)).toBe(false);
    mergeFormulaStarter(await buildApart([]));
    expect(st().nodePrototypes.size).toBe(things);
  });
});
