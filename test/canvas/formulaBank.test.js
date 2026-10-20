import { describe, it, expect, beforeAll } from 'vitest';
import { loadFormulaBank, loadFormulaBankKnown } from '../../src/components/canvas/formats/formula/bank/formulaBank.js';
import { chainFromText, chainText } from '../../src/components/canvas/formats/formula/formulaChain.js';

const isNumber = (name) => /^\d+(\.\d+)?$/.test(name) || name === '∞';
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
  isKnownName: (n) => Object.prototype.hasOwnProperty.call(equation.symbols, n) || !!equation.placeHolders?.includes(n),
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

  it('reads every equation, each symbol in it tied to one concept (what a sum runs over excepted)', () => {
    const problems = [];
    for (const { equation } of bank.equations) {
      let chain;
      try { chain = readEntry(equation); } catch (err) { problems.push(`${equation.id}: ${err.message}`); continue; }
      const names = [...new Set(thingNames(chain).filter(n => !isNumber(n)))];
      const untied = names.filter(n => !(n in equation.symbols) && !equation.placeHolders?.includes(n));
      if (untied.length) problems.push(`${equation.id}: untied ${untied.join(', ')}`);
      const unused = Object.keys(equation.symbols).filter(s => !names.includes(s));
      if (unused.length) problems.push(`${equation.id}: unused ${unused.join(', ')}`);
      for (const q of Object.values(equation.symbols)) if (!bank.concepts[q]) problems.push(`${equation.id}: no concept ${q}`);
      if (!chainText(chain)) problems.push(`${equation.id}: no text`);
    }
    expect(problems).toEqual([]);
  });

  it('gives each concept one symbol, the way most of its equations write it; one written otherwise keeps its own', () => {
    // Coulomb's law: q₁ and q₂ are both electric charge.
    const twice = bank.equations.find(({ equation }) => new Set(Object.values(equation.symbols)).size < Object.keys(equation.symbols).length);
    expect(twice).toBeTruthy();
    const symbolsOf = (q) => bank.equations.flatMap(({ equation }) => Object.entries(equation.symbols).filter(([, c]) => c === q).map(([s]) => s));
    for (const [q, concept] of Object.entries(bank.concepts)) {
      const counts = {};
      symbolsOf(q).forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
      expect(counts[concept.symbol], `${concept.name} written ${concept.symbol}`).toBeGreaterThan(0);
    }
  });

  it('divides disciplines into sections, each equation in one of its own discipline\'s', () => {
    const physics = bank.disciplines.find(d => d.id === 'physics');
    expect(physics.sections.map(x => x.name)).toContain('Thermodynamics');
    for (const d of bank.disciplines) {
      const ids = new Set(d.sections.map(x => x.id));
      for (const e of d.equations.filter(x => x.sectionId)) expect(ids.has(e.sectionId), `${e.id} in ${e.section}`).toBe(true);
      for (const x of d.sections) expect(x.equations).toBe(d.equations.filter(e => e.sectionId === x.id).length);
    }
  });

  it('knows what each section is missing, and why', async () => {
    const known = await loadFormulaBankKnown();
    const lists = Object.entries(known.sections);
    expect(lists.length).toBeGreaterThan(50);
    for (const [key, list] of lists) {
      const [disciplineId, sectionId] = key.split('/');
      expect(bank.disciplines.find(d => d.id === disciplineId)?.sections.some(x => x.id === sectionId), key).toBe(true);
      for (const [q, title, , why] of list) {
        expect(q).toMatch(/^Q\d+$/);
        expect(title?.trim()).toBeTruthy();
        expect(why?.trim()).toBeTruthy();
      }
    }
    // Population genetics knows of Hardy–Weinberg, which Wikidata gives no formula.
    const biology = bank.disciplines.find(d => d.id === 'biology');
    const genetics = biology?.sections.find(x => x.name === 'Population Genetics');
    expect(known.sections[`biology/${genetics?.id}`]?.some(([q]) => q === 'Q49974')).toBe(true);
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
    // a and b both mean "cathetus": each written its own way.
    expect(byId.get('Q11518')?.text).toBe('c ^ 2 = a ^ 2 + b ^ 2');
    // Calculus and vectors: P = dE/dt, F⃗ = m a⃗.
    expect(byId.get('Q25342')?.text).toBe('P = derivative(E, t)');
    expect(byId.get('Q11402')?.text).toBe('F\u20D7 = m × a\u20D7');
  });
});
