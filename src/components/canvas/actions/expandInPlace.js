/**
 * Expanding a node in place ("Decompose"), shared by the pie menu and the node
 * control panel.
 *
 * With "Open definitions in place" on (the default), the node opens onto its
 * definition itself: what is built inside is the definition, shown the same
 * everywhere (see src/core/openDefinitions.js). Off, it copies the definition into
 * a node-group, as it always has. A node already inside an open definition always
 * opens in place: copying needs the node to live in the graph being viewed.
 */
import useGraphStore from '../../../store/graphStore.js';
import { projectGraphView } from '../../../core/openDefinitions.js';

/**
 * @returns {Object|null} The group now shown for the expanded node (as viewed), or null.
 */
export function expandNodeInPlace({ viewGraphId, prototypeId, definitionIndex = 0, instanceId }) {
  const store = useGraphStore.getState();
  const ownsNode = store.graphs.get(viewGraphId)?.instances?.has(instanceId);

  let groupId;
  if (store.openDefinitionsInPlace !== false || !ownsNode) {
    groupId = store.openDefinitionInPlace(viewGraphId, instanceId, definitionIndex);
  } else {
    const defGraphId = store.nodePrototypes.get(prototypeId)?.definitionGraphIds?.[definitionIndex];
    const defGraph = defGraphId ? store.graphs.get(defGraphId) : null;
    groupId = (!defGraph?.instances || defGraph.instances.size === 0)
      ? store.decomposeEmptyNodeToGroup(viewGraphId, prototypeId, definitionIndex, instanceId)
      : store.decomposeNodeToGroup(viewGraphId, prototypeId, definitionIndex, instanceId);
  }
  if (!groupId) return null;
  return projectGraphView(useGraphStore.getState(), viewGraphId)?.groups?.get(groupId) || null;
}
