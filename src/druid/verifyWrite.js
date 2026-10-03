/**
 * Did a write actually land?
 *
 * A tool result is the tool's word that something happened; the store is what
 * happened. On its fourth run the Druid called createNode("Soul") five times,
 * was told each time that it worked, and the Thing never appeared — the result
 * named a web the applier could not find, and the applier dropped it quietly.
 * The Druid then spent the rest of the run trying to reconcile what it had
 * been told with what it could see.
 *
 * So the loop checks the store after applying. For the writes it knows how to
 * check, a result that left no trace is treated as a failure. Writes it cannot
 * check (updates, deletes, merges) return null and are trusted as before.
 */

const valuesOf = (c) => (c instanceof Map ? Array.from(c.values()) : Array.isArray(c) ? c : Object.values(c || {}));
const lower = (s) => String(s || '').trim().toLowerCase();

function namesInGraph(state, graphId) {
  const graph = state.graphs?.get?.(graphId);
  if (!graph) return null;
  return valuesOf(graph.instances).map(inst => lower(state.nodePrototypes.get(inst.prototypeId)?.name));
}

/**
 * @param {string} toolName
 * @param {Object} result   the tool result that was applied
 * @param {Object} state    store state AFTER applying
 * @returns {boolean|null}  true landed, false did not, null cannot tell
 */
export function writeLanded(toolName, result, state) {
  const action = result?.action || toolName;

  if (action === 'createNode') {
    const names = namesInGraph(state, result.graphId);
    return names ? names.includes(lower(result.name)) : false;
  }

  if (action === 'createGraph') {
    return valuesOf(state.graphs).some(g => g.id === result.graphId || lower(g.name) === lower(result.graphName));
  }

  if (action === 'createEdge') {
    const graph = state.graphs?.get?.(result.graphId);
    if (!graph) return false;
    // By name, not id: for Things made earlier in the same turn the result
    // carries the agent loop's predicted instance ids, which never match the
    // ids the store assigned. Ids are the fallback when names are absent.
    const ends = (name, id) => {
      if (!name) return id ? new Set([id]) : null;
      const want = lower(name);
      return new Set(valuesOf(graph.instances)
        .filter(inst => lower(state.nodePrototypes.get(inst.prototypeId)?.name) === want)
        .map(inst => inst.id));
    };
    const a = ends(result.sourceName, result.sourceInstanceId);
    const b = ends(result.targetName, result.targetInstanceId);
    if (!a || !b) return null;
    return (graph.edgeIds || []).some(id => {
      const e = state.edges.get(id);
      return e && ((a.has(e.sourceId) && b.has(e.destinationId)) || (b.has(e.sourceId) && a.has(e.destinationId)));
    });
  }

  return null;
}
