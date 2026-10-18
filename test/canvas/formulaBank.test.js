import { describe, it, expect } from 'vitest';
import {
  BANK_DISCIPLINES, BANK_CONCEPT_IDS, bankConcept, bankEquations,
} from '../../src/components/canvas/formats/formula/bank/formulaBank.js';
import { chainFromText, chainText } from '../../src/components/canvas/formats/formula/formulaChain.js';

const isNumber = (name) => /^\d+(\.\d+)?$/.test(name);

/** Every Thing a chain names, parts included. */
function thingNames(chain, out = []) {
  for (const item of chain.items) {
    if (item.kind === 'thing') out.push(item.name);
    else if (item.kind === 'part') item.args.forEach(a => thingNames(a, out));
  }
  return out;
}

const readEntry = (equation) => chainFromText(equation.text, {
  convention: 'math',
  isKnownName: (n) => Object.prototype.hasOwnProperty.call(equation.symbols, n),
});

const writable = bankEquations().filter(({ equation }) => !equation.unsupported);

describe('the formula bank', () => {
  it('has disciplines of equations, each with an id and a title of its own', () => {
    expect(BANK_DISCIPLINES.length).toBeGreaterThanOrEqual(10);
    expect(writable.length).toBeGreaterThanOrEqual(80);
    const ids = bankEquations().map(({ equation }) => equation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BANK_DISCIPLINES.map(d => d.id)).size).toBe(BANK_DISCIPLINES.length);
    for (const { equation } of bankEquations()) expect(equation.title?.trim()).toBeTruthy();
  });

  it.each(writable.map(({ discipline, equation }) => [`${discipline.name}: ${equation.title}`, equation]))(
    'reads %s, every symbol bound to a concept',
    (_, equation) => {
      const chain = readEntry(equation);
      const names = thingNames(chain).filter(n => !isNumber(n));
      // Every symbol written is bound, and every binding is written.
      expect(names.filter(n => !(n in equation.symbols))).toEqual([]);
      expect(Object.keys(equation.symbols).filter(s => !names.includes(s))).toEqual([]);
      // Each binding names a concept written by that very symbol.
      for (const [symbol, conceptId] of Object.entries(equation.symbols)) {
        const concept = bankConcept(conceptId);
        expect(concept, `${symbol} -> ${conceptId}`).toBeTruthy();
        expect(concept.symbol).toBe(symbol);
      }
      expect(chainText(chain)).toBeTruthy();
    },
  );

  it('titles each equation apart from the concepts in it, so its Thing is never mistaken for one', () => {
    const names = new Set(BANK_CONCEPT_IDS.map(id => bankConcept(id).name.toLowerCase()));
    expect(bankEquations().filter(({ equation }) => names.has(equation.title.toLowerCase())).map(({ equation }) => equation.title)).toEqual([]);
  });

    it('uses every concept it defines', () => {
    const used = new Set(bankEquations().flatMap(({ equation }) => Object.values(equation.symbols)));
    expect(BANK_CONCEPT_IDS.filter(id => !used.has(id))).toEqual([]);
  });

  it('lets one letter mean different things, each its own concept', () => {
    // The letters that mean the most, and what they mean.
    const meanings = new Map();
    for (const id of BANK_CONCEPT_IDS) {
      const { symbol, name } = bankConcept(id);
      if (!meanings.has(symbol)) meanings.set(symbol, new Set());
      meanings.get(symbol).add(name);
    }
    expect([...meanings.get('P')].sort()).toEqual(['Power', 'Pressure', 'Price', 'Price Level', 'Principal']);
    expect([...meanings.get('c')].sort()).toEqual(['Constant Term', 'Hypotenuse', 'Molar Concentration', 'Specific Heat', 'Speed of Light']);
    expect([...meanings.get('π')].sort()).toEqual(['Inflation Rate', 'Pi', 'Profit']);
    expect(meanings.get('λ').size).toBe(3); // wavelength, decay constant, arrival rate
    // A discipline alone doesn't settle it: in mechanics W is weight and work.
    const mechanics = BANK_DISCIPLINES.find(d => d.id === 'mechanics');
    const w = new Set(mechanics.equations.filter(e => e.symbols.W).map(e => e.symbols.W));
    expect([...w].sort()).toEqual(['weight', 'work']);
  });

  it('lists what the notation cannot write yet', () => {
    const missing = new Set(bankEquations().filter(({ equation }) => equation.unsupported).map(({ equation }) => equation.unsupported));
    expect([...missing].sort()).toEqual(['conditional probability (|)', 'derivatives', 'Σ', '±', '∫'].sort());
  });
});
