import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { projectGraphView } from '../../src/core/openDefinitions.js';
import { readFormulaGroup, chainText } from '../../src/components/canvas/formats/formula/formulaChain.js';
import { symbolsOf } from '../../src/components/canvas/formats/formula/formulaEquations.js';
import { tieSymbol } from '../../src/components/canvas/formats/formula/tieSymbol.js';
import { formulaWeb } from './formulaWeb.js';

/**
 * An equation's Symbols card (formula/SymbolsCard): its letters and what each
 * stands for, and tying a letter to a Thing (tieSymbol).
 */

// P V = 2 n R T, the equation's Thing `p-eq`: Pressure, Volume, Gas Constant
// and Temperature written by symbol, n a bare letter.
const idealGas = () => {
  const state = formulaWeb({
    things: [['p', 'Pressure', 0], ['v', 'Volume', 300], ['two', '2', 500], ['n', 'n', 700], ['r', 'Gas Constant', 1000], ['t', 'Temperature', 1300]],
    ops: [['p', 'v', 'Multiplication'], ['v', 'two', 'Equality'], ['two', 'n', 'Multiplication'], ['n', 'r', 'Multiplication'], ['r', 't', 'Multiplication']],
    top: ['p', 'v', 'two', 'n', 'r', 't'],
    labels: { Pressure: 'P', Volume: 'V', 'Gas Constant': 'R', Temperature: 'T' },
    format: 'formula',
  });
  state.nodePrototypes.set('p-eq', { id: 'p-eq', name: 'Ideal Gas Law', color: '#8B0000', typeNodeId: null });
  state.graphs.get('web').groups.get('top').linkedNodePrototypeId = 'p-eq';
  // Amount of Substance, a Thing of the universe's own, not yet in the equation.
  state.nodePrototypes.set('p-amount', { id: 'p-amount', name: 'Amount of Substance', color: '#335500', typeNodeId: null });
  return state;
};

const text = () => {
  const st = useGraphStore.getState();
  const view = projectGraphView(st, 'web');
  return chainText(readFormulaGroup(st, view, view.groups.get('top')));
};
const symbols = () => symbolsOf(useGraphStore.getState(), 'p-eq');
const rowFor = (symbol) => symbols().find(r => r.symbol === symbol);

describe('an equation\'s symbols', () => {
  beforeEach(() => { useGraphStore.setState(idealGas()); });

  it('lists each letter once, in reading order, with what it stands for; numbers are not symbols', () => {
    expect(symbols().map(r => [r.symbol, r.protoId, r.bare])).toEqual([
      ['P', 'p-Pressure', false], ['V', 'p-Volume', false], ['n', 'p-n', true], ['R', 'p-Gas Constant', false], ['T', 'p-Temperature', false],
    ]);
    expect(symbols()).toBe(symbols()); // the same until something changes
    expect(symbolsOf(useGraphStore.getState(), 'p-Pressure')).toEqual([]); // not an equation
  });

  it('ties a bare letter to a Thing: the equation reads the same and the bare letter goes', () => {
    expect(tieSymbol(rowFor('n'), 'p-amount')).toBe(true);
    const st = useGraphStore.getState();
    expect(st.graphs.get('web').instances.get('n').prototypeId).toBe('p-amount');
    expect(st.nodePrototypes.get('p-amount').labels).toEqual({ formula: 'n' });
    expect(st.nodePrototypes.has('p-n')).toBe(false);
    expect(text()).toBe('P × V = 2 × n × R × T');
    expect(rowFor('n')).toMatchObject({ protoId: 'p-amount', bare: false });
  });

  it('keeps the equation\'s letter on the instance when the Thing is written otherwise', () => {
    useGraphStore.getState().updateNodePrototype('p-amount', (d) => { d.labels = { formula: 'N' }; });
    tieSymbol(rowFor('n'), 'p-amount');
    const st = useGraphStore.getState();
    expect(st.nodePrototypes.get('p-amount').labels).toEqual({ formula: 'N' });
    expect(st.graphs.get('web').instances.get('n').labels).toEqual({ formula: 'n' });
    expect(text()).toBe('P × V = 2 × n × R × T');
  });

  it('moves a letter from one Thing to another, keeping the first', () => {
    tieSymbol(rowFor('P'), 'p-amount');
    const st = useGraphStore.getState();
    expect(st.graphs.get('web').instances.get('p').prototypeId).toBe('p-amount');
    expect(st.nodePrototypes.has('p-Pressure')).toBe(true);
    expect(text()).toBe('P × V = 2 × n × R × T');
  });

  it('keeps a bare letter still used elsewhere', () => {
    useGraphStore.setState((s) => {
      const graphs = new Map(s.graphs);
      graphs.set('other', { id: 'other', name: 'Other', instances: new Map([['n2', { id: 'n2', prototypeId: 'p-n', x: 0, y: 0 }]]), edgeIds: [], groups: new Map() });
      return { graphs };
    });
    tieSymbol(rowFor('n'), 'p-amount');
    expect(useGraphStore.getState().nodePrototypes.has('p-n')).toBe(true);
  });
});

describe('an equation opened in place', () => {
  // The equation's Thing `eq`, its definition `def` holding a + b, placed in `web` open as its formula.
  beforeEach(() => {
    const defWeb = formulaWeb({ things: [['a', 'a', 0], ['b', 'b', 200]], ops: [['a', 'b', 'Addition']] });
    const def = { ...defWeb.graphs.get('web'), id: 'def' };
    const nodePrototypes = new Map(defWeb.nodePrototypes);
    nodePrototypes.set('eq', { id: 'eq', name: 'Sum', color: '#8B0000', definitionGraphIds: ['def'] });
    nodePrototypes.set('p-apples', { id: 'p-apples', name: 'Apples', color: '#335500', typeNodeId: null });
    const instances = new Map([['box', {
      id: 'box', prototypeId: 'eq', x: 100, y: 100, format: 'formula',
      openDefinition: { index: 0, offset: { x: 150, y: 120 } },
    }]]);
    useGraphStore.setState({
      activeGraphId: 'web',
      graphs: new Map([['web', { id: 'web', name: 'Web', instances, edgeIds: [], groups: new Map() }], ['def', def]]),
      nodePrototypes,
      edges: defWeb.edges,
    });
  });

  it('lists its letters and ties one in the equation\'s own web', () => {
    const rows = symbolsOf(useGraphStore.getState(), 'eq');
    expect(rows.map(r => [r.symbol, r.bare])).toEqual([['a', true], ['b', true]]);
    tieSymbol(rows[0], 'p-apples');
    const st = useGraphStore.getState();
    expect(st.graphs.get('def').instances.get('a')).toMatchObject({ prototypeId: 'p-apples', x: 0, y: 0 });
    expect(st.nodePrototypes.get('p-apples').labels).toEqual({ formula: 'a' });
    expect(st.nodePrototypes.has('p-a')).toBe(false);
    expect(symbolsOf(st, 'eq').map(r => [r.symbol, r.protoId])).toEqual([['a', 'p-apples'], ['b', 'p-b']]);
  });
});
