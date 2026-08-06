/**
 * resolveGraphId - Resolve a graph ID from either an actual ID or a graph name.
 * Tries exact ID match first, then case-insensitive name match.
 *
 * When multiple graphs share the same name, disambiguation prefers (in order):
 *   1. The active graph itself if its name matches
 *   2. A name-matching graph that contains the active graph's defining node as
 *      one of its instances (i.e., a "parent" graph that defines the page above
 *      this one in the hierarchy)
 *   3. A name-matching graph the user currently has open as a tab, nearest to
 *      the active tab
 *   4. The most recently created exact name match
 *   5. The most recently created partial (substring) name match
 *
 * This guards against accidentally targeting an unrelated same-named graph
 * elsewhere in the project — e.g., when the user is in a "Mitochondria" graph,
 * the wizard's `targetGraphId: "Mitochondria"` should resolve to THIS graph,
 * not some other "Mitochondria" graph that happens to share the name.
 *
 * Rules 4 and 5 used to take the FIRST match. Graph collections iterate in
 * insertion order, so "first" means OLDEST — and in a long-lived universe where
 * names repeat across sessions, that reliably resolved to a stale graph from
 * some earlier session rather than the one just built. Taking the last match
 * picks the current one. (Same trap, and same fix, as prototype name resolution.)
 *
 * @param {string} idOrName - Graph ID or name from the LLM
 * @param {Array|Map|Iterable} graphs - Graphs collection (Array of {id, name, ...},
 *   Map keyed by id, or any iterable of graph objects)
 * @param {Object} [opts]
 * @param {string} [opts.activeGraphId] - The active graph ID for disambiguation
 * @param {string[]} [opts.openGraphIds] - Ordered open tab IDs. When supplied, a
 *   name match the user actually has open beats one buried in the archive.
 * @returns {string|null} The resolved graph ID, or the input value if nothing matched
 */
export function resolveGraphId(idOrName, graphs, opts = {}) {
  if (!idOrName || !graphs) return idOrName;

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
    // No real graph matched — treat "active"/"current" as sentinels for the active graph.
    // Only falls through to here if no actual graph has that name, avoiding false matches.
    const lower = String(idOrName).toLowerCase().trim();
    if ((lower === 'active' || lower === 'current') && opts.activeGraphId) {
      return opts.activeGraphId;
    }
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

  // Rule 3: a graph the user actually has open, closest to the active tab.
  // Something on screen is far likelier to be what was meant than a same-named
  // graph sitting in the archive.
  const openIds = Array.isArray(opts.openGraphIds) ? opts.openGraphIds : null;
  if (openIds && openIds.length > 0) {
    const activeIdx = openIds.indexOf(activeGraphId);
    const byTabDistance = (candidates) => {
      const openCandidates = candidates
        .map(g => ({ g, idx: openIds.indexOf(g.id) }))
        .filter(entry => entry.idx >= 0);
      if (openCandidates.length === 0) return null;
      if (activeIdx < 0) return openCandidates[0].g;
      openCandidates.sort((a, b) => Math.abs(a.idx - activeIdx) - Math.abs(b.idx - activeIdx));
      return openCandidates[0].g;
    };
    const openExact = byTabDistance(exactMatches);
    if (openExact) return openExact.id;
    const openPartial = byTabDistance(partialMatches);
    if (openPartial) return openPartial.id;
  }

  // Rule 4 / 5: most recent exact, then most recent partial. LAST, not first —
  // see the note above about insertion order surfacing stale graphs.
  if (exactMatches.length > 0) return exactMatches[exactMatches.length - 1].id;
  return partialMatches[partialMatches.length - 1].id;
}

/**
 * Report whether a name was ambiguous, so a tool can say so instead of silently
 * acting on one of several same-named graphs. Returns null when there was no
 * ambiguity to report.
 *
 * @param {string} idOrName - The name the model asked for
 * @param {Array|Map|Iterable} graphs - Graphs collection
 * @param {string} resolvedId - What resolveGraphId settled on
 * @returns {string|null} A human-readable note, or null
 */
export function describeGraphAmbiguity(idOrName, graphs, resolvedId) {
  if (!idOrName || !graphs) return null;
  const graphList = Array.isArray(graphs)
    ? graphs
    : graphs instanceof Map
      ? Array.from(graphs.values())
      : (typeof graphs[Symbol.iterator] === 'function' ? Array.from(graphs) : []);

  // An exact ID was given — nothing to be ambiguous about.
  if (graphList.some(g => g && g.id === idOrName)) return null;

  const nameLower = String(idOrName).toLowerCase().trim();
  const matches = graphList.filter(g => g && String(g?.name || '').toLowerCase().trim() === nameLower);
  if (matches.length <= 1) return null;

  return `"${idOrName}" matches ${matches.length} graphs. Used ${resolvedId}. `
    + `If that is the wrong one, pass an explicit graphId: ${matches.map(g => g.id).join(', ')}.`;
}
