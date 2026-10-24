/**
 * The webs opened in place inside a web: a definition or a formula shown open
 * on a node, its Things kept in its own web and drawn in this one
 * (core/openDefinitions.js). Each opens once, nested ones included, so a
 * web's Things as the user sees them are its own plus these webs'.
 */
const listOf = (v) => (v instanceof Map ? Array.from(v.values()) : Array.isArray(v) ? v : Object.values(v || {}));

export function websOpenedIn(graphState, graphId) {
  const { graphs = [], nodePrototypes = [] } = graphState || {};
  const graphById = new Map(graphs.filter(g => g?.id).map(g => [g.id, g]));
  const protoById = new Map(nodePrototypes.filter(p => p?.id).map(p => [p.id, p]));
  const opened = [];
  const seen = new Set([graphId]);
  const walk = (g) => {
    for (const inst of listOf(g?.instances)) {
      if (!inst?.openDefinition) continue;
      const defId = listOf(protoById.get(inst.prototypeId)?.definitionGraphIds)[inst.openDefinition.index ?? 0];
      const def = graphById.get(defId);
      if (!def || seen.has(defId)) continue;
      seen.add(defId);
      opened.push({ graph: def, anchorId: inst.id, name: protoById.get(inst.prototypeId)?.name || def.name || '' });
      walk(def);
    }
  };
  walk(graphById.get(graphId));
  return opened;
}

/** A web's instances as the user sees them: its own, then each opened web's, marked with what it is opened in. */
export function instancesSeenIn(graphState, graph) {
  const own = listOf(graph?.instances).map(inst => ({ inst }));
  if (!graph?.id) return own;
  const inside = websOpenedIn(graphState, graph.id)
    .flatMap(({ graph: def, name }) => listOf(def.instances).map(inst => ({ inst, openedIn: name })));
  return [...own, ...inside];
}
