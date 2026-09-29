/**
 * Placing a semantic-orbit candidate on the canvas (moved verbatim from
 * NodeCanvas's handleOrbitItemClick). NodeCanvas passes the render values it
 * used as `ctx`. The prototype, the instance and the connection are made by
 * the shared semantic placement, so an orbit add and a panel add of the same
 * statement produce the same Thing and the same edge.
 */
import { candidateToConcept } from '../../../services/candidates.js';
import { ensureConceptPrototype, placeConcept } from '../../../services/semanticPlacement.js';
import { getNodeDimensions } from '../../../utils.js';
import useGraphStore from '../../../store/graphStore.js';

export function placeOrbitCandidate(candidate, centerX, centerY, dims, ctx) {
  const { activeGraphId, exitOrbitMode, gridMode, selectedInstanceIds, snapToGridAnimated } = ctx;
  if (!activeGraphId || !candidate) return;

  const conceptData = candidateToConcept(candidate);
  const prototypeId = ensureConceptPrototype(conceptData);

  // The orbit already chose the spot: the ring position that was clicked.
  // snapToGrid takes a CENTRE and returns a top-left, same as the branch
  // below — so both paths are fed the centre, and neither offsets it twice.
  const prototype = useGraphStore.getState().nodePrototypes.get(prototypeId)
    || { id: prototypeId, name: conceptData.name, color: conceptData.color };
  const nodeDims = getNodeDimensions(prototype, false, null);
  const position = gridMode !== 'off'
    ? snapToGridAnimated(centerX, centerY, nodeDims.currentWidth, nodeDims.currentHeight, null)
    : { x: centerX - nodeDims.currentWidth / 2, y: centerY - nodeDims.currentHeight / 2 };

  const focusedInstanceId = selectedInstanceIds.size >= 1 ? [...selectedInstanceIds][0] : null;
  const rawPredicate = conceptData.defaultPredicate || candidate.predicate || 'relatedTo';

  try {
    placeConcept({
      graphId: activeGraphId,
      concept: conceptData,
      prototypeId,
      position,
      reveal: false,
      joinGroup: false,
      anchorInstanceId: focusedInstanceId,
      predicate: rawPredicate,
      direction: 'out',
      provenance: {
        source: conceptData.source,
        uri: conceptData.semanticMetadata?.originalUri || null,
        predicate: rawPredicate,
        retrieved_at: conceptData.discoveredAt || new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[handleOrbitItemClick] Placement failed:', err);
  }

  exitOrbitMode();
}
