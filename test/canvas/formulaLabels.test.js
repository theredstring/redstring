import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import { projectGraphView } from '../../src/core/openDefinitions.js';
import { readFormulaGroup, tokensOf, chainText } from '../../src/components/canvas/formats/formula/formulaChain.js';
import { computeFormulaObjects } from '../../src/components/canvas/formats/formula/formulaObjects.js';
import { equationsOf } from '../../src/components/canvas/formats/formula/formulaEquations.js';
import { isReplacedInstance, isReplacedGroup } from '../../src/components/canvas/formats/replaced.js';
import { formulaWeb } from './formulaWeb.js';

// P V = n R T: Pressure, Volume and Temperature written by symbol, n left bare.
const idealGas = (opts = {}) => formulaWeb({
  things: [['p', 'Pressure', 0], ['v', 'Volume', 300], ['n', 'n', 700], ['r', 'Gas Constant', 1000], ['t', 'Temperature', 1300]],
  ops: [['p', 'v', 'Multiplication'], ['v', 'n', 'Equality'], ['n', 'r', 'Multiplication'], ['r', 't', 'Multiplication']],
  top: ['p', 'v', 'n', 'r', 't'],
  labels: { Pressure: 'P', Volume: 'V', 'Gas Constant': 'R', Temperature: 'T' },
  format: 'formula',
  ...opts,
});
const chainOf = (state) => {
  const view = projectGraphView(state, 'web');
  return readFormulaGroup(state, view, view.groups.get('top'));
};

describe('formula labels', () => {
  it('writes a Thing by its label and keeps its real name behind it', () => {
    const chain = chainOf(idealGas());
    expect(chainText(chain)).toBe('P × V = n × R × T');
    expect(chain.items[0]).toMatchObject({ name: 'P', realName: 'Pressure' });
  });

  it('marks what means more than what is written; a bare symbol is just text', () => {
    const tokens = tokensOf(chainOf(idealGas()), { standard: true });
    expect(tokens.map(t => [t.text, !!t.defined])).toEqual([
      ['P', true], ['V', true], ['=', true], ['n', false], ['R', true], ['T', true],
    ]);
    expect(tokens.find(t => t.text === '=').realName).toBe('Equality');
  });

  it('reads with names instead of symbols when asked, writing every multiplication', () => {
    const tokens = tokensOf(chainOf(idealGas()), { standard: true, words: true });
    expect(tokens.map(t => t.text).join(' ')).toBe('Pressure × Volume = n × Gas Constant × Temperature');
  });

  it('lights a part by its own name only when it has one', () => {
    const named = (name) => tokensOf(chainOf(formulaWeb({
      things: [['b', 'b', 0], ['c', 'c', 300], ['z', 'z', 800]],
      parts: [{ id: 'g', anchor: 'pa', name, members: ['b', 'c'], x: 150 }],
      ops: [['b', 'c', 'Subtraction'], ['pa', 'z', 'Addition']],
      top: ['b', 'c', 'pa', 'z'],
    })), { standard: true }).find(t => t.text === '(').defined;
    expect(named('Discriminant')).toBe(true);
    expect(named('b − c')).toBe(false);
  });
});

describe('a formula shown as a Thing-group', () => {
  it('carries its title and keeps its Things from being hit', () => {
    const state = idealGas();
    const fo = computeFormulaObjects(state);
    expect(fo.objects[0].title).toBe('Formula');
    expect(fo.objects[0].titleBox.y).toBeLessThan(fo.objects[0].inner.y);
    expect(isReplacedInstance('p')).toBe(true);
    expect(isReplacedGroup('top')).toBe(true);
    // Shown as Things again, they are hit again.
    const web = state.graphs.get('web');
    const { format: _shown, ...asThings } = web.groups.get('top');
    state.graphs = new Map([['web', { ...web, groups: new Map([...web.groups, ['top', asThings]]) }]]);
    computeFormulaObjects(state);
    expect(isReplacedInstance('p')).toBe(false);
  });
});

describe('the equations a Thing is in', () => {
  it('finds each by its symbol there, and none for a Thing in no formula', () => {
    const state = idealGas();
    state.nodePrototypes.get('p-Pressure').id = 'p-Pressure';
    const rows = equationsOf(state, 'p-Pressure');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: 'P', title: 'Formula', graphId: 'web' });
    expect(equationsOf(state, 'p-Pressure')).toBe(rows); // the same until something changes
    expect(equationsOf(state, 'p-nothing')).toEqual([]);
  });
});
