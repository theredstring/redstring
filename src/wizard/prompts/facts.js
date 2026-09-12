/**
 * The small set of facts the intent picker branches on.
 *
 * Kept separate from the prompt builders on purpose: the picker has to decide
 * which intents to offer, and what to call them, BEFORE any prompt is built —
 * building all of them just to render a menu would be wasteful and, for the
 * larger builders, slow. These are the cheap questions: is this Web empty, does
 * this Thing already sit on a ladder, how many Connections are selected.
 */
import useGraphStore from '../../store/graphStore.js';
import { resolveChain, DEFAULT_ABSTRACTION_DIMENSION } from '../tools/utils/abstractionSpec.js';

function instanceCountOf(graph) {
  const instances = graph?.instances;
  if (!instances) return 0;
  return instances instanceof Map ? instances.size : Object.keys(instances).length;
}

/** Does this prototype already sit on a chain with rungs, on the given axis? */
function hasLadderFor(prototype, dimension, nodePrototypes) {
  if (!prototype) return false;
  try {
    const resolved = resolveChain(prototype.id, dimension, nodePrototypes.values());
    // A "virtual" chain is one the carousel synthesises for a node that has none,
    // and a chain of one is just the node itself — neither is a ladder to expand.
    return !resolved?.virtual && Array.isArray(resolved?.chain) && resolved.chain.length > 1;
  } catch {
    return false;
  }
}

export function thingFacts(prototype, { dimension = DEFAULT_ABSTRACTION_DIMENSION } = {}) {
  const st = useGraphStore.getState();
  const activeGraph = st.activeGraphId ? st.graphs.get(st.activeGraphId) : null;
  return {
    protoName: prototype?.name || 'this Thing',
    webName: activeGraph?.name || 'this Web',
    webInstanceCount: instanceCountOf(activeGraph),
    hasLadder: hasLadderFor(prototype, dimension, st.nodePrototypes)
  };
}

export function connectionFacts(edges) {
  const st = useGraphStore.getState();
  const activeGraph = st.activeGraphId ? st.graphs.get(st.activeGraphId) : null;
  return {
    edgeCount: Array.isArray(edges) ? edges.length : 0,
    webName: activeGraph?.name || 'this Web'
  };
}

export function webFacts() {
  const st = useGraphStore.getState();
  const activeGraph = st.activeGraphId ? st.graphs.get(st.activeGraphId) : null;
  const count = instanceCountOf(activeGraph);
  return {
    webName: activeGraph?.name || 'this Web',
    webInstanceCount: count,
    isBlank: count === 0
  };
}

export function ladderFacts(prototype, dimension) {
  const st = useGraphStore.getState();
  return {
    protoName: prototype?.name || 'this Thing',
    dimension,
    hasLadder: hasLadderFor(prototype, dimension, st.nodePrototypes)
  };
}
