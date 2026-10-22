import { resolveGraphId } from './resolveGraphId.js';
import { findFormulaIn, findEquation, formulasIn, readFormulaText } from './utils/formulas.js';

/**
 * formula - Work with a formula that exists: use it like a Thing in another
 * web, fold it into its Thing or open it again, rewrite it, or delete it.
 *
 *   place    the equation's Thing in this web (from any web), shown as its
 *            formula; `folded` for a node that opens as its formula
 *   open     a folded formula, shown as its formula again
 *   fold     a formula into its Thing (Combine Into Thing)
 *   rewrite  it with new `text`, in place: the same equation, its
 *            connections kept
 *   delete   it from this web (its Things go with it; the equation stays
 *            wherever else it is placed)
 *
 * Found by its title or its text. The store side (toolResultApplier) does
 * each by name: placeFormula, openFormula, foldFormula, rewriteFormula,
 * deleteFormula.
 */
const ACTIONS = new Set(['place', 'open', 'fold', 'rewrite', 'delete']);

const listed = (formulas) => formulas.length
  ? formulas.map(f => `"${f.title}"`).join(', ')
  : '(none)';

export async function formula(args, graphState) {
  const { formulaName, action = 'place', text, title, meanings, folded, convention, targetGraphId } = args || {};
  if (!ACTIONS.has(action)) throw new Error(`Unknown formula action "${action}". Use place, open, fold, rewrite or delete.`);
  const { graphs = [], nodePrototypes = [], activeGraphId } = graphState || {};
  const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;
  if (!graphId) throw new Error('No web to work in. Create or open one first.');

  if (action === 'place') {
    const eq = findEquation(graphState, formulaName);
    if (!eq) {
      const all = [...new Set([...(graphState?.equations || []).map(e => e.name), ...(graphState?.formulas || []).map(f => f.title)])];
      throw new Error(`No formula "${formulaName}" in this universe. Formulas: ${all.length ? all.map(n => `"${n}"`).join(', ') : '(none)'}. Write a new one with addFormula.`);
    }
    return {
      action: 'placeFormula',
      graphId,
      formulaName: eq.name,
      equationProtoId: eq.protoId,
      text: eq.text,
      folded: !!folded,
      summary: `Places "${eq.name}" (${eq.text}) here${folded ? ', folded into its Thing' : ', shown as its formula'}.`,
    };
  }

  const f = findFormulaIn(graphState, graphId, formulaName);
  if (!f) {
    throw new Error(`No formula "${formulaName}" in this web. Formulas here: ${listed(formulasIn(graphState, graphId))}. To use one from another web here, use action "place".`);
  }

  if (action === 'open') {
    if (f.shown !== 'folded') return { graphId, formulaName: f.title, note: `"${f.title}" is shown as its formula already.` };
    return { action: 'openFormula', graphId, formulaName: f.title, summary: `Opens "${f.title}" as its formula.` };
  }
  if (action === 'fold') {
    if (f.shown === 'folded') return { graphId, formulaName: f.title, note: `"${f.title}" is folded already.` };
    return { action: 'foldFormula', graphId, formulaName: f.title, summary: `Folds "${f.title}" into its Thing.` };
  }
  if (action === 'delete') {
    return {
      action: 'deleteFormula',
      graphId,
      formulaName: f.title,
      name: f.title,
      summary: f.shown === 'formula'
        ? `Deletes "${f.title}" from this web, with its Things.`
        : `Removes this placement of "${f.title}"; the equation stays wherever else it is.`,
    };
  }

  // rewrite
  if (!text || !String(text).trim()) throw new Error('Give the new formula as `text` to rewrite it.');
  const read = readFormulaText(text, { meanings, knownNames: nodePrototypes.map(p => p.name), convention });
  return {
    action: 'rewriteFormula',
    graphId,
    formulaName: f.title,
    text: String(text),
    canonicalText: read.text,
    title: title ? String(title).trim() : '',
    meanings: (Array.isArray(meanings) ? meanings : []).filter(m => m?.symbol && m?.thing)
      .map(m => ({ symbol: String(m.symbol).trim(), thing: String(m.thing).trim() })),
    convention: convention === 'programming' ? 'programming' : 'math',
    terms: read.terms,
    summary: `Rewrites "${f.title}" as ${read.text}.`,
  };
}
