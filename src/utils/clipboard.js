import { v4 as uuidv4 } from 'uuid';

/**
 * How a placement is shown, which a copy keeps: opened in place (its box where
 * it stood from the node, `openFromNode`), as what (formats/: a formula) and
 * at what size (an equation's is its node's).
 * A box's offset is where its definition lands in the view, so it is kept from
 * the node's place in the same view (projectGraphView's openView), not as saved.
 */
function showStateOf(graph, instance) {
  const out = {};
  for (const key of ['format', 'linkedFormat', 'sizeMul']) {
    if (instance[key]) out[key] = instance[key];
  }
  const open = instance.openDefinition;
  if (open) {
    const at = graph.openView?.boxes?.get(instance.id)?.offset || open.offset || { x: 0, y: 0 };
    out.openFromNode = { index: open.index ?? 0, dx: at.x - (instance.x ?? 0), dy: at.y - (instance.y ?? 0) };
  }
  return out;
}

/**
 * Copy selected nodes and their interconnecting edges to clipboard data structure
 * @param {Set<string>} selectedInstanceIds - Set of selected instance IDs
 * @param {Object} graph - Current graph object with instances and edgeIds
 * @param {Map} nodePrototypes - Map of node prototypes
 * @param {Map} edges - Map of all edges
 * @returns {Object} Clipboard data structure
 */
export function copySelection(selectedInstanceIds, graph, nodePrototypes, edges) {
  if (!selectedInstanceIds || selectedInstanceIds.size === 0) {
    return null;
  }

  const nodes = [];
  let totalX = 0;
  let totalY = 0;

  // Collect node data
  for (const instanceId of selectedInstanceIds) {
    const instance = graph.instances.get(instanceId);
    if (!instance) continue;

    nodes.push({
      instanceId,
      prototypeId: instance.prototypeId,
      x: instance.x,
      y: instance.y,
      scale: instance.scale || 1,
      ...(instance.labels ? { labels: instance.labels } : {}),
      ...showStateOf(graph, instance)
    });

    totalX += instance.x;
    totalY += instance.y;
  }

  // Calculate center of selection
  const originalCenter = {
    x: totalX / nodes.length,
    y: totalY / nodes.length
  };

  // Store relative positions from center
  nodes.forEach(node => {
    node.relativeX = node.x - originalCenter.x;
    node.relativeY = node.y - originalCenter.y;
  });

  // Collect edges where both endpoints are in selection
  const copiedEdges = [];
  for (const edgeId of graph.edgeIds) {
    // As drawn in the view: its ends are the ids the selection holds.
    const edge = graph.openView?.edges?.get(edgeId) || edges.get(edgeId);
    if (!edge) continue;

    if (selectedInstanceIds.has(edge.sourceId) && selectedInstanceIds.has(edge.destinationId)) {
      copiedEdges.push({
        oldSourceId: edge.sourceId,
        oldDestinationId: edge.destinationId,
        edgeData: {
          name: edge.name,
          description: edge.description,
          picture: edge.picture,
          color: edge.color,
          typeNodeId: edge.typeNodeId,
          // Not every edge carries these (Wizard-made and older-file edges
          // can lack them); copying one used to throw and abort the copy.
          definitionNodeIds: [...(edge.definitionNodeIds || [])],
          directionality: {
            arrowsToward: new Set(edge.directionality?.arrowsToward || [])
          }
        }
      });
    }
  }

  return {
    nodes,
    edges: copiedEdges,
    sourceGraphId: graph.id,
    originalCenter
  };
}

/**
 * Copy a connection's definition — the Thing that says what the connection means,
 * not the connection itself, which has no life away from its two endpoints.
 *
 * Same payload Cmd/Ctrl+C writes for a selected edge, so the Copy button on a
 * connection menu and the keyboard shortcut fill one clipboard, not two.
 *
 * @param {Object} edge
 * @returns {Object|null} clipboard payload, or null if there's nothing to copy
 */
export function copyEdgeDefinition(edge) {
  if (!edge) return null;
  return {
    type: 'edge_definitions',
    definitions: {
      color: edge.color,
      typeNodeId: edge.typeNodeId,
      definitionNodeIds: [...(edge.definitionNodeIds || [])]
    }
  };
}

/**
 * What, if anything, the clipboard can contribute to a connection.
 *
 * Two payloads qualify, which is what "paste a definition" means in practice:
 *   - another connection's definition (copyEdgeDefinition, above)
 *   - a single copied Thing, whose prototype becomes the connection's definition
 *     — the same move as picking that Thing in the Define dialog
 * Anything else (several nodes, a web) has no single answer to "what does this
 * connection mean", so it reads as nothing and the Paste button stays away.
 *
 * @param {Object} clipboardData
 * @param {Map} nodePrototypes
 * @returns {{name: string, color: ?string, definitions: Object}|null}
 */
export function readConnectionClipboard(clipboardData, nodePrototypes) {
  if (!clipboardData) return null;

  if (clipboardData.type === 'edge_definitions') {
    const defs = clipboardData.definitions || {};
    const protoId = defs.definitionNodeIds?.[0] || null;
    const proto = protoId ? nodePrototypes?.get(protoId) : null;
    // A copied bare connection carries no definition and no type worth moving.
    if (!proto && !defs.typeNodeId) return null;
    return {
      name: proto?.name || 'Connection',
      color: proto?.color || defs.color || null,
      definitions: {
        color: defs.color,
        typeNodeId: defs.typeNodeId,
        definitionNodeIds: [...(defs.definitionNodeIds || [])]
      }
    };
  }

  if (Array.isArray(clipboardData.nodes) && clipboardData.nodes.length === 1) {
    const protoId = clipboardData.nodes[0]?.prototypeId;
    const proto = protoId ? nodePrototypes?.get(protoId) : null;
    if (!proto) return null;
    return {
      name: proto.name || 'Thing',
      color: proto.color || null,
      // typeNodeId is left alone: the edge keeps whatever kind of connection it
      // is and gains a definition, exactly as choosing this Thing in the Define
      // dialog would (see UnifiedSelector's onNodeSelect in NodeCanvas).
      definitions: { definitionNodeIds: [protoId] }
    };
  }

  return null;
}

/**
 * Apply a readConnectionClipboard payload to one or more edges.
 *
 * @param {Object} payload - from readConnectionClipboard
 * @param {Iterable<string>} edgeIds
 * @param {Object} storeActions
 */
export function applyConnectionClipboard(payload, edgeIds, storeActions) {
  if (!payload) return;
  const { definitions } = payload;
  for (const edgeId of edgeIds) {
    if (!edgeId) continue;
    storeActions.updateEdge(edgeId, (draft) => {
      if (definitions.color) draft.color = definitions.color;
      if (definitions.typeNodeId !== undefined) draft.typeNodeId = definitions.typeNodeId;
      draft.definitionNodeIds = [...(definitions.definitionNodeIds || [])];
    });
  }
}

/**
 * Check if any nodes in the proposed positions collide with existing nodes
 * @param {Array} positions - Array of {x, y, width, height} for proposed nodes
 * @param {Array} existingNodes - Array of existing node instances
 * @param {Function} getNodeDimensions - Function to get node dimensions
 * @returns {boolean} True if collision detected
 */
function hasCollision(positions, existingNodes, getNodeDimensions) {
  for (const pos of positions) {
    for (const existingNode of existingNodes) {
      const existingDims = getNodeDimensions(existingNode);

      // Check AABB collision
      const overlap = !(
        pos.x + pos.width < existingNode.x ||
        pos.x > existingNode.x + existingDims.currentWidth ||
        pos.y + pos.height < existingNode.y ||
        pos.y > existingNode.y + existingDims.currentHeight
      );

      if (overlap) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Calculate positions for pasted nodes from a center point
 * @param {Object} clipboardData - Clipboard data with nodes
 * @param {Object} targetCenter - Target center position {x, y}
 * @param {Function} getNodeDimensions - Function to get node dimensions
 * @returns {Array} Array of positions with dimensions
 */
function calculatePositionsFromCenter(clipboardData, targetCenter, getNodeDimensions) {
  return clipboardData.nodes.map(node => {
    const x = targetCenter.x + node.relativeX;
    const y = targetCenter.y + node.relativeY;

    // Get dimensions for collision checking
    // Note: We'll use default dimensions since we don't have the full node context yet
    const width = 150 * (node.scale || 1);
    const height = 100 * (node.scale || 1);

    return { x, y, width, height, nodeData: node };
  });
}

/**
 * Find a non-overlapping position for pasted nodes using collision avoidance
 * @param {Object} targetCenter - Initial target center position
 * @param {Object} clipboardData - Clipboard data
 * @param {Array} existingNodes - Array of existing node instances in target graph
 * @param {Function} getNodeDimensions - Function to get node dimensions
 * @returns {Array} Final positions for nodes
 */
function findNonOverlappingPosition(targetCenter, clipboardData, existingNodes, getNodeDimensions) {
  // Spiral pattern offsets for collision avoidance
  const offsets = [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: -50, y: 50 },
    { x: 50, y: -50 },
    { x: -50, y: -50 },
    { x: 100, y: 100 },
    { x: -100, y: 100 },
    { x: 100, y: -100 },
    { x: -100, y: -100 },
    { x: 150, y: 150 },
    { x: -150, y: 150 },
    { x: 150, y: -150 },
    { x: -150, y: -150 },
    { x: 200, y: 200 }
  ];

  for (const offset of offsets) {
    const testCenter = {
      x: targetCenter.x + offset.x,
      y: targetCenter.y + offset.y
    };
    const positions = calculatePositionsFromCenter(clipboardData, testCenter, getNodeDimensions);

    if (!hasCollision(positions, existingNodes, getNodeDimensions)) {
      return positions;
    }
  }

  // If all offsets collide, use the last offset anyway
  return calculatePositionsFromCenter(clipboardData, {
    x: targetCenter.x + 200,
    y: targetCenter.y + 200
  }, getNodeDimensions);
}

/**
 * What pasting the clipboard's nodes would make, for the button that does it,
 * or null when it holds none. The shape of what was copied (connections
 * between selected nodes are captured on copy):
 *   1 node                              → Paste Thing
 *   many nodes, no connections          → Paste Things
 *   exactly 2 nodes + 1 directed edge   → Paste Triple
 *   many nodes + any connections        → Paste Web
 *   a formula (copyFormula)             → Paste Formula
 */
export function pasteLabelFor(clip) {
  if (!Array.isArray(clip?.nodes) || clip.nodes.length === 0) return null;
  if (clip.kind === 'formula') return 'Paste Formula';
  const nodeCount = clip.nodes.length;
  const edges = Array.isArray(clip.edges) ? clip.edges : [];
  if (edges.length === 0) return nodeCount === 1 ? 'Paste Thing' : 'Paste Things';
  // A triple is strictly subject → connection → object: exactly 2 nodes,
  // exactly 1 connection between them, pointing exactly one way.
  // Everything else with connections is a Web. Specifically NOT a triple:
  //   - more than 2 nodes
  //   - undirected connection (0 arrows)
  //   - doubly-connected / bidirectional (2 arrows)
  const arrows = edges.length === 1 ? edges[0]?.edgeData?.directionality?.arrowsToward : null;
  const arrowCount = arrows instanceof Set ? arrows.size : (Array.isArray(arrows) ? arrows.length : 0);
  return nodeCount === 2 && edges.length === 1 && arrowCount === 1 ? 'Paste Triple' : 'Paste Web';
}

/**
 * Paste clipboard data into target graph with collision avoidance
 * @param {Object} clipboardData - Clipboard data from copySelection
 * @param {string} targetGraphId - Target graph ID
 * @param {Object} targetPosition - Target center position {x, y}
 * @param {Object} storeActions - Store actions for adding nodes/edges
 * @param {Object} graph - Target graph object
 * @param {Function} getNodeDimensions - Function to get node dimensions
 * @returns {Object} {newInstanceIds: Array, newEdgeIds: Array}
 */
export function pasteClipboard(
  clipboardData,
  targetGraphId,
  targetPosition,
  storeActions,
  graph,
  getNodeDimensions
) {
  if (!clipboardData || !clipboardData.nodes || clipboardData.nodes.length === 0) {
    return { newInstanceIds: [], newEdgeIds: [] };
  }

  // Get existing nodes for collision detection
  const existingNodes = Array.from(graph.instances.values());

  // Find non-overlapping positions
  const positions = findNonOverlappingPosition(
    targetPosition,
    clipboardData,
    existingNodes,
    getNodeDimensions
  );

  // Build instance ID mapping (old ID -> new ID)
  const instanceIdMap = new Map();
  const newInstanceIds = [];

  // Create new instances
  const nodesToPaste = positions.map(pos => {
    const node = pos.nodeData;
    const newInstanceId = uuidv4();
    instanceIdMap.set(node.instanceId, newInstanceId);
    newInstanceIds.push(newInstanceId);

    const open = node.openFromNode;
    return {
      instanceId: newInstanceId,
      prototypeId: node.prototypeId,
      x: pos.x,
      y: pos.y,
      scale: node.scale,
      ...(node.labels ? { labels: node.labels } : {}),
      ...(node.format ? { format: node.format } : {}),
      ...(node.linkedFormat ? { linkedFormat: node.linkedFormat } : {}),
      ...(node.sizeMul ? { sizeMul: node.sizeMul } : {}),
      ...(open ? { openDefinition: { index: open.index, offset: { x: pos.x + open.dx, y: pos.y + open.dy } } } : {})
    };
  });

  // Create new edges with remapped IDs
  const newEdgeIds = [];
  const edgesToPaste = clipboardData.edges.map(edge => {
    const newEdgeId = uuidv4();
    const newSourceId = instanceIdMap.get(edge.oldSourceId);
    const newDestinationId = instanceIdMap.get(edge.oldDestinationId);

    newEdgeIds.push(newEdgeId);

    // Remap directionality arrows
    const newArrowsToward = new Set();
    for (const oldId of (edge.edgeData.directionality?.arrowsToward || [])) {
      const newId = instanceIdMap.get(oldId);
      if (newId) {
        newArrowsToward.add(newId);
      }
    }

    return {
      id: newEdgeId,
      sourceId: newSourceId,
      destinationId: newDestinationId,
      name: edge.edgeData.name,
      description: edge.edgeData.description,
      picture: edge.edgeData.picture,
      color: edge.edgeData.color,
      typeNodeId: edge.edgeData.typeNodeId,
      definitionNodeIds: [...(edge.edgeData.definitionNodeIds || [])],
      directionality: {
        arrowsToward: newArrowsToward
      }
    };
  });

  // A copied formula's groups (copyFormula): its own and its parts', on the new Things.
  const groupIdMap = new Map();
  const newGroupIds = [];
  const groupsToPaste = (clipboardData.groups || []).map(group => {
    const newGroupId = uuidv4();
    groupIdMap.set(group.id, newGroupId);
    newGroupIds.push(newGroupId);
    return {
      ...group,
      id: newGroupId,
      memberInstanceIds: group.memberInstanceIds.map(id => instanceIdMap.get(id)).filter(Boolean),
      ...(group.anchorInstanceId ? { anchorInstanceId: instanceIdMap.get(group.anchorInstanceId) } : {})
    };
  });

  // Batch paste operation
  storeActions.pasteNodesAndEdges(targetGraphId, nodesToPaste, edgesToPaste, {}, groupsToPaste);

  // What to select: a formula as itself (its anchor alone selects its group:
  // canvasUIStore), else what was pasted.
  const outer = clipboardData.kind === 'formula' && clipboardData.groups?.[0];
  const selectIds = outer?.anchorInstanceId ? [instanceIdMap.get(outer.anchorInstanceId)] : newInstanceIds;
  const selectGroupId = outer && !outer.anchorInstanceId ? groupIdMap.get(outer.id) : null;

  return { newInstanceIds, newEdgeIds, newGroupIds, selectIds, selectGroupId };
}
