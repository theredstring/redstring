import { describe, it, expect } from 'vitest';
import { operatorKeyForName } from '../../src/components/canvas/formats/formula/formulaNotation.js';
import { chainFromText, chainText, tokensOf, readFormulaGroup } from '../../src/components/canvas/formats/formula/formulaChain.js';
import { layoutFormulaLine } from '../../src/components/canvas/formats/formula/formulaObjects.js';
import { projectGraphView } from '../../src/core/openDefinitions.js';
import { formulaWeb } from './formulaWeb.js';

const text = (t, convention) => chainText(chainFromText(t, convention ? { convention } : undefined));
const standard = (t) => tokensOf(chainFromText(t), { standard: true });
const shown = (tokens) => tokens.map(t => (t.sub ? `_${t.text}` : t.text)).join(' ');

describe('logarithms', () => {
  it('are operations by name, as the rest are', () => {
    expect(operatorKeyForName('Logarithm')).toBe('log');
    expect(operatorKeyForName('Natural Logarithm')).toBe('ln');
    expect(operatorKeyForName('ln')).toBe('ln');
    expect(operatorKeyForName('Common Logarithm')).toBe('log10');
    expect(operatorKeyForName('log')).toBe('log10');
  });

  it('with a base: an operation from the base to what it is taken of, like exponentiation', () => {
    const chain = chainFromText('log_2(x)');
    expect(chain.items.map(i => (i.kind === 'op' ? i.key : i.name))).toEqual(['2', 'log', 'x']);
    expect(chainFromText('log_b x').items.map(i => (i.kind === 'op' ? i.key : i.name))).toEqual(['b', 'log', 'x']);
    // Written applied, the base lowered after "log".
    expect(shown(tokensOf(chain))).toBe('log _2 ( x )');
    expect(text('log_2(x)')).toBe('log_2(x)');
    expect(text('y = log_b(x + 1)')).toBe('y = log_b(x + 1)');
    expect(text('log_2(x)^2 + 1')).toBe('log_2(x) ^ 2 + 1');
    expect(text('log_a(log_b(x))')).toBe('log_a(log_b(x))');
  });

  it('without one: applied like a root, ln for e and log for 10', () => {
    const [ln] = chainFromText('ln(x) + 1').items;
    expect(ln).toMatchObject({ kind: 'part', apply: 'ln', typeName: 'Natural Logarithm' });
    const [log] = chainFromText('log x').items;
    expect(log).toMatchObject({ kind: 'part', apply: 'log10', typeName: 'Common Logarithm' });
    expect(text('ln(x)')).toBe('ln(x)');
    expect(text('lnx')).toBe('ln(x)');
    expect(text('-log("[H⁺]")')).toBe('−log([H⁺])');
    expect(text('-log_2(p)')).toBe('−log_2(p)');
  });

  it('reads code the way code writes them', () => {
    expect(text('log(x)', 'programming')).toBe('ln(x)');
    expect(text('log(x, 2)', 'programming')).toBe('log_2(x)');
    expect(text('log2(x) + log10(y)', 'programming')).toBe('log_2(x) + log_10(y)');
  });

  it('are standard: none of their tokens switches to a name', () => {
    for (const t of [...standard('y = log_2(x)'), ...standard('y = ln(x)')]) {
      if (t.text === 'log' || t.text === 'ln' || t.kind === 'paren') expect(t.defined).toBe(false);
    }
  });

  it('multiply side by side the way functions do', () => {
    const tokens = standard('C = B log_2(1 + S / N)');
    const head = tokens.find(t => t.text === 'log');
    expect(head.joined).toBe(true);
    expect(standard('2 ln(x)').find(t => t.text === 'ln').joined).toBe(true);
  });

  it('lower the base in the line', () => {
    const tokens = standard('log_2(x)');
    const { boxes } = layoutFormulaLine(tokens, 44);
    const base = tokens.findIndex(t => t.sub);
    const head = tokens.findIndex(t => t.text === 'log');
    expect(boxes[base].size).toBeLessThan(boxes[head].size);
    expect(boxes[base].baseline).toBeGreaterThan(boxes[head].baseline);
  });

  it('read back from Things: b —Logarithm→ x, and a part typed Natural Logarithm', () => {
    const based = formulaWeb({
      things: [['y', 'y', 0], ['b', 'b', 200], ['x', 'x', 400]],
      ops: [['y', 'b', 'Equality'], ['b', 'x', 'Logarithm']],
      top: ['y', 'b', 'x'],
    });
    const view = projectGraphView(based, 'web');
    expect(chainText(readFormulaGroup(based, view, view.groups.get('top')))).toBe('y = log_b(x)');

    const natural = formulaWeb({
      things: [['y', 'y', 0], ['x', 'x', 400]],
      ops: [['y', 'pa', 'Equality']],
      parts: [{ id: 'g', anchor: 'pa', name: 'ln(x)', type: 'Natural Logarithm', members: ['x'], x: 300 }],
      top: ['y', 'x', 'pa'],
    });
    const nview = projectGraphView(natural, 'web');
    expect(chainText(readFormulaGroup(natural, nview, nview.groups.get('top')))).toBe('y = ln(x)');
  });
});
