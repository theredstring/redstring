/**
 * The equations a Thing is part of, across the universe: every group shown as
 * a formula whose formula has a token standing for the Thing ("P in Ideal Gas
 * Law"). Read for the panel's Equations section.
 */
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { readFormulaGroup, tokensOf } from './formulaChain.js';

let last = null;

/** Every formula in the universe: [{ key, graphId, groupId, equationProtoId, title, tokens }]. */
function allFormulas(state) {
  if (last && last.graphs === state.graphs && last.protos === state.nodePrototypes && last.edges === state.edges) {
    return last.formulas;
  }
  const formulas = [];
  state.graphs.forEach((graph, graphId) => {
    let shown = false;
    graph.groups?.forEach((g) => { if (g.format === 'formula') shown = true; });
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
      });
    });
  });
  last = { graphs: state.graphs, protos: state.nodePrototypes, edges: state.edges, formulas, byProto: new Map() };
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
