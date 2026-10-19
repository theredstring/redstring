import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import { projectGraphView } from '../../src/core/openDefinitions.js';
import { readFormulaGroup, tokensOf, chainText, expandFor } from '../../src/components/canvas/formats/formula/formulaChain.js';
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

  it('marks what means more than what is written; a bare symbol, or a standard operation, is just text', () => {
    const tokens = tokensOf(chainOf(idealGas()), { standard: true });
    expect(tokens.map(t => [t.text, !!t.defined])).toEqual([
      ['P', true], ['V', true], ['=', false], ['n', false], ['R', true], ['T', true],
    ]);
  });

  it('writes a formula by names when asked, every multiplication written, operations still by symbol', () => {
    const tokens = tokensOf(chainOf(idealGas()), { standard: true, expand: expandFor(true, null) });
    expect(tokens.map(t => t.text).join(' ')).toBe('Pressure × Volume = n × Gas Constant × Temperature');
    expect(tokens.filter(t => t.expanded).map(t => t.text)).toEqual(['Pressure', 'Volume', 'Gas Constant', 'Temperature']);
  });

  it('switches one token on its own, keeping every token\'s key', () => {
    const chain = chainOf(idealGas());
    const before = tokensOf(chain, { standard: true });
    const p = before.find(t => t.text === 'P');
    const after = tokensOf(chain, { standard: true, expand: expandFor(false, new Set([p.flip])) });
    expect(after.map(t => t.text).join(' ')).toBe('Pressure × V = n R T');
    // The × that appears is the connection's own; everything else keeps its key.
    expect(before.every(t => after.some(a => a.key === t.key))).toBe(true);
    expect(after.find(t => t.text === '×').target).toMatch(/^edge:/);
    // A standard operation has nothing to switch; inside a formula shown by
    // names, a switched token goes back to its symbol.
    expect(before.find(t => t.text === '=').flip).toBe(null);
    expect(tokensOf(chain, { standard: true, expand: expandFor(true, new Set([p.flip])) }).find(t => t.key === p.key).text).toBe('P');
  });

  it('writes a named part as its name alone when switched', () => {
    const chain = chainOf(formulaWeb({
      things: [['b', 'b', 0], ['c', 'c', 300], ['z', 'z', 800]],
      parts: [{ id: 'g', anchor: 'pa', name: 'Discriminant', members: ['b', 'c'], x: 150 }],
      ops: [['b', 'c', 'Subtraction'], ['pa', 'z', 'Addition']],
      top: ['b', 'c', 'pa', 'z'],
    }));
    expect(tokensOf(chain, { standard: true, expand: expandFor(false, new Set(['pa'])) }).map(t => t.text).join(' ')).toBe('Discriminant + z');
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
