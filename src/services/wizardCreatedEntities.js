/**
 * What a Wizard tool call made, by real store id.
 *
 * A tool result names what it made by name and by predictive id, and the
 * predictive ids never match the ones the store hands out (see BridgeClient's
 * name-resolution rule). So the record is taken from the store itself: the
 * entity Maps before the result is applied against the Maps after. Immer keeps
 * the old Maps intact, so the "before" snapshot costs three references.
 *
 * The record lands on the tool call's chat block as `created`, which is how the
 * card under it can show the Webs, Things and Connections the call made and
 * open them, after a reload too.
 */

/** Rows of each kind a card keeps. More than this is a summary, not a list. */
export const CREATED_ENTITY_LIMIT = 40;

export function snapshotEntityMaps(state) {
  return {
    graphs: state?.graphs,
    nodePrototypes: state?.nodePrototypes,
    edges: state?.edges
  };
}

const newKeys = (before, after) => {
  if (!(after instanceof Map) || before === after) return [];
  const out = [];
  for (const key of after.keys()) {
    if (!before?.has?.(key)) out.push(key);
  }
  return out;
};

const instancesOf = (graph) => {
  const inst = graph?.instances;
  if (inst instanceof Map) return inst;
  return new Map(Object.entries(inst || {}));
};

/**
 * @returns {{webs:string[], things:string[], connections:Array<{id:string, graphId:string|null}>}}
 *   in the order the store gained them; a Connection carries the web it was
 *   drawn in, which is where its ends are found. Things are the Things this call placed (a
 *   reused Thing counts: it is what the call put on the web) plus the ones it
 *   made without placing, less the ones another row already stands for: a new
 *   Web's defining Thing, and a new Connection's type.
 */
export function diffCreatedEntities(before, after) {
  const webs = newKeys(before.graphs, after.graphs);
  const newEdgeIds = newKeys(before.edges, after.edges);
  const edgeGraph = new Map();

  const things = [];
  const seen = new Set();
  const addThing = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    things.push(id);
  };

  // Placed Things: instances this call added to any web, new or old.
  if (after.graphs instanceof Map && before.graphs !== after.graphs) {
    for (const [graphId, graph] of after.graphs) {
      const prev = before.graphs?.get?.(graphId);
      if (prev === graph) continue;
      const prevInstances = prev ? instancesOf(prev) : null;
      for (const [instanceId, inst] of instancesOf(graph)) {
        if (prevInstances?.has(instanceId)) continue;
        addThing(inst?.prototypeId);
      }
      for (const edgeId of graph?.edgeIds || []) {
        if (!edgeGraph.has(edgeId)) edgeGraph.set(edgeId, graphId);
      }
    }
  }
  const connections = newEdgeIds.map(id => ({ id, graphId: edgeGraph.get(id) || null }));

  // Things it made without placing them: a type, a rung of an abstraction chain.
  for (const id of newKeys(before.nodePrototypes, after.nodePrototypes)) addThing(id);

  const representedElsewhere = new Set();
  for (const graphId of webs) {
    for (const id of after.graphs.get(graphId)?.definingNodeIds || []) representedElsewhere.add(id);
  }
  for (const { id: edgeId } of connections) {
    const edge = after.edges.get(edgeId);
    for (const id of edge?.definitionNodeIds || []) representedElsewhere.add(id);
    if (edge?.typeNodeId) representedElsewhere.add(edge.typeNodeId);
  }

  return {
    webs: webs.slice(0, CREATED_ENTITY_LIMIT),
    things: things.filter(id => !representedElsewhere.has(id)).slice(0, CREATED_ENTITY_LIMIT),
    connections: connections.slice(0, CREATED_ENTITY_LIMIT)
  };
}

export const hasCreatedEntities = (created) =>
  !!created && (created.webs?.length > 0 || created.things?.length > 0 || created.connections?.length > 0);

/** Two records of the same call, as one. A held change applies in a second pass. */
export function mergeCreatedEntities(a, b) {
  if (!hasCreatedEntities(a)) return b;
  if (!hasCreatedEntities(b)) return a;
  const merge = (x = [], y = [], key = v => v) => {
    const byKey = new Map();
    for (const v of [...x, ...y]) if (!byKey.has(key(v))) byKey.set(key(v), v);
    return Array.from(byKey.values()).slice(0, CREATED_ENTITY_LIMIT);
  };
  return {
    webs: merge(a.webs, b.webs),
    things: merge(a.things, b.things),
    connections: merge(a.connections, b.connections, c => c?.id)
  };
}

const listeners = new Set();

/**
 * Hear about each applied tool call that made something.
 * @param {(event:{toolCallId:string, conversationId:string|undefined, created:object}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onWizardEntitiesCreated(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyWizardEntitiesCreated(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (err) { console.error('[WizardCreatedEntities] listener failed:', err); }
  }
}
