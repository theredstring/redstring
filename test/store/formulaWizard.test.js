import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import {
  addFormulaForWizard, placeEquation, openFormulaForWizard,
  foldFormulaForWizard, deleteFormulaForWizard, rewriteFormulaForWizard, addBankFormulaForWizard,
} from '../../src/components/canvas/formats/formula/formulaWizard.js';
import { formulasForWizard, findFormula, equationOf } from '../../src/components/canvas/formats/formula/formulaSnapshot.js';
import { deleteFormula } from '../../src/components/canvas/formats/formula/deleteFormula.js';
import { PALETTES } from '../../src/ai/palettes.js';
import { buildFormulaInWeb } from '../../src/components/canvas/formats/formula/buildFormula.js';
import { NODE_DEFAULT_COLOR } from '../../src/constants.js';

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

  it('given to a Thing standing in the web, the formula takes its node\'s place, connections and all', () => {
    const model = place('main', 'p-model', "Hamilton's Model", 400, 300);
    const ratio = place('main', 'p-ratio', 'Sex Ratio', -2000, 0);
    st().applyBulkGraphUpdates('main', { nodes: [], edges: [{ sourceId: model, targetId: ratio, type: 'predicts' }] });
    const built = addFormulaForWizard({
      graphId: 'main', text: 'r = (n - 1) / (2n)', forThing: "Hamilton's Model",
      meanings: [{ symbol: 'r', thing: 'Sex Ratio' }, { symbol: 'n', thing: 'Foundress Number' }],
    });
    const graph = st().graphs.get('main');
    // One Hamilton's Model in the web: the formula's title, not the old node beside it.
    expect(graph.instances.has(model)).toBe(false);
    const anchorId = graph.groups.get(built.groupId).anchorInstanceId;
    expect([...graph.instances.values()].filter(i => i.prototypeId === 'p-model').map(i => i.id)).toEqual([anchorId]);
    // Its connection now reaches the whole equation.
    const edges = graph.edgeIds.map(id => st().edges.get(id));
    expect(edges.some(e => e.sourceId === anchorId && e.destinationId === ratio)).toBe(true);
    // Its formula's r is the Sex Ratio the web had.
    expect(formulasIn('main')[0].terms.find(t => t.symbol === 'r').protoId).toBe('p-ratio');
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
    placeEquation({ graphId: 'other', ref: 'Distribution' });
    const [f] = formulasIn('other');
    expect(f).toMatchObject({ shown: 'open', equationProtoId, text: 'a × (b + c)' });
  });

  it('placed where its Thing is already, that one shows as its formula: no second beside it', () => {
    const { equationProtoId } = addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    st().addNodeInstance('other', equationProtoId, { x: 0, y: 0 }, 'plain');
    placeEquation({ graphId: 'other', ref: 'Distribution' });
    expect([...st().graphs.get('other').instances.values()].filter(i => i.prototypeId === equationProtoId)).toHaveLength(1);
    expect(formulasIn('other')[0]).toMatchObject({ shown: 'open', anchorId: 'plain' });
    placeEquation({ graphId: 'other', ref: 'Distribution' });
    expect(st().graphs.get('other').instances.size).toBe(1);
  });

  it('placed folded, it is a node that opens as its formula', () => {
    addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    const { instanceId } = placeEquation({ graphId: 'other', ref: 'Distribution', folded: true });
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
    placeEquation({ graphId: 'other', ref: 'Distribution', folded: true });
    deleteFormulaForWizard({ graphId: 'main', ref: 'Distribution' });
    expect(formulasIn('main')).toHaveLength(0);
    expect(st().graphs.get('main').instances.size).toBe(0);
    // Still in the other web, still an equation.
    deleteFormulaForWizard({ graphId: 'other', ref: 'Distribution' });
    expect(st().graphs.get('other').instances.size).toBe(0);
  });

  it('the panel\'s Delete on a formula open in place removes that placement', () => {
    addFormulaForWizard({ graphId: 'main', text: 'a * (b + c)', title: 'Distribution' });
    st().collapseNodeGroupIntoDefinition('main', formulasIn('main')[0].groupId);
    placeEquation({ graphId: 'other', ref: 'Distribution' });
    const [f] = formulasIn('other');
    expect(f.groupId).toBe(`open:${f.anchorId}`);
    expect(deleteFormula('other', f.groupId)).toBe(true);
    expect(st().graphs.get('other').instances.has(f.anchorId)).toBe(false);
    expect(formulasIn('other')).toHaveLength(0);
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

describe('the colors of a formula the wizard writes', () => {
  beforeEach(() => { vi.useFakeTimers(); reset(); });

  const [paletteName, palette] = Object.entries(PALETTES).find(([, p]) => Object.keys(p.colors).length >= 3);
  const colors = Object.values(palette.colors).map(c => c.toLowerCase());
  const colored = (graphId, protoId, name, color, x = 0) => {
    st().addNodePrototype({ id: protoId, name, color, definitionGraphIds: [] });
    st().addNodeInstance(graphId, protoId, { x, y: -2000 }, `${protoId}-in-${graphId}`);
  };
  const colorOf = (protoId) => String(st().nodePrototypes.get(protoId)?.color).toLowerCase();

  it('takes the palette the web is in, for what it makes new; what it reuses keeps its own', () => {
    colored('main', 'p-pressure', 'Pressure', colors[0]);
    colored('main', 'p-gas', 'Gas', colors[1], 400);
    const built = addFormulaForWizard({
      graphId: 'main', text: 'P V = n R T', title: 'Ideal Gas Law',
      meanings: [{ symbol: 'P', thing: 'Pressure' }, { symbol: 'V', thing: 'Volume' }],
    });
    const [f] = formulasIn('main');
    const bySymbol = Object.fromEntries(f.terms.map(t => [t.symbol, t]));
    // The equation in a color of the web's palette the web is not already using.
    expect(colors.slice(2)).toContain(colorOf(built.equationProtoId));
    expect(colors).toContain(colorOf(bySymbol.V.protoId));
    expect(colorOf('p-pressure')).toBe(colors[0]);
    expect(st().graphs.get('main').groups.get(built.groupId).color.toLowerCase()).toBe(colorOf(built.equationProtoId));
  });

  // A formula's parentheses: the Thing-groups inside it, and their Things.
  const partsOf = (graphId, groupId) => [...st().graphs.get(graphId).groups.values()].filter(g => g.id !== groupId);

  it('colors its parentheses the same way, nested ones too', () => {
    colored('main', 'p-a', 'A', colors[0]);
    colored('main', 'p-b', 'B', colors[1], 400);
    const built = addFormulaForWizard({ graphId: 'main', text: 'y = a * (b + (c - d))', title: 'Nested' });
    const parts = partsOf('main', built.groupId);
    expect(parts.length).toBe(2);
    for (const g of parts) {
      expect(colors).toContain(g.color.toLowerCase());
      expect(colorOf(g.linkedNodePrototypeId)).toBe(g.color.toLowerCase());
    }
  });

  it('without the web\'s colors (New Formula), its parentheses are the equation\'s color', () => {
    const built = buildFormulaInWeb('y = a * (b + c)', 'main', { x: 0, y: 0 }, { convention: 'math' }, { title: 'Picked', color: '#1965b5' });
    const [part] = partsOf('main', built.groupId);
    expect(part.color).toBe('#1965b5');
    expect(colorOf(part.linkedNodePrototypeId)).toBe('#1965b5');
  });

  it('stays in the color of a web of one color', () => {
    colored('main', 'p-a', 'A', NODE_DEFAULT_COLOR);
    colored('main', 'p-b', 'B', NODE_DEFAULT_COLOR, 400);
    const built = addFormulaForWizard({ graphId: 'main', text: 'F = m a', title: 'Second Law' });
    expect(colorOf(built.equationProtoId)).toBe(NODE_DEFAULT_COLOR.toLowerCase());
  });

  it('takes the color asked for, over the web\'s', () => {
    colored('main', 'p-a', 'A', colors[0]);
    colored('main', 'p-b', 'B', colors[1], 400);
    const built = addFormulaForWizard({
      graphId: 'main', text: 'F = m a', title: 'Second Law', color: '#123456',
      meanings: [{ symbol: 'F', thing: 'Force', color: '#654321' }],
    });
    const f = formulasIn('main')[0];
    expect(colorOf(built.equationProtoId)).toBe('#123456');
    expect(colorOf(f.terms.find(t => t.symbol === 'F').protoId)).toBe('#654321');
  });

  it('in an empty web, takes the color of the Thing the web is', () => {
    st().addNodePrototype({ id: 'p-thermo', name: 'Thermodynamics', color: '#22752d', definitionGraphIds: ['other'] });
    useGraphStore.setState((s) => ({ graphs: new Map(s.graphs).set('other', { ...web('other'), definingNodeIds: ['p-thermo'] }) }));
    const built = addFormulaForWizard({ graphId: 'other', text: 'U = Q - W', title: 'First Law' });
    expect(colorOf(built.equationProtoId)).toBe('#22752d');
  });

  it(`is told the palette by the tool (${paletteName})`, async () => {
    const { addFormula } = await import('../../src/wizard/tools/addFormula.js');
    const colorName = Object.keys(palette.colors)[1];
    const result = await addFormula({ text: 'F = m a', palette: paletteName, color: colorName }, { graphs: [{ id: 'main' }], nodePrototypes: [], activeGraphId: 'main' });
    expect(result.color.toLowerCase()).toBe(colors[1]);
    const none = await addFormula({ text: 'F = m a' }, { graphs: [{ id: 'main' }], nodePrototypes: [], activeGraphId: 'main' });
    expect(none.color).toBe('');
  });
});
