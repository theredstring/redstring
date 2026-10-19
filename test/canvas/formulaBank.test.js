import { describe, it, expect, beforeAll } from 'vitest';
import { loadFormulaBank } from '../../src/components/canvas/formats/formula/bank/formulaBank.js';
import { chainFromText, chainText } from '../../src/components/canvas/formats/formula/formulaChain.js';

const isNumber = (name) => /^\d+(\.\d+)?$/.test(name);
const WIKIDATA = /^http:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

/** Every Thing a chain names, parts included. */
function thingNames(chain, out = []) {
  for (const item of chain.items) {
    if (item.kind === 'thing') out.push(item.name);
    else if (item.kind === 'part') item.args.forEach(a => thingNames(a, out));
  }
  return out;
}

let bank;
beforeAll(async () => { bank = await loadFormulaBank(); });

const readEntry = (equation) => chainFromText(equation.text, {
  convention: 'math',
  isKnownName: (n) => Object.prototype.hasOwnProperty.call(equation.symbols, n),
});

describe('the formula bank, populated from Wikidata', () => {
  it('has disciplines of equations, each its own', () => {
    expect(bank.disciplines.length).toBeGreaterThanOrEqual(3);
    expect(bank.equations.length).toBeGreaterThanOrEqual(300);
    const ids = bank.equations.map(({ equation }) => equation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(bank.disciplines.map(d => d.id)).size).toBe(bank.disciplines.length);
  });

  it('gives every equation a title, a description for its bio, and the item it came from', () => {
    const lacking = bank.equations.filter(({ equation: e }) => !e.title?.trim() || !e.description?.trim() || !WIKIDATA.test(e.source));
    expect(lacking.map(({ equation }) => equation.id)).toEqual([]);
  });

  it('reads every equation, each symbol in it tied to one concept written by that symbol', () => {
    const problems = [];
    for (const { equation } of bank.equations) {
      let chain;
      try { chain = readEntry(equation); } catch (err) { problems.push(`${equation.id}: ${err.message}`); continue; }
      const names = [...new Set(thingNames(chain).filter(n => !isNumber(n)))];
      const untied = names.filter(n => !(n in equation.symbols));
      if (untied.length) problems.push(`${equation.id}: untied ${untied.join(', ')}`);
      const unused = Object.keys(equation.symbols).filter(s => !names.includes(s));
      if (unused.length) problems.push(`${equation.id}: unused ${unused.join(', ')}`);
      const concepts = Object.values(equation.symbols);
      if (new Set(concepts).size !== concepts.length) problems.push(`${equation.id}: a concept written two ways`);
      for (const [symbol, q] of Object.entries(equation.symbols)) {
        const concept = bank.concepts[q];
        if (!concept) problems.push(`${equation.id}: no concept ${q}`);
        else if (concept.symbol !== symbol) problems.push(`${equation.id}: ${symbol} for ${concept.name}, written ${concept.symbol}`);
      }
      if (!chainText(chain)) problems.push(`${equation.id}: no text`);
    }
    expect(problems).toEqual([]);
  });

  it('names every concept and links it to its item, and uses every concept it lists', () => {
    const used = new Set(bank.equations.flatMap(({ equation }) => Object.values(equation.symbols)));
    for (const [q, concept] of Object.entries(bank.concepts)) {
      expect(concept.name?.trim(), q).toBeTruthy();
      expect(concept.source).toBe(`http://www.wikidata.org/entity/${q}`);
      expect(used.has(q), q).toBe(true);
    }
  });

  it('titles an equation that defines one of its own concepts apart from it', () => {
    const names = new Set(Object.values(bank.concepts).map(c => c.name.toLowerCase()));
    const clashing = bank.equations.filter(({ equation }) => names.has(equation.title.toLowerCase()) && !equation.defines);
    // An item that is the law itself (Ideal Gas Law) isn't one of its concepts, so its title can stand.
    for (const { equation } of clashing) expect(Object.values(equation.symbols)).not.toContain(equation.id);
    for (const { equation } of bank.equations.filter(x => x.equation.defines)) {
      expect(equation.title.startsWith('Definition of ')).toBe(true);
      expect(Object.values(equation.symbols)).toContain(equation.defines);
    }
  });

  it('holds the classics', () => {
    const byId = new Map(bank.equations.map(({ equation }) => [equation.id, equation]));
    expect(byId.get('Q191785')?.title).toBe('Ideal Gas Law');
    expect(byId.get('Q35875')?.title).toBe('Mass–Energy Equivalence');
    expect(byId.get('Q41591')?.title).toBe("Ohm's Law");
    // Not yet: a and b both mean "cathetus", and a Thing is written one way.
    expect(byId.has('Q11518')).toBe(false);
  });
});
