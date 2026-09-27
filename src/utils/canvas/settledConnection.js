/**
 * A connection's resting geometry — what renderConnectionEdge draws for it when
 * it is neither hovered nor selected — as data, so the web previews (the Open
 * Webs list, the definition in the right panel, a node's decomposition preview)
 * draw every connection style exactly as the canvas does.
 *
 * Every branch below mirrors a branch of renderConnectionEdge / SelfLoopEdge
 * with `isHovered`, `isSelected` and the node selection all false, and calls
 * the same routing helpers with the same arguments. It is not a lookalike: the
 * parity test (test/components/settledConnectionParity.test.jsx) renders the
 * canvas in every routing style and checks this against the DOM it emits. When
 * the renderer's resting geometry changes, change it here too.
 *
 * Pipeline:
 *   connectionRoutingSettings(state)            the user's connection settings
 *   buildConnectionScene({ nodes, edges, ... }) the whole-web passes (parallel
 *                                               pairs, clean ports, Lombardi fans)
 *   settledConnectionGeometry(edge, scene)      one connection's stroke and arrows
 */
import { CONNECTION_WIDTH_BASE_SCALE, NODE_DEFAULT_COLOR } from '../../constants';
import { getLineNodeIntersection, getNodeEdgeIntersection, getVisualConnectionEndpoints } from './nodeHitbox.js';
import {
  computeCleanRouting, computeLombardiRouting, computeLombardiTangents, computeManhattanRouting,
  connectionCurveMinBow, LOMBARDI_LANE_FRACTION, ORTHOGONAL_LANE_FRACTION,
} from './edgeRouting.js';
import { DEFAULT_TIP_INSET, calculateParallelEdgePath, getCurvedArrowPlacement, getTrimmedBezierPath } from './parallelEdgeUtils.js';
import { computeCleanLaneOffsets } from './cleanLaneOffsets.js';
import { calculateSelfLoopPath } from './selfLoopUtils.js';
import { computeEdgeCurveInfo } from '../../components/canvas/edges/edgeGeometry.js';

/** The arrowhead polygon, drawn at scale(connectionWidth). */
export const ARROW_POLYGON_POINTS = '-26,34 26,34 0,-34';
/** The visible stroke, in world units at connectionWidth 1. */
export const CONNECTION_STROKE_BASE = 27;

const EMPTY_SET = new Set();

/** The connection settings NodeCanvas reads, with its defaults. */
export function connectionRoutingSettings(state) {
  const als = state?.autoLayoutSettings || {};
  return {
    enableAutoRouting: als.enableAutoRouting,
    routingStyle: als.routingStyle || 'straight',
    manhattanBends: als.manhattanBends || 'auto',
    cleanLaneSpacing: als.cleanLaneSpacing || 24,
    lombardiCurvature: als.lombardiCurvature ?? 1.0,
    multiConnectionCurve: als.multiConnectionCurve ?? 1.0,
    connectionWidth: (state?.textSettings?.connectionWidth ?? 1.0) * CONNECTION_WIDTH_BASE_SCALE,
    textSettings: state?.textSettings,
  };
}

/**
 * The anchor record the canvas's group pass publishes for a Thing-group
 * (groupLayouts.js anchorPositions), built from a computeGroupLayout result.
 */
export function anchorInfoFromGroupLayout(layout, cornerRadius) {
  const { label, rect, nodeGroupRect, visualBounds } = layout;
  return {
    x: label.x, y: label.y,
    width: label.w, height: label.h,
    outerBounds: visualBounds ? { x: visualBounds.x, y: visualBounds.y, width: visualBounds.w, height: visualBounds.h } : null,
    shellRect: { x: rect.x, y: nodeGroupRect.y, w: rect.w, h: nodeGroupRect.h, r: cornerRadius },
  };
}

const boundsFrom = (outer) => (outer
  ? { minX: outer.x, minY: outer.y, maxX: outer.x + outer.width, maxY: outer.y + outer.height }
  : null);

/**
 * The whole-web passes every connection reads, as NodeCanvas memoizes them.
 *
 * @param {object} p
 * @param {Array} p.nodes - Hydrated nodes of the web (anchors included).
 * @param {Array} p.edges - Every edge of the web.
 * @param {Map} p.dimsById - node id → getNodeDimensions(node, false, null).
 * @param {Map} [p.anchors] - anchor id → anchorInfoFromGroupLayout(...).
 * @param {object} p.settings - connectionRoutingSettings(state).
 * @param {number} [p.zoom] - Screen px per world unit (Lombardi's visible-bow floor).
 */
export function buildConnectionScene({ nodes, edges, dimsById, anchors = new Map(), settings, zoom = 1 }) {
  const {
    enableAutoRouting, routingStyle, cleanLaneSpacing, multiConnectionCurve, textSettings,
  } = settings;
  const isRoutedStyle = !!enableAutoRouting
    && (routingStyle === 'manhattan' || routingStyle === 'clean' || routingStyle === 'lombardi');
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const curveSpacing = 200 * multiConnectionCurve;

  // NodeCanvas anchorGeometryFor: a Thing-group's anchor is its title pill.
  const anchorGeometryFor = (node, dims) => {
    const info = node?.isGroupAnchor ? anchors.get(node.id) : null;
    if (!info) return { node, dims };
    return { node: { ...node, x: info.x, y: info.y }, dims: { currentWidth: info.width, currentHeight: info.height } };
  };

  const cleanLaneOffsets = computeCleanLaneOffsets({
    anchorGeometryFor, baseDimsById: dimsById, cleanLaneSpacing, draggingNodeInfo: null, edges, enableAutoRouting,
    nodeById, nodes, prevCleanLaneOffsetsRef: { current: new Map() }, routingStyle, textSettings,
  });

  let lombardiTangents = new Map();
  if (enableAutoRouting && routingStyle === 'lombardi' && edges.length) {
    let tangentNodes = nodes;
    let tangentDims = dimsById;
    if (anchors.size > 0) {
      tangentDims = new Map(dimsById);
      tangentNodes = nodes.map((n) => {
        const { node, dims } = anchorGeometryFor(n, dimsById.get(n.id));
        if (node === n) return n;
        tangentDims.set(n.id, dims);
        return node;
      });
    }
    lombardiTangents = computeLombardiTangents(tangentNodes, edges, tangentDims);
  }

  return {
    ...settings,
    isRoutedStyle,
    nodeById,
    dimsById,
    anchors,
    curveSpacing,
    orthogonalLaneSpacing: curveSpacing * ORTHOGONAL_LANE_FRACTION,
    lombardiLaneSpacing: curveSpacing * LOMBARDI_LANE_FRACTION,
    lombardiMinBow: connectionCurveMinBow(zoom),
    cleanLaneOffsets,
    lombardiTangents,
    edgeCurveInfo: computeEdgeCurveInfo({ edges }),
  };
}

/** A connection's colour: its type's, else its destination's (renderConnectionEdge getEdgeColor). */
export function connectionColor(edge, destNode, nodePrototypes, edgePrototypes) {
  if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
    const definitionNode = nodePrototypes?.get(edge.definitionNodeIds[0]);
    if (definitionNode) return definitionNode.color || NODE_DEFAULT_COLOR;
  }
  if (edge.typeNodeId) {
    if (edge.typeNodeId === 'base-connection-prototype') return '#000000';
    const edgePrototype = edgePrototypes?.get(edge.typeNodeId);
    if (edgePrototype) return edgePrototype.color || NODE_DEFAULT_COLOR;
  }
  return destNode?.color || NODE_DEFAULT_COLOR;
}

// Arrow origin and angle for a port on a node side, pointing into the node.
const sideArrow = (side, x, y, offset) => {
  switch (side) {
    case 'top': return { x, y: y - offset, angle: 90 };
    case 'bottom': return { x, y: y + offset, angle: -90 };
    case 'left': return { x: x - offset, y, angle: 0 };
    case 'right': return { x: x + offset, y, angle: 180 };
    default: return null;
  }
};

/**
 * One connection at rest.
 *
 * @returns {null | {
 *   kind: 'self'|'line'|'path',
 *   d?: string, x1?: number, y1?: number, x2?: number, y2?: number,
 *   roundCap: boolean,
 *   stubs: Array<{x1,y1,x2,y2}>,        // Manhattan's centre-to-port runs
 *   arrows: Array<{end: 'source'|'dest'|'self', x, y, angle}>,
 *   clipShells: Array<{x,y,w,h,r}>,     // Thing-group shells to cut the stroke along
 *   sourceNode, destNode,
 * }}
 */
export function settledConnectionGeometry(edge, scene) {
  const {
    nodeById, dimsById, anchors, isRoutedStyle, enableAutoRouting, routingStyle, manhattanBends,
    cleanLaneOffsets, cleanLaneSpacing, lombardiTangents, lombardiCurvature, lombardiLaneSpacing,
    lombardiMinBow, orthogonalLaneSpacing, edgeCurveInfo, curveSpacing, connectionWidth,
  } = scene;

  let sourceNode = nodeById.get(edge.sourceId);
  let destNode = nodeById.get(edge.destinationId);
  if (!sourceNode || !destNode) return null;

  const sAnchorInfo = sourceNode.isGroupAnchor ? anchors.get(sourceNode.id) : null;
  const eAnchorInfo = destNode.isGroupAnchor ? anchors.get(destNode.id) : null;
  if (sAnchorInfo) sourceNode = { ...sourceNode, x: sAnchorInfo.x, y: sAnchorInfo.y };
  if (eAnchorInfo) destNode = { ...destNode, x: eAnchorInfo.x, y: eAnchorInfo.y };
  const sNodeDims = sAnchorInfo
    ? { currentWidth: sAnchorInfo.width, currentHeight: sAnchorInfo.height }
    : dimsById.get(sourceNode.id);
  const eNodeDims = eAnchorInfo
    ? { currentWidth: eAnchorInfo.width, currentHeight: eAnchorInfo.height }
    : dimsById.get(destNode.id);
  if (!sNodeDims || !eNodeDims) return null;

  const arrowsToward = edge.directionality?.arrowsToward instanceof Set
    ? edge.directionality.arrowsToward
    : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);

  // SelfLoopEdge.
  if (edge.sourceId === edge.destinationId) {
    const loop = calculateSelfLoopPath(sourceNode.x, sourceNode.y, sNodeDims.currentWidth, sNodeDims.currentHeight, edgeCurveInfo.get(edge.id));
    return {
      kind: 'self', d: loop.path, roundCap: true, stubs: [], clipShells: [],
      arrows: arrowsToward.has(sourceNode.id) ? [{ end: 'self', x: loop.anchorB.x, y: loop.anchorB.y, angle: loop.arrowAngleB }] : [],
      sourceNode, destNode,
    };
  }

  const hasSourceArrow = arrowsToward.has(sourceNode.id);
  const hasDestArrow = arrowsToward.has(destNode.id);
  const isDirected = arrowsToward.size > 0;
  const sOuter = sAnchorInfo?.outerBounds || null;
  const eOuter = eAnchorInfo?.outerBounds || null;
  const visualEndpoints = () => getVisualConnectionEndpoints(
    sourceNode, destNode, sNodeDims, eNodeDims, false, false, true, sOuter, eOuter,
  );

  const sCx = sourceNode.x + sNodeDims.currentWidth / 2;
  const sCy = sourceNode.y + sNodeDims.currentHeight / 2;
  const dCx = destNode.x + eNodeDims.currentWidth / 2;
  const dCy = destNode.y + eNodeDims.currentHeight / 2;

  let x1 = sCx, y1 = sCy, x2 = dCx, y2 = dCy;
  if (!isRoutedStyle && isDirected && (hasSourceArrow || hasDestArrow)) {
    const endpoints = visualEndpoints();
    if (hasSourceArrow) { x1 = endpoints.x1; y1 = endpoints.y1; }
    if (hasDestArrow) { x2 = endpoints.x2; y2 = endpoints.y2; }
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);

  const sBounds = boundsFrom(sOuter);
  const eBounds = boundsFrom(eOuter);
  const sourceIntersection = sBounds
    ? getLineNodeIntersection(sCx, sCy, dCx, dCy, sBounds)
    : getNodeEdgeIntersection(sourceNode.x, sourceNode.y, sNodeDims.currentWidth, sNodeDims.currentHeight, dx / length, dy / length);
  const destIntersection = eBounds
    ? getLineNodeIntersection(dCx, dCy, sCx, sCy, eBounds)
    : getNodeEdgeIntersection(destNode.x, destNode.y, eNodeDims.currentWidth, eNodeDims.currentHeight, -dx / length, -dy / length);

  const curveInfo = edgeCurveInfo.get(edge.id);
  let isCurvedEdge = false;
  if (curveInfo && curveInfo.totalInPair > 1) {
    isCurvedEdge = curveInfo.pairIndex - (curveInfo.totalInPair - 1) / 2 !== 0;
  }
  let shouldShortenSource = isCurvedEdge ? false : hasSourceArrow;
  let shouldShortenDest = isCurvedEdge ? false : hasDestArrow;
  if (enableAutoRouting && routingStyle === 'manhattan') {
    shouldShortenSource = hasSourceArrow;
    shouldShortenDest = hasDestArrow;
  }

  let startX, startY, endX, endY;
  if (enableAutoRouting && routingStyle === 'clean') {
    const ports = cleanLaneOffsets.get(edge.id);
    startX = ports && hasSourceArrow ? ports.sourcePort.x : x1;
    startY = ports && hasSourceArrow ? ports.sourcePort.y : y1;
    endX = ports && hasDestArrow ? ports.destPort.x : x2;
    endY = ports && hasDestArrow ? ports.destPort.y : y2;
  } else {
    const inset = (shouldShortenSource || shouldShortenDest) ? visualEndpoints() : null;
    startX = shouldShortenSource ? (inset?.x1 ?? sourceIntersection?.x ?? x1) : x1;
    startY = shouldShortenSource ? (inset?.y1 ?? sourceIntersection?.y ?? y1) : y1;
    endX = shouldShortenDest ? (inset?.x2 ?? destIntersection?.x ?? x2) : x2;
    endY = shouldShortenDest ? (inset?.y2 ?? destIntersection?.y ?? y2) : y2;
  }

  let orthoRouting = null;
  let manhattanSourceSide = null;
  let manhattanDestSide = null;
  if (enableAutoRouting && routingStyle === 'manhattan') {
    orthoRouting = computeManhattanRouting(sourceNode, destNode, sNodeDims, eNodeDims, manhattanBends, {
      curveInfo, laneSpacing: orthogonalLaneSpacing,
    });
    ({ startX, startY, endX, endY } = orthoRouting);
    manhattanSourceSide = orthoRouting.sourceSide;
    manhattanDestSide = orthoRouting.destSide;
  } else if (enableAutoRouting && routingStyle === 'clean') {
    orthoRouting = computeCleanRouting(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
  } else if (enableAutoRouting && routingStyle === 'lombardi') {
    orthoRouting = computeLombardiRouting(edge, sourceNode, destNode, sNodeDims, eNodeDims, lombardiTangents, {
      curvature: lombardiCurvature, selectedInstanceIds: EMPTY_SET,
      curveInfo, laneSpacing: lombardiLaneSpacing,
      minBow: lombardiMinBow,
      connectionWidth,
      sourceBounds: sBounds,
      destBounds: eBounds,
    });
    ({ startX, startY, endX, endY } = orthoRouting);
  }

  const parallelPath = calculateParallelEdgePath(startX, startY, endX, endY, curveInfo, curveSpacing);
  const useCurve = parallelPath.type === 'curve' && !orthoRouting;
  const curvedArrowPlacement = useCurve ? getCurvedArrowPlacement(parallelPath, connectionWidth, DEFAULT_TIP_INSET) : null;
  let trimmedPath = null;
  if (useCurve && parallelPath.ctrlX !== null && (hasSourceArrow || hasDestArrow)) {
    trimmedPath = getTrimmedBezierPath(
      parallelPath.startX, parallelPath.startY, parallelPath.ctrlX, parallelPath.ctrlY,
      parallelPath.endX, parallelPath.endY,
      curvedArrowPlacement ? curvedArrowPlacement.source.trimT : 0,
      curvedArrowPlacement ? curvedArrowPlacement.dest.trimT : 1,
    );
  }

  // Arrow-less ends on a Thing-group anchor are cut along its shell.
  const clipShells = [];
  if (sAnchorInfo?.shellRect && !hasSourceArrow) clipShells.push(sAnchorInfo.shellRect);
  if (eAnchorInfo?.shellRect && !hasDestArrow) clipShells.push(eAnchorInfo.shellRect);

  // The stroke.
  let stroke;
  const stubs = [];
  if (orthoRouting) {
    stroke = { kind: 'path', d: orthoRouting.pathD, roundCap: true };
    if (routingStyle === 'manhattan') {
      if (!hasSourceArrow) stubs.push({ x1, y1, x2: startX, y2: startY });
      if (!hasDestArrow) stubs.push({ x1: endX, y1: endY, x2, y2 });
    }
  } else if (useCurve) {
    stroke = { kind: 'path', d: trimmedPath ? trimmedPath.path : parallelPath.path, roundCap: true };
  } else {
    stroke = { kind: 'line', x1: startX, y1: startY, x2: endX, y2: endY, roundCap: false };
  }

  // The arrowheads, in the renderer's order of precedence.
  let source = null;
  let dest = null;
  if (useCurve && parallelPath.ctrlX !== null && curvedArrowPlacement) {
    source = curvedArrowPlacement.source;
    dest = curvedArrowPlacement.dest;
  } else if (orthoRouting?.kind === 'lombardi') {
    source = orthoRouting.sourceArrow || { x: startX, y: startY, angle: 0 };
    dest = orthoRouting.destArrow || { x: endX, y: endY, angle: 0 };
  } else if (enableAutoRouting && routingStyle === 'clean') {
    const offset = 6;
    const ports = cleanLaneOffsets.get(edge.id);
    if (ports) {
      source = sideArrow(ports.sourceSide, ports.sourcePort.x, ports.sourcePort.y, offset);
      dest = sideArrow(ports.destSide, ports.destPort.x, ports.destPort.y, offset);
    } else {
      const deltaX = endX - startX;
      const deltaY = endY - startY;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        source = { angle: deltaY > 0 ? -90 : 90, x: startX, y: startY + (deltaY > 0 ? offset : -offset) };
        dest = { angle: deltaX > 0 ? 0 : 180, x: endX + (deltaX > 0 ? -offset : offset), y: endY };
      } else {
        source = { angle: deltaX > 0 ? 180 : 0, x: startX + (deltaX > 0 ? offset : -offset), y: startY };
        dest = { angle: deltaY > 0 ? 90 : -90, x: endX, y: endY + (deltaY > 0 ? -offset : offset) };
      }
    }
  } else if (!sourceIntersection || !destIntersection) {
    const fallbackOffset = 20;
    source = { x: x1 + (dx / length) * fallbackOffset, y: y1 + (dy / length) * fallbackOffset, angle: Math.atan2(-dy, -dx) * (180 / Math.PI) };
    dest = { x: x2 - (dx / length) * fallbackOffset, y: y2 - (dy / length) * fallbackOffset, angle: Math.atan2(dy, dx) * (180 / Math.PI) };
  } else if (enableAutoRouting && routingStyle === 'manhattan') {
    const offset = 12;
    if (Math.abs(endX - startX) > Math.abs(endY - startY)) {
      dest = { angle: endX >= startX ? 0 : 180, x: endX + (endX >= startX ? -offset : offset), y: endY };
      source = { angle: endX - startX >= 0 ? 180 : 0, x: startX + (endX - startX >= 0 ? offset : -offset), y: startY };
    } else {
      dest = { angle: endY >= startY ? 90 : -90, x: endX, y: endY + (endY >= startY ? -offset : offset) };
      source = { angle: endY - startY >= 0 ? -90 : 90, x: startX, y: startY + (endY - startY >= 0 ? offset : -offset) };
    }
  } else {
    const offset = 12;
    const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
    const normalizedAngle = angle > 90 ? 180 - angle : angle;
    const arrowLength = (normalizedAngle < 15 || normalizedAngle > 75) ? offset * 0.6 : offset;
    source = { angle: Math.atan2(-dy, -dx) * (180 / Math.PI), x: sourceIntersection.x + (dx / length) * arrowLength, y: sourceIntersection.y + (dy / length) * arrowLength };
    dest = { angle: Math.atan2(dy, dx) * (180 / Math.PI), x: destIntersection.x - (dx / length) * arrowLength, y: destIntersection.y - (dy / length) * arrowLength };
  }
  if (enableAutoRouting && routingStyle === 'manhattan') {
    // Override by the routed sides: the arrow sits 12 outside the port, into the node.
    dest = sideArrow(manhattanDestSide, endX, endY, 12) || dest;
    source = sideArrow(manhattanSourceSide, startX, startY, 12) || source;
  }

  const arrows = [];
  if (hasSourceArrow && source) arrows.push({ end: 'source', x: source.x, y: source.y, angle: source.angle });
  if (hasDestArrow && dest) arrows.push({ end: 'dest', x: dest.x, y: dest.y, angle: dest.angle });

  return { ...stroke, stubs, arrows, clipShells, sourceNode, destNode };
}

