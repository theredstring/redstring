import { resolveGraphId } from './resolveGraphId.js';
import { readFormulaText } from './utils/formulas.js';
import { resolvePaletteColor } from '../../ai/palettes.js';

/**
 * addFormula - Write a formula into a web, shown as its formula, or build one
 * from the formula bank fully formed.
 *
 * A formula is an equation's Thing (its title, or its text untitled) whose
 * web is the formula's own Things: each symbol a Thing, each operation a
 * connection, each part in parentheses a Thing-group
 * (formats/formula/buildFormula.js). `meanings` ties a symbol to the Thing it
 * stands for, one the universe has (by name) or a new one, so P in the Ideal
 * Gas Law is Pressure, the same Pressure everywhere. A symbol given no
 * meaning is a bare symbol, one per formula.
 *
 * The text is read here as the canvas will read it, so a formula it can't
 * build is refused before anything is written. The store side
 * (toolResultApplier: 'addFormula') builds it, by name. `color` (from
 * `palette`) is the equation's, a meaning's `color` its new Thing's; without,
 * what is made new takes the web's colors (formats/formula/webColors.js).
 */
export async function addFormula(args, graphState) {
  const { text, bankId, title, description, meanings, forThing, convention, targetGraphId, color, palette } = args || {};
  const { graphs = [], nodePrototypes = [], activeGraphId } = graphState || {};
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;
  if (!graphId) throw new Error('No web to add the formula to. Create or open one first.');
  // Only what was asked for: resolvePaletteColor makes up a color for nothing.
  const colorOf = (c) => (c ? resolvePaletteColor(palette, String(c)) : '');

  if (bankId) {
    let bank;
    try {
      const { loadFormulaBank } = await import('../../components/canvas/formats/formula/bank/formulaBank.js');
      bank = await loadFormulaBank();
    } catch {
      throw new Error('The formula bank could not be loaded here. Write the formula as text instead.');
    }
    const { findBankEquation, describeBankEquation } = await import('../../components/canvas/formats/formula/bank/searchBank.js');
    const found = findBankEquation(bank, bankId);
    if (!found) throw new Error(`No equation "${bankId}" in the formula bank. Use searchFormulaBank to find its bankId, or write it as text.`);
    const entry = describeBankEquation(bank, found.discipline, found.equation);
    return {
      action: 'addFormula',
      graphId,
      bankId: entry.bankId,
      title: entry.title,
      text: entry.formula,
      canonicalText: entry.formula,
      color: colorOf(color),
      terms: Object.entries(entry.meanings).map(([symbol, thing]) => ({ symbol, thing })),
      created: true,
      summary: `Adds "${entry.title}" (${entry.formula}) from the formula bank, its symbols tied to what they mean, filed under ${entry.section || entry.discipline}.`,
    };
  }

  if (!text || !String(text).trim()) {
    throw new Error('Give the formula as `text` ("F = m * a"), or a `bankId` from searchFormulaBank.');
  }
  const read = readFormulaText(text, {
    meanings,
    knownNames: nodePrototypes.map(p => p.name),
    convention,
  });
  const cleanMeanings = (Array.isArray(meanings) ? meanings : [])
    .filter(m => m?.symbol && m?.thing)
    .map(m => ({
      symbol: String(m.symbol).trim(), thing: String(m.thing).trim(),
      ...(m.description ? { description: String(m.description) } : {}),
      ...(m.color ? { color: colorOf(m.color) } : {}),
    }));
  // Titled as one of its own symbols' Things (K for Kinetic Energy, titled
  // Kinetic Energy), the equation would be a second Thing of that name.
  let name = String(title || forThing || '').trim();
  const renamed = !forThing && name && cleanMeanings.some(m => m.thing.toLowerCase() === name.toLowerCase());
  if (renamed) name = `${name} Formula`;
  return {
    action: 'addFormula',
    graphId,
    text: String(text),
    canonicalText: read.text,
    title: name,
    description: description ? String(description) : '',
    meanings: cleanMeanings,
    forThing: forThing ? String(forThing).trim() : '',
    convention: convention === 'programming' ? 'programming' : 'math',
    color: colorOf(color),
    terms: read.terms,
    created: true,
    summary: `Adds ${name ? `"${name}": ` : ''}${read.text}${cleanMeanings.length ? `, with ${cleanMeanings.map(m => `${m.symbol} = ${m.thing}`).join(', ')}` : ''}.`
      + (renamed ? ` Titled "${name}", since "${title}" is what one of its symbols stands for.` : ''),
  };
}
