/**
 * resolveGraphId - Resolve a graph ID from either an actual ID or a graph name.
 * Tries exact ID match first, then case-insensitive name match.
 *
 * When multiple graphs share the same name, disambiguation prefers (in order):
 *   1. The active graph itself if its name matches
 *   2. A name-matching graph that contains the active graph's defining node as
 *      one of its instances (i.e., a "parent" graph that defines the page above
 *      this one in the hierarchy)
 *   3. The first exact name match
 *   4. The first partial (substring) name match
 *
 * This guards against accidentally targeting an unrelated same-named graph
 * elsewhere in the project — e.g., when the user is in a "Mitochondria" graph,
 * the wizard's `targetGraphId: "Mitochondria"` should resolve to THIS graph,
 * not some other "Mitochondria" graph that happens to share the name.
 *
 * @param {string} idOrName - Graph ID or name from the LLM
 * @param {Array|Map|Iterable} graphs - Graphs collection (Array of {id, name, ...},
 *   Map keyed by id, or any iterable of graph objects)
 * @param {Object} [opts]
 * @param {string} [opts.activeGraphId] - The active graph ID for disambiguation
 * @returns {string|null} The resolved graph ID, or the input value if nothing matched
 */
export function resolveGraphId(idOrName, graphs, opts = {}) {
  if (!idOrName || !graphs) return idOrName;

  // "active" / "current" are sentinel values models use to mean the active graph
  const sentinel = String(idOrName).toLowerCase().trim();
  if (sentinel === 'active' || sentinel === 'current') {
    return opts.activeGraphId || idOrName;
  }

  // Normalize the graphs collection into an Array of graph objects.
  const graphList = Array.isArray(graphs)
    ? graphs
    : graphs instanceof Map
      ? Array.from(graphs.values())
      : (typeof graphs[Symbol.iterator] === 'function' ? Array.from(graphs) : []);

  // Try ID match first
  if (graphList.some(g => g && g.id === idOrName)) return idOrName;

  // Fall back to name-based lookup
  const nameLower = String(idOrName).toLowerCase().trim();
  const nameOf = (g) => String(g?.name || '').toLowerCase().trim();

  const exactMatches = graphList.filter(g => g && nameOf(g) === nameLower);
  const partialMatches = graphList.filter(g => g && nameOf(g) !== nameLower && nameOf(g).includes(nameLower));

  if (exactMatches.length === 0 && partialMatches.length === 0) {
    return idOrName;
  }

  const { activeGraphId } = opts;
  const activeGraph = activeGraphId
    ? graphList.find(g => g && g.id === activeGraphId)
    : null;

  // Rule 1: the active graph itself, if it's among the name matches
  if (activeGraph) {
    if (exactMatches.includes(activeGraph)) return activeGraph.id;
    if (partialMatches.includes(activeGraph)) return activeGraph.id;
  }

  // Rule 2: a name-matching graph that contains the active graph's defining
  // node as an instance — i.e., the "parent" graph in the hierarchy.
  if (activeGraph && Array.isArray(activeGraph.definingNodeIds) && activeGraph.definingNodeIds.length > 0) {
    const definingProtoIds = new Set(activeGraph.definingNodeIds);
    const containsDefining = (g) => {
      if (!g) return false;
      const instances = g.instances;
      if (!instances) return false;
      const iter = Array.isArray(instances)
        ? instances
        : instances instanceof Map
          ? instances.values()
          : (typeof instances === 'object' ? Object.values(instances) : []);
      for (const inst of iter) {
        if (inst && definingProtoIds.has(inst.prototypeId)) return true;
      }
      return false;
    };
    const exactWithDefining = exactMatches.find(containsDefining);
    if (exactWithDefining) return exactWithDefining.id;
    const partialWithDefining = partialMatches.find(containsDefining);
    if (partialWithDefining) return partialWithDefining.id;
  }

  // Rule 3 / 4: first exact, then first partial
  if (exactMatches.length > 0) return exactMatches[0].id;
  return partialMatches[0].id;
}
