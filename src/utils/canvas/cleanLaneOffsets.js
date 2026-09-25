/**
 * Lane offsets for the clean routing style (moved verbatim from NodeCanvas's
 * cleanLaneOffsets memo). NodeCanvas memoizes it on the same dependencies.
 */
import { NODE_CORNER_RADIUS } from '../../constants';
import { calculateStaggeredPosition, getPortPosition } from './portPositioning.js';

export function computeCleanLaneOffsets(ctx) {
  const {
    anchorGeometryFor, baseDimsById, cleanLaneSpacing, draggingNodeInfo, edges, enableAutoRouting,
    nodeById, nodes, prevCleanLaneOffsetsRef, routingStyle, textSettings,
  } = ctx;
  const portAssignments = new Map(); // edgeId -> { sourcePort, destPort }
  // PERF: Skip expensive port assignment during drag — reuse cached result
  if (draggingNodeInfo) return prevCleanLaneOffsetsRef.current || portAssignments;
  // NOTE: iterate ALL edges (not visibleEdges) so port stagger indices stay
  // stable as the visible set changes during pan/zoom. Otherwise, when a
  // neighboring edge pops in/out of visibility at high zoom, the stagger
  // length shifts and the still-visible edge jumps to a new lane = flicker.
  if (!enableAutoRouting || routingStyle !== 'clean' || !edges?.length) return portAssignments;

  try {
    // Step 1: Group edges by node pairs and assign ports intelligently
    const nodePortUsage = new Map(); // nodeId -> { top: [], bottom: [], left: [], right: [] }

    // Initialize port usage tracking for all nodes
    for (const node of nodes) {
      nodePortUsage.set(node.id, { top: [], bottom: [], left: [], right: [] });
    }

    // Step 2: Pick a side for each edge end, and only then stagger along it.
    //
    // Two passes, not one. Fitting a fan onto a side needs to know how many
    // edges will end up on it, and that isn't known until every edge has
    // chosen its sides — a single pass can only see the edges before it. The
    // old one-pass version handled the overflow by wrapping the port index
    // modulo the lane count, which is exactly how several connections between
    // the same pair of nodes ended up sharing one port and drawing as one
    // line.
    const sideChoices = [];
    for (const edge of edges) {
      const sRaw = nodeById.get(edge.sourceId);
      const dRaw = nodeById.get(edge.destinationId);
      if (!sRaw || !dRaw) continue;

      const sDimsRaw = baseDimsById.get(sRaw.id);
      const dDimsRaw = baseDimsById.get(dRaw.id);
      if (!sDimsRaw || !dDimsRaw) continue;

      // Ports go on the box the connection actually meets — the title pill
      // for a group anchor. See anchorGeometryFor.
      const { node: s, dims: sDims } = anchorGeometryFor(sRaw, sDimsRaw);
      const { node: d, dims: dDims } = anchorGeometryFor(dRaw, dDimsRaw);

      // Calculate node centers
      const sCenterX = s.x + sDims.currentWidth / 2;
      const sCenterY = s.y + sDims.currentHeight / 2;
      const dCenterX = d.x + dDims.currentWidth / 2;
      const dCenterY = d.y + dDims.currentHeight / 2;

      // Determine optimal ports based on relative position - favor left/right sides
      const deltaX = dCenterX - sCenterX;
      const deltaY = dCenterY - sCenterY;

      let sourceSide, destSide;

      // Bias toward left/right sides (where text is) unless the connection is strongly vertical
      const isStronglyVertical = Math.abs(deltaY) > Math.abs(deltaX) * 1.5; // 1.5x bias toward horizontal

      if (isStronglyVertical) {
        // Strong vertical connection - use top/bottom
        sourceSide = deltaY > 0 ? 'bottom' : 'top';
        destSide = deltaY > 0 ? 'top' : 'bottom';
      } else {
        // Horizontal or diagonal - prefer left/right sides
        sourceSide = deltaX > 0 ? 'right' : 'left';
        destSide = deltaX > 0 ? 'left' : 'right';
      }

      // Calculate port positions on the non-rounded edge segments.
      //
      // Take the radius from each node's OWN dimensions. Recomputing it from
      // the global slider (as this used to) was wrong twice over: it dropped
      // the 1.4 geometry factor that getNodeDimensions applies, and it ignored
      // per-instance sizeMul entirely — so an independently-resized node
      // reported a 40px corner while actually drawing a ~112px one, and its
      // ports landed inside the rounded corner where the connection visibly
      // detaches from the node outline.
      const sCornerRadius = sDims.scaledCornerRadius ?? (NODE_CORNER_RADIUS * 1.4 * (textSettings?.nodeScale ?? 1.0)) ?? 8;
      const dCornerRadius = dDims.scaledCornerRadius ?? (NODE_CORNER_RADIUS * 1.4 * (textSettings?.nodeScale ?? 1.0)) ?? 8;

      // Claim a slot on each side; the fan gets sized in pass two.
      const sourceUsage = nodePortUsage.get(s.id)[sourceSide];
      const destUsage = nodePortUsage.get(d.id)[destSide];
      const sourceIndex = sourceUsage.length;
      const destIndex = destUsage.length;
      sourceUsage.push(edge.id);
      destUsage.push(edge.id);

      sideChoices.push({
        edgeId: edge.id, s, d, sDims, dDims, sCornerRadius, dCornerRadius,
        sourceSide, destSide, sourceIndex, destIndex, sourceUsage, destUsage,
      });
    }

    // Pass two: stagger, now that every side knows its full occupancy.
    for (const c of sideChoices) {
      const sourcePortPos = getPortPosition(c.s, c.sDims, c.sourceSide, c.sCornerRadius);
      const destPortPos = getPortPosition(c.d, c.dDims, c.destSide, c.dCornerRadius);

      portAssignments.set(c.edgeId, {
        sourcePort: calculateStaggeredPosition(
          sourcePortPos, c.sourceSide, c.sourceIndex, c.sDims, c.sCornerRadius,
          cleanLaneSpacing, c.sourceUsage.length
        ),
        destPort: calculateStaggeredPosition(
          destPortPos, c.destSide, c.destIndex, c.dDims, c.dCornerRadius,
          cleanLaneSpacing, c.destUsage.length
        ),
        sourceSide: c.sourceSide,
        destSide: c.destSide,
      });
    }

    prevCleanLaneOffsetsRef.current = portAssignments;
    return portAssignments;
  } catch (error) {

    return new Map();
  }
}
