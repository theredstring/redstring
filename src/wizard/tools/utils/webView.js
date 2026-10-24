/**
 * A web as the wizard is shown it, and the names that lead back into it.
 *
 * The context describes a web's Things and connections under one set of
 * names (ContextBuilder), and the tools take those names back to act on what
 * was described. Both go through here, so a name the wizard read leads to the
 * Thing it read about, on the web it is working in:
 *  - a Thing drawn as itself on the web goes by its name;
 *  - a formula's symbol goes by "Pendulum Length (in Pendulum Period)", and by
 *    the bare name only when no Thing of that name is drawn as itself;
 *  - a connection inside a formula is one of its operations, not one of the
 *    web's connections, and no name reaches it.
 * Before this each tool built its own name list with its own rule (first
 * match, last match, formula or not), so a name could land on a copy of a
 * Thing the wizard was never shown: a connection to Pendulum Length drawn to
 * the formula's own L, inside the formula.
 */
import { formulasIn, formulaCover } from './formulas.js';
import { resolveNodeSmart } from './resolveNodeSmart.js';

const listOf = (v) => (v instanceof Map ? Array.from(v.values()) : Array.isArray(v) ? v : Object.values(v || {}));
const key = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The name a placement goes by in its web. `cover` is its web's formulaCover. */
export const placeName = (inst, protoName, cover) => cover.nameOf(inst.id, inst.name || protoName || '');

/** Every instance's own name, across webs: for a connection's end kept in another web. */
export function instanceNames(graphState, protoById) {
  const names = new Map();
  for (const g of listOf(graphState?.graphs)) {
    for (const inst of listOf(g?.instances)) {
      const nm = inst?.id && (inst.name || protoById.get(inst.prototypeId)?.name);
      if (nm) names.set(inst.id, nm);
    }
  }
  return names;
}

/**
 * Read one web: its places (instances) under the names the wizard is shown,
 * and its connections that are the web's own (a formula's operations left out).
 */
export function readWeb(graphState, graphId) {
  const graph = listOf(graphState?.graphs).find(g => g?.id === graphId) || null;
  const protoById = new Map(listOf(graphState?.nodePrototypes).filter(p => p?.id).map(p => [p.id, p]));
  const cover = formulaCover(formulasIn(graphState, graphId));

  const places = listOf(graph?.instances).filter(inst => inst?.id).map((inst) => {
    const proto = protoById.get(inst.prototypeId);
    const f = cover.of(inst.id);
    return {
      instanceId: inst.id,
      prototypeId: inst.prototypeId,
      name: placeName(inst, proto?.name, cover),
      thing: inst.name || proto?.name || '',
      ...(f && f.anchorId !== inst.id ? { inFormula: f.title } : {}),
      description: inst.description || proto?.description || '',
      color: inst.color || proto?.color || '',
      x: inst.x,
      y: inst.y,
    };
  });
  const byId = new Map(places.map(p => [p.instanceId, p]));

  // A connection's end can be kept in another web (a definition or formula
  // opened in place); it is named there, a formula's symbol as one.
  let elsewhere = null;
  const formulaNames = cover.names();
  const nameOfEnd = (id) => {
    if (byId.has(id)) return byId.get(id).name;
    if (formulaNames.has(id)) return formulaNames.get(id);
    elsewhere = elsewhere || instanceNames(graphState, protoById);
    return elsewhere.get(id) || id || '?';
  };

  const edgeById = new Map(listOf(graphState?.edges).filter(e => e?.id).map(e => [e.id, e]));
  const connections = listOf(graph?.edgeIds).map(id => edgeById.get(id)).filter(e => e && !cover.internal(e));

  return { graph, graphId, cover, protoById, places, byId, connections, nameOfEnd };
}

/**
 * A place by id, or by the name the wizard was shown (case and spacing
 * aside): the Thing drawn as itself first, a formula's symbol by its full
 * name, or by the Thing it stands for when nothing of that name is drawn as
 * itself. The last match of equals, as names resolve across the project.
 */
export function findPlace(web, ref) {
  if (ref == null || ref === '') return null;
  const byId = web.byId.get(ref)
    || web.places.find(p => !p.inFormula && p.prototypeId === ref)
    || web.places.find(p => p.prototypeId === ref);
  if (byId) return byId;
  const k = key(ref);
  const named = web.places.filter(p => key(p.name) === k);
  if (named.length) return named[named.length - 1];
  const symbols = web.places.filter(p => p.inFormula && key(p.thing) === k);
  return symbols.length ? symbols[symbols.length - 1] : null;
}

/**
 * findPlace, else the shared smart resolver (a model's pick, then substring)
 * over the web's places. Same return shape as resolveNodeSmart.
 */
export async function resolvePlace(web, ref, callSite, opts = {}) {
  const found = findPlace(web, ref);
  if (found) return { match: found, method: 'exact', exact: true, callId: null };
  return resolveNodeSmart(ref, opts.candidates || web.places, { callSite, ...opts });
}

/**
 * Whether a connection's end goes by `name` as the wizard was shown it. A
 * symbol also answers to its Thing's bare name when no Thing of that name is
 * drawn as itself, as findPlace resolves it.
 */
export function endNamed(web, id, name) {
  const k = key(name);
  if (key(web.nameOfEnd(id)) === k) return true;
  const place = web.byId.get(id);
  return !!place?.inFormula && key(place.thing) === k && !web.places.some(p => !p.inFormula && key(p.name) === k);
}

/** The web's own connections whose ends go by these names, either direction. */
export function connectionsBetween(web, sourceName, targetName) {
  return web.connections.filter((e) => {
    const a = e.sourceId;
    const b = e.destinationId || e.targetId;
    if (sourceName && targetName) {
      return (endNamed(web, a, sourceName) && endNamed(web, b, targetName)) || (endNamed(web, a, targetName) && endNamed(web, b, sourceName));
    }
    const q = sourceName || targetName;
    return endNamed(web, a, q) || endNamed(web, b, q);
  });
}
