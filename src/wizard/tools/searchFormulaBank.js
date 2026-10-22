/**
 * searchFormulaBank - Find well-known equations in the formula bank (from
 * Wikidata and MathModDB, by discipline): by title, topic, or what they are
 * about. Read-only. Each comes with its bankId for addFormula, its formula,
 * and what each of its symbols means.
 */
export async function searchFormulaBank(args) {
  const { query = '', discipline = '', limit } = args || {};
  if (!String(query).trim() && !String(discipline).trim()) {
    throw new Error('Give a `query` (a title like "ideal gas", or a topic like "pressure"), or a `discipline`.');
  }
  let bank;
  try {
    const { loadFormulaBank } = await import('../../components/canvas/formats/formula/bank/formulaBank.js');
    bank = await loadFormulaBank();
  } catch {
    throw new Error('The formula bank could not be loaded here. Write the formula as text with addFormula instead.');
  }
  const { searchBank } = await import('../../components/canvas/formats/formula/bank/searchBank.js');
  const n = Math.max(1, Math.min(20, Number(limit) || 8));
  const results = searchBank(bank, query, { discipline, limit: n });
  return {
    query,
    ...(discipline ? { discipline } : {}),
    count: results.length,
    results,
    note: results.length
      ? 'Add one with addFormula({ bankId }). Its symbols come tied to what they mean.'
      : `Nothing in the bank for "${query}". Disciplines: ${bank.disciplines.map(d => d.name).join(', ')}. Or write the formula as text with addFormula.`,
  };
}
