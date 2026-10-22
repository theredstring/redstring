/**
 * The wizard's hands on formulas (src/wizard/tools: addFormula, formula,
 * searchFormulaBank), through the same builders New Formula and the group
 * panel use: buildFormula.js, condenseFormula.js, deleteFormula.js, and the
 * canvas's own open in place (actions/expandInPlace.js).
 *
 * What it reads of them is formulaSnapshot.js. What it does is here, by
 * name, against the live store: the ids the wizard has for what it made this
 * ask are its own predictions and never match (MEMORY: resolve by name, the
 * last match), so an equation is found by its title or its text, a symbol's
 * meaning by the Thing's name.
 */
import useGraphStore from '../../../../store/graphStore.js';
import { spotBelow } from './formulaPlacement.js';
import { findFormula, findEquationThing, equationOf, normalizeName } from './formulaSnapshot.js';
import { buildFormulaInWeb, buildBankEquation, rewriteFormulaInWeb, bankEquationThing } from './buildFormula.js';
import { markFormulaSpawn } from './formulaSpawn.js';
import { condenseFormula } from './condenseFormula.js';
import { deleteFormula } from './deleteFormula.js';
import { loadFormulaBank, formulaBankNow } from './bank/formulaBank.js';
import { findBankEquation } from './bank/searchBank.js';
import { expandNodeInPlace } from '../../actions/expandInPlace.js';

/** A Thing by name, the web's own first, the last match (MEMORY: never the first). */
function thingNamed(state, graphId, name) {
  const key = normalizeName(name);
  if (!key) return null;
  let found = null;
  for (const inst of state.graphs.get(graphId)?.instances?.values() || []) {
    const p = state.nodePrototypes.get(inst.prototypeId);
    if (p && normalizeName(p.name) === key) found = p;
  }
  if (found) return found;
  for (const p of state.nodePrototypes.values()) {
    if (!p.isOrbitCatalog && normalizeName(p.name) === key) found = p;
  }
  return found;
}

/**
 * What each symbol means, as the builder's bindings: a Thing the universe has
 * by that name, else a new one named for it. A meaning that is just the
 * symbol again ("x" is "x") leaves it a bare symbol.
 */
export function bindingsFor(state, graphId, meanings = []) {
  const bindings = {};
  for (const m of Array.isArray(meanings) ? meanings : []) {
    const symbol = String(m?.symbol || '').trim();
    const thing = String(m?.thing || '').trim();
    if (!symbol || !thing || thing === symbol) continue;
    const own = thingNamed(state, graphId, thing);
    bindings[symbol] = own
      ? { protoId: own.id, label: symbol }
      : { name: thing, label: symbol, description: String(m?.description || '') };
  }
  return bindings;
}

/** How text is read: the symbols given meanings, and every name the universe has, kept whole. */
function readOptionsFor(state, bindings, convention = 'math') {
  const known = new Set(Object.keys(bindings));
  for (const p of state.nodePrototypes.values()) {
    if (p.isOrbitCatalog) continue;
    if (p.name) known.add(String(p.name).trim());
    if (p.labels?.formula) known.add(String(p.labels.formula).trim());
  }
  return { convention: convention === 'programming' ? 'programming' : 'math', isKnownName: (n) => known.has(n) };
}

/**
 * Write a formula into a web. `forThing`: a Thing the universe has whose
 * formula this is (the Ideal Gas Law already on the canvas). Returns what
 * buildFormulaInWeb does.
 */
export function addFormulaForWizard({ graphId, text, title = '', description = '', meanings = [], forThing = '', convention = 'math' }) {
  const state = useGraphStore.getState();
  if (!state.graphs.get(graphId)) throw new Error('No web to add the formula to');
  const bindings = bindingsFor(state, graphId, meanings);
  const holder = forThing ? thingNamed(state, graphId, forThing) : null;
  return buildFormulaInWeb(text, graphId, spotBelow(state, graphId), readOptionsFor(state, bindings, convention), {
    title: title || holder?.name || '',
    description,
    bindings,
    ...(holder ? { protoId: holder.id } : {}),
  });
}

/**
 * Build a bank equation into a web, fully formed. `ref`: its bank id
 * (Q191785), or its title. At once when the bank is loaded already (the
 * wizard's tool loaded it to find the entry), so what the wizard does next
 * finds it there.
 */
export function addBankFormulaForWizard({ graphId, ref }) {
  const bank = formulaBankNow();
  if (!bank) return loadFormulaBank().then(() => addBankFormulaForWizard({ graphId, ref }));
  const found = findBankEquation(bank, ref);
  if (!found) throw new Error(`No equation "${ref}" in the formula bank`);
  const state = useGraphStore.getState();
  if (!state.graphs.get(graphId)) throw new Error('No web to add the formula to');
  // The universe has this one already (the starter, an earlier ask): that equation, placed here.
  const thing = bankEquationThing(found.equation);
  if (thing && equationOf(state, thing)) return placeEquation({ graphId, ref: thing.id });
  return buildBankEquation(found.discipline, found.equation, graphId, spotBelow(state, graphId));
}

/**
 * Place an equation's Thing in a web, shown as its formula: open in place,
 * or `folded`, a node that opens as its formula. How it shows is the
 * placement's (formulaRoundTrip.test.js), so this one is marked as a formula
 * and no other placement changes. Placed in the web already (a bank equation
 * is filed in its section's web as a plain node), that node opens, as the
 * canvas opens one; else a new one comes in as a formula just written does.
 * `at`: where its middle goes (New Formula's spot); else under what the web has.
 * For New Formula's box and the wizard.
 */
export function placeEquation({ graphId, ref, folded = false, at = null }) {
  const state = useGraphStore.getState();
  if (!state.graphs.get(graphId)) throw new Error('No web to place the formula in');
  const proto = findEquationThing(state, ref);
  if (!proto) throw new Error(`No formula "${ref}" to place`);
  const index = equationOf(state, proto)?.index ?? 0;
  const placed = [...state.graphs.get(graphId).instances.values()].filter(inst => inst.prototypeId === proto.id && !inst.isGroupAnchor);
  const done = (instanceId) => ({ instanceId, equationProtoId: proto.id, name: proto.name });
  if (placed.some(inst => inst.format === 'formula' && (inst.openDefinition || folded))) {
    return done(placed.find(inst => inst.format === 'formula').id);
  }
  const existing = placed.find(inst => !inst.openDefinition);
  if (existing) {
    state.updateNodeInstance(graphId, existing.id, (draft) => { draft.format = 'formula'; });
    if (!folded) expandNodeInPlace({ viewGraphId: graphId, prototypeId: proto.id, definitionIndex: index, instanceId: existing.id });
    return done(existing.id);
  }

  const instanceId = `formula-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const spot = at ? { x: at.x - 100, y: at.y - 50 } : spotBelow(state, graphId, { centre: false });
  state.addNodeInstance(graphId, proto.id, spot, instanceId);
  const st = useGraphStore.getState();
  st.updateNodeInstance(graphId, instanceId, (draft) => { draft.format = 'formula'; });
  if (folded) return done(instanceId);
  const groupId = st.openDefinitionsInPlace !== false
    ? st.openDefinitionInPlace(graphId, instanceId, index)
    : st.decomposeNodeToGroup(graphId, proto.id, index, instanceId);
  markFormulaSpawn(groupId);
  return done(instanceId);
}

/** Open a folded formula in place, as the canvas does. */
export function openFormulaForWizard({ graphId, ref }) {
  const state = useGraphStore.getState();
  const f = findFormula(state, graphId, ref);
  if (!f) throw new Error(`No formula "${ref}" in this web`);
  if (f.shown !== 'folded') return f;
  const proto = state.nodePrototypes.get(f.equationProtoId);
  const eq = equationOf(state, proto);
  expandNodeInPlace({ viewGraphId: graphId, prototypeId: proto.id, definitionIndex: eq?.index ?? 0, instanceId: f.anchorId });
  return f;
}

/** Fold a formula into its Thing (Combine Into Thing). */
export function foldFormulaForWizard({ graphId, ref }) {
  const f = findFormula(useGraphStore.getState(), graphId, ref);
  if (!f) throw new Error(`No formula "${ref}" in this web`);
  if (f.shown === 'folded') return f;
  condenseFormula(graphId, f.groupId);
  return f;
}

/**
 * Delete a formula from a web. Shown as a Thing-group, it goes with its
 * Things and parts (deleteFormula); a placement of its Thing (open or
 * folded) goes as that one node, the equation kept wherever else it is.
 */
export function deleteFormulaForWizard({ graphId, ref }) {
  const state = useGraphStore.getState();
  const f = findFormula(state, graphId, ref);
  if (!f) throw new Error(`No formula "${ref}" in this web`);
  if (f.shown === 'formula') deleteFormula(graphId, f.groupId);
  else state.removeNodeInstance(graphId, f.anchorId);
  return f;
}

/**
 * Write a formula of the web over again (rewriteFormulaInWeb). A folded or
 * open one is opened as a Thing-group to be rewritten, its definition saved
 * over, and shown as it was again.
 */
export function rewriteFormulaForWizard({ graphId, ref, text, title = '', meanings = [], convention = 'math' }) {
  let state = useGraphStore.getState();
  const f = findFormula(state, graphId, ref);
  if (!f) throw new Error(`No formula "${ref}" in this web`);
  const bindings = bindingsFor(state, graphId, meanings);
  const readOptions = readOptionsFor(state, bindings, convention);
  if (f.shown === 'formula') return rewriteFormulaInWeb(graphId, f.groupId, text, readOptions, { title, bindings });

  // Folded or open: its definition is what is rewritten, through a copy of it here.
  const proto = state.nodePrototypes.get(f.equationProtoId);
  const eq = equationOf(state, proto);
  if (!eq) throw new Error(`"${f.title}" no longer reads as a formula`);
  if (f.shown === 'open') state.closeDefinitionInPlace(graphId, f.anchorId);
  state = useGraphStore.getState();
  const groupId = state.decomposeNodeToGroup(graphId, proto.id, eq.index, f.anchorId);
  if (!groupId) throw new Error(`Could not open "${f.title}" to rewrite it`);
  useGraphStore.getState().updateGroup(graphId, groupId, (draft) => { draft.format = 'formula'; });
  const result = rewriteFormulaInWeb(graphId, groupId, text, readOptions, { title, bindings });
  const nodeId = useGraphStore.getState().collapseNodeGroupIntoDefinition(graphId, groupId);
  if (nodeId && f.shown === 'open') {
    expandNodeInPlace({ viewGraphId: graphId, prototypeId: proto.id, definitionIndex: eq.index, instanceId: nodeId });
  }
  return result;
}
