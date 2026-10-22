/**
 * searchFormulaBank - Find equations, this universe's (the ones written here
 * and the bank's already added, graphState.universeEquations) with the
 * well-known ones in the formula bank (from Wikidata and MathModDB, by
 * discipline), best match first, one here winning a tie and standing in for
 * the bank's copy: by title, topic, or what they are about. Read-only. A bank
 * equation comes with its bankId for addFormula; one here is placed by its
 * title with formula. Each comes with its formula and what its symbols mean.
 */
import { universeEquationsOf } from './utils/formulas.js';

/** The universe's equations as a bank searchBank reads: no disciplines, each symbol's Thing its concept. */
function bankOfHere(here) {
  const concepts = {};
  const discipline = { name: '' };
  const equations = here.map((e) => {
    const symbols = {};
    for (const t of e.terms || []) {
      if (!t.thing || t.thing === t.symbol) continue;
      symbols[t.symbol] = t.thing;
      concepts[t.thing] = { name: t.thing };
    }
    return { discipline, equation: { id: e.protoId, title: e.name, text: e.text, description: e.description || '', symbols } };
  });
  return { equations, concepts };
}

const key = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function searchFormulaBank(args, graphState) {
  const { query = '', discipline = '', limit } = args || {};
  if (!String(query).trim() && !String(discipline).trim()) {
    throw new Error('Give a `query` (a title like "ideal gas", or a topic like "pressure"), or a `discipline`.');
  }
  const { scoreBank, describeBankEquation } = await import('../../components/canvas/formats/formula/bank/searchBank.js');
  const n = Math.max(1, Math.min(20, Number(limit) || 8));

  // Here: they have no discipline of their own, so a discipline alone finds none of them.
  const here = universeEquationsOf(graphState);
  const hereBank = bankOfHere(here);
  const inUniverse = String(query).trim()
    ? scoreBank(hereBank, query).map(({ score, discipline: d, equation }) => {
      const { title, formula, description, meanings } = describeBankEquation(hereBank, d, equation);
      return { score, entry: { inUniverse: true, title, formula, ...(description ? { description } : {}), meanings } };
    })
    : [];
  const hereTitles = new Set(here.map(e => key(e.name)));

  let bank = null;
  try {
    const { loadFormulaBank } = await import('../../components/canvas/formats/formula/bank/formulaBank.js');
    bank = await loadFormulaBank();
  } catch {
    if (!inUniverse.length) throw new Error('The formula bank could not be loaded here. Write the formula as text with addFormula instead.');
  }
  // The bank's, less the ones the universe has already (found here instead).
  const fromBank = bank
    ? scoreBank(bank, query, { discipline })
      .filter(({ equation }) => !hereTitles.has(key(equation.title)))
      .slice(0, n)
      .map(({ score, discipline: d, equation }) => ({ score, entry: describeBankEquation(bank, d, equation) }))
    : [];
  // Best match first, from either; on a tie the one here comes first.
  const results = [...inUniverse, ...fromBank]
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .map(r => r.entry);

  const notes = [];
  if (results.some(r => r.inUniverse)) notes.push('inUniverse: this universe has it already; use it with formula({ action: "place", formulaName: <its title> }), not a second copy.');
  if (results.some(r => !r.inUniverse)) notes.push('Add one from the bank with addFormula({ bankId }). Its symbols come tied to what they mean.');
  if (!results.length) {
    notes.push(`Nothing here or in the bank for "${query}".${bank ? ` Disciplines: ${bank.disciplines.map(d => d.name).join(', ')}.` : ''} Or write the formula as text with addFormula.`);
  }
  return {
    query,
    ...(discipline ? { discipline } : {}),
    count: results.length,
    results,
    note: notes.join(' '),
  };
}
