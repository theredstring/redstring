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
    // A chunk, or a vector, is not one symbol.
    expect(latexSymbolName('\\frac1{4\\pi\\varepsilon_0}')).toBe(null);
    expect(latexSymbolName('\\boldsymbol{F}')).toBe(null);
  });

  it('refuses what the notation can\'t write yet, saying what', () => {
    expect(refusal('\\sigma = \\frac{\\mathrm{d} Q}{\\mathrm{d} A}')).toMatch(/derivatives/);
    expect(refusal('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')).toMatch(/±/);
    expect(refusal('\\boldsymbol{p} = m \\boldsymbol{v}')).toMatch(/vectors/);
    expect(refusal('H = -\\sum_i p_i \\log_2 p_i')).toMatch(/sums/);
    expect(refusal('A = \\int F \\, ds')).toMatch(/integrals/);
    expect(refusal('\\rho \\mathbf{v}')).toMatch(/vectors|not an equation/);
    expect(refusal('E = h \\nu')).toBe(null);
  });
});
