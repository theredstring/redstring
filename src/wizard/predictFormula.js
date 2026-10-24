/**
 * What the formula tools' results will do, in the wizard's own snapshot
 * (AgentLoop.updateGraphState), so the rest of an ask finds them: the
 * equation's Thing by its title, its terms by what they stand for, the
 * formula itself in graphState.formulas. The store side builds them by name
 * (toolResultApplier), so the ids here are predictions and never reach it.
 */
import { findFormulaIn, findEquation } from './tools/utils/formulas.js';

const newId = (kind) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const key = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const compact = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();

const asArray = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : Object.values(x || {}));

/** The Thing by that name (the last match), else a new one. */
function protoNamed(graphState, name) {
  const protos = graphState.nodePrototypes;
  let found = null;
  for (const p of protos) if (key(p.name) === key(name)) found = p;
  if (found) return found;
  const proto = { id: newId('proto'), name: String(name), color: '', description: '', definitionGraphIds: [] };
  protos.push(proto);
  return proto;
}

/** A formula's terms placed in the web: each symbol's Thing (a bare symbol is its own). */
function placeTerms(graphState, graph, terms = []) {
  return terms.map((t) => {
    const proto = t.thing && t.thing !== t.symbol
      ? protoNamed(graphState, t.thing)
      : (() => {
        const bare = { id: newId('proto'), name: String(t.symbol), color: '', description: '', definitionGraphIds: [] };
        graphState.nodePrototypes.push(bare);
        return bare;
      })();
    const instanceId = newId('inst');
    graph.instances.push({ id: instanceId, prototypeId: proto.id, name: proto.name });
    return { symbol: t.symbol, thing: proto.name, instanceId, protoId: proto.id };
  });
}

/** Take Things out of the web, and the connections touching them (a formula's operations among them). */
function removeFrom(graphState, graph, ids) {
  const gone = new Set(ids.filter(Boolean));
  graph.instances = graph.instances.filter(inst => !gone.has(inst.id));
  const touching = new Set((graphState.edges || [])
    .filter(e => gone.has(e.sourceId) || gone.has(e.destinationId))
    .map(e => e.id));
  if (touching.size) {
    graphState.edges = graphState.edges.filter(e => !touching.has(e.id));
    graph.edgeIds = (graph.edgeIds || []).filter(id => !touching.has(id));
  }
  graph.groups = graph.groups.filter(g => !gone.has(g.anchorInstanceId));
  graph.groups.forEach((g) => {
    if (Array.isArray(g.memberInstanceIds)) g.memberInstanceIds = g.memberInstanceIds.filter(id => !gone.has(id));
  });
}

export function predictFormula(graphState, result) {
  const graph = (graphState.graphs || []).find(g => g.id === (result.graphId || graphState.activeGraphId));
  if (!graph) return;
  graph.instances = asArray(graph.instances);
  graph.groups = asArray(graph.groups);
  graphState.nodePrototypes = graphState.nodePrototypes || [];
  graphState.formulas = graphState.formulas || [];
  graphState.equations = graphState.equations || [];
  const formulas = graphState.formulas;

  if (result.action === 'addFormula') {
    const title = result.title || result.canonicalText;
    const eq = result.forThing
      ? protoNamed(graphState, result.forThing)
      : (() => {
        const proto = { id: newId('proto'), name: title, color: '', description: result.description || '', definitionGraphIds: [] };
        graphState.nodePrototypes.push(proto);
        return proto;
      })();
    // Its web is the formula: it has a definition from now on.
    const definition = { id: newId('graph'), name: eq.name, description: '', instances: [], edgeIds: [], groups: [], definingNodeIds: [eq.id] };
    eq.definitionGraphIds = [...(eq.definitionGraphIds || []), definition.id];
    graphState.graphs.push(definition);
    const index = eq.definitionGraphIds.length - 1;
    const anchorId = newId('inst');
    // Standing here as a plain node, the Thing's formula takes that node's place,
    // its connections and all (buildFormula.js takePlaceOf).
    if (result.forThing) {
      const inFormula = new Set(graph.groups.filter(g => g.format === 'formula').flatMap(g => g.memberInstanceIds || []));
      const standing = graph.instances.filter(inst => inst.prototypeId === eq.id && !inst.isGroupAnchor
        && !inst.openDefinition && !inst.format && !inFormula.has(inst.id)).pop();
      if (standing) {
        for (const e of graphState.edges || []) {
          if (e.sourceId === standing.id) e.sourceId = anchorId;
          if (e.destinationId === standing.id) e.destinationId = anchorId;
        }
        removeFrom(graphState, graph, [standing.id]);
      }
    }
    // Its Thing opened in place, shown as its formula (buildFormula.js openedInPlace):
    // its terms are in its definition, which this web shows without holding.
    graph.instances.push({ id: anchorId, prototypeId: eq.id, name: eq.name, format: 'formula', openDefinition: { index } });
    const terms = placeTerms(graphState, definition, result.terms);
    const memberIds = terms.map(t => t.instanceId);
    formulas.push({ graphId: graph.id, groupId: `open:${anchorId}`, anchorId, equationProtoId: eq.id, title: eq.name, text: result.canonicalText, shown: 'open', terms, memberIds });
    graphState.equations.push({ protoId: eq.id, name: eq.name, text: result.canonicalText });
    return;
  }

  if (result.action === 'placeFormula') {
    const eq = findEquation(graphState, result.equationProtoId) || findEquation(graphState, result.formulaName);
    const protoId = eq?.protoId || result.equationProtoId;
    if (!protoId) return;
    if (!graphState.nodePrototypes.some(p => p.id === protoId)) {
      graphState.nodePrototypes.push({ id: protoId, name: result.formulaName, color: '', description: '', definitionGraphIds: [newId('graph')] });
    }
    const source = formulas.find(f => f.equationProtoId === protoId);
    const anchorId = newId('inst');
    graph.instances.push({
      id: anchorId, prototypeId: protoId, name: result.formulaName, format: 'formula',
      ...(result.folded ? {} : { openDefinition: { index: 0 } }),
    });
    formulas.push({
      graphId: graph.id, groupId: result.folded ? null : `open:${anchorId}`, anchorId, equationProtoId: protoId,
      title: result.formulaName, text: result.text || source?.text || '', shown: result.folded ? 'folded' : 'open',
      // Inside the definition, which this web shows without holding.
      terms: (source?.terms || eq?.terms || []).map(t => ({ ...t, instanceId: null })),
      memberIds: [],
    });
    return;
  }

  const f = findFormulaIn(graphState, graph.id, result.formulaName);
  if (!f) return;

  if (result.action === 'openFormula') {
    f.shown = 'open';
    f.groupId = `open:${f.anchorId}`;
  } else if (result.action === 'foldFormula') {
    if (f.shown === 'formula') {
      removeFrom(graphState, graph, f.memberIds);
      graph.groups = graph.groups.filter(g => g.id !== f.groupId);
      const anchor = graph.instances.find(inst => inst.id === f.anchorId);
      if (anchor) { delete anchor.isGroupAnchor; anchor.format = 'formula'; }
    } else if (f.shown === 'open') {
      const anchor = graph.instances.find(inst => inst.id === f.anchorId);
      if (anchor) delete anchor.openDefinition;
    }
    f.shown = 'folded';
    f.groupId = null;
    f.memberIds = [];
  } else if (result.action === 'deleteFormula') {
    removeFrom(graphState, graph, [...f.memberIds, f.anchorId]);
    graph.groups = graph.groups.filter(g => g.id !== f.groupId);
    formulas.splice(formulas.indexOf(f), 1);
  } else if (result.action === 'rewriteFormula') {
    const untitled = compact(f.title) === compact(f.text);
    if (f.shown === 'formula') {
      removeFrom(graphState, graph, f.memberIds);
      f.terms = placeTerms(graphState, graph, result.terms);
      f.memberIds = f.terms.map(t => t.instanceId);
      const group = graph.groups.find(g => g.id === f.groupId);
      if (group) group.memberInstanceIds = [...f.memberIds];
    } else {
      f.terms = (result.terms || []).map(t => ({ ...t, instanceId: null }));
    }
    f.text = result.canonicalText;
    const name = result.title || (untitled ? result.canonicalText : '');
    if (name) {
      f.title = name;
      const proto = graphState.nodePrototypes.find(p => p.id === f.equationProtoId);
      if (proto) proto.name = name;
    }
  }
}
