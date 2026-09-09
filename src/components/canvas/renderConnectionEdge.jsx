import React from 'react';
import { getNodeDimensions } from '../../utils.js';
import { edgeLabelGlyphAdvances, truncateEdgeLabel } from '../../services/textMeasurement.js';
import { GLYPH_SPRITE_LAYERS, glyphQuadAt, peekGlyphSprite, peekLabelSprite, requestGlyphSprite, requestLabelSprite, spritesUsable } from '../../services/labelSpriteCache.js';
import { getConnectionLabelColors } from '../../utils/colorUtils.js';
import { haptic } from '../../services/haptics.js';
import { resolveEdgeLabelFontSize } from '../../services/layoutGeometry.js';
import { buildShellCutoutPath } from '../../services/groupLayout.js';
import { getLineNodeIntersection, getNodeEdgeIntersection, getNodeHitbox, getVisualConnectionEndpoints } from '../../utils/canvas/nodeHitbox.js';
import { stabilizeLabelPosition } from '../../utils/canvas/labelStabilization.js';
import { NODE_DEFAULT_COLOR } from '../../constants';
import { computeCleanRouting, computeLombardiRouting, computeManhattanRouting, labelArcGlyphFrames, rebuildRoutedPath, trimRoutePreviewEnd } from '../../utils/canvas/edgeRouting.js';
import { DEFAULT_TIP_INSET, POLY_TIP, calculateParallelEdgePath, getCurveBorderCrossings, getCurvedArrowPlacement, getTrimmedBezierPath } from '../../utils/canvas/parallelEdgeUtils.js';
import SelfLoopEdge from './SelfLoopEdge.jsx';
import { LABEL_TRUNCATE_FILL, chooseRoutedLabelPlacement, estimateTextWidth, labelBoundsFor, labelFrameToken, routedLabelSpan, straightLabelTransform } from '../../utils/canvas/edgeLabelPlacement.js';

/**
 * renderConnectionEdge — the renderer for a single connection.
 *
 * One renderer for every connection, called from each of the z-layers in
 * NodeCanvas. It used to be two near-identical 1500-line copies, and they had
 * drifted — the "above" copy was missing the touch/pointer hitbox handlers, so
 * connections between node-group members could not be tapped.
 *
 * Lifted verbatim out of NodeCanvas, where it lived as a ~1,800-line closure
 * declared inline in the JSX. It closed over 53 values from the component
 * scope, which meant nothing about its inputs was stated anywhere and every
 * NodeCanvas commit re-ran the whole of it — routing, border crossings, Bezier
 * trims, shell cutouts and the full label placement solve — for every visible
 * edge. That commit was measured at 143ms with labels on against 15ms with them
 * off.
 *
 * Moving it here does not by itself make anything faster. What it does is make
 * the input surface explicit: everything the renderer reads now arrives in
 * `ctx`, so the cost of a re-solve can be reasoned about, cached, and
 * eventually skipped. The body below is byte-identical to what it replaced
 * apart from a uniform de-indent, so this step cannot change what is painted.
 *
 * INVARIANT — the emitted DOM is a contract, not an implementation detail.
 * useNodeDrag.js caches element references at drag start by querying for
 * `[data-edge-id]`, `[data-edge-hit]`, `[data-shell-clip]`, `[data-arrow]`,
 * `[data-endpoint-dot]`, `[data-label-sprite]`, `[data-glyph-layer]` and
 * `text[data-connection-label]`, then writes those elements directly on every
 * drag frame. The `connection-label` / `connection-label-ring` class names are
 * likewise a CSS contract, driven by `.canvas-moving` in NodeCanvas.css. Rename
 * or drop any of them and node drag breaks silently at runtime — nothing here
 * will throw.
 *
 * @param {object} edge Raw edge record from the store.
 * @param {object} ctx  Every component-scope value the renderer reads.
 * @returns {JSX.Element|null}
 */
export function renderConnectionEdge(edge, ctx) {
  const {
    anchorPositionUpdatesRef,
    baseDimsById,
    canvasSize,
    cleanLaneOffsets,
    cleanLaneSpacing,
    connectionLabelColorMode,
    connectionLabelOuterRing,
    connectionLabelRingWidth,
    connectionLabelSize,
    connectionLabelTruncate,
    connectionOrbHitsRef,
    connectionWidth,
    curveLabels,
    curveSpacing,
    curvedLabelQuantum,
    darkMode,
    draggingNodeInfo,
    edgeCurveInfo,
    edgePrototypesMap,
    edgeTouchHandlers,
    enableAutoRouting,
    getEdgeHitboxHandlers,
    hoveredEdgeInfo,
    ignoreCanvasClick,
    isRoutedStyle,
    labelArcMinBow,
    labelCrossingIndex,
    labelHaloEnabled,
    labelObstacleOptions,
    labelRingEnabled,
    labelSpriteScale,
    labelSpritesEnabled,
    lombardiCurvature,
    lombardiLaneSpacing,
    lombardiMinBow,
    lombardiTangents,
    manhattanBends,
    nodeById,
    nodePrototypesMap,
    nodes,
    orbToggleEchoRef,
    orthogonalLaneSpacing,
    placedLabelsRef,
    quantizeLabelAngle,
    routingStyle,
    selectEdgeFromClick,
    selectedEdgeId,
    selectedEdgeIds,
    selectedInstanceIds,
    showConnectionNames,
    storeActions,
    textSettings,
    visibleNodeIds,
  } = ctx;

  let sourceNode = nodeById.get(edge.sourceId);
  let destNode = nodeById.get(edge.destinationId);

  if (!sourceNode || !destNode) {
    return null;
  }
  // For anchor nodes, use current-frame ref positions (not stale store positions)
  // and title dimensions instead of node dimensions
  const sAnchorInfo = sourceNode.isGroupAnchor ? anchorPositionUpdatesRef.current.get(sourceNode.id) : null;
  const eAnchorInfo = destNode.isGroupAnchor ? anchorPositionUpdatesRef.current.get(destNode.id) : null;
  if (sAnchorInfo) sourceNode = { ...sourceNode, x: sAnchorInfo.x, y: sAnchorInfo.y };
  if (eAnchorInfo) destNode = { ...destNode, x: eAnchorInfo.x, y: eAnchorInfo.y };
  const sNodeDims = sAnchorInfo
    ? { currentWidth: sAnchorInfo.width, currentHeight: sAnchorInfo.height }
    : (baseDimsById.get(sourceNode.id) || getNodeDimensions(sourceNode, false, null));
  const eNodeDims = eAnchorInfo
    ? { currentWidth: eAnchorInfo.width, currentHeight: eAnchorInfo.height }
    : (baseDimsById.get(destNode.id) || getNodeDimensions(destNode, false, null));

  if (edge.sourceId === edge.destinationId) {
    const isHovered = !draggingNodeInfo && hoveredEdgeInfo?.edgeId === edge.id;
    const isSelected = selectedEdgeId === edge.id || selectedEdgeIds.has(edge.id);
    let selfColor = sourceNode.color || NODE_DEFAULT_COLOR;
    let selfConnectionName = 'Connection';
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      const defProto = nodePrototypesMap.get(edge.definitionNodeIds[0]);
      if (defProto) {
        selfColor = defProto.color || selfColor;
        selfConnectionName = defProto.name || selfConnectionName;
      }
    } else if (edge.typeNodeId) {
      if (edge.typeNodeId === 'base-connection-prototype') {
        selfColor = '#000000';
      } else {
        const proto = edgePrototypesMap.get(edge.typeNodeId);
        if (proto) {
          selfColor = proto.color || selfColor;
          selfConnectionName = proto.name || selfConnectionName;
        }
      }
    }
    const selfFontSize = resolveEdgeLabelFontSize(textSettings, connectionLabelSize);
    return (
      <SelfLoopEdge
        key={`edge-${edge.id}`}
        edge={edge}
        node={sourceNode}
        nodeDims={sNodeDims}
        curveInfo={edgeCurveInfo.get(edge.id)}
        isHovered={isHovered}
        isSelected={isSelected}
        edgeColor={selfColor}
        showConnectionNames={showConnectionNames}
        selectedEdgeIds={selectedEdgeIds}
        storeActions={storeActions}
        ignoreCanvasClick={ignoreCanvasClick}
        edgeTouchHandlers={edgeTouchHandlers}
        connectionName={selfConnectionName}
        connectionFontSize={selfFontSize}
        connectionWidth={connectionWidth}
        placedLabelsRef={placedLabelsRef}
      />
    );
  }

  // Check if this is a directed edge (has arrows)
  const arrowsToward = edge.directionality?.arrowsToward instanceof Set
    ? edge.directionality.arrowsToward
    : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);

  // Check which ends have arrows
  const hasSourceArrow = arrowsToward.has(sourceNode.id);
  const hasDestArrow = arrowsToward.has(destNode.id);
  const isDirected = arrowsToward.size > 0;

  // Connection endpoint calculation
  let x1, y1, x2, y2;
  if (isRoutedStyle) {
    // Routed styles - use centers as base (ports/arcs override later)
    x1 = sourceNode.x + sNodeDims.currentWidth / 2;
    y1 = sourceNode.y + sNodeDims.currentHeight / 2;
    x2 = destNode.x + eNodeDims.currentWidth / 2;
    y2 = destNode.y + eNodeDims.currentHeight / 2;
  } else if (isDirected && (hasSourceArrow || hasDestArrow)) {
    // Directed connections: sides with arrows draw to the border, sides
    // without draw to the center — the stub from center to border is
    // occluded, by the node itself or (for an anchor) by the group shell
    // plus the shell-cutout clip below.
    // Use edge-based calculation, then selectively apply results.
    // For thing-group endpoints, clip against the group's full outer box
    // so the arrow-side line terminates just outside the box (the anchor
    // tab sits inside it and the box paints on top, hiding a tab-edge end).
    const endpoints = getVisualConnectionEndpoints(
      sourceNode, destNode,
      sNodeDims, eNodeDims,
      selectedInstanceIds.has(sourceNode.id),
      selectedInstanceIds.has(destNode.id),
      true,
      sAnchorInfo?.outerBounds || null,
      eAnchorInfo?.outerBounds || null
    );

    x1 = hasSourceArrow ? endpoints.x1 : sourceNode.x + sNodeDims.currentWidth / 2;
    y1 = hasSourceArrow ? endpoints.y1 : sourceNode.y + sNodeDims.currentHeight / 2;
    x2 = hasDestArrow ? endpoints.x2 : destNode.x + eNodeDims.currentWidth / 2;
    y2 = hasDestArrow ? endpoints.y2 : destNode.y + eNodeDims.currentHeight / 2;
  } else {
    // Non-directed connections: use centers for traditional appearance
    x1 = sourceNode.x + sNodeDims.currentWidth / 2;
    y1 = sourceNode.y + sNodeDims.currentHeight / 2;
    x2 = destNode.x + eNodeDims.currentWidth / 2;
    y2 = destNode.y + eNodeDims.currentHeight / 2;
  }

  // Suppress edge hover (connection dots, hover-widened arrows, etc.)
  // while dragging — the dots would otherwise freeze at the last
  // hovered position instead of tracking the moving node.
  const isHovered = !draggingNodeInfo && hoveredEdgeInfo?.edgeId === edge.id;
  const isSelected = selectedEdgeId === edge.id || selectedEdgeIds.has(edge.id);
  // Selected connections get the same endpoint-dot affordances as hovered
  // ones: the line shortens, dots sit at the pulled-back preview position,
  // and curved edges trim to their arrowhead depth. `isHovered` is force-
  // cleared during a node drag (see above), so routing selection geometry
  // through this flag — which stays true across the drag — keeps a selected
  // edge's dots tracking the moving node in lockstep with its arrowheads.
  const isActive = isHovered || isSelected;




  // Get edge color - prioritize definitionNodeIds for custom types, then typeNodeId for base types
  const getEdgeColor = () => {
    // First check definitionNodeIds (for custom connection types set via control panel)
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
      if (definitionNode) {
        return definitionNode.color || NODE_DEFAULT_COLOR;
      }
    }

    // Then check typeNodeId (for base connection type)
    if (edge.typeNodeId) {
      // Special handling for base connection prototype - ensure it's black
      if (edge.typeNodeId === 'base-connection-prototype') {
        return '#000000'; // Black color for base connection
      }
      const edgePrototype = edgePrototypesMap.get(edge.typeNodeId);
      if (edgePrototype) {
        return edgePrototype.color || NODE_DEFAULT_COLOR;
      }
    }

    return destNode.color || NODE_DEFAULT_COLOR;
  };
  const edgeColor = getEdgeColor();

  // Calculate arrow position and rotation
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);

  // Calculate edge intersections. getNodeEdgeIntersection is shared with
  // the drag-time DOM writer (see nodeHitbox.js) so both agree. For thing-group anchors the arrow tip must
  // sit on the group's OUTER box edge, not the anchor tab (which hides under
  // the box). getNodeEdgeIntersection rays from the box CENTER, which is wrong
  // here because the line doesn't pass through the outer-box center (the title
  // tab is at the top). Use the actual center line's exit point from the box.
  const sCenterForArrow = sourceNode.x + sNodeDims.currentWidth / 2;
  const sCenterForArrowY = sourceNode.y + sNodeDims.currentHeight / 2;
  const dCenterForArrow = destNode.x + eNodeDims.currentWidth / 2;
  const dCenterForArrowY = destNode.y + eNodeDims.currentHeight / 2;
  const sourceIntersection = sAnchorInfo?.outerBounds
    ? getLineNodeIntersection(
        sCenterForArrow, sCenterForArrowY, dCenterForArrow, dCenterForArrowY,
        { minX: sAnchorInfo.outerBounds.x, minY: sAnchorInfo.outerBounds.y,
          maxX: sAnchorInfo.outerBounds.x + sAnchorInfo.outerBounds.width,
          maxY: sAnchorInfo.outerBounds.y + sAnchorInfo.outerBounds.height }
      )
    : getNodeEdgeIntersection(
        sourceNode.x, sourceNode.y, sNodeDims.currentWidth, sNodeDims.currentHeight,
        dx / length, dy / length
      );

  const destIntersection = eAnchorInfo?.outerBounds
    ? getLineNodeIntersection(
        dCenterForArrow, dCenterForArrowY, sCenterForArrow, sCenterForArrowY,
        { minX: eAnchorInfo.outerBounds.x, minY: eAnchorInfo.outerBounds.y,
          maxX: eAnchorInfo.outerBounds.x + eAnchorInfo.outerBounds.width,
          maxY: eAnchorInfo.outerBounds.y + eAnchorInfo.outerBounds.height }
      )
    : getNodeEdgeIntersection(
        destNode.x, destNode.y, eNodeDims.currentWidth, eNodeDims.currentHeight,
        -dx / length, -dy / length
      );

  // Determine if each end of the edge should be shortened for arrows
  // (arrowsToward already calculated earlier for endpoint logic)

  // Check if this is a curved edge (parallel edge with non-zero offset)
  // The middle edge in an odd-numbered group has offset 0 and is straight
  const curveInfo = edgeCurveInfo.get(edge.id);
  let isCurvedEdge = false;
  if (curveInfo && curveInfo.totalInPair > 1) {
    const centerIndex = (curveInfo.totalInPair - 1) / 2;
    const offsetSteps = curveInfo.pairIndex - centerIndex;
    isCurvedEdge = offsetSteps !== 0;
  }

  // Only shorten connections at ends with arrows or hover state
  // For curved edges, NEVER change endpoints - we use trimmed paths instead
  // This ensures the curve shape stays consistent
  let shouldShortenSource = isCurvedEdge
    ? false  // Never change curve endpoints
    : (isActive || arrowsToward.has(sourceNode.id));
  let shouldShortenDest = isCurvedEdge
    ? false  // Never change curve endpoints
    : (isActive || arrowsToward.has(destNode.id));
  if (enableAutoRouting && routingStyle === 'manhattan') {
    // In Manhattan mode, never shorten for hover—only for actual arrows
    shouldShortenSource = arrowsToward.has(sourceNode.id);
    shouldShortenDest = arrowsToward.has(destNode.id);
  }

  // Determine actual start/end points for rendering
  let startX, startY, endX, endY;

  // For clean routing, use assigned ports; otherwise use intersection-based positioning
  if (enableAutoRouting && routingStyle === 'clean') {
    const portAssignment = cleanLaneOffsets.get(edge.id);
    if (portAssignment) {
      const { sourcePort, destPort } = portAssignment;

      // Check if this edge has directional arrows
      const hasSourceArrow = arrowsToward.has(sourceNode.id);
      const hasDestArrow = arrowsToward.has(destNode.id);

      // Use ports for directional connections, centers for non-directional
      startX = hasSourceArrow ? sourcePort.x : x1;
      startY = hasSourceArrow ? sourcePort.y : y1;
      endX = hasDestArrow ? destPort.x : x2;
      endY = hasDestArrow ? destPort.y : y2;
    } else {
      // Fallback to node centers for clean routing
      startX = x1;
      startY = y1;
      endX = x2;
      endY = y2;
    }
  } else {
    // Use intersection-based positioning for other routing modes.
    // Visible LINE endpoint uses the 4px-inset variant so the round
    // line cap (strokeLinecap="round", strokeWidth=6 → cap radius 3)
    // stops cleanly behind the arrow polygon's flat base. Arrow
    // placement still uses sourceIntersection/destIntersection (no
    // inset) downstream, so the arrow tip anchors at the literal
    // border.
    const insetLineEndpoints = (shouldShortenSource || shouldShortenDest)
      ? getVisualConnectionEndpoints(
        sourceNode, destNode, sNodeDims, eNodeDims,
        selectedInstanceIds.has(sourceNode.id),
        selectedInstanceIds.has(destNode.id),
        true,
        sAnchorInfo?.outerBounds || null,
        eAnchorInfo?.outerBounds || null
      )
      : null;
    startX = shouldShortenSource ? (insetLineEndpoints?.x1 ?? sourceIntersection?.x ?? x1) : x1;
    startY = shouldShortenSource ? (insetLineEndpoints?.y1 ?? sourceIntersection?.y ?? y1) : y1;
    endX = shouldShortenDest ? (insetLineEndpoints?.x2 ?? destIntersection?.x ?? x2) : x2;
    endY = shouldShortenDest ? (insetLineEndpoints?.y2 ?? destIntersection?.y ?? y2) : y2;
  }

  // Straight hover-preview: hovering an arrow-less end of a NON-curved edge
  // should look like a preview arrow — pull the visible line back by roughly
  // an arrowhead's length so the hover dot sits ahead of it at the border,
  // exactly where a real arrowhead would land. Curved edges do this via the
  // trimT trim below; Manhattan/Clean keep their own geometry.
  const isStraightRouting = !isRoutedStyle;
  let lineStartX = startX, lineStartY = startY, lineEndX = endX, lineEndY = endY;
  let straightDotSource = null, straightDotDest = null;
  if (isActive && isStraightRouting && !isCurvedEdge && length > 0) {
    const ux = dx / length, uy = dy / length;
    const previewBack = POLY_TIP * connectionWidth + 8;
    if (!arrowsToward.has(sourceNode.id) && sourceIntersection) {
      lineStartX = sourceIntersection.x + ux * previewBack;
      lineStartY = sourceIntersection.y + uy * previewBack;
      // Dot caps the shortened line end (tracks the connection end).
      straightDotSource = { x: lineStartX, y: lineStartY };
    }
    if (!arrowsToward.has(destNode.id) && destIntersection) {
      lineEndX = destIntersection.x - ux * previewBack;
      lineEndY = destIntersection.y - uy * previewBack;
      straightDotDest = { x: lineEndX, y: lineEndY };
    }
  }

  // Routed (Manhattan/Clean) geometry, computed ONCE per edge from the
  // shared helpers in edgeRouting.js — the same helpers useNodeDrag
  // uses. This used to be hand-inlined here AND again in the
  // above-groups block below AND partially re-derived at each <path>,
  // so the settled render and the drag-time render had no way to stay
  // in agreement. Keep every routed path reading from orthoPathD.
  let orthoRouting = null;
  let manhattanPathD = null;
  let manhattanSourceSide = null;
  let manhattanDestSide = null;

  if (enableAutoRouting && routingStyle === 'manhattan') {
    orthoRouting = computeManhattanRouting(sourceNode, destNode, sNodeDims, eNodeDims, manhattanBends, {
      curveInfo: edgeCurveInfo.get(edge.id), laneSpacing: orthogonalLaneSpacing,
    });
    startX = orthoRouting.startX;
    startY = orthoRouting.startY;
    endX = orthoRouting.endX;
    endY = orthoRouting.endY;
    manhattanPathD = orthoRouting.pathD;
    manhattanSourceSide = orthoRouting.sourceSide;
    manhattanDestSide = orthoRouting.destSide;
  } else if (enableAutoRouting && routingStyle === 'clean') {
    // startX/startY/endX/endY were already resolved from the port
    // assignment above and agree with this polyline's endpoints.
    orthoRouting = computeCleanRouting(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
  } else if (enableAutoRouting && routingStyle === 'lombardi') {
    orthoRouting = computeLombardiRouting(
      edge, sourceNode, destNode, sNodeDims, eNodeDims, lombardiTangents,
      { curvature: lombardiCurvature, selectedInstanceIds,
        curveInfo: edgeCurveInfo.get(edge.id), laneSpacing: lombardiLaneSpacing,
        // A bow the viewer cannot see is drawn as the line it
        // looks like, rather than as an arc of vast radius —
        // see connectionCurveMinBow.
        minBow: lombardiMinBow,
        // The arrowhead polygon is drawn at scale(connectionWidth), so
        // the routing has to back its ends off by the same factor.
        connectionWidth,
        sourceBounds: sAnchorInfo?.outerBounds ? {
          minX: sAnchorInfo.outerBounds.x, minY: sAnchorInfo.outerBounds.y,
          maxX: sAnchorInfo.outerBounds.x + sAnchorInfo.outerBounds.width,
          maxY: sAnchorInfo.outerBounds.y + sAnchorInfo.outerBounds.height } : null,
        destBounds: eAnchorInfo?.outerBounds ? {
          minX: eAnchorInfo.outerBounds.x, minY: eAnchorInfo.outerBounds.y,
          maxX: eAnchorInfo.outerBounds.x + eAnchorInfo.outerBounds.width,
          maxY: eAnchorInfo.outerBounds.y + eAnchorInfo.outerBounds.height } : null }
    );
    startX = orthoRouting.startX;
    startY = orthoRouting.startY;
    endX = orthoRouting.endX;
    endY = orthoRouting.endY;
  }

  // Orthogonal hover preview — the counterpart of the straight-edge
  // pull-back above, which Manhattan/Clean never had. Retract each
  // arrow-less end out of its node and a further arrowhead-length, and
  // drop the hover dot on the new endpoint. Without this these modes
  // had neither the shortening nor the dots, so a hovered connection
  // gave no affordance for adding an arrow.
  let orthoPathD = orthoRouting?.pathD || null;
  // Hit target always uses the FULL route: pointer-move hover detection
  // measures against the untrimmed polyline, so shrinking the click path
  // on hover would desync the two (and make the retracted ends dead).
  const orthoHitPathD = orthoPathD;
  if (orthoRouting && isActive) {
    // A hovered dot sits as far back as an arrow would. Lombardi used
    // to need its own branch here because its arrows retreated by a
    // flat constant; now that they back off by POLY_TIP * width like
    // everything else, there is one expression for every style.
    const previewBack = POLY_TIP * connectionWidth + 8;
    const sBox = sAnchorInfo?.outerBounds
      ? { minX: sAnchorInfo.outerBounds.x, minY: sAnchorInfo.outerBounds.y,
          maxX: sAnchorInfo.outerBounds.x + sAnchorInfo.outerBounds.width,
          maxY: sAnchorInfo.outerBounds.y + sAnchorInfo.outerBounds.height }
      : getNodeHitbox(sourceNode, sNodeDims, selectedInstanceIds.has(sourceNode.id));
    const eBox = eAnchorInfo?.outerBounds
      ? { minX: eAnchorInfo.outerBounds.x, minY: eAnchorInfo.outerBounds.y,
          maxX: eAnchorInfo.outerBounds.x + eAnchorInfo.outerBounds.width,
          maxY: eAnchorInfo.outerBounds.y + eAnchorInfo.outerBounds.height }
      : getNodeHitbox(destNode, eNodeDims, selectedInstanceIds.has(destNode.id));

    let previewPts = orthoRouting.points;
    if (!arrowsToward.has(sourceNode.id)) {
      const t = trimRoutePreviewEnd(orthoRouting, previewPts, sBox, true, previewBack);
      previewPts = t.points;
      straightDotSource = t.endpoint;
    }
    if (!arrowsToward.has(destNode.id)) {
      const t = trimRoutePreviewEnd(orthoRouting, previewPts, eBox, false, previewBack);
      previewPts = t.points;
      straightDotDest = t.endpoint;
    }
    // Arc routings re-emit a shorter arc on the SAME circle here, so a
    // hovered Lombardi edge retracts without losing its curvature.
    orthoPathD = rebuildRoutedPath(orthoRouting, previewPts);
  }

  // Calculate parallel edge path using centralized utility
  // Note: curveInfo was already retrieved earlier for shouldShorten logic
  // Curved edges anchor an arrow-less end at the node CENTER and an
  // arrow-side end at the node BORDER (see x1/y1 logic above). The border
  // anchor is what visibly shortens the connection when an arrow is active.
  // On hover we want that same shortening as a preview, so pull the
  // arrow-less curve ends to the border too — making hover match arrow-active
  // geometry exactly (same parallelPath → same trim, arrows, dots).
  let curveStartX = startX, curveStartY = startY, curveEndX = endX, curveEndY = endY;
  if (isCurvedEdge && isActive) {
    const hoverBorder = getVisualConnectionEndpoints(
      sourceNode, destNode, sNodeDims, eNodeDims,
      selectedInstanceIds.has(sourceNode.id),
      selectedInstanceIds.has(destNode.id),
      true,
      sAnchorInfo?.outerBounds || null,
      eAnchorInfo?.outerBounds || null
    );
    if (!hasSourceArrow) { curveStartX = hoverBorder.x1; curveStartY = hoverBorder.y1; }
    if (!hasDestArrow) { curveEndX = hoverBorder.x2; curveEndY = hoverBorder.y2; }
  }
  const parallelPath = calculateParallelEdgePath(curveStartX, curveStartY, curveEndX, curveEndY, curveInfo, curveSpacing);
  // A routed style OWNS the geometry, so the parallel-edge bezier is
  // not what gets drawn — and everything downstream that keys off
  // useCurve (arrowhead placement, hover-dot border crossings, the
  // trimmed path) would otherwise measure against a curve nobody can
  // see. Parallel routed edges are already separated by the routing
  // itself: clean staggers their ports, Lombardi fans them into
  // distinct tangent slots.
  const useCurve = parallelPath.type === 'curve' && !orthoRouting;

  // Curved arrow placement (tips a fixed px from each endpoint, tangent angle).
  // Shared source of truth for both the arrowheads and the curve trim below.
  const curvedArrowPlacement = useCurve
    ? getCurvedArrowPlacement(parallelPath, connectionWidth, DEFAULT_TIP_INSET)
    : null;

  // For label placement, always use the visible segment (edge-to-edge).
  // This ensures labels are centered on the visible portion, not the drawn
  // portion. When an endpoint is a thing-group anchor, clip against the
  // group's full outer box so the segment excludes the whole group (not just
  // the title tab) — the midpoint then sits centered on the truly-visible run.
  const visibleEndpoints = getVisualConnectionEndpoints(
    sourceNode, destNode,
    sNodeDims, eNodeDims,
    selectedInstanceIds.has(sourceNode.id),
    selectedInstanceIds.has(destNode.id),
    true,
    sAnchorInfo?.outerBounds || null,
    eAnchorInfo?.outerBounds || null
  );
  const labelPlacementPath = calculateParallelEdgePath(
    visibleEndpoints.x1, visibleEndpoints.y1,
    visibleEndpoints.x2, visibleEndpoints.y2,
    curveInfo,
    curveSpacing
  );
  // Hover dots sit exactly where the bowed curve crosses each node's
  // border — the true visible connection end. The curve runs center→center
  // and bows out perpendicular, so its border crossing is laterally offset
  // from the straight chord's crossing (using the chord put dots off on
  // both axes). Walk the actual bezier out of each node box to find it.
  const dotBorderEndpoints = (useCurve && parallelPath.ctrlX !== null)
    ? (() => {
        const sBox = sAnchorInfo?.outerBounds
          ? { minX: sAnchorInfo.outerBounds.x, minY: sAnchorInfo.outerBounds.y,
              maxX: sAnchorInfo.outerBounds.x + sAnchorInfo.outerBounds.width,
              maxY: sAnchorInfo.outerBounds.y + sAnchorInfo.outerBounds.height }
          : { minX: sourceNode.x, minY: sourceNode.y,
              maxX: sourceNode.x + sNodeDims.currentWidth,
              maxY: sourceNode.y + sNodeDims.currentHeight };
        const eBox = eAnchorInfo?.outerBounds
          ? { minX: eAnchorInfo.outerBounds.x, minY: eAnchorInfo.outerBounds.y,
              maxX: eAnchorInfo.outerBounds.x + eAnchorInfo.outerBounds.width,
              maxY: eAnchorInfo.outerBounds.y + eAnchorInfo.outerBounds.height }
          : { minX: destNode.x, minY: destNode.y,
              maxX: destNode.x + eNodeDims.currentWidth,
              maxY: destNode.y + eNodeDims.currentHeight };
        const c = getCurveBorderCrossings(
          parallelPath.startX, parallelPath.startY,
          parallelPath.ctrlX, parallelPath.ctrlY,
          parallelPath.endX, parallelPath.endY,
          sBox, eBox
        );
        return { x1: c.source.x, y1: c.source.y, x2: c.dest.x, y2: c.dest.y };
      })()
    : null;

  // For hover effect or arrows on curved edges, trim the curve so it ends
  // exactly at the arrowhead tips (never overshoots them). Only trim the
  // end(s) that actually have an arrow; a plain hover keeps a small cosmetic
  // trim. Uses the SAME t values that place the arrowheads (curvedArrowPlacement)
  // so line and arrow stay in lockstep.
  let trimmedPath = null;
  const shouldTrimCurve = useCurve && parallelPath.ctrlX !== null &&
    (isActive || hasSourceArrow || hasDestArrow);
  if (shouldTrimCurve) {
    // On hover OR with a real arrow, pull the curve back to the arrowhead's
    // base depth (trimT) so a plain hover looks like a preview arrow — the
    // border-crossing dot then sits ahead of the line end, in the gap where
    // an arrowhead would go.
    const tStart = curvedArrowPlacement
      ? curvedArrowPlacement.source.trimT
      : (isActive ? 0.08 : 0);
    const tEnd = curvedArrowPlacement
      ? curvedArrowPlacement.dest.trimT
      : (isActive ? 0.92 : 1);
    trimmedPath = getTrimmedBezierPath(
      parallelPath.startX, parallelPath.startY,
      parallelPath.ctrlX, parallelPath.ctrlY,
      parallelPath.endX, parallelPath.endY,
      tStart, tEnd
    );
  }

  // Shell-cutout clip. An arrow-less end that lands on a node-group
  // anchor is drawn to the title-pill center, inside the group's box,
  // and relies on the shell to hide the stub — which the shell only
  // does when it paints above this connection. When the other end is
  // deeper in the nesting, it doesn't. Cutting the group's box out of
  // the connection reproduces that occlusion at any paint order, and
  // unlike simply ending the line at the boundary it cuts ALONG the
  // boundary, so there's no leftover cap nub at the rim.
  //
  // Only arrow-less anchor ends need it: an arrow end already
  // terminates on the border with its head outside the box, and
  // clipping there would slice the arrowhead.
  const clippedShells = [];
  if (sAnchorInfo?.shellRect && !hasSourceArrow) clippedShells.push(sAnchorInfo.shellRect);
  if (eAnchorInfo?.shellRect && !hasDestArrow) clippedShells.push(eAnchorInfo.shellRect);
  const shellClipId = clippedShells.length > 0 ? `edge-shell-clip-${edge.id}` : null;

  return (
    <g key={`edge-${edge.id}`} data-edge-id={edge.id}>
      {shellClipId && (
        <defs>
          <clipPath id={shellClipId} clipPathUnits="userSpaceOnUse">
            <path
              data-shell-clip
              d={buildShellCutoutPath(
                { x: canvasSize.offsetX, y: canvasSize.offsetY, w: canvasSize.width, h: canvasSize.height },
                clippedShells
              )}
              clipRule="evenodd"
            />
          </clipPath>
        </defs>
      )}
      <g clipPath={shellClipId ? `url(#${shellClipId})` : undefined}>
      {/* Main edge line - always same thickness */}
      {/* Glow effect for selected or hovered edge */}
      {(isSelected || isHovered) && (
        orthoRouting ? (
          <path
            d={orthoPathD}
            fill="none"
            stroke={edgeColor}
            strokeWidth={20 * connectionWidth}
            opacity={isSelected ? "0.3" : "0.2"}
            style={{
              filter: `drop-shadow(0 0 8px ${edgeColor})`
            }}
            strokeLinecap="round"
          />
        ) : useCurve ? (
          <path
            d={trimmedPath ? trimmedPath.path : parallelPath.path}
            fill="none"
            stroke={edgeColor}
            strokeWidth={20 * connectionWidth}
            opacity={isSelected ? "0.3" : "0.2"}
            style={{
              filter: `drop-shadow(0 0 8px ${edgeColor})`
            }}
            strokeLinecap="round"
          />
        ) : (
          <line
            x1={lineStartX}
            y1={lineStartY}
            x2={lineEndX}
            y2={lineEndY}
            stroke={edgeColor}
            strokeWidth={20 * connectionWidth}
            opacity={isSelected ? "0.3" : "0.2"}
            style={{
              filter: `drop-shadow(0 0 8px ${edgeColor})`
            }}
          />
        )
      )}

      {orthoRouting ? (
        <>
          {routingStyle === 'manhattan' && !arrowsToward.has(sourceNode.id) && (
            <line x1={x1} y1={y1} x2={startX} y2={startY} stroke={edgeColor} strokeWidth={27 * connectionWidth} strokeLinecap="round" />
          )}
          {routingStyle === 'manhattan' && !arrowsToward.has(destNode.id) && (
            <line x1={endX} y1={endY} x2={x2} y2={y2} stroke={edgeColor} strokeWidth={27 * connectionWidth} strokeLinecap="round" />
          )}
          <path
            d={orthoPathD}
            fill="none"
            stroke={edgeColor}
            strokeWidth={27 * connectionWidth}
            style={{ transition: 'stroke 0.2s ease' }}
            strokeLinecap="round"
          />
        </>
      ) : useCurve ? (
        <path
          d={trimmedPath ? trimmedPath.path : parallelPath.path}
          fill="none"
          stroke={edgeColor}
          strokeWidth={27 * connectionWidth}
          style={{ transition: 'stroke 0.2s ease' }}
          strokeLinecap="round"
        />
      ) : (
        <line
          x1={lineStartX}
          y1={lineStartY}
          x2={lineEndX}
          y2={lineEndY}
          stroke={edgeColor}
          strokeWidth={27 * connectionWidth}
          style={{ transition: 'stroke 0.2s ease' }}
        />
      )}

      {/* Invisible click area for edge selection - matches hover detection */}
      {orthoRouting ? (
        <path
          data-edge-hit
          d={orthoHitPathD}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(50, 44 * connectionWidth)}
          style={{ cursor: 'pointer' }}
          {...edgeTouchHandlers(edge.id)}
          onClick={(e) => {
            e.stopPropagation();
            ignoreCanvasClick.current = true;
            // Select the nearest overlapping connection, not just the topmost hitbox
            selectEdgeFromClick(edge.id, e);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();

            // Find the defining node for this edge's connection type
            let definingNodeId = null;

            // Check definitionNodeIds first (for custom connection types)
            if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
              definingNodeId = edge.definitionNodeIds[0];
            } else if (edge.typeNodeId) {
              // Fallback to typeNodeId (for base connection type)
              definingNodeId = edge.typeNodeId;
            }

            // Open the panel tab for the defining node
            if (definingNodeId) {
              storeActions.openRightPanelNodeTab(definingNodeId);
            }
          }}
        />
      ) : useCurve ? (
        <path
          data-edge-hit
          d={parallelPath.path}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(50, 44 * connectionWidth)}
          style={{ cursor: 'pointer' }}
          {...edgeTouchHandlers(edge.id)}
          onClick={(e) => {
            e.stopPropagation();
            ignoreCanvasClick.current = true;
            // Select the nearest overlapping connection, not just the topmost hitbox
            selectEdgeFromClick(edge.id, e);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();

            // Find the defining node for this edge's connection type
            let definingNodeId = null;

            // Check definitionNodeIds first (for custom connection types)
            if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
              definingNodeId = edge.definitionNodeIds[0];
            } else if (edge.typeNodeId) {
              // Fallback to typeNodeId (for base connection type)
              definingNodeId = edge.typeNodeId;
            }

            // Open the panel tab for the defining node
            if (definingNodeId) {
              storeActions.openRightPanelNodeTab(definingNodeId);
            }
          }}
        />
      ) : (
        <line
          data-edge-hit
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth={Math.max(50, 44 * connectionWidth)}
          style={{ cursor: 'pointer' }}
          {...edgeTouchHandlers(edge.id)}
          onClick={(e) => {
            e.stopPropagation();
            ignoreCanvasClick.current = true;
            // Select the nearest overlapping connection, not just the topmost hitbox
            selectEdgeFromClick(edge.id, e);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();

            // Find the defining node for this edge's connection type
            let definingNodeId = null;

            // Check definitionNodeIds first (for custom connection types)
            if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
              definingNodeId = edge.definitionNodeIds[0];
            } else if (edge.typeNodeId) {
              // Fallback to typeNodeId (for base connection type)
              definingNodeId = edge.typeNodeId;
            }

            // Open the panel tab for the defining node
            if (definingNodeId) {
              storeActions.openRightPanelNodeTab(definingNodeId);
            }
          }}
        />
      )}

      </g>{/* end shell-cutout clip: line geometry only. Arrowheads,
          hover dots and the label stay outside it — an arrow end is
          never clipped anyway, and clipping the affordances would make
          them unclickable where they sit near a group's rim. */}

      {/* Smart directional arrows with clickable toggle */}
      {(() => {
        // Calculate arrow positions (use fallback if intersections fail)
        let sourceArrowX, sourceArrowY, destArrowX, destArrowY, sourceArrowAngle, destArrowAngle;

        // For curved edges, calculate arrow/dot positions along the curve
        if (useCurve && parallelPath.ctrlX !== null && curvedArrowPlacement) {
          // Curved edges: place arrowheads so their tips land a fixed pixel
          // distance from each endpoint (at the node border, like straight
          // edges) with the angle following the bezier tangent. Origins are
          // pre-backed-off by the helper so translate() targets are the group
          // origins the render expects.
          sourceArrowX = curvedArrowPlacement.source.x;
          sourceArrowY = curvedArrowPlacement.source.y;
          sourceArrowAngle = curvedArrowPlacement.source.angle; // Points back toward source
          destArrowX = curvedArrowPlacement.dest.x;
          destArrowY = curvedArrowPlacement.dest.y;
          destArrowAngle = curvedArrowPlacement.dest.angle; // Points toward dest
        } else if (orthoRouting?.kind === 'lombardi') {
          // Lombardi has no node sides — an arc can leave at any bearing.
          // The routing already resolved each arrowhead's origin and its
          // tangent angle, so take them rather than re-deriving a direction
          // from the chord (which on a bowed arc points somewhere else).
          const srcA = orthoRouting.sourceArrow;
          const dstA = orthoRouting.destArrow;
          sourceArrowX = srcA ? srcA.x : startX;
          sourceArrowY = srcA ? srcA.y : startY;
          sourceArrowAngle = srcA ? srcA.angle : 0;
          destArrowX = dstA ? dstA.x : endX;
          destArrowY = dstA ? dstA.y : endY;
          destArrowAngle = dstA ? dstA.angle : 0;
        } else if (enableAutoRouting && routingStyle === 'clean') {
          // Clean mode: use actual port assignments for proper arrow positioning
          const offset = 6;
          const portAssignment = cleanLaneOffsets.get(edge.id);

          if (portAssignment) {
            const { sourcePort, destPort, sourceSide, destSide } = portAssignment;

            // Position arrows pointing TOWARD the target node (into the edge)
            // Arrow tip points toward the node, positioned outside the edge
            switch (sourceSide) {
              case 'top':
                sourceArrowAngle = 90; // Arrow points down toward node
                sourceArrowX = sourcePort.x;
                sourceArrowY = sourcePort.y - offset;
                break;
              case 'bottom':
                sourceArrowAngle = -90; // Arrow points up toward node
                sourceArrowX = sourcePort.x;
                sourceArrowY = sourcePort.y + offset;
                break;
              case 'left':
                sourceArrowAngle = 0; // Arrow points right toward node
                sourceArrowX = sourcePort.x - offset;
                sourceArrowY = sourcePort.y;
                break;
              case 'right':
                sourceArrowAngle = 180; // Arrow points left toward node
                sourceArrowX = sourcePort.x + offset;
                sourceArrowY = sourcePort.y;
                break;
            }

            switch (destSide) {
              case 'top':
                destArrowAngle = 90; // Arrow points down toward node
                destArrowX = destPort.x;
                destArrowY = destPort.y - offset;
                break;
              case 'bottom':
                destArrowAngle = -90; // Arrow points up toward node
                destArrowX = destPort.x;
                destArrowY = destPort.y + offset;
                break;
              case 'left':
                destArrowAngle = 0; // Arrow points right toward node
                destArrowX = destPort.x - offset;
                destArrowY = destPort.y;
                break;
              case 'right':
                destArrowAngle = 180; // Arrow points left toward node
                destArrowX = destPort.x + offset;
                destArrowY = destPort.y;
                break;
            }
          } else {
            // Fallback to center-based positioning
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const isMainlyVertical = Math.abs(deltaY) > Math.abs(deltaX);

            if (isMainlyVertical) {
              sourceArrowAngle = deltaY > 0 ? -90 : 90;
              sourceArrowX = startX;
              sourceArrowY = startY + (deltaY > 0 ? offset : -offset);
              destArrowAngle = deltaX > 0 ? 0 : 180;
              destArrowX = endX + (deltaX > 0 ? -offset : offset);
              destArrowY = endY;
            } else {
              sourceArrowAngle = deltaX > 0 ? 180 : 0;
              sourceArrowX = startX + (deltaX > 0 ? offset : -offset);
              sourceArrowY = startY;
              destArrowAngle = deltaY > 0 ? 90 : -90;
              destArrowX = endX;
              destArrowY = endY + (deltaY > 0 ? -offset : offset);
            }
          }
        } else if (!sourceIntersection || !destIntersection) {
          // Fallback positioning - arrows/dots closer to connection center  
          const fallbackOffset = 20;
          sourceArrowX = x1 + (dx / length) * fallbackOffset;
          sourceArrowY = y1 + (dy / length) * fallbackOffset;
          destArrowX = x2 - (dx / length) * fallbackOffset;
          destArrowY = y2 - (dy / length) * fallbackOffset;
          sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
          destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        } else if (enableAutoRouting && routingStyle === 'clean') {
          // Clean routing arrow placement - position close to nodes for better visibility
          const offset = 8; // Reduced offset for better visibility
          const portAssignment = cleanLaneOffsets.get(edge.id);

          if (portAssignment) {
            const { sourcePort, destPort, sourceSide, destSide } = portAssignment;

            // Position arrows close to the actual ports, pointing toward the nodes
            switch (sourceSide) {
              case 'top':
                sourceArrowAngle = 90; // Arrow points down toward node
                sourceArrowX = sourcePort.x;
                sourceArrowY = sourcePort.y - offset;
                break;
              case 'bottom':
                sourceArrowAngle = -90; // Arrow points up toward node
                sourceArrowX = sourcePort.x;
                sourceArrowY = sourcePort.y + offset;
                break;
              case 'left':
                sourceArrowAngle = 0; // Arrow points right toward node
                sourceArrowX = sourcePort.x - offset;
                sourceArrowY = sourcePort.y;
                break;
              case 'right':
                sourceArrowAngle = 180; // Arrow points left toward node
                sourceArrowX = sourcePort.x + offset;
                sourceArrowY = sourcePort.y;
                break;
            }

            switch (destSide) {
              case 'top':
                destArrowAngle = 90; // Arrow points down toward node
                destArrowX = destPort.x;
                destArrowY = destPort.y - offset;
                break;
              case 'bottom':
                destArrowAngle = -90; // Arrow points up toward node
                destArrowX = destPort.x;
                destArrowY = destPort.y + offset;
                break;
              case 'left':
                destArrowAngle = 0; // Arrow points right toward node
                destArrowX = destPort.x - offset;
                destArrowY = destPort.y;
                break;
              case 'right':
                destArrowAngle = 180; // Arrow points left toward node
                destArrowX = destPort.x + offset;
                destArrowY = destPort.y;
                break;
            }
          } else {
            // Fallback: position arrows close to node centers
            sourceArrowX = startX;
            sourceArrowY = startY;
            sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
            destArrowX = endX;
            destArrowY = endY;
            destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          }
        } else {
          // Manhattan-aware arrow placement; falls back to straight orientation
          const offset = 12;
          if (enableAutoRouting && routingStyle === 'manhattan') {
            // Destination arrow aligns to terminal segment into destination
            const horizontalTerminal = Math.abs(endX - startX) > Math.abs(endY - startY);
            if (horizontalTerminal) {
              destArrowAngle = (endX >= startX) ? 0 : 180;
              destArrowX = endX + ((endX >= startX) ? -offset : offset);
              destArrowY = endY;
            } else {
              destArrowAngle = (endY >= startY) ? 90 : -90;
              destArrowX = endX;
              destArrowY = endY + ((endY >= startY) ? -offset : offset);
            }
            // Source arrow aligns to initial segment out of source (pointing back toward source)
            const horizontalInitial = Math.abs(endX - startX) > Math.abs(endY - startY);
            if (horizontalInitial) {
              sourceArrowAngle = (endX - startX) >= 0 ? 180 : 0;
              sourceArrowX = startX + ((endX - startX) >= 0 ? offset : -offset);
              sourceArrowY = startY;
            } else {
              sourceArrowAngle = (endY - startY) >= 0 ? -90 : 90;
              sourceArrowX = startX;
              sourceArrowY = startY + ((endY - startY) >= 0 ? offset : -offset);
            }
          } else {
            // Precise intersection positioning - adjust based on slope for visual consistency
            const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
            const normalizedAngle = angle > 90 ? 180 - angle : angle;
            // Shorter distance for quantized slopes (hitting node sides) vs diagonal (hitting corners)
            const isQuantizedSlope = normalizedAngle < 15 || normalizedAngle > 75;
            const arrowLength = isQuantizedSlope ? offset * 0.6 : offset;
            sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
            sourceArrowX = sourceIntersection.x + (dx / length) * arrowLength;
            sourceArrowY = sourceIntersection.y + (dy / length) * arrowLength;
            destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
            destArrowX = destIntersection.x - (dx / length) * arrowLength;
            destArrowY = destIntersection.y - (dy / length) * arrowLength;
          }
        }

        // Override arrow orientation deterministically by Manhattan sides
        if (enableAutoRouting && routingStyle === 'manhattan') {
          const sideOffset = 12;
          // Destination arrow strictly based on destination side
          if (manhattanDestSide === 'left') {
            destArrowAngle = 0; // rightwards
            destArrowX = endX - sideOffset;
            destArrowY = endY;
          } else if (manhattanDestSide === 'right') {
            destArrowAngle = 180; // leftwards
            destArrowX = endX + sideOffset;
            destArrowY = endY;
          } else if (manhattanDestSide === 'top') {
            destArrowAngle = 90; // downwards
            destArrowX = endX;
            destArrowY = endY - sideOffset;
          } else if (manhattanDestSide === 'bottom') {
            destArrowAngle = -90; // upwards
            destArrowX = endX;
            destArrowY = endY + sideOffset;
          }
          // Source arrow strictly based on source side (points toward the source node)
          if (manhattanSourceSide === 'left') {
            sourceArrowAngle = 0; // rightwards
            sourceArrowX = startX - sideOffset;
            sourceArrowY = startY;
          } else if (manhattanSourceSide === 'right') {
            sourceArrowAngle = 180; // leftwards
            sourceArrowX = startX + sideOffset;
            sourceArrowY = startY;
          } else if (manhattanSourceSide === 'top') {
            sourceArrowAngle = 90; // downwards
            sourceArrowX = startX;
            sourceArrowY = startY - sideOffset;
          } else if (manhattanSourceSide === 'bottom') {
            sourceArrowAngle = -90; // upwards
            sourceArrowX = startX;
            sourceArrowY = startY + sideOffset;
          }
        }

        // Hover "dot" affordances. For curved edges the arrow's translate
        // origin is a straight-line back-off that drifts OFF the curve on
        // sharply-bowed outer edges (and can land inside a wide node's box),
        // so dots use an explicit ON-curve point at the arrowhead's depth.
        // Other routings keep the arrow coords.
        // Curved: dot sits at the trimmed curve's visible end (the line's
        // new endpoint after the hover/arrow pull-back), tracking it exactly.
        // Falls back to the border crossing if the curve wasn't trimmed.
        const curveSourceDot = (useCurve && trimmedPath)
          ? { x: trimmedPath.startX, y: trimmedPath.startY }
          : (dotBorderEndpoints ? { x: dotBorderEndpoints.x1, y: dotBorderEndpoints.y1 } : null);
        const curveDestDot = (useCurve && trimmedPath)
          ? { x: trimmedPath.endX, y: trimmedPath.endY }
          : (dotBorderEndpoints ? { x: dotBorderEndpoints.x2, y: dotBorderEndpoints.y2 } : null);
        const sourceDotX = curveSourceDot ? curveSourceDot.x : (straightDotSource ? straightDotSource.x : sourceArrowX);
        const sourceDotY = curveSourceDot ? curveSourceDot.y : (straightDotSource ? straightDotSource.y : sourceArrowY);
        const destDotX = curveDestDot ? curveDestDot.x : (straightDotDest ? straightDotDest.x : destArrowX);
        const destDotY = curveDestDot ? curveDestDot.y : (straightDotDest ? straightDotDest.y : destArrowY);

        // Register touch hit-targets for a hovered/selected connection so
        // touch input can toggle arrows and win over the node underneath.
        //   - Endpoints WITHOUT an arrow → the "add arrow" orbs (only shown
        //     for the same routings the orb <circle>s render under, below).
        //   - Endpoints WITH an arrow → the arrowhead itself, so a tap on it
        //     removes the arrow. Arrowheads render for every routing, so this
        //     isn't gated on the orb routing condition.
        // Keyed by edge id, not appended to a shared list.
        //
        // This used to push into a flat array that the parent cleared once per
        // render and every edge then refilled — which is only correct while
        // EVERY edge is guaranteed to run on EVERY pass. That is exactly the
        // guarantee the caching and memoisation work removes: an edge that
        // short-circuits would silently stop contributing its orbs, and the
        // failure mode is a connection whose direction toggle just stops
        // responding to touch, with nothing thrown and nothing logged.
        //
        // Writing the edge's own entry makes each edge's contribution
        // independent of whether its neighbours ran. Entries are only produced
        // for hovered or selected edges, so the map holds a handful at most.
        if (isHovered || isSelected) {
          const orbR = Math.round(36 * connectionWidth);
          // Every routing now computes an endpoint dot position: straight and
          // orthogonal via their hover pull-back, curved via the trimmed
          // curve end. Nothing left to exclude.
          const showDots = true;
          const orbHits = [];
          if (arrowsToward.has(sourceNode.id)) {
            orbHits.push({ cx: sourceArrowX, cy: sourceArrowY, r: orbR, edgeId: edge.id, nodeId: sourceNode.id });
          } else if (showDots) {
            orbHits.push({ cx: sourceDotX, cy: sourceDotY, r: orbR, edgeId: edge.id, nodeId: sourceNode.id });
          }
          if (arrowsToward.has(destNode.id)) {
            orbHits.push({ cx: destArrowX, cy: destArrowY, r: orbR, edgeId: edge.id, nodeId: destNode.id });
          } else if (showDots) {
            orbHits.push({ cx: destDotX, cy: destDotY, r: orbR, edgeId: edge.id, nodeId: destNode.id });
          }
          connectionOrbHitsRef.current.set(edge.id, orbHits);
        } else {
          // Eligibility ended — drop the entry from when it was eligible.
          // The parent no longer clears this map per pass, because a cached
          // edge does not run and so could not refill it.
          connectionOrbHitsRef.current.delete(edge.id);
        }

        const handleArrowClick = (nodeId, e) => {
          e.stopPropagation();

          // Ignore the synthesized click that echoes a touch-driven orb
          // toggle (which already fired on touchstart) — otherwise it
          // double-toggles and cancels itself out.
          if (performance.now() - orbToggleEchoRef.current < 700) {
            orbToggleEchoRef.current = 0;
            return;
          }

          // Past the echo guard, so the touch path's own
          // toggle (which already fired) isn't doubled.
          haptic('directionToggle');

          // Toggle the arrow state for the specific node
          storeActions.updateEdge(edge.id, (draft) => {
            // Ensure directionality object exists
            if (!draft.directionality) {
              draft.directionality = { arrowsToward: new Set() };
            }
            // Ensure arrowsToward is a Set
            if (!draft.directionality.arrowsToward) {
              draft.directionality.arrowsToward = new Set();
            }

            // Toggle arrow for this specific node
            if (draft.directionality.arrowsToward.has(nodeId)) {
              draft.directionality.arrowsToward.delete(nodeId);
            } else {
              draft.directionality.arrowsToward.add(nodeId);
            }
          });
        };

        return (
          <>
            {/* Source Arrow - visible if arrow points toward source node */}
            {arrowsToward.has(sourceNode.id) && (
              <g
                data-arrow="source"
                transform={`translate(${sourceArrowX}, ${sourceArrowY}) rotate(${sourceArrowAngle + 90}) scale(${connectionWidth})`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => handleArrowClick(sourceNode.id, e)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Glow effect for arrow - only when selected or hovered */}
                {(isSelected || isHovered) && (
                  <polygon
                    points="-18,23 18,23 0,-23"
                    fill={edgeColor}
                    stroke={edgeColor}
                    strokeWidth="8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={isSelected ? "0.3" : "0.2"}
                    style={{
                      filter: `drop-shadow(0 0 6px ${edgeColor})`
                    }}
                  />
                )}
                <polygon
                  points="-26,34 26,34 0,-34"
                  fill={edgeColor}
                  stroke={edgeColor}
                  strokeWidth="6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  paintOrder="stroke fill"
                />
              </g>
            )}

            {/* Destination Arrow - visible if arrow points toward destination node */}
            {arrowsToward.has(destNode.id) && (
              <g
                data-arrow="dest"
                transform={`translate(${destArrowX}, ${destArrowY}) rotate(${destArrowAngle + 90}) scale(${connectionWidth})`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => handleArrowClick(destNode.id, e)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Glow effect for arrow - only when selected or hovered */}
                {(isSelected || isHovered) && (
                  <polygon
                    points="-18,23 18,23 0,-23"
                    fill={edgeColor}
                    stroke={edgeColor}
                    strokeWidth="8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={isSelected ? "0.3" : "0.2"}
                    style={{
                      filter: `drop-shadow(0 0 6px ${edgeColor})`
                    }}
                  />
                )}
                <polygon
                  points="-26,34 26,34 0,-34"
                  fill={edgeColor}
                  stroke={edgeColor}
                  strokeWidth="6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  paintOrder="stroke fill"
                />
              </g>
            )}

            {/* Endpoint Dots - visible when hovering OR when the connection is selected (straight edges or curved parallel edges) */}
            {(isHovered || isSelected) && (
              <>
                {/* Source Dot - only show if arrow not pointing toward source */}
                {/* data-endpoint-dot lets the drag-time DOM writer move these
                    with the connection; without it a selected edge's dots sat
                    frozen at their pre-drag position for the whole gesture. */}
                {!arrowsToward.has(sourceNode.id) && (
                  <g data-endpoint-dot="source">
                    <circle
                      cx={sourceDotX}
                      cy={sourceDotY}
                      r={Math.round(36 * connectionWidth)}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => handleArrowClick(sourceNode.id, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <circle
                      cx={sourceDotX}
                      cy={sourceDotY}
                      r={Math.round(30 * connectionWidth)}
                      fill={edgeColor}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                )}

                {/* Destination Dot - only show if arrow not pointing toward destination */}
                {!arrowsToward.has(destNode.id) && (
                  <g data-endpoint-dot="dest">
                    <circle
                      cx={destDotX}
                      cy={destDotY}
                      r={Math.round(36 * connectionWidth)}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => handleArrowClick(destNode.id, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <circle
                      cx={destDotX}
                      cy={destDotY}
                      r={Math.round(30 * connectionWidth)}
                      fill={edgeColor}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                )}
              </>
            )}
          </>
        );
      })()}

      {/* Connection name text — rendered after arrows so labels appear on top */}
      {showConnectionNames && (() => {
        const connectionFontSize = resolveEdgeLabelFontSize(textSettings, connectionLabelSize);
        let midX;
        let midY;
        let angle;
        if (enableAutoRouting && routingStyle === 'manhattan') {
          const horizontalLen = Math.abs(endX - startX);
          const verticalLen = Math.abs(endY - startY);
          if (horizontalLen >= verticalLen) {
            midX = (startX + endX) / 2;
            midY = startY;
            angle = 0;
          } else {
            midX = endX;
            midY = (startY + endY) / 2;
            angle = 90;
          }
        } else {
          // Use utility-calculated apex for curves, midpoint for lines
          // Use labelPlacementPath (visible segment) for accurate centering
          midX = labelPlacementPath.apexX;
          midY = labelPlacementPath.apexY;
          angle = labelPlacementPath.labelAngle;
        }

        // Determine connection name to display
        let connectionName = 'Connection';
        if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
          const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
          if (definitionNode) {
            connectionName = definitionNode.name || 'Connection';
          }
        } else if (edge.typeNodeId) {
          const edgePrototype = edgePrototypesMap.get(edge.typeNodeId);
          if (edgePrototype) {
            connectionName = edgePrototype.name || 'Connection';
          }
        }

        // The label as it is actually DRAWN. With
        // connectionLabelTruncate on, a name longer than the run it
        // sits along is cut to fit and ellipsed.
        //
        // Everything downstream measures this string and never the raw
        // name: the placement solve, the rect the label reserves against
        // its neighbours, the click target, the per-glyph advances a
        // Lombardi arc bends it with. Measuring the placement against one
        // width and drawing another is precisely the failure the
        // labelBoundsFor comment below describes, one input earlier.
        //
        // The routed branch truncates inside the cache miss instead of
        // here, because the run it measures against is the routing's
        // (see routedLabelSpan) and reading it costs an arc sample. A
        // straight connection's run is the visible chord, which is a
        // hypot of endpoints already computed.
        let displayName = connectionName;
        if (connectionLabelTruncate && !orthoRouting) {
          displayName = truncateEdgeLabel(
            connectionName,
            connectionFontSize,
            Math.hypot(
              visibleEndpoints.x2 - visibleEndpoints.x1,
              visibleEndpoints.y2 - visibleEndpoints.y1
            ) * LABEL_TRUNCATE_FILL
          );
        }

        // Routed styles place the label ON the polyline.
        //
        // These branches used to call chooseLabelPlacement, whose on-path
        // strategy demands a segment longer than the entire label — at
        // connection font sizes almost nothing qualifies, so it fell
        // through to chord-based strategies that measure direction
        // endpoint-to-endpoint (a diagonal) and shove the label 40-80px
        // off to the side. Hence labels that sat tilted, detached, and
        // nowhere near the connection they name.
        if (orthoRouting) {
          // Prefer the cached placement to avoid re-solving (and visibly
          // re-shuffling) every label on every render.
          //
          // The cache MUST be keyed on the geometry it was computed from,
          // not just the edge id. Keyed on the id alone it went stale on
          // everything that moves a route without changing which edge it
          // is: auto-layout, a node dragged elsewhere re-fanning this
          // node's arcs, a change of routing style or curvature. The
          // config-change effect that cleared it ran AFTER the render that
          // needed clearing, and nothing re-rendered afterwards — so a
          // label could sit at a position from a routing mode the user had
          // already left.
          //
          // pathD is exactly the right signature: it is a complete,
          // already-computed description of the drawn geometry. (It's the
          // untrimmed route, so hovering doesn't churn the cache.)
          // The crossing generation belongs in here for the same reason
          // pathD does. A placement depends on where the OTHER connections
          // run, so when one of them moves onto this label nothing about
          // this edge changes and the stale, now-covered position would
          // survive. Invalidating via the signature rather than by clearing
          // the cache in an effect matters twice over: the effect would run
          // after the render it was meant to protect (with nothing
          // necessarily re-rendering afterwards), and it would throw away
          // the anchors a drag needs to hold its placement.
          const labelSignature = `${orthoRouting.pathD}|${connectionName}|${connectionFontSize}|${connectionLabelTruncate ? 1 : 0}|${labelCrossingIndex?.generation ?? 0}`;
          const cached = placedLabelsRef.current.get(edge.id);
          if (cached && cached.position && cached.signature === labelSignature && !draggingNodeInfo) {
            // The truncation rides on the cache entry alongside the
            // placement. It is a function of the same geometry the
            // signature already covers (pathD), so a hit means the cut is
            // still the right one — and re-deriving it would cost an arc
            // sample per label per render for an answer that cannot have
            // changed.
            displayName = cached.displayName ?? connectionName;
            const stabilized = stabilizeLabelPosition(edge.id, cached.position.x, cached.position.y, cached.position.angle || 0);
            midX = stabilized.x;
            midY = stabilized.y;
            angle = stabilized.angle || 0;
          } else {
            if (connectionLabelTruncate) {
              displayName = truncateEdgeLabel(
                connectionName,
                connectionFontSize,
                routedLabelSpan(orthoRouting) * LABEL_TRUNCATE_FILL
              );
            }
            const placement = chooseRoutedLabelPlacement(
              orthoRouting, displayName, nodes, visibleNodeIds,
              baseDimsById, placedLabelsRef.current, connectionFontSize,
              edge.id, selectedInstanceIds, labelObstacleOptions
            );
            const stabilized = stabilizeLabelPosition(edge.id, placement.x, placement.y, placement.angle || 0);
            midX = stabilized.x;
            midY = stabilized.y;
            angle = stabilized.angle || 0;

            // Register the rect the label ACTUALLY occupies, at the
            // position and angle it actually ended up at — the labels
            // placed after this one dodge whatever goes in here.
            //
            // Via the placer's own helper rather than a second copy of
            // the geometry. The copy that used to live here snapped the
            // angle to horizontal-or-vertical, so on a Lombardi label
            // (which sits at neither) it registered a box far shorter
            // than the text being drawn, and every later label happily
            // placed itself inside it.
            placedLabelsRef.current.set(edge.id, {
              rect: labelBoundsFor(
                midX, midY,
                estimateTextWidth(displayName, connectionFontSize),
                connectionFontSize * 1.1,
                angle
              ),
              signature: labelSignature,
              displayName,
              position: { x: midX, y: midY, angle },
              // How far along the route this solve landed, so a drag can
              // carry it instead of resetting to the midpoint. See ANCHORS
              // in edgeLabelPlacement.js.
              anchor: placement.anchor,
            });

            // Diagnostic for label placement. Set
            // window.__labelDebug = true (or to a substring of the
            // connection name) in the console and nudge the graph.
            // Reports which of the placer's inputs actually applied,
            // so a label sitting in the wrong place can be traced to
            // the input that put it there instead of guessed at.
            const dbg = typeof window !== 'undefined' && window.__labelDebug;
            if (dbg && (dbg === true || String(connectionName).includes(dbg))) {
              console.log('[label]', connectionName, edge.id, {
                hasArc: !!orthoRouting.arc,
                visibleRange: orthoRouting.visibleRange,
                chosenAnchor: placement.anchor,
                crossings: placement.crossings,
                placed: { x: Math.round(placement.x), y: Math.round(placement.y) },
                afterStabilize: { x: Math.round(midX), y: Math.round(midY) },
                lineStart: { x: Math.round(orthoRouting.startX), y: Math.round(orthoRouting.startY) },
                lineEnd: { x: Math.round(orthoRouting.endX), y: Math.round(orthoRouting.endY) },
                sourceIsGroupAnchor: !!sourceNode.isGroupAnchor,
                destIsGroupAnchor: !!destNode.isGroupAnchor,
                sourceOuterBounds: sAnchorInfo?.outerBounds || null,
                destOuterBounds: eAnchorInfo?.outerBounds || null,
                sourceShellRect: sAnchorInfo?.shellRect || null,
                destShellRect: eAnchorInfo?.shellRect || null,
                bundle: edgeCurveInfo.get(edge.id) || null,
              });
            }
          }
        }
        // For straight/curved routing, midX/midY/angle are already set from parallelPath above

        // midX/midY already sit at the center of the visible segment —
        // getVisualConnectionEndpoints clipped against each endpoint's real
        // occluder (node hitbox, or a thing-group's full outer box), so the
        // label needs no further nudging off the group box.
        const labelRenderX = midX;
        const labelRenderY = midY;

        // Adjust angle to keep text readable (never upside down),
        // then snap it into a bucket. The snap is what keeps a few hundred
        // labels affordable — see CONNECTION LABEL RENDERING BUDGETS.
        //
        // Below LABEL_ANGLE_QUANTUM_MIN_COUNT visible labels — which is
        // most working views — quantizeLabelAngle is the identity, so the
        // text lies exactly along the line it names. Above it the bucket is
        // a constant, so whatever tilt a label takes it keeps: panning and
        // zooming can no longer re-round it against a line that hasn't
        // moved.
        const adjustedAngle = quantizeLabelAngle(
          (angle > 90 || angle < -90) ? angle + 180 : angle
        );

        // Lombardi labels ride the arc itself rather than sitting on a
        // chord of it — whenever the bend is visible on screen and the
        // curved-label budget allows. Each glyph is positioned and rotated
        // individually, computed closed-form from the circle; see
        // labelArcGlyphFrames for why this is not a <textPath>.
        //
        // Returns null for a degenerate arc, a label that would wrap the
        // circle, or a bow under labelArcMinBow. Text that must not be
        // split into per-glyph chunks (combining marks, joiners, RTL) makes
        // the advances null one step earlier. Either way it falls through to
        // the straight rotated label below, which at that point is the same
        // picture for less — one glyph matrix instead of one per character.
        const labelGlyphAdvances = (orthoRouting?.arc && curveLabels)
          ? edgeLabelGlyphAdvances(displayName, connectionFontSize)
          : null;
        // Sprites take EXACT angles. The rotation bucket exists purely
        // to bound glyph-atlas keys, and a sprite mints none — rotating
        // an <image> is a transform on a bitmap, not a re-rasterisation
        // of an outline, so distinct angles are free. That bucket is also
        // the source of the visible wobble on gently-bent labels: each
        // glyph rounds INDEPENDENTLY, so neighbours straddling a boundary
        // jump a whole quantum apart, worst exactly where the curve is
        // shallowest. Sprites simply don't need it.
        const labelGlyphs = labelGlyphAdvances
          ? labelArcGlyphFrames(
            orthoRouting.arc,
            { x: labelRenderX, y: labelRenderY },
            labelGlyphAdvances,
            {
              minBow: labelArcMinBow,
              rotationQuantum: labelSpritesEnabled ? 0 : curvedLabelQuantum,
            }
          )
          : null;

        // What React is about to commit, in one string, so the drag
        // updater can put the DOM back exactly here before React diffs
        // against it. See LABEL FRAMES in edgeLabelPlacement.js for why
        // this has to come from the render rather than from a snapshot
        // the drag takes for itself.
        const glyphAttrs = labelGlyphs ? {
          x: labelGlyphs.x.map((v) => v.toFixed(2)).join(' '),
          y: labelGlyphs.y.map((v) => v.toFixed(2)).join(' '),
          rotate: labelGlyphs.rotate.map((v) => v.toFixed(2)).join(' '),
        } : null;
        const labelFrame = labelFrameToken(
          glyphAttrs, labelRenderX, labelRenderY, adjustedAngle
        );

        // Generous hitbox around the label text so the name is as
        // clickable as the line itself (labels often sit off the line).
        const labelHitW = estimateTextWidth(displayName, connectionFontSize) + connectionFontSize * 0.9;
        const labelHitH = connectionFontSize * 1.5;

        const labelColors = getConnectionLabelColors(edgeColor, darkMode, connectionLabelColorMode, connectionLabelOuterRing);
        const labelHaloWidth = 8 * (connectionFontSize / 54);

        // A straight label is drawn as a pre-rasterised sprite when one
        // is available: ring, halo and fill baked into a bitmap, drawn
        // as a single <image>. That replaces TWO stroked rotated <text>
        // elements — the form the browser cannot cache glyph masks for —
        // with a textured quad, whose rotation is a transform rather
        // than glyph work. See labelSpriteCache.js.
        //
        // Curved labels keep the per-glyph <text> path. They ride an arc
        // rather than a baseline, so a single flat bitmap cannot express
        // them; that is a glyph-atlas problem rather than a label-sprite
        // one and is deliberately left alone here.
        //
        // Falls back to <text> whenever a sprite is not available, which
        // includes the whole period before EmOne has loaded — baking a
        // fallback face into a bitmap would freeze the wrong glyphs,
        // where <text> fixes itself on the next render.
        const spriteAppearance = {
          fontSize: connectionFontSize,
          fill: labelColors.fill,
          halo: labelHaloEnabled ? labelColors.stroke : null,
          haloWidth: labelHaloWidth,
          ring: (labelHaloEnabled && labelRingEnabled) ? labelColors.outerStroke : null,
          ringWidth: labelHaloWidth * connectionLabelRingWidth,
          scale: labelSpriteScale,
        };

        // Peek, then ask. Baking inside a render is what made the
        // whole network wait on the labels: a lombardi graph's first
        // pass wants the alphabet across three layers, and every one of
        // those ends in a PNG encode. Now the render only reads the
        // cache and registers what it needs; the queue drains in idle
        // time and re-renders when a batch lands.
        const labelSpriteWanted = !labelGlyphs && labelSpritesEnabled && spritesUsable();
        const labelSprite = labelSpriteWanted
          ? peekLabelSprite({ ...spriteAppearance, text: displayName })
          : null;
        if (labelSpriteWanted && !labelSprite) {
          requestLabelSprite({ ...spriteAppearance, text: displayName });
        }

        // A CURVED label is the same trick one level down. It has no
        // single baseline, so it cannot be one bitmap — but nothing about
        // a curve resists bitmaps: each glyph becomes its own quad, placed
        // and rotated by the frames labelArcGlyphFrames already computed.
        // The atlas is keyed by character, so it is bounded by the
        // alphabet rather than by how many distinct labels exist, and
        // every curved label on the canvas shares it.
        //
        // Drawn in three passes — every ring, then every halo, then every
        // fill — because neighbouring glyphs' rings overlap (22 units wide
        // on a ~39-unit advance). Drawing finished glyphs left to right
        // would paint each one's ring over the previous one's fill and
        // notch every letter. Stroked <text> never had that problem
        // because SVG strokes a whole run before filling any of it, and
        // these passes reproduce that order.
        const labelGlyphChars = (labelGlyphs && labelSpritesEnabled && spritesUsable())
          ? Array.from(displayName)
          : null;
        // Each layer holds the same glyphs at the same indices, so one
        // pass builds all three. `gi` travels with every quad because the
        // runs SKIP spaces while the frames do not — without it the drag
        // updater would re-place glyph n using frame n and shear the
        // label apart at the first space.
        const labelGlyphLayers = labelGlyphChars ? GLYPH_SPRITE_LAYERS.map((layer) => {
          const quads = [];
          for (let i = 0; i < labelGlyphChars.length && i < labelGlyphs.x.length; i++) {
            const ch = labelGlyphChars[i];
            if (!ch || ch.trim() === '') continue;
            const glyphSpec = { ...spriteAppearance, ch, layer };
            const sprite = peekGlyphSprite(glyphSpec);
            if (!sprite) { requestGlyphSprite(glyphSpec); continue; }
            const q = glyphQuadAt(labelGlyphs, i, sprite.advance);
            if (!q) continue;
            quads.push({ sprite, q, gi: i });
          }
          return { layer, quads };
        }).filter((l) => l.quads.length) : null;
        // All or nothing. A partial atlas would draw some glyphs and drop
        // others, which is a worse picture than the <text> path it
        // replaces — so every layer the appearance calls for has to be
        // present, and all of them must cover the same glyphs.
        const wantedGlyphLayers = GLYPH_SPRITE_LAYERS.filter((layer) => (
          layer === 'fill' || (layer === 'halo' ? spriteAppearance.halo : spriteAppearance.ring)
        )).length;
        // How many glyphs this label OWES. Spaces draw nothing, so they
        // are not owed; everything else is.
        let owedGlyphs = 0;
        if (labelGlyphChars) {
          const n = Math.min(labelGlyphChars.length, labelGlyphs.x.length);
          for (let i = 0; i < n; i++) {
            const ch = labelGlyphChars[i];
            if (ch && ch.trim() !== '') owedGlyphs++;
          }
        }
        // Every layer must be present AND complete.
        //
        // Comparing the layers to EACH OTHER is not enough, and that was
        // the bug: a glyph still baking is skipped by all three passes
        // alike, so a half-ready label had three equally short layers and
        // sailed through, rendering whichever characters happened to be
        // done. Labels came in a few letters at a time. Measuring against
        // what the label owes makes it wait for the whole word.
        const useGlyphSprites = !!labelGlyphLayers
          && owedGlyphs > 0
          && labelGlyphLayers.length === wantedGlyphLayers
          && labelGlyphLayers.every((l) => l.quads.length === owedGlyphs);

        // A label whose sprite is still baking renders as <text> and
        // swaps to the bitmap when it lands, rather than waiting.
        //
        // Holding it back was the other option and read as the graph
        // loading in pieces. Drawing text first costs one stroked pass
        // per label — real, but paid ONCE at settle, where the cost this
        // whole path exists to avoid is the per-frame one during motion.
        // The label is present and correct from the first paint and gets
        // cheaper shortly after.
        //
        // The swap only looks seamless because the two forms are placed
        // by the same rule: identical origins, identical advances,
        // identical rotations (sprites drop the glyph angle bucket, and
        // the text form drops it too whenever sprites are enabled), and
        // a sprite centre corrected onto the text's baseline by
        // spriteCenterOffsetY. Change any one of those and the swap
        // becomes a visible twitch.

        // Everything that positions the label, shared by the real label and
        // the connection-colored ring drawn underneath it. Both carry
        // data-connection-label so the drag updater moves them together —
        // see labelTextOf in useNodeDrag.
        const labelGeomProps = {
          'data-connection-label': '1',
          'data-label-frame': labelFrame,
          // Truncation has to be re-decided per frame during a drag,
          // and the drag owns the DOM rather than re-rendering — so
          // both halves of the decision travel on the element.
          //
          // `full` is the uncut name, because a cut can only ever be
          // taken from the ORIGINAL: re-cutting an already-cut string
          // ratchets it down and it never grows back when the
          // connection lengthens again.
          //
          // `text` is what React committed, and it is here for
          // precisely the reason data-label-frame is — React writes
          // only what changed between its OWN renders, so a settled
          // render that lands on the same text React last rendered
          // skips the write and leaves the drag's last cut in the DOM.
          // See LABEL FRAMES in edgeLabelPlacement.js.
          ...(connectionLabelTruncate ? {
            'data-label-full': connectionName,
            'data-label-text': displayName,
          } : null),
          fontSize: connectionFontSize,
          fontWeight: 'bold',
          dominantBaseline: 'middle',
          style: { pointerEvents: 'none', fontFamily: "'EmOne', sans-serif" },
          ...(labelGlyphs
            /* Curved: every glyph placed and rotated individually.
               textAnchor is `start` because x/y are baseline ORIGINS —
               labelArcGlyphFrames already walked each one back half an
               advance so the glyph's centre lands on the circle. The drag
               updater rewrites these same three lists per frame. */
            ? {
              x: glyphAttrs.x,
              y: glyphAttrs.y,
              rotate: glyphAttrs.rotate,
              textAnchor: 'start',
            }
            : {
              x: labelRenderX,
              y: labelRenderY,
              textAnchor: 'middle',
              transform: straightLabelTransform(adjustedAngle, labelRenderX, labelRenderY),
            }),
        };

        return (
          <g>
            {/* Invisible click target covering the label text */}
            <rect
              x={labelRenderX - labelHitW / 2}
              y={labelRenderY - labelHitH / 2}
              width={labelHitW}
              height={labelHitH}
              rx={labelHitH / 2}
              ry={labelHitH / 2}
              fill="transparent"
              transform={`rotate(${adjustedAngle}, ${labelRenderX}, ${labelRenderY})`}
              style={{ cursor: 'pointer' }}
              {...getEdgeHitboxHandlers(edge.id)}
            />
            {useGlyphSprites ? (
              /* Curved: one quad per glyph, in three layer passes.
                 Each <image> is placed by its box, so the quad centre
                 recovered by glyphSpriteQuads is walked back half its
                 own size — and rotated about that same centre, which is
                 the point labelArcGlyphFrames put on the circle. */
              <g
                className="connection-label"
                data-connection-label="1"
                data-label-sprite="1"
                data-label-glyph-sprite="1"
                {...({
                  /* The advances a drag re-solves the arc with are
                     measured from the text and its size, and a sprite
                     label has no <text> for the drag to read those off.
                     Carry them on the wrapper instead. */
                  'data-label-text': displayName,
                  'data-label-font-size': connectionFontSize,
                })}
                style={{ pointerEvents: 'none' }}
              >
                {labelGlyphLayers.map(({ layer, quads }) => (
                  <g key={layer} data-glyph-layer={layer}>
                    {quads.map(({ sprite, q, gi }) => {
                      const ix = q.cx - sprite.width / 2;
                      const iy = q.cy - sprite.height / 2 + sprite.centerOffsetY;
                      return (
                        <image
                          key={gi}
                          href={sprite.href}
                          x={ix}
                          y={iy}
                          width={sprite.width}
                          height={sprite.height}
                          transform={`rotate(${q.rot} ${q.cx} ${q.cy})`}
                          preserveAspectRatio="none"
                          data-gi={gi}
                          data-advance={sprite.advance}
                          data-oy={sprite.centerOffsetY}
                          /* What React committed, so a drag can put this
                             glyph back before React diffs against it —
                             the per-glyph twin of data-label-frame. See
                             LABEL FRAMES in edgeLabelPlacement.js. */
                          data-gframe={`${ix}|${iy}|${q.rot}|${q.cx}|${q.cy}`}
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
            ) : labelSprite ? (
              /* The whole label — ring, halo and fill — as one bitmap.
                 Wrapped in a <g> carrying the placement so a drag can
                 move it by rewriting ONE transform, the same way the
                 <text> forms are moved by rewriting theirs. The <image>
                 itself sits at a fixed offset from that origin, so the
                 group's translate is the label's centre exactly as
                 `x`/`y` are for a middle-anchored <text>. */
              <g
                className="connection-label"
                data-connection-label="1"
                data-label-sprite="1"
                data-label-frame={labelFrame}
                transform={`translate(${labelRenderX} ${labelRenderY}) rotate(${adjustedAngle})`}
                style={{ pointerEvents: 'none' }}
              >
                <image
                  href={labelSprite.href}
                  x={-labelSprite.width / 2}
                  /* Offset inside the rotated group, so it carries
                     perpendicular to the text — see spriteCenterOffsetY. */
                  y={-labelSprite.height / 2 + labelSprite.centerOffsetY}
                  width={labelSprite.width}
                  height={labelSprite.height}
                  preserveAspectRatio="none"
                />
              </g>
            ) : (<>
            {/* Outermost ring, in the connection's own color, so the dark
                halo never meets the canvas directly and the label reads as
                sitting IN the line rather than on top of it. A separate
                <text> because SVG paints exactly one stroke per element. */}
            {labelHaloEnabled && labelRingEnabled && labelColors.outerStroke && (
              <text
                {...labelGeomProps}
                className="connection-label-ring"
                fill="none"
                stroke={labelColors.outerStroke}
                strokeWidth={labelHaloWidth * connectionLabelRingWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {displayName}
              </text>
            )}
            {/* Canvas-colored text creating a "hole" effect in the connection */}
            <text
              {...labelGeomProps}
              className="connection-label"
              fill={labelColors.fill}
              {...(labelHaloEnabled ? {
                stroke: labelColors.stroke,
                strokeWidth: labelHaloWidth,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                paintOrder: 'stroke fill',
              } : null)}
            >
              {displayName}
            </text>
            </>)}
          </g>
        );
      })()}
    </g>
  );
}
