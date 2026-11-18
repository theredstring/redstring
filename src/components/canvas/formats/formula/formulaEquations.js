/**
 * The equations a Thing is part of, across the universe: every group shown as
 * a formula whose formula has a token standing for the Thing ("P in Ideal Gas
 * Law"). Read for the panel's Equations section.
 */
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { readFormulaGroup, tokensOf, isSymbolText } from './formulaChain.js';

let last = null;

const isNumberText = (text) => /^\d+(\.\d+)?$/.test(text) || text === '∞';

/** The Things a formula is written with, in reading order, parts' insides included. */
function thingsOf(chain, out = []) {
  for (const item of chain.items) {
    if (item.kind === 'thing') {
      if (item.protoId && item.instanceId && !isNumberText(item.name)) out.push(item);
    } else if (item.kind === 'part') {
      item.args?.forEach(arg => thingsOf(arg, out));
    }
  }
  return out;
}

/** Every formula in the universe: [{ key, graphId, groupId, equationProtoId, title, tokens }]. */
function allFormulas(state) {
  if (last && last.graphs === state.graphs && last.protos === state.nodePrototypes && last.edges === state.edges) {
    return last.formulas;
  }
  const formulas = [];
  state.graphs.forEach((graph, graphId) => {
    let shown = false;
    graph.groups?.forEach((g) => { if (g.format === 'formula') shown = true; });
    // Opened in place, the format is on the anchor (as formulaSnapshot reads it).
    if (!shown) graph.instances?.forEach((inst) => { if (inst.format === 'formula') shown = true; });
    if (!shown) return;
    const view = projectGraphView(state, graphId);
    view?.groups?.forEach((group) => {
      if (group.format !== 'formula') return;
      const chain = readFormulaGroup(state, view, group);
      if (!chain) return;
      const equationProto = group.linkedNodePrototypeId ? state.nodePrototypes.get(group.linkedNodePrototypeId) : null;
      formulas.push({
        key: `${graphId}:${group.id}`,
        graphId,
        groupId: group.id,
        equationProtoId: equationProto?.id || null,
        title: equationProto?.name || group.name || '',
        tokens: tokensOf(chain, { standard: true }),
        things: thingsOf(chain),
      });
    });
  });
  last = { graphs: state.graphs, protos: state.nodePrototypes, edges: state.edges, formulas, byProto: new Map(), symbols: new Map() };
  return formulas;
}

const NONE = Object.freeze([]);

/**
 * The equations a Thing appears in, once each (an equation placed in two webs
 * is one equation): [{ key, graphId, groupId, equationProtoId, title, symbol, tokens }].
 * The same array comes back until something it was read from changes.
 */
export function equationsOf(state, protoId) {
  if (!protoId) return NONE;
  const formulas = allFormulas(state);
  if (last.byProto.has(protoId)) return last.byProto.get(protoId);
  const rows = [];
  const seen = new Set();
  for (const f of formulas) {
    if (f.equationProtoId === protoId) continue; // the equation itself
    const token = f.tokens.find(t => t.protoId === protoId);
    if (!token) continue;
    const once = f.equationProtoId || f.key;
    if (seen.has(once)) continue;
    seen.add(once);
    rows.push({ ...f, symbol: token.text });
  }
  const result = rows.length ? rows : NONE;
  last.byProto.set(protoId, result);
  return result;
}

/**
 * A Thing that is only its letter: made for a symbol of an equation (P) and
 * never told what it stands for. No label, description, definition or link.
 */
export const isBareSymbol = (proto) => !!proto
  && isSymbolText(String(proto.name || ''))
  && !proto.labels?.formula
  && !String(proto.description || '').trim()
  && !proto.definitionGraphIds?.length
  && !proto.externalLinks?.length;

/**
 * An equation's symbols, each Thing it is written with once per symbol, in reading order:
 * [{ key, symbol, protoId, bare, graphId, instanceIds }]. `graphId` is the web
 * the formula was read in and `instanceIds` its instances there, for tying a
 * symbol to another Thing (tieSymbol). The same array comes back until
 * something it was read from changes.
 */
export function symbolsOf(state, equationProtoId) {
  if (!equationProtoId) return NONE;
  const formulas = allFormulas(state);
  if (last.symbols.has(equationProtoId)) return last.symbols.get(equationProtoId);
  const formula = formulas.find(f => f.equationProtoId === equationProtoId);
  // One row per symbol of a Thing: q₁ and q₂, both Electric Charge, are two.
  const byProto = new Map();
  for (const term of formula?.things || []) {
    const key = `${term.protoId}|${term.name}`;
    const row = byProto.get(key);
    if (row) { row.instanceIds.push(term.instanceId); continue; }
    byProto.set(key, {
      key,
      symbol: term.name,
      protoId: term.protoId,
      bare: isBareSymbol(state.nodePrototypes.get(term.protoId)),
      graphId: formula.graphId,
      instanceIds: [term.instanceId],
    });
  }
  const result = byProto.size ? [...byProto.values()] : NONE;
  last.symbols.set(equationProtoId, result);
  return result;
}
