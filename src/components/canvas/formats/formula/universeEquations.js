/**
 * The equations this universe has, shaped as the bank is ({ disciplines,
 * equations, concepts }), for New Formula's box (FormulaBankPicker): its
 * disciplines and sections browsed as before, holding only what is here.
 * Nothing from the bank is offered until it is added (bank/formulaStarter.js,
 * the wizard, an equation placed before); the formulas written here, by hand
 * or by the wizard, are a discipline of their own, Yours.
 *
 * Each entry is the bank's (its text, symbols, description) with the Thing it
 * is here, `protoId`: picking one places that Thing (formulaWizard's
 * placeEquation), the same equation, not a copy of it.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import useGraphStore from '../../../../store/graphStore.js';
import { canonicalizeLink, LINK_STATES } from '../../../../formats/linkState.js';
import { loadFormulaBank, formulaBankNow, subscribeFormulaBank, equationOrigin, BANK_AGENT } from './bank/formulaBank.js';
import { formulasForWizard, equationOf } from './formulaSnapshot.js';

export const YOURS = '__yours__';

/** The bank's equations here: entry id → the Thing it is, found as the builder finds it. */
function bankEquationsHere(state, bank) {
  const byOrigin = new Map();
  const byLink = new Map();
  for (const p of state.nodePrototypes.values()) {
    const prov = p.semanticMetadata?.provenance;
    if (prov?.wasAttributedTo === BANK_AGENT && typeof prov.source === 'string') byOrigin.set(prov.source, p);
    for (const link of p.externalLinks || []) {
      const key = canonicalizeLink(link);
      if (p.semanticMetadata?.linkConfirmations?.[key]?.state === LINK_STATES.EXACT) byLink.set(key, p);
    }
  }
  const here = new Map();
  for (const { equation } of bank.equations) {
    // Made from this entry: its own. Only linked to the same item: its own once it reads as the formula.
    const made = byOrigin.get(equationOrigin(equation.id));
    const linked = !made && !equation.defines && equation.source ? byLink.get(canonicalizeLink(equation.source)) : null;
    const thing = made || (linked && equationOf(state, linked) ? linked : null);
    if (thing?.definitionGraphIds?.length) here.set(equation.id, thing.id);
  }
  return here;
}

/** The universe's equations, bank-shaped. */
export function universeEquations(state, bank) {
  const here = bank ? bankEquationsHere(state, bank) : new Map();
  const disciplines = [];
  for (const d of bank?.disciplines || []) {
    const equations = d.equations.filter(e => here.has(e.id)).map(e => ({ ...e, protoId: here.get(e.id) }));
    if (!equations.length) continue;
    const bySection = new Map();
    for (const e of equations) if (e.sectionId) bySection.set(e.sectionId, (bySection.get(e.sectionId) || 0) + 1);
    disciplines.push({
      ...d,
      equations,
      sections: (d.sections || []).filter(x => bySection.has(x.id)).map(x => ({ ...x, equations: bySection.get(x.id), missing: 0 })),
    });
  }

  // Written here: every equation shown somewhere that the bank didn't make.
  const fromBank = new Set(here.values());
  const yours = [];
  for (const eq of formulasForWizard(state).equations) {
    if (fromBank.has(eq.protoId)) continue;
    const proto = state.nodePrototypes.get(eq.protoId);
    const shown = formulasForWizard(state).formulas.find(f => f.equationProtoId === eq.protoId);
    yours.push({
      id: eq.protoId,
      protoId: eq.protoId,
      title: eq.name,
      text: eq.text,
      description: proto?.description || '',
      symbols: {},
      // Read back as it reads here: each of its symbols one name.
      placeHolders: (shown?.terms || []).map(t => t.symbol),
    });
  }
  if (yours.length) {
    disciplines.push({ id: YOURS, name: 'Yours', description: 'Equations written in this universe.', sections: [], equations: yours });
  }

  return Object.freeze({
    source: bank?.source,
    fetchedAt: bank?.fetchedAt,
    from: 'universe',
    disciplines,
    equations: disciplines.flatMap(discipline => discipline.equations.map(equation => ({ discipline, equation }))),
    concepts: bank?.concepts || {},
  });
}

/** The universe's equations, kept current with the store and the bank; null while the bank loads. */
export function useUniverseEquations() {
  const bank = useSyncExternalStore(subscribeFormulaBank, formulaBankNow);
  const graphs = useGraphStore(s => s.graphs);
  const nodePrototypes = useGraphStore(s => s.nodePrototypes);
  const edges = useGraphStore(s => s.edges);
  useEffect(() => { loadFormulaBank(); }, []);
  return useMemo(
    () => (bank ? universeEquations({ graphs, nodePrototypes, edges }, bank) : null),
    [bank, graphs, nodePrototypes, edges],
  );
}
