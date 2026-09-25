/**
 * Dropping a spawnable Thing onto the canvas (react-dnd `drop`), moved verbatim
 * from NodeCanvas's useDrop spec: semantic concepts become saved prototypes
 * (B-16), existing prototypes get an instance at the drop point, snapped to the
 * grid when it is on.
 */
import { haptic } from '../../../services/haptics.js';
import { backfillConceptLinks, conceptToPrototypeFields } from '../../../services/candidates.js';
import useGraphStore from '../../../store/graphStore.js';
import { enrichPrototypeFromLinks } from '../../../services/conceptEnrichment.js';
import { getNodeDimensions } from '../../../utils.js';

/** The useDrop `drop` handler; NodeCanvas keeps the spec and its dependencies. */
export function handleCanvasDrop(ctx, item, monitor) {
  const {
    activeGraphId, containerRef, clientToCanvasCoordinates, nodePrototypesMap, storeActions, gridMode,
    snapToGridAnimated, selectedInstanceIds,
  } = ctx;
  if (!activeGraphId) return;

  const offset = monitor.getClientOffset();
  if (!offset || !containerRef.current) return;

  // After the guards that can abort the drop, so a spawn that doesn't land
  // stays silent. Forced past the rate limit: react-dnd can deliver this in
  // the same tick as other release-time feedback.
  haptic('nodeSpawn', { force: true });

  // Convert drop position to canvas coordinates
  const { x, y } = clientToCanvasCoordinates(offset.x, offset.y);

  // Handle semantic concepts that need materialization
  if (item.needsMaterialization && item.conceptData) {

    // Check if this semantic concept already exists as a prototype
    const existingPrototype = Array.from(nodePrototypesMap.values()).find(proto =>
      proto.semanticMetadata?.isSemanticNode &&
      proto.name === item.conceptData.name &&
      proto.semanticMetadata?.originMetadata?.source === item.conceptData.source &&
      proto.semanticMetadata?.originMetadata?.originalUri === item.conceptData.semanticMetadata?.originalUri
    );

    let prototypeId;

    if (existingPrototype) {
      // Use existing prototype, topping up any links it predates.
      prototypeId = existingPrototype.id;
      const patch = backfillConceptLinks(existingPrototype, item.conceptData);
      if (patch) {
        storeActions.updateNodePrototype(prototypeId, (draft) => {
          draft.externalLinks = patch.externalLinks;
          draft.semanticMetadata = patch.semanticMetadata;
        });
      }

    } else {
      // Create new prototype
      prototypeId = `semantic-node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Carries the concept's own URI onto the prototype as a real
      // externalLinks entry, not just into the semanticMetadata blob.
      const fields = conceptToPrototypeFields(item.conceptData);

      // Add the prototype to the store
      storeActions.addNodePrototype({
        id: prototypeId,
        name: item.conceptData.name,
        description: '', // No custom bio - will show origin info instead
        color: item.conceptData.color,
        typeNodeId: 'base-thing-prototype',
        definitionGraphIds: [],
        externalLinks: fields.externalLinks,
        semanticMetadata: fields.semanticMetadata,
        originalDescription: fields.originalDescription
      });

      // Auto-save semantic nodes to Library. // addNodePrototype already saves a new prototype; toggling here unsaved it (B-16).
      if (!useGraphStore.getState().savedNodeIds.has(prototypeId)) storeActions.toggleSavedNode(prototypeId);

      // Description and picture arrive a moment later, from the article
      // this concept already names — no second search, no guessing.
      enrichPrototypeFromLinks(prototypeId, fields.externalLinks);

    }

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
