import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import { projectGraphView } from '../../src/core/openDefinitions.js';
import {
  chainFromText, chainText, tokensOf, rowsOf, readFormulaGroup, isSymbolText, vectorOf,
} from '../../src/components/canvas/formats/formula/formulaChain.js';
import { layoutFormulaLine, FORMULA_FONT } from '../../src/components/canvas/formats/formula/formulaObjects.js';
import { formulaWeb } from './formulaWeb.js';

const standard = (t) => tokensOf(chainFromText(t), { standard: true });
const inline = (t) => tokensOf(chainFromText(t), { standard: true, stack: false });
/** A row as text: [numerator / denominator], ∑{under}{over}. */
const shape = (tokens) => {
  const row = (r) => r.map((e) => {
    if (typeof e === 'number') return tokens[e].text;
    if (e.kind === 'fraction') return `[${row(e.num)} / ${row(e.den)}]`;
    if (e.kind === 'big') return `${tokens[e.sign].text}{${row(e.under)}}{${row(e.over)}}`;
    return `√[${row(e.body)}]`;
  }).join(' ');
  return row(rowsOf(tokens));
};
const chainOf = (state) => {
  const view = projectGraphView(state, 'web');
  return readFormulaGroup(state, view, view.groups.get('top'));
};

describe('derivatives', () => {
  it('is typed derivative(m, V) and drawn dm over dV', () => {
    expect(chainText(chainFromText('rho = derivative(m, V)'))).toBe('rho = derivative(m, V)');
    expect(shape(standard('rho = derivative(m, V)'))).toBe('rho = [d m / d V]');
    expect(shape(inline('rho = derivative(m, V)'))).toBe('rho = d m / d V');
  });

  it('writes the same derivative taken again once, with how many times', () => {
    expect(shape(standard('a = partial(partial(u, t), t)'))).toBe('a = [∂ 2 u / ∂ t 2]');
  });

  it('writes d/dx before what it is of when that is more than one thing', () => {
    expect(shape(standard('y = derivative(a + b, x)'))).toBe('y = [d / d x] ( a + b )');
  });

  it('writes a differential against what it is of: dQ = I dt', () => {
    expect(chainText(chainFromText('differential(Q) = I differential(t)'))).toBe('differential(Q) = I × differential(t)');
    expect(shape(standard('differential(Q) = I differential(t)'))).toBe('d Q = I d t');
  });
});

describe('integrals, sums and limits', () => {
  it('writes an integral with its limits at its side, then what it integrates and its d', () => {
    expect(shape(standard('W = integral(F, x, a, b)'))).toBe('W = ∫{a}{b} F d x');
    // ∫ dA, of 1, which goes unwritten.
    expect(shape(standard('A = integral(1, A)'))).toBe('A = ∫{}{} d A');
    expect(standard('W = integral(F, x, a, b)').find(t => t.text === '∫').bigScripts).toBe(true);
  });

  it('writes a line integral as the field along each step', () => {
    expect(shape(standard('W = lineintegral(F⃗, r⃗, C)'))).toBe('W = ∫{C}{} F⃗ · d r⃗');
  });

  it('writes a sum over what it runs over, from where to where', () => {
    expect(shape(standard('S = sum(a_i, i, 1, n)'))).toBe('S = ∑{i = 1}{n} a_i');
    expect(shape(standard('S = sum(p)'))).toBe('S = ∑{}{} p');
    // What it sums is in parentheses when it is a sum itself.
    expect(shape(standard('S = sum(x_i + 1, i)'))).toBe('S = ∑{i}{} ( x_i + 1 )');
  });

  it('writes a limit with what approaches what under it', () => {
    expect(shape(standard('e = lim((1 + 1/n)^n, n, ∞)'))).toBe('e = lim{n → ∞}{} ( 1 + [1 / n] ) n');
  });

  it('says how many things each takes', () => {
    expect(() => chainFromText('y = derivative(x)')).toThrow(/derivative\(\) takes 2/);
    expect(() => chainFromText('y = sum(a, i, 1)')).toThrow(/sum\(\) takes 1 or 2 or 4/);
  });

  it('lays a sum\'s limits under and over a larger ∑, and an integral\'s at its side', () => {
    const sum = standard('S = sum(a_i, i, 1, n)');
    const { boxes } = layoutFormulaLine(sum);
    const sign = boxes[sum.findIndex(t => t.text === '∑')];
    const under = boxes[sum.findIndex(t => t.text === 'i')];
    const over = boxes[sum.findIndex(t => t.text === 'n')];
    expect(sign.size).toBeGreaterThan(FORMULA_FONT);
    expect(under.size).toBeLessThan(FORMULA_FONT);
    expect(under.y).toBeGreaterThan(sign.y + sign.h / 2);
    expect(over.y + over.h).toBeLessThan(sign.y + sign.h / 2);
    const int = standard('W = integral(F, x, a, b)');
    const ib = layoutFormulaLine(int).boxes;
    const s = ib[int.findIndex(t => t.text === '∫')];
    const a = ib[int.findIndex(t => t.text === 'a')];
    expect(a.x).toBeGreaterThan(s.x);
  });
});

describe('vectors', () => {
  it('is a letter with its arrow, read as one symbol', () => {
    expect(isSymbolText('F⃗')).toBe(true);
    expect(isSymbolText('F⃗_g')).toBe(true);
    expect(vectorOf('F⃗')).toEqual({ letter: 'F', vector: true });
    expect(chainText(chainFromText('F⃗ = m a⃗'))).toBe('F⃗ = m × a⃗');
    expect(standard('F⃗ = m a⃗').find(t => t.text === 'a⃗').joined).toBe(true);
  });

  it('types the scalar and vector products apart from multiplication, and draws them as it is drawn', () => {
    expect(chainText(chainFromText('W = F⃗ ⋅ s⃗'))).toBe('W = F⃗ ⋅ s⃗');
    expect(chainText(chainFromText('L⃗ = r⃗ ⨯ p⃗'))).toBe('L⃗ = r⃗ ⨯ p⃗');
    expect(chainText(chainFromText('a = b · c'))).toBe('a = b × c');
    expect(standard('W = F⃗ ⋅ s⃗').find(t => t.kind === 'operator' && t.realName === 'Scalar Product').text).toBe('·');
  });
});

describe('in Things mode', () => {
  it('reads a part typed Derivative as the derivative of its first Thing by its second', () => {
    const state = formulaWeb({
      things: [['rho', 'ρ', 0], ['m', 'Mass', 400], ['v', 'Volume', 700]],
      parts: [{ id: 'g', anchor: 'pd', name: 'derivative(m, V)', type: 'Derivative', members: ['m', 'v'], x: 300 }],
      ops: [['rho', 'pd', 'Equality']],
      top: ['rho', 'm', 'v', 'pd'],
      labels: { Mass: 'm', Volume: 'V' },
      format: 'formula',
    });
    const chain = chainOf(state);
    expect(chainText(chain)).toBe('ρ = derivative(m, V)');
    expect(shape(tokensOf(chain, { standard: true }))).toBe('ρ = [d m / d V]');
  });

  it('writes one instance its own way: q₁ and q₂, both Electric Charge, written q', () => {
    const state = formulaWeb({
      things: [['f', 'Force', 0], ['k', 'k', 300], ['q1', 'Electric Charge', 600], ['q2', 'Electric Charge', 900]],
      ops: [['f', 'k', 'Equality'], ['k', 'q1', 'Multiplication'], ['q1', 'q2', 'Multiplication']],
      top: ['f', 'k', 'q1', 'q2'],
      labels: { Force: 'F', 'Electric Charge': 'q' },
      instanceLabels: { q1: 'q_1', q2: 'q_2' },
      format: 'formula',
    });
    const chain = chainOf(state);
    expect(chainText(chain)).toBe('F = k × q_1 × q_2');
    const tokens = tokensOf(chain, { standard: true });
    expect(tokens.filter(t => t.realName === 'Electric Charge').map(t => t.text)).toEqual(['q_1', 'q_2']);
  });
});
