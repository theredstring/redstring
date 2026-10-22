import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import {
  addFormulaForWizard, placeEquationForWizard, openFormulaForWizard,
  foldFormulaForWizard, deleteFormulaForWizard, rewriteFormulaForWizard, addBankFormulaForWizard,
} from '../../src/components/canvas/formats/formula/formulaWizard.js';
import { formulasForWizard, findFormula, equationOf } from '../../src/components/canvas/formats/formula/formulaSnapshot.js';

// What the wizard does to formulas, against the store: written with meanings,
// placed like a Thing, folded and opened, rewritten in place, deleted.

const st = () => useGraphStore.getState();
const web = (id) => ({ id, name: id, description: '', instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds: [] });

const reset = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([['main', web('main')], ['other', web('other')]]),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    openDefinitionsInPlace: true,
  });
};

const formulasIn = (graphId) => formulasForWizard(st()).formulas.filter(f => f.graphId === graphId);

/** A Thing placed in a web: its instance id. */
const place = (graphId, protoId, name, x = 0, y = 0) => {
  if (!st().nodePrototypes.has(protoId)) st().addNodePrototype({ id: protoId, name, color: '#8B0000', definitionGraphIds: [] });
  const id = `${protoId}-in-${graphId}`;
  st().addNodeInstance(graphId, protoId, { x, y }, id);
  return id;
};

describe('the wizard writing a formula', () => {
  beforeEach(() => { vi.useFakeTimers(); reset(); });

  it('reads back as its text, each symbol standing for what it was given', () => {
    place('main', 'p-pressure', 'Pressure', -2000, -2000);
    const built = addFormulaForWizard({
      graphId: 'main', text: 'P V = n R T', title: 'Ideal Gas Law',
      meanings: [{ symbol: 'P', thing: 'Pressure' }, { symbol: 'V', thing: 'Volume' }, { symbol: 'T', thing: 'Temperature' }],
    });
    expect(built.groupId).toBeTruthy();
    const [f] = formulasIn('main');
    expect(f).toMatchObject({ title: 'Ideal Gas Law', text: 'P × V = n × R × T', shown: 'formula', groupId: built.groupId });
    const bySymbol = Object.fromEntries(f.terms.map(t => [t.symbol, t]));
    // The Pressure the web had, not a new one; Volume new, named for what it is; n bare.
    expect(bySymbol.P.protoId).toBe('p-pressure');
    expect(st().nodePrototypes.get('p-pressure').labels.formula).toBe('P');
    expect(bySymbol.V.thing).toBe('Volume');
    expect(bySymbol.n.thing).toBe('n');
  });

  it('can be the formula of a Thing the web already has', () => {
    place('main', 'p-law', 'Ideal Gas Law');
    const built = addFormulaForWizard({ graphId: 'main', text: 'P V = n R T', forThing: 'Ideal Gas Law' });
    expect(built.equationProtoId).toBe('p-law');
    expect(equationOf(st(), st().nodePrototypes.get('p-law')).text).toBe('P × V = n × R × T');
  });

  it('is found by title or by text', () => {
    addFormulaForWizard({ graphId: 'main', text: 'E = m c^2', title: 'Mass-Energy Equivalence' });
    expect(findFormula(st(), 'main', 'mass-energy equivalence')).toBeTruthy();
    expect(findFormula(st(), 'main', 'E = m × c ^ 2')).toBeTruthy();
    expect(findFormula(st(), 'main', 'Nothing Like It')).toBeNull();
  });

  it('refuses text that is not a formula', () => {
    expect(() => addFormulaForWizard({ graphId: 'main', text: '= =' })).toThrow();
  });
});

describe('the wizard using a formula like a Thing', () => {
  beforeEach(() => { vi.useFakeTimers(); reset(); });

  it('placed in another web, it shows as its formula there', () => {
    const { equationProtoId } = addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    st().collapseNodeGroupIntoDefinition('main', formulasIn('main')[0].groupId);
    placeEquationForWizard({ graphId: 'other', ref: 'Distribution' });
    const [f] = formulasIn('other');
    expect(f).toMatchObject({ shown: 'open', equationProtoId, text: 'a × (b + c)' });
  });

  it('placed where its Thing is already, that one shows as its formula: no second beside it', () => {
    const { equationProtoId } = addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    st().addNodeInstance('other', equationProtoId, { x: 0, y: 0 }, 'plain');
    placeEquationForWizard({ graphId: 'other', ref: 'Distribution' });
    expect([...st().graphs.get('other').instances.values()].filter(i => i.prototypeId === equationProtoId)).toHaveLength(1);
    expect(formulasIn('other')[0]).toMatchObject({ shown: 'open', anchorId: 'plain' });
    placeEquationForWizard({ graphId: 'other', ref: 'Distribution' });
    expect(st().graphs.get('other').instances.size).toBe(1);
  });

  it('placed folded, it is a node that opens as its formula', () => {
    addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    const { instanceId } = placeEquationForWizard({ graphId: 'other', ref: 'Distribution', folded: true });
    expect(formulasIn('other')[0]).toMatchObject({ shown: 'folded', anchorId: instanceId });
    openFormulaForWizard({ graphId: 'other', ref: 'Distribution' });
    expect(formulasIn('other')[0].shown).toBe('open');
  });

  it('connects to the whole formula, and to a term in it', () => {
    const gas = place('main', 'p-gas', 'Gas', -3000, 0);
    addFormulaForWizard({ graphId: 'main', text: 'P V = n R T', title: 'Ideal Gas Law', meanings: [{ symbol: 'P', thing: 'Pressure' }] });
    const f = formulasIn('main')[0];
    st().applyBulkGraphUpdates('main', { nodes: [], edges: [
      { sourceId: gas, targetId: f.anchorId, type: 'obeys' },
      { sourceId: gas, targetId: f.terms.find(t => t.symbol === 'P').instanceId, type: 'exerts' },
    ] });
    const reaching = st().graphs.get('main').edgeIds.map(id => st().edges.get(id)).filter(e => e.sourceId === gas);
    expect(reaching).toHaveLength(2);
    // Still one formula: a connection from outside doesn't break its reading.
    expect(formulasIn('main')[0].text).toBe('P × V = n × R × T');
  });

  it('folds into its Thing and opens again', () => {
    addFormulaForWizard({ graphId: 'main', text: 'x + y = z' });
    foldFormulaForWizard({ graphId: 'main', ref: 'x + y = z' });
    expect(formulasIn('main')[0].shown).toBe('folded');
    openFormulaForWizard({ graphId: 'main', ref: 'x + y = z' });
    expect(formulasIn('main')[0].shown).toBe('open');
  });
});

describe('the wizard rewriting a formula', () => {
  beforeEach(() => { vi.useFakeTimers(); reset(); });

  it('in place: the same group and Thing, its connections kept, its definition saved', () => {
    const gas = place('main', 'p-gas', 'Gas', -3000, 0);
    addFormulaForWizard({ graphId: 'main', text: 'P V = n R T', title: 'Ideal Gas Law', meanings: [{ symbol: 'P', thing: 'Pressure' }] });
    const before = formulasIn('main')[0];
    st().applyBulkGraphUpdates('main', { nodes: [], edges: [
      { sourceId: gas, targetId: before.anchorId, type: 'obeys' },
      { sourceId: gas, targetId: before.terms.find(t => t.symbol === 'P').instanceId, type: 'exerts' },
    ] });

    rewriteFormulaForWizard({ graphId: 'main', ref: 'Ideal Gas Law', text: 'P = n R T / V', meanings: [{ symbol: 'P', thing: 'Pressure' }] });

    const after = formulasIn('main');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ groupId: before.groupId, anchorId: before.anchorId, equationProtoId: before.equationProtoId, title: 'Ideal Gas Law' });
    expect(after[0].text).toBe('P = n × R × T ÷ V');
    const reaching = st().graphs.get('main').edgeIds.map(id => st().edges.get(id)).filter(e => e.sourceId === gas);
    expect(reaching.map(e => e.destinationId).sort()).toEqual([before.anchorId, after[0].terms.find(t => t.symbol === 'P').instanceId].sort());
    // None of the old Things left behind.
    for (const id of before.memberIds) {
      if (!after[0].memberIds.includes(id)) expect(st().graphs.get('main').instances.has(id)).toBe(false);
    }
    expect(equationOf(st(), st().nodePrototypes.get(before.equationProtoId)).text).toBe('P = n × R × T ÷ V');
  });

  it('untitled, its name follows its text', () => {
    addFormulaForWizard({ graphId: 'main', text: 'x + y = z' });
    rewriteFormulaForWizard({ graphId: 'main', ref: 'x + y = z', text: 'x - y = z' });
    expect(formulasIn('main')[0].title).toBe('x − y = z');
  });

  it('folded: its definition is rewritten, and it is folded again', () => {
    addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    foldFormulaForWizard({ graphId: 'main', ref: 'Distribution' });
    rewriteFormulaForWizard({ graphId: 'main', ref: 'Distribution', text: 'a * (b - c)' });
    const [f] = formulasIn('main');
    expect(f).toMatchObject({ shown: 'folded', text: 'a × (b − c)' });
  });
});

describe('the wizard deleting a formula', () => {
  beforeEach(() => { vi.useFakeTimers(); reset(); });

  it('a Thing-group goes with its Things; a placement goes as its node', () => {
    addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    placeEquationForWizard({ graphId: 'other', ref: 'Distribution', folded: true });
    deleteFormulaForWizard({ graphId: 'main', ref: 'Distribution' });
    expect(formulasIn('main')).toHaveLength(0);
    expect(st().graphs.get('main').instances.size).toBe(0);
    // Still in the other web, still an equation.
    deleteFormulaForWizard({ graphId: 'other', ref: 'Distribution' });
    expect(st().graphs.get('other').instances.size).toBe(0);
  });
});

describe('the wizard building from the bank', () => {
  beforeEach(() => { vi.useFakeTimers(); reset(); });

  it('by title: its symbols tied to their concepts', async () => {
    vi.useRealTimers();
    await addBankFormulaForWizard({ graphId: 'main', ref: 'Ideal Gas Law' });
    const [f] = formulasIn('main');
    expect(f.title).toBe('Ideal Gas Law');
    expect(f.terms.map(t => t.thing)).toContain('Pressure');
  });
});
