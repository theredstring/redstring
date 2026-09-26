/**
 * Converting a node into a node-group of its definition (moved verbatim from
 * NodeCanvas's handleNodeConvertToNodeGroup). NodeCanvas passes the render
 * values it used as `ctx`.
 */
import useGraphStore from '../../../store/graphStore.js';
import { v4 as uuidv4 } from 'uuid';
import { expandNodeInPlace } from './expandInPlace.js';

export function convertNodeToNodeGroup(instanceId, prototypeId, definitionGraphId, ctx) {
  const {
    activeGraphId, edgesMap, graphsMap, nodePrototypesMap, setGroupControlPanelShouldShow, setNodeControlPanelShouldShow,
    setNodeControlPanelVisible, setPreviewingNodeId, setSelectedGroup, setSelectedInstanceIds, storeActions,
  } = ctx;
  if (!activeGraphId) return;

  // Opening definitions in place (the default) shows the definition itself rather
  // than copying it; see expandInPlace.
  if (useGraphStore.getState().openDefinitionsInPlace !== false) {
    const definitionIndex = Math.max(0, nodePrototypesMap.get(prototypeId)?.definitionGraphIds?.indexOf(definitionGraphId) ?? 0);
    const openGroup = expandNodeInPlace({ viewGraphId: activeGraphId, prototypeId, definitionIndex, instanceId });
    if (openGroup) {
      setSelectedGroup(openGroup);
      setSelectedInstanceIds(new Set());
      setPreviewingNodeId(null);
      setGroupControlPanelShouldShow(true);
      setNodeControlPanelShouldShow(false);
      setNodeControlPanelVisible(false);
    }
    return;
  }

  // Get the node instance data
  const graphData = graphsMap.get(activeGraphId);
  if (!graphData) return;

  const instanceData = graphData.instances?.get(instanceId);
  if (!instanceData) return;

  // Get the node prototype data
  const prototypeData = nodePrototypesMap.get(prototypeId);
  if (!prototypeData) return;

  // Get the definition graph
  const defGraph = graphsMap.get(definitionGraphId);
  if (!defGraph) {
    console.error('[Convert Node to Node-Group] Definition graph not found:', definitionGraphId);
    return;
  }

  console.log(`[Convert Node to Node-Group] Converting node ${instanceId} (${prototypeData.name}) to node-group with definition ${definitionGraphId}`);

  // Copy all instances from the definition graph to the active graph
  const instanceIdMap = new Map(); // Maps old instance IDs to new instance IDs
  const newInstanceIds = [];
  let createdGroupId = null;

  // One gesture, one undo step. Without the transaction these calls split into
  // several entries, and ensureGroupAnchor (a repair-typed, non-recordable
  // action outside a transaction) dropped out entirely — so undoing a convert
  // left a group with no anchor behind.
  storeActions.withHistoryTransaction('Converted to node-group', () => {

  // Calculate offset to position the copied network at the original node's position
  let offsetX = instanceData.x;
  let offsetY = instanceData.y;

  // Find the center or top-left of the definition graph to use as reference
  if (defGraph.instances && defGraph.instances.size > 0) {
    const defInstances = Array.from(defGraph.instances.values());
    const minX = Math.min(...defInstances.map(inst => inst.x));
    const minY = Math.min(...defInstances.map(inst => inst.y));
    offsetX = instanceData.x - minX;
    offsetY = instanceData.y - minY;
  }

  // Copy instances
  if (defGraph.instances) {
    defGraph.instances.forEach((defInstance, defInstanceId) => {
      const newInstanceId = uuidv4();
      instanceIdMap.set(defInstanceId, newInstanceId);
      newInstanceIds.push(newInstanceId);

      // Create the instance in the active graph
      storeActions.addNodeInstance(
        activeGraphId,
        defInstance.prototypeId,
        { x: defInstance.x + offsetX, y: defInstance.y + offsetY },
        newInstanceId
      );
    });
  }

  // Copy edges between instances
  if (defGraph.edgeIds) {
    defGraph.edgeIds.forEach(edgeId => {
      const edge = edgesMap.get(edgeId);
      if (!edge) return;

      const newSourceId = instanceIdMap.get(edge.sourceId);
      const newDestId = instanceIdMap.get(edge.destinationId);

      // Only copy edges where both endpoints were copied
      if (newSourceId && newDestId) {
        // Remap arrowsToward IDs
        const directionality = edge.directionality || {};
        const arrowsToward = directionality.arrowsToward || new Set();
        const newArrowsToward = new Set();
        arrowsToward.forEach(oldId => {
          const newId = instanceIdMap.get(oldId);
          if (newId) newArrowsToward.add(newId);
        });

        const clonedEdgeId = uuidv4();
        storeActions.addEdge(
          activeGraphId,
          {
            id: clonedEdgeId,
            sourceId: newSourceId,
            destinationId: newDestId,
            connectionName: edge.connectionName,
            graphId: activeGraphId,
            color: edge.color,
            typeNodeId: edge.typeNodeId,
            definitionNodeIds: edge.definitionNodeIds ? [...edge.definitionNodeIds] : [],
            directionality: {
              type: directionality.type || 'none',
              arrowsToward: newArrowsToward
            },
            metadata: edge.metadata ? { ...edge.metadata } : {}
          }
        );
      }
    });
  }

  // Create a new node-group with all the copied instances
  createdGroupId = storeActions.createGroup(activeGraphId, {
    name: prototypeData.name,
    color: prototypeData.color || '#8B0000',
    memberInstanceIds: newInstanceIds
  });

  if (!createdGroupId) {
    console.error('[Convert Node to Node-Group] Failed to create group');
    return;
  }

  // Update the group with position and linked prototype
  storeActions.updateGroup(activeGraphId, createdGroupId, (group) => {
    group.x = instanceData.x;
    group.y = instanceData.y;
    group.linkedNodePrototypeId = prototypeId;
  });

  // Reuse the original node instance as the group's anchor instead of deleting it.
  // This keeps the group a usable connection target AND preserves every pre-existing
  // edge to/from the original node (deleting it would take those edges with it).
  storeActions.ensureGroupAnchor(activeGraphId, createdGroupId, { preferredAnchorInstanceId: instanceId });

  // A no-op on the group itself — they're already members — but now that it is
  // anchored on the original instance, this resolves the groups that instance
  // was inside and pushes the new members up to them. Without it a node
  // converted inside another group is born un-nested and paints beneath it.
  storeActions.addInstancesToGroup(activeGraphId, createdGroupId, newInstanceIds);
  });

  if (!createdGroupId) return;

  // Get the updated group data from store
  const currentState = useGraphStore.getState();
  const graph = currentState.graphs?.get(activeGraphId);
  const newGroup = graph?.groups?.get(createdGroupId);

  if (newGroup) {
    // Select the new group
    setSelectedGroup(newGroup);

    // Clear node selection and show group control panel
    setSelectedInstanceIds(new Set());
    setPreviewingNodeId(null);
    setGroupControlPanelShouldShow(true);
    setNodeControlPanelShouldShow(false);
    setNodeControlPanelVisible(false);

    console.log(`[Convert Node to Node-Group] Created node-group ${createdGroupId} with ${newInstanceIds.length} instances at position (${instanceData.x}, ${instanceData.y})`);
  }
}
