/**
 * Placing a semantic-orbit candidate on the canvas (moved verbatim from
 * NodeCanvas's handleOrbitItemClick). NodeCanvas passes the render values it
 * used as `ctx`. The rest of the orbit module is P5.08.
 */
import { backfillConceptLinks, candidateToConcept, conceptToPrototypeFields } from '../../../services/candidates.js';
import { enrichPrototypeFromLinks } from '../../../services/conceptEnrichment.js';
import { formatPredicate } from '../../../utils/predicateFormatter.js';
import { getNodeDimensions } from '../../../utils.js';
import useGraphStore from '../../../store/graphStore.js';

export function placeOrbitCandidate(candidate, centerX, centerY, dims, ctx) {
  const {
    activeGraphId, exitOrbitMode, gridMode, nodePrototypesMap, selectedInstanceIds, snapToGridAnimated,
    storeActions,
  } = ctx;
  if (!activeGraphId || !candidate) return;

  // Convert candidate to concept data
  const conceptData = candidateToConcept(candidate);

  // --- 1. Create or reuse node prototype ---
  const existingPrototype = Array.from(nodePrototypesMap.values()).find(proto =>
    proto.semanticMetadata?.isSemanticNode &&
    proto.name === conceptData.name &&
    proto.semanticMetadata?.originMetadata?.source === conceptData.source &&
    proto.semanticMetadata?.originMetadata?.originalUri === conceptData.semanticMetadata?.originalUri
  );

  let prototypeId;
  if (existingPrototype) {
    prototypeId = existingPrototype.id;
    const patch = backfillConceptLinks(existingPrototype, conceptData);
    if (patch) {
      storeActions.updateNodePrototype(prototypeId, (draft) => {
        draft.externalLinks = patch.externalLinks;
        draft.semanticMetadata = patch.semanticMetadata;
      });
    }
  } else {
    prototypeId = `semantic-node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const fields = conceptToPrototypeFields(conceptData);

    storeActions.addNodePrototype({
      id: prototypeId,
      name: conceptData.name,
      description: '',
      color: conceptData.color,
      typeNodeId: 'base-thing-prototype',
      definitionGraphIds: [],
      externalLinks: fields.externalLinks,
      semanticMetadata: fields.semanticMetadata
    });

    // addNodePrototype already saves a new prototype; toggling here unsaved it (B-16).
    if (!useGraphStore.getState().savedNodeIds.has(prototypeId)) storeActions.toggleSavedNode(prototypeId);
    enrichPrototypeFromLinks(prototypeId, fields.externalLinks);
  }

  // --- 2. Calculate position (centre → top-left) ---
  const prototype = nodePrototypesMap.get(prototypeId) || { id: prototypeId, name: conceptData.name, color: conceptData.color };
  const nodeDims = getNodeDimensions(prototype, false, null);

  // snapToGrid takes a CENTRE and returns a top-left, same as the branch
  // below — so both paths are fed the centre, and neither offsets it twice.
  const position = gridMode !== 'off'
    ? snapToGridAnimated(centerX, centerY, nodeDims.currentWidth, nodeDims.currentHeight, null)
    : { x: centerX - nodeDims.currentWidth / 2, y: centerY - nodeDims.currentHeight / 2 };

  // --- 3. Place instance ---
  storeActions.addNodeInstance(activeGraphId, prototypeId, position);

  // --- 4. Create edge with predicate and connection definition node ---
  try {
    if (selectedInstanceIds.size >= 1) {
      const focusedInstanceId = [...selectedInstanceIds][0];

      // Find the just-created instance
      const freshState = useGraphStore.getState();
      const g = freshState.graphs.get(activeGraphId);
      let newInstanceId = null;
      let best = Infinity;
      if (g?.instances) {
        g.instances.forEach(inst => {
          if (inst.prototypeId === prototypeId) {
            const dx = inst.x - position.x;
            const dy = inst.y - position.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < best) { best = d2; newInstanceId = inst.id; }
          }
        });
      }

      if (newInstanceId) {
        const rawPredicate = conceptData.defaultPredicate || candidate.predicate || 'relatedTo';
        const predicateLabel = formatPredicate(rawPredicate);

        // Find or create a connection definition node prototype by predicate name
        let connectionProtoId = null;
        freshState.nodePrototypes.forEach((proto, pid) => {
          if (proto.name?.toLowerCase() === predicateLabel.toLowerCase()) {
            connectionProtoId = pid;
          }
        });

        if (!connectionProtoId) {
          connectionProtoId = `proto-conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          storeActions.addNodePrototype({
            id: connectionProtoId,
            name: predicateLabel,
            description: `Defines the "${predicateLabel}" relationship`,
            color: candidate.color || '#666666',
            typeNodeId: null,
            definitionGraphIds: []
          });
          if (!useGraphStore.getState().savedNodeIds.has(connectionProtoId)) storeActions.toggleSavedNode(connectionProtoId); // B-16
        }

        const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        storeActions.addEdge(activeGraphId, {
          id: edgeId,
          sourceId: focusedInstanceId,
          destinationId: newInstanceId,
          name: predicateLabel,
          type: predicateLabel,
          typeNodeId: 'base-connection-prototype',
          definitionNodeIds: [connectionProtoId],
          directionality: { arrowsToward: new Set([newInstanceId]) },
          provenance: {
            source: conceptData.source,
            uri: conceptData.semanticMetadata?.originalUri || null,
            predicate: rawPredicate,
            retrieved_at: conceptData.discoveredAt || new Date().toISOString()
          }
        });
      }
    }
  } catch (err) {
    console.error('[handleOrbitItemClick] Edge creation failed:', err);
  }

  // --- 5. Exit orbit mode ---
  exitOrbitMode();
}
