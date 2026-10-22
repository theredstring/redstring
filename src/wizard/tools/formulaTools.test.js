import { describe, it, expect } from 'vitest';
import { selectToolsForTurn } from './schemas.js';
import { searchBank, findBankEquation } from '../../components/canvas/formats/formula/bank/searchBank.js';
import { loadFormulaBank } from '../../components/canvas/formats/formula/bank/formulaBank.js';
import { formulaCover, formulaLine, findFormulaIn, readFormulaText } from './utils/formulas.js';
import { predictFormula } from '../predictFormula.js';
import { searchFormulaBank } from './searchFormulaBank.js';
import { formula } from './formula.js';

const FORMULA_TOOLS = ['addFormula', 'searchFormulaBank', 'formula'];
const web = { id: 'w', name: 'W', instances: [{ id: 'a', prototypeId: 'pa' }], edgeIds: [], groups: [] };
const offered = (graphState, userMessage) => selectToolsForTurn({ graphState, userMessage }).map(t => t.name);

describe('formula tools are offered', () => {
  it('when the ask is about a formula', () => {
    const names = offered({ graphs: [web], activeGraphId: 'w' }, 'Add the ideal gas law equation');
    expect(names).toEqual(expect.arrayContaining(FORMULA_TOOLS));
  });

  it('when the universe has one, whatever the ask', () => {
    const names = offered({ graphs: [web], activeGraphId: 'w', formulas: [{ graphId: 'w', title: 'E' }] }, 'tidy this up');
    expect(names).toEqual(expect.arrayContaining(FORMULA_TOOLS));
  });

  it('not otherwise', () => {
    const names = offered({ graphs: [web], activeGraphId: 'w' }, 'make a web of birds');
    expect(names.filter(n => FORMULA_TOOLS.includes(n))).toEqual([]);
  });
});

describe('the formula bank, searched', () => {
  it('by title, by what it is about, within a discipline', async () => {
    const bank = await loadFormulaBank();
    expect(searchBank(bank, 'ideal gas')[0].title).toBe('Ideal Gas Law');
    expect(searchBank(bank, 'pressure').some(r => Object.values(r.meanings).includes('Pressure'))).toBe(true);
    expect(searchBank(bank, '', { discipline: 'Thermodynamics' }).every(r => r.section === 'Thermodynamics' || r.discipline === 'Thermodynamics')).toBe(true);
    expect(findBankEquation(bank, 'Q191785').equation.title).toBe('Ideal Gas Law');
    expect(findBankEquation(bank, "ohm's law").equation.id).toBe('Q41591');
  });
});

describe('the universe\'s equations, searched with the bank', () => {
  const gs = {
    graphs: [web], activeGraphId: 'w',
    universeEquations: [{
      protoId: 'pe', name: 'Ideal Gas Law', text: 'P × V = n × R × T', description: '',
      terms: [{ symbol: 'P', thing: 'Pressure' }, { symbol: 'V', thing: 'Volume' }, { symbol: 'n', thing: 'n' }],
    }],
  };

  it('finds the one here, and not the bank\'s copy of it', async () => {
    const out = await searchFormulaBank({ query: 'ideal gas' }, gs);
    expect(out.results[0]).toMatchObject({ inUniverse: true, title: 'Ideal Gas Law', meanings: { P: 'Pressure', V: 'Volume' } });
    expect(out.results.filter(r => r.title === 'Ideal Gas Law')).toHaveLength(1);
    // By what it is about too, ranked with the bank's by how well each matches.
    expect((await searchFormulaBank({ query: 'pressure', limit: 20 }, gs)).results.some(r => r.inUniverse)).toBe(true);
    // A better match in the bank still comes first.
    expect((await searchFormulaBank({ query: "boyle's law" }, gs)).results[0].title).toBe("Boyle's Law");
  });

  it('places it by its title, though no web shows it as a formula', async () => {
    const out = await formula({ action: 'place', formulaName: 'Ideal Gas Law' }, gs);
    expect(out).toMatchObject({ action: 'placeFormula', equationProtoId: 'pe' });
  });
});

describe('a formula in the snapshot', () => {
  const f = {
    graphId: 'w', groupId: 'g', anchorId: 'anchor', equationProtoId: 'pe', title: 'Ideal Gas Law',
    text: 'P × V = n × R × T', shown: 'formula', memberIds: ['p', 'v'],
    terms: [{ symbol: 'P', thing: 'Pressure', instanceId: 'p' }, { symbol: 'V', thing: 'Volume', instanceId: 'v' }, { symbol: 'n', thing: 'n' }],
  };

  it('reads as one line, its meanings after', () => {
    expect(formulaLine(f)).toBe('Ideal Gas Law: P × V = n × R × T (P = Pressure, V = Volume)');
    expect(formulaLine({ ...f, title: 'P×V=n×R×T' })).toBe('P × V = n × R × T (P = Pressure, V = Volume)');
  });

  it('covers its Things and its own operations, not connections from outside', () => {
    const cover = formulaCover([f]);
    expect(cover.hides('p')).toBe(true);
    expect(cover.internal({ sourceId: 'p', destinationId: 'v' })).toBe(true);
    expect(cover.internal({ sourceId: 'gas', destinationId: 'p' })).toBe(false);
    expect(cover.nameOf('p', 'Pressure')).toBe('Pressure (in Ideal Gas Law)');
    expect(cover.nameOf('anchor', 'x')).toBe('Ideal Gas Law');
  });

  it('is found by title or text', () => {
    const gs = { formulas: [f] };
    expect(findFormulaIn(gs, 'w', 'ideal gas law')).toBe(f);
    expect(findFormulaIn(gs, 'w', 'P×V=n×R×T')).toBe(f);
    expect(findFormulaIn(gs, 'other', 'Ideal Gas Law')).toBeNull();
  });
});

describe('what an ask has made, predicted', () => {
  it('a new formula is there for the rest of the ask: its title, its terms, the formula', () => {
    const gs = { graphs: [{ id: 'w', name: 'W', instances: [], edgeIds: [], groups: [] }], nodePrototypes: [], activeGraphId: 'w' };
    const read = readFormulaText('P * V = n * R * T', { meanings: [{ symbol: 'P', thing: 'Pressure' }] });
    predictFormula(gs, { action: 'addFormula', graphId: 'w', title: 'Ideal Gas Law', canonicalText: read.text, terms: read.terms });
    const names = gs.graphs[0].instances.map(i => i.name);
    expect(names).toEqual(expect.arrayContaining(['Ideal Gas Law', 'Pressure', 'V']));
    expect(gs.formulas[0]).toMatchObject({ title: 'Ideal Gas Law', text: 'P × V = n × R × T', shown: 'formula' });

    predictFormula(gs, { action: 'foldFormula', graphId: 'w', formulaName: 'Ideal Gas Law' });
    expect(gs.formulas[0].shown).toBe('folded');
    expect(gs.graphs[0].instances.map(i => i.name)).toEqual(['Ideal Gas Law']);

    // Its operations are connections of the web too; deleted, they go with it.
    const [anchor] = gs.graphs[0].instances;
    const outside = { id: 'gas', prototypeId: 'p-gas', name: 'Gas' };
    gs.graphs[0].instances.push(outside);
    gs.edges = [{ id: 'e1', sourceId: 'gas', destinationId: anchor.id }, { id: 'e2', sourceId: 'gas', destinationId: 'gas' }];
    gs.graphs[0].edgeIds = ['e1', 'e2'];
    predictFormula(gs, { action: 'deleteFormula', graphId: 'w', formulaName: 'Ideal Gas Law' });
    expect(gs.formulas).toEqual([]);
    expect(gs.graphs[0].instances).toEqual([outside]);
    expect(gs.graphs[0].edgeIds).toEqual(['e2']);
    expect(gs.edges.map(e => e.id)).toEqual(['e2']);
  });
});
