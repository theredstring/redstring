/**
 * Dropping a spawnable Thing onto the canvas (react-dnd `drop`), moved verbatim
 * from NodeCanvas's useDrop spec: semantic concepts become saved prototypes
 * (B-16), existing prototypes get an instance at the drop point, snapped to the
 * grid when it is on. A semantic connection returns its drop point for the
 * list it came from to place. A Thing let go on a connection (and not on a
 * node) defines that connection instead of landing beside it.
 */
import { haptic } from '../../../services/haptics.js';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { ensureConceptPrototype } from '../../../services/semanticPlacement.js';
import { getNodeDimensions } from '../../../utils.js';

// The connection under the drop point, or null. A drop on a node never counts:
// the hit-test measures from node centres, so a connection runs under its ends.
function connectionUnderDrop(findEdgeAtClientPointRef, offset) {
  const findEdgeAtClientPoint = findEdgeAtClientPointRef?.current;
  if (!findEdgeAtClientPoint) return null;
  if (document.elementFromPoint(offset.x, offset.y)?.closest?.('[data-instance-id]')) return null;
  return findEdgeAtClientPoint(offset.x, offset.y, 'mouse')?.edgeId || null;
}

const defineConnection = (storeActions, edgeId, prototypeId) => {
  storeActions.updateEdge(edgeId, (draft) => { draft.definitionNodeIds = [prototypeId]; });
};

/**
 * The useDrop spec's handlers; NodeCanvas keeps the accept type and the
 * dependencies. Hover marks the connection a release would define, so it glows
 * (spawnDropEdgeId); SpawningNodeDragLayer clears it when the drag ends or
 * leaves the canvas.
 *
 * `getCtx` is called per event, not here: NodeCanvas builds this spec above
 * some of what the context names (findEdgeAtClientPointRef), so reading them
 * during render throws.
 */
export function canvasDropSpec(getCtx) {
  return {
    drop: (item, monitor) => {
      useCanvasUIStore.getState().setSpawnDropEdgeId(null);
      return handleCanvasDrop(getCtx(), item, monitor);
    },
    hover: (item, monitor) => {
      const offset = monitor.getClientOffset();
      const edgeId = item.semanticStatement || !offset ? null : connectionUnderDrop(getCtx().findEdgeAtClientPointRef, offset);
      useCanvasUIStore.getState().setSpawnDropEdgeId(edgeId);
    },
  };
}

/** The useDrop `drop` handler. */
export function handleCanvasDrop(ctx, item, monitor) {
  const {
    activeGraphId, containerRef, clientToCanvasCoordinates, nodePrototypesMap, storeActions, gridMode,
    snapToGridAnimated, selectedInstanceIds, findEdgeAtClientPointRef,
  } = ctx;
  if (!activeGraphId) return;

  const offset = monitor.getClientOffset();
  if (!offset || !containerRef.current) return;

  // A connection from a Semantic Web list: the row that started the drag
  // places it (it may ask first), so the drop only says where it landed.
  if (item.semanticStatement) {
    return { graphId: activeGraphId, canvasPoint: clientToCanvasCoordinates(offset.x, offset.y) };
  }

  // After the guards that can abort the drop, so a spawn that doesn't land
  // stays silent. Forced past the rate limit: react-dnd can deliver this in
  // the same tick as other release-time feedback.
  haptic('nodeSpawn', { force: true });

  const connectionId = connectionUnderDrop(findEdgeAtClientPointRef, offset);

  // Convert drop position to canvas coordinates
  const { x, y } = clientToCanvasCoordinates(offset.x, offset.y);

  // Handle semantic concepts that need materialization
  if (item.needsMaterialization && item.conceptData) {

    // Found again by its URI, or made, saved and enriched — the same
    // prototype every other way of bringing this concept in would give.
    const prototypeId = ensureConceptPrototype(item.conceptData);
    if (connectionId) return defineConnection(storeActions, connectionId, prototypeId);

    // Now use the prototype ID for positioning
    const prototype = {
      ...item.conceptData,
      id: prototypeId,
      name: item.conceptData.name,
      color: item.conceptData.color
    };
    const dimensions = getNodeDimensions(prototype, false, null);

    // Create position
    let position = {
      x: x - (dimensions.currentWidth / 2),
      y: y - (dimensions.currentHeight / 2)
    };

    // Apply grid snapping if enabled
    if (gridMode !== 'off') {
      const snapped = snapToGridAnimated(x, y, dimensions.currentWidth, dimensions.currentHeight, null);
      position = { x: snapped.x, y: snapped.y };
    }

    // Add instance to the canvas
    storeActions.addNodeInstance(activeGraphId, prototypeId, position);

    // If there is exactly one node selected (focus), and the dragged concept carried a predicate,
    // create an edge from the focused node to this new instance with provenance
    try {
      if (selectedInstanceIds.size === 1) {
        const focusedInstanceId = [...selectedInstanceIds][0];
        const newInstanceId = (() => {
          // Find the just-created instance id at that position (closest by distance)
          const g = useGraphStore.getState().graphs.get(activeGraphId);
          let closestId = null, best = Infinity;
          if (g?.instances) {
            g.instances.forEach(inst => {
              if (inst.prototypeId === prototypeId) {
                const dx = inst.x - position.x; const dy = inst.y - position.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < best) { best = d2; closestId = inst.id; }
              }
            });
          }
          return closestId;
        })();

        if (newInstanceId) {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const predicate = item.conceptData.defaultPredicate || 'relatedTo';
          storeActions.addEdge(activeGraphId, {
            id: edgeId,
            sourceId: focusedInstanceId,
            destinationId: newInstanceId,
            label: predicate,
            color: '#666666',
            provenance: {
              source: item.conceptData.source,
              uri: item.conceptData.semanticMetadata?.originalUri || null,
              predicate,
              claims: item.conceptData.relationships || [],
              retrieved_at: item.conceptData.discoveredAt || new Date().toISOString()
            }
          });
        }
      }
    } catch { }

    return;
  }

  // Handle regular nodes (existing logic)
  const { prototypeId } = item;
  if (!prototypeId) {

    return;
  }

  const prototype = nodePrototypesMap.get(prototypeId);
  if (!prototype) {

    // Try to find a prototype with the same name as a fallback
    const potentialMatches = Array.from(nodePrototypesMap.values()).filter(p =>
      item.nodeName && p.name.toLowerCase() === item.nodeName.toLowerCase()
    );

    if (potentialMatches.length > 0) {

      // Use the first match as a fallback
      const fallbackPrototype = potentialMatches[0];
      if (connectionId) return defineConnection(storeActions, connectionId, fallbackPrototype.id);
      const dimensions = getNodeDimensions(fallbackPrototype, false, null);

      let position = {
        x: x - (dimensions.currentWidth / 2),
        y: y - (dimensions.currentHeight / 2)
      };

      if (gridMode !== 'off') {
        const snapped = snapToGridAnimated(x, y, dimensions.currentWidth, dimensions.currentHeight, null);
        position = { x: snapped.x, y: snapped.y };
      }

      storeActions.addNodeInstance(activeGraphId, fallbackPrototype.id, position);
      return;
    }

    return;
  }

  if (connectionId) return defineConnection(storeActions, connectionId, prototypeId);

  const dimensions = getNodeDimensions(prototype, false, null);

  // With the new model, we ALWAYS create a new instance.
  let position = {
    x: x - (dimensions.currentWidth / 2),
    y: y - (dimensions.currentHeight / 2)
  };

  // Apply smooth grid snapping when creating new nodes via drag and drop if grid is enabled
  if (gridMode !== 'off') {
    const snapped = snapToGridAnimated(x, y, dimensions.currentWidth, dimensions.currentHeight, null);
    position = { x: snapped.x, y: snapped.y };
  }

  storeActions.addNodeInstance(activeGraphId, prototypeId, position);
}
