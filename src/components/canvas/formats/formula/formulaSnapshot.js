/**
 * What the wizard reads of the formulas in the universe (formulaWizard.js
 * writes them): every formula a web shows, as its text and what each symbol
 * in it stands for, put in the snapshot the wizard works from
 * (graphState.formulas). Without it the wizard sees a formula as a row of
 * small Things joined by Multiplication and Exponentiation.
 *
 * Pure: reads a store state, writes nothing, so the snapshot builders (the
 * panel's, the headless one) can call it without the canvas.
 */
import { projectGraphView, anchorIdFromOpenGroupId } from '../../../../core/openDefinitions.js';
import { readFormulaGroup, chainText } from './formulaChain.js';

// Names match whole, any case or spacing: Greek and symbols too (θ, ρ).
export const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// A web this large is not one formula: not read as one (formatCandidates' bound).
const MAX_EQUATION_WEB = 200;
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


let lastHere = null;

/**
 * Every equation's Thing in the universe, shown anywhere or not: the ones
 * written here and the bank's added to it (the Formula Starter files those
 * in their sections' webs as plain nodes, so formulasForWizard doesn't see
 * them). For the wizard's searchFormulaBank, which looks here before the bank.
 *   [{ protoId, name, text, description, terms }]
 * The same answer comes back until the store changes.
 */
export function equationsHere(state) {
  if (lastHere && lastHere.graphs === state.graphs && lastHere.protos === state.nodePrototypes && lastHere.edges === state.edges) {
    return lastHere.result;
  }
  const result = [];
  for (const proto of state.nodePrototypes.values()) {
    if (proto.isOrbitCatalog || !proto.definitionGraphIds?.length) continue;
    const eq = equationOf(state, proto);
    if (!eq) continue;
    result.push({
      protoId: proto.id,
      name: proto.name,
      text: eq.text,
      description: proto.description || '',
      terms: termsOf(eq.chain).map(({ symbol, thing }) => ({ symbol, thing })),
    });
  }
  lastHere = { graphs: state.graphs, protos: state.nodePrototypes, edges: state.edges, result };
  return result;
}

/** The formulas part of the wizard's snapshot: formulasForWizard's, and every equation here. */
export function formulaSnapshotForWizard(state) {
  return { ...formulasForWizard(state), universeEquations: equationsHere(state) };
}
