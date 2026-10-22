/**
 * The wizard's hands on formulas (src/wizard/tools: addFormula, formula,
 * searchFormulaBank), through the same builders New Formula and the group
 * panel use: buildFormula.js, condenseFormula.js, deleteFormula.js, and the
 * canvas's own open in place (actions/expandInPlace.js).
 *
 * Read: formulasForWizard(state) is every formula the webs show, as its text
 * and what each symbol in it stands for, for the snapshot the wizard reads
 * (graphState.formulas). Without it the wizard sees a formula as a row of
 * small Things joined by Multiplication and Exponentiation.
 *
 * Write: by name, against the live store. The ids the wizard has for what it
 * made this ask are its own predictions and never match (MEMORY: resolve by
 * name, the last match), so an equation is found by its title or its text, a
 * symbol's meaning by the Thing's name.
 */
import useGraphStore from '../../../../store/graphStore.js';
import { projectGraphView, anchorIdFromOpenGroupId } from '../../../../core/openDefinitions.js';
import { getNodeDimensions } from '../../../../utils.js';
import { readFormulaGroup, chainText } from './formulaChain.js';
import { buildFormulaInWeb, buildBankEquation, rewriteFormulaInWeb } from './buildFormula.js';
import { condenseFormula } from './condenseFormula.js';
import { deleteFormula } from './deleteFormula.js';
import { loadFormulaBank } from './bank/formulaBank.js';
import { expandNodeInPlace } from '../../actions/expandInPlace.js';

// Names match whole, any case or spacing: Greek and symbols too (θ, ρ).
const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// A web this large is not one formula: not read as one (formatCandidates' bound).
const MAX_EQUATION_WEB = 200;
// Below what the web has already, this far.
const BELOW = 600;

const compact = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();

/** Every term of a chain, once per symbol: { symbol, thing, instanceId, protoId }. */
function termsOf(chain, out = [], seen = new Set()) {
  for (const item of chain.items) {
    if (item.kind === 'thing') {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      out.push({ symbol: item.name, thing: item.realName, instanceId: item.instanceId, protoId: item.protoId });
    } else if (item.kind === 'part') {
      item.args.forEach(arg => termsOf(arg, out, seen));
    }
  }
  return out;
}

/** The first definition of a Thing that reads as a formula: { index, text, chain }, or null. */
export function equationOf(state, proto) {
  const ids = proto?.definitionGraphIds || [];
  for (let index = 0; index < ids.length; index++) {
    const def = state.graphs.get(ids[index]);
    if (!def?.instances?.size || def.instances.size > MAX_EQUATION_WEB) continue;
    const view = projectGraphView(state, ids[index]);
    if (!view) continue;
    const chain = readFormulaGroup(state, view, { id: '__web__', memberInstanceIds: [...view.instances.keys()] });
    if (chain) return { index, text: chainText(chain), chain };
  }
  return null;
}

let last = null;

/**
 * Every formula shown in a web, and every equation's Thing they are of.
 *   formulas: [{ graphId, groupId, anchorId, equationProtoId, title, text,
 *                shown: 'formula' | 'open' | 'folded', terms, memberIds }]
 *     'formula': a Thing-group of the web shown as its formula; 'open': its
 *     Thing opened in place, shown as its formula; 'folded': its Thing closed,
 *     opening as its formula. memberIds: what the formula is drawn over.
 *   equations: [{ protoId, name, text }]
 * The same answer comes back until the store changes.
 */
export function formulasForWizard(state) {
  if (last && last.graphs === state.graphs && last.protos === state.nodePrototypes && last.edges === state.edges) {
    return last.result;
  }
  const formulas = [];
  const equations = new Map();
  state.graphs.forEach((graph, graphId) => {
    let shows = false;
    graph.groups?.forEach((g) => { if (g.format === 'formula') shows = true; });
    if (!shows) graph.instances?.forEach((inst) => { if (inst.format === 'formula') shows = true; });
    if (!shows) return;
    const view = projectGraphView(state, graphId);
    if (!view) return;
    view.groups?.forEach((group) => {
      if (group.format !== 'formula') return;
      const chain = readFormulaGroup(state, view, group);
      if (!chain) return;
      const openAnchor = anchorIdFromOpenGroupId(group.id);
      const proto = group.linkedNodePrototypeId ? state.nodePrototypes.get(group.linkedNodePrototypeId) : null;
      const text = chainText(chain);
      formulas.push({
        graphId,
        groupId: group.id,
        anchorId: openAnchor || group.anchorInstanceId || null,
        equationProtoId: proto?.id || null,
        title: proto?.name || group.name || text,
        text,
        shown: openAnchor ? 'open' : 'formula',
        terms: termsOf(chain),
        memberIds: [...(group.memberInstanceIds || [])],
      });
      if (proto) equations.set(proto.id, { protoId: proto.id, name: proto.name, text });
    });
    graph.instances?.forEach((inst) => {
      if (inst.format !== 'formula' || inst.openDefinition) return;
      const proto = state.nodePrototypes.get(inst.prototypeId);
      const eq = proto ? equationOf(state, proto) : null;
      if (!eq) return;
      formulas.push({
        graphId, groupId: null, anchorId: inst.id, equationProtoId: proto.id, title: proto.name,
        text: eq.text, shown: 'folded', terms: termsOf(eq.chain), memberIds: [],
      });
      equations.set(proto.id, { protoId: proto.id, name: proto.name, text: eq.text });
    });
  });
  const result = { formulas, equations: [...equations.values()] };
  last = { graphs: state.graphs, protos: state.nodePrototypes, edges: state.edges, result };
  return result;
}

/**
 * A formula of the web by what the wizard calls it: its group or node id, its
 * title, or its text. The last match, as the wizard's names are resolved.
 */
export function findFormula(state, graphId, ref) {
  const inWeb = formulasForWizard(state).formulas.filter(f => f.graphId === graphId);
  if (!ref) return inWeb.length === 1 ? inWeb[0] : null;
  const byId = inWeb.find(f => f.groupId === ref || f.anchorId === ref || f.equationProtoId === ref);
  if (byId) return byId;
  const key = normalizeName(ref);
  const named = inWeb.filter(f => normalizeName(f.title) === key || compact(f.text) === compact(ref));
  if (named.length) return named[named.length - 1];
  const near = inWeb.filter(f => normalizeName(f.title).includes(key) || key.includes(normalizeName(f.title)));
  return near.length ? near[near.length - 1] : null;
}

/** An equation's Thing anywhere in the universe, by id or name (the last match). */
export function findEquationThing(state, ref) {
  if (!ref) return null;
  const byId = state.nodePrototypes.get(ref);
  if (byId && equationOf(state, byId)) return byId;
  const key = normalizeName(ref);
  let found = null;
  for (const e of formulasForWizard(state).equations) {
    if (normalizeName(e.name) === key || compact(e.text) === compact(ref)) found = state.nodePrototypes.get(e.protoId) || found;
  }
  if (found) return found;
  for (const p of state.nodePrototypes.values()) {
    if (!p.isOrbitCatalog && normalizeName(p.name) === key && equationOf(state, p)) found = p;
  }
  return found;
}

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

/** Where the next thing goes: under what the web has (`centre`: a middle; else a top-left corner). */
export function spotBelow(state, graphId, { centre = true } = {}) {
  const graph = state.graphs.get(graphId);
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const inst of graph?.instances?.values() || []) {
    if (!Number.isFinite(inst.x) || !Number.isFinite(inst.y)) continue;
    let w = 200, h = 100;
    try {
      const dims = getNodeDimensions({ name: state.nodePrototypes.get(inst.prototypeId)?.name || '' }, false, null);
      w = dims.currentWidth; h = dims.currentHeight;
    } catch { /* no text measuring here: the estimate stands */ }
    minX = Math.min(minX, inst.x); maxX = Math.max(maxX, inst.x + w); maxY = Math.max(maxY, inst.y + h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  const x = (minX + maxX) / 2;
  const y = maxY + BELOW;
  return centre ? { x, y } : { x: x - 100, y };
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

/** Build a bank equation into a web, fully formed. `ref`: its bank id (Q191785), or its title. */
export async function addBankFormulaForWizard({ graphId, ref }) {
  const bank = await loadFormulaBank();
  const found = findBankEquation(bank, ref);
  if (!found) throw new Error(`No equation "${ref}" in the formula bank`);
  const state = useGraphStore.getState();
  if (!state.graphs.get(graphId)) throw new Error('No web to add the formula to');
  return buildBankEquation(found.discipline, found.equation, graphId, spotBelow(state, graphId));
}

/** A bank entry by id, or by title (exact, else the closest). */
export function findBankEquation(bank, ref) {
  if (!bank || !ref) return null;
  const all = bank.equations || [];
  const byId = all.find(({ equation }) => equation.id === ref);
  if (byId) return byId;
  const key = normalizeName(ref);
  return all.find(({ equation }) => normalizeName(equation.title) === key)
    || all.find(({ equation }) => normalizeName(equation.title).includes(key))
    || null;
}

/**
 * Place an equation's Thing in a web, shown as its formula: open in place
 * (as the canvas opens a node), or `folded`, a node that opens as its formula.
 * How it shows is the placement's (formulaRoundTrip.test.js), so this one is
 * marked as a formula and no other placement changes.
 */
export function placeEquationForWizard({ graphId, ref, folded = false }) {
  const state = useGraphStore.getState();
  if (!state.graphs.get(graphId)) throw new Error('No web to place the formula in');
  const proto = findEquationThing(state, ref);
  if (!proto) throw new Error(`No formula "${ref}" to place`);
  const eq = equationOf(state, proto);
  const at = spotBelow(state, graphId, { centre: false });
  const instanceId = `formula-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  state.addNodeInstance(graphId, proto.id, at, instanceId);
  useGraphStore.getState().updateNodeInstance(graphId, instanceId, (draft) => { draft.format = 'formula'; });
  if (!folded) expandNodeInPlace({ viewGraphId: graphId, prototypeId: proto.id, definitionIndex: eq?.index ?? 0, instanceId });
  return { instanceId, equationProtoId: proto.id, name: proto.name };
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
