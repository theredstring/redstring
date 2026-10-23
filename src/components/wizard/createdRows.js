import useGraphStore from '../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { connectionThingId, webThingId } from './entityActions.js';

/**
 * A tool call's `created` record (services/wizardCreatedEntities.js) resolved
 * against the live store into the rows its card draws (EntityRows.jsx).
 */

const arrowEndsOf = (edge) => {
  const ends = new Set();
  const toward = edge?.directionality?.arrowsToward;
  const has = (id) => (toward instanceof Set ? toward.has(id) : Array.isArray(toward) ? toward.includes(id) : false);
  if (has(edge?.sourceId)) ends.add('subject');
  if (has(edge?.destinationId)) ends.add('object');
  return ends;
};

/**
 * The webs a call made, outermost first. The store gains nested webs inside
 * out (a formula's parts get their webs before the equation's), so a web
 * whose Thing is placed in another web the call made comes after that one,
 * and the card leads with the web the call was for. Same depth keeps the
 * store's order.
 */
function outermostFirst(webIds, graphs) {
  const placedIn = new Map();
  for (const graphId of webIds) {
    const instances = graphs.get(graphId)?.instances;
    const placed = new Set();
    if (instances?.forEach) instances.forEach(inst => placed.add(inst?.prototypeId));
    placedIn.set(graphId, placed);
  }
  const depths = new Map();
  const depthOf = (graphId, visiting) => {
    if (depths.has(graphId)) return depths.get(graphId);
    if (visiting.has(graphId)) return 0;
    visiting.add(graphId);
    const definers = graphs.get(graphId)?.definingNodeIds || [];
    let depth = 0;
    for (const [outerId, placed] of placedIn) {
      if (outerId !== graphId && definers.some(id => placed.has(id))) {
        depth = Math.max(depth, depthOf(outerId, visiting) + 1);
      }
    }
    visiting.delete(graphId);
    depths.set(graphId, depth);
    return depth;
  };
  return webIds
    .map((graphId, order) => ({ graphId, order, depth: depthOf(graphId, new Set()) }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map(w => w.graphId);
}

/**
 * Resolve a `created` record against the live store into rows. Anything since
 * deleted, or undone, is simply absent.
 */
export function resolveRows(created, state) {
  const { graphs, nodePrototypes, edges, activeGraphId } = state;
  const rows = [];

  // A Web the call made is drawn whole, live (WebDefinitionsSection's card), so
  // what the call put inside it is in that drawing and needs no row of its own.
  const madeWebs = new Set();
  const liveWebs = (created?.webs || []).filter(graphId => graphs.has(graphId));
  for (const graphId of outermostFirst(liveWebs, graphs)) {
    const graph = graphs.get(graphId);
    if (!graph) continue;
    madeWebs.add(graphId);
    const thingId = webThingId(graph, nodePrototypes);
    const thing = thingId ? nodePrototypes.get(thingId) : null;
    rows.push({
      kind: 'web',
      key: `w:${graphId}`,
      id: graphId,
      thingId,
      name: graph.name || thing?.name || 'Web',
      thingName: thing?.name || graph.name || 'Web',
      color: thing?.color || graph.color || NODE_DEFAULT_COLOR,
      webOpen: graphId === activeGraphId
    });
  }
  const placedInMadeWeb = new Set();
  for (const graphId of madeWebs) {
    const instances = graphs.get(graphId)?.instances;
    if (instances?.forEach) instances.forEach(inst => placedInMadeWeb.add(inst?.prototypeId));
  }

  for (const thingId of created?.things || []) {
    if (placedInMadeWeb.has(thingId)) continue;
    const thing = nodePrototypes.get(thingId);
    if (!thing) continue;
    const defs = Array.isArray(thing.definitionGraphIds) ? thing.definitionGraphIds : [];
    rows.push({
      kind: 'thing',
      key: `t:${thingId}`,
      id: thingId,
      name: thing.name || 'Thing',
      color: thing.color || NODE_DEFAULT_COLOR,
      definitionGraphIds: defs,
      webOpen: !!defs[0] && defs[0] === activeGraphId
    });
  }

  for (const entry of created?.connections || []) {
    const edgeId = typeof entry === 'string' ? entry : entry?.id;
    if (entry?.graphId && madeWebs.has(entry.graphId)) continue;
    const edge = edgeId ? edges.get(edgeId) : null;
    if (!edge) continue;
    const graph = entry?.graphId ? graphs.get(entry.graphId) : null;
    const instanceOf = (instanceId) => {
      const inst = graph?.instances?.get?.(instanceId);
      return inst ? nodePrototypes.get(inst.prototypeId) || null : null;
    };
    const subject = instanceOf(edge.sourceId);
    const object = instanceOf(edge.destinationId);
    if (!subject || !object) continue;
    const typeId = connectionThingId(edge);
    const type = typeId ? nodePrototypes.get(typeId) : null;
    const typeDefs = Array.isArray(type?.definitionGraphIds) ? type.definitionGraphIds : [];
    rows.push({
      kind: 'connection',
      key: `c:${edgeId}`,
      id: edgeId,
      typeId: type ? typeId : null,
      name: type?.name || edge.name || 'Connection',
      subjectId: subject.id,
      objectId: object.id,
      subject: subject.name || 'Thing',
      object: object.name || 'Thing',
      subjectColor: subject.color || NODE_DEFAULT_COLOR,
      objectColor: object.color || NODE_DEFAULT_COLOR,
      connectionColor: type?.color || edge.color || subject.color,
      arrowsToward: arrowEndsOf(edge),
      webOpen: !!typeDefs[0] && typeDefs[0] === activeGraphId
    });
  }
  return rows;
}

// Everything a row draws, as one string, so a card re-renders when one of its
// own entities changes and not on every write to the store (a drag writes
// every frame).
export const rowsSignature = (rows) => rows.map(r => [
  r.key, r.name, r.thingName, r.thingId, r.color, r.webOpen ? 1 : 0, r.subject, r.object, r.subjectColor, r.objectColor,
  r.connectionColor, r.arrowsToward ? Array.from(r.arrowsToward).join('+') : '', r.typeId, r.subjectId, r.objectId
].join('|')).join('\n');

/**
 * Whether a call's card draws anything for what it made: false when there is
 * no record, or all of it has since been deleted or undone. The card uses it to
 * drop the text these drawings replace.
 */
export const useHasCreatedEntities = (created) =>
  useGraphStore(state => (created ? resolveRows(created, state).length > 0 : false));

