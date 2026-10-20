import { describe, it, expect } from 'vitest';
import { latexToFormula, latexSymbolName } from '../../src/components/canvas/formats/formula/latex/latexToFormula.js';
import { chainFromText, chainText } from '../../src/components/canvas/formats/formula/formulaChain.js';

/** LaTeX, read the way the bank reads it, as the formula's plain line. */
const read = (tex) => {
  const { text, names } = latexToFormula(tex);
  return chainText(chainFromText(text, { convention: 'math', isKnownName: (n) => names.includes(n) }));
};
const refusal = (tex) => {
  try { latexToFormula(tex); return null; } catch (err) { return err.message; }
};

describe('LaTeX in', () => {
  it('reads the formulas Wikidata writes', () => {
    expect(read('p V = n R T')).toBe('p × V = n × R × T');
    expect(read('E = m c^2')).toBe('E = m × c ^ 2');
    expect(read('T = \\frac{1}{2} m v^2')).toBe('T = 1 ÷ 2 × m × v ^ 2');
    expect(read('T = \\frac12 m v^2')).toBe('T = 1 ÷ 2 × m × v ^ 2');
    expect(read('F_{\\rm g} = G {m_1 m_2 \\over r^2}')).toBe('F_g = G × (m_1 × m_2 ÷ r ^ 2)');
    expect(read('\\lambda_{\\mathrm{C}} = \\frac{h}{m c_0}')).toBe('λ_C = h ÷ (m × c_0)');
    expect(read('a_\\text{P} = \\sqrt{\\frac{c^7}{\\hbar G}}')).toBe('a_P = √(c ^ 7 ÷ (ħ × G))');
    expect(read('S = k_B \\ln W')).toBe('S = k_B × ln(W)');
    expect(read('y = \\log_b(x)')).toBe('y = log_b(x)');
    expect(read('\\sin^2\\theta + \\cos^2\\theta = 1')).toBe('sin(θ) ^ 2 + cos(θ) ^ 2 = 1');
    expect(read('d = |x - y|')).toBe('d = abs(x − y)');
    expect(read('\\mathrm{Re} = \\frac{\\rho v L}{\\mu}')).toBe('Re = ρ × v × L ÷ μ');
  });

  it('names each symbol the way the formula writes it', () => {
    expect(latexSymbolName('q_1')).toBe('q_1');
    expect(latexSymbolName('m_{\\mathrm f}')).toBe('m_f');
    expect(latexSymbolName('\\varepsilon_0')).toBe('ε_0');
    expect(latexSymbolName('k_\\text{B}')).toBe('k_B');
    expect(latexSymbolName('\\hbar')).toBe('ħ');
    // A vector is one symbol, its arrow written after its letter.
    expect(latexSymbolName('\\boldsymbol{F}')).toBe('F\u20D7');
    expect(latexSymbolName('\\boldsymbol{F}_{\\mathrm{g}}')).toBe('F\u20D7_g');
    // A chunk is not one symbol.
    expect(latexSymbolName('\\frac1{4\\pi\\varepsilon_0}')).toBe(null);
  });

  it('reads derivatives, differentials, integrals, sums and limits', () => {
    expect(read('\\rho = \\frac{\\mathrm{d} m}{\\mathrm{d} V}')).toBe('ρ = derivative(m, V)');
    expect(read('P = \\frac{dE}{dt}')).toBe('P = derivative(E, t)');
    expect(read('\\frac{\\partial^2 u}{\\partial t^2} = c^2 u')).toBe('partial(partial(u, t), t) = c ^ 2 × u');
    expect(read('\\mathrm{d}Q = I \\mathrm{d}t')).toBe('differential(Q) = I × differential(t)');
    expect(read('A=\\int dA')).toBe('A = integral(1, A)');
    expect(read('J = \\int r^{2} \\mathrm{d} m')).toBe('J = integral(r ^ 2, m)');
    expect(read('W = \\int_a^b F \\, \\mathrm{d}x')).toBe('W = integral(F, x, a, b)');
    expect(read('W = \\int_{\\Gamma} \\boldsymbol{F} \\cdot \\mathrm{d} \\boldsymbol{r}')).toBe('W = lineintegral(F\u20D7, r\u20D7, Γ)');
    expect(read('I = \\frac{1}{2} \\sum_i{z_i^2 b_i}')).toBe('I = 1 ÷ 2 × sum(z_i ^ 2 × b_i, i)');
    expect(read('S = \\sum_{i = 1}^n a_i')).toBe('S = sum(a_i, i, 1, n)');
    expect(read('\\mathrm{e} = \\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n')).toBe('e = lim((1 + 1 ÷ n) ^ n, n, ∞)');
    // A fraction that only looks like one stays a fraction.
    expect(read('r = \\frac{d}{2}')).toBe('r = d ÷ 2');
    // What a sum or an integral runs over needs no meaning of its own.
    expect(latexToFormula('S = \\sum_{i = 1}^n a_i').bound).toEqual(['i']);
  });

  it('reads vectors, and · and × between two of them as their products', () => {
    expect(read('\\boldsymbol{F} = m \\boldsymbol{a}')).toBe('F\u20D7 = m × a\u20D7');
    expect(read('\\boldsymbol{L} = \\boldsymbol{r} \\times \\boldsymbol{p}')).toBe('L\u20D7 = r\u20D7 ⨯ p\u20D7');
    expect(read('W = \\boldsymbol{F} \\cdot \\boldsymbol{s}')).toBe('W = F\u20D7 ⋅ s\u20D7');
    expect(read('\\boldsymbol{F} = q (\\boldsymbol{E} + \\boldsymbol{v} \\times \\boldsymbol{B})')).toBe('F\u20D7 = q × (E\u20D7 + v\u20D7 ⨯ B\u20D7)');
    // A number times a vector is multiplication.
    expect(read('\\boldsymbol{F} = m \\cdot \\boldsymbol{a}')).toBe('F\u20D7 = m × a\u20D7');
  });

  it('refuses what the notation can\'t write yet, saying what', () => {
    expect(refusal('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')).toMatch(/±/);
    expect(refusal('\\nabla \\cdot \\boldsymbol{E} = \\rho')).toMatch(/derivatives/);
    expect(refusal('\\Phi = \\oint \\boldsymbol{B} \\cdot \\mathrm{d}\\boldsymbol{A}')).toMatch(/integrals/);
    expect(refusal('P = \\prod_i p_i')).toMatch(/products/);
    expect(refusal('y = f(x)')).toMatch(/can't tell/);
    expect(refusal('\\rho \\mathbf{v}')).toMatch(/not an equation/);
    expect(refusal('E = h \\nu')).toBe(null);
  });
});
