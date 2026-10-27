/**
 * The formula bank searched by what is asked for: a title (ideal gas), a
 * discipline or section (thermodynamics), or what an equation is about, a
 * concept one of its symbols stands for (pressure). For the wizard's
 * searchFormulaBank and its addFormula; New Formula's box matches titles as
 * they are typed (FormulaBankPicker's useBankMatches).
 *
 * Pure: reads the bank formulaBank.js loaded.
 */

const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
const key = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** An entry as the wizard reads it: what it is, its formula, and what each symbol means. */
export function describeBankEquation(bank, discipline, equation) {
  return {
    bankId: equation.id,
    title: equation.title,
    formula: equation.text,
    discipline: discipline.name,
    ...(equation.section ? { section: equation.section } : {}),
    ...(equation.description ? { description: equation.description } : {}),
    meanings: Object.fromEntries(Object.entries(equation.symbols || {})
      .map(([symbol, q]) => [symbol, bank.concepts?.[q]?.name || q])),
  };
}

/**
 * How well each entry matches `query`, best first: [{ score, discipline, equation }].
 * With only a `discipline` (Physics, or a section: Thermodynamics), that one's best known.
 */
export function scoreBank(bank, query, { discipline = '' } = {}) {
  if (!bank) return [];
  const q = key(query);
  const asked = words(query);
  const within = key(discipline);
  const scored = [];
  bank.equations.forEach(({ discipline: d, equation }, order) => {
    const section = key(equation.section);
    if (within && !key(d.name).includes(within) && !section.includes(within)) return;
    const title = key(equation.title);
    const concepts = Object.values(equation.symbols || {}).map(c => key(bank.concepts?.[c]?.name)).filter(Boolean);
    const description = key(equation.description);
    let score = 0;
    if (q && title === q) score += 100;
    else if (q && (title.includes(q) || q.includes(title))) score += 40;
    for (const w of asked) {
      if (title.includes(w)) score += 10;
      if (section.includes(w)) score += 4;
      if (key(d.name).includes(w)) score += 3;
      if (concepts.some(c => c.includes(w))) score += 5;
      if (description.includes(w)) score += 1;
    }
    if (score > 0 || (!asked.length && within)) scored.push({ score, order, discipline: d, equation });
  });
  // Ties keep the bank's order: best known first.
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ score, discipline: d, equation }) => ({ score, discipline: d, equation }));
}

/**
 * The entries best matching `query`, best first (scoreBank's order).
 * @returns {Array} describeBankEquation's, at most `limit`
 */
export function searchBank(bank, query, { discipline = '', limit = 8 } = {}) {
  return scoreBank(bank, query, { discipline }).slice(0, limit)
    .map(({ discipline: d, equation }) => describeBankEquation(bank, d, equation));
}

/** A bank entry by id (Q191785), or by title (exact, else the closest): { discipline, equation }, or null. */
export function findBankEquation(bank, ref) {
  if (!bank || !ref) return null;
  const all = bank.equations || [];
  const byId = all.find(({ equation }) => equation.id === ref);
  if (byId) return byId;
  const k = key(ref);
  return all.find(({ equation }) => key(equation.title) === k)
    || all.find(({ equation }) => key(equation.title).includes(k))
    || null;
}
