import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import * as GeometryUtils from '../utils/canvas/geometryUtils.js';
import { getNodeDimensions } from '../utils.js';
import useHistoryStore from '../store/historyStore.js';
import { getVisualConnectionEndpoints } from '../utils/canvas/nodeHitbox.js';
import { calculateParallelEdgePath, getPointOnQuadraticBezier } from '../utils/canvas/parallelEdgeUtils.js';
import { calculateSelfLoopPath } from '../utils/canvas/selfLoopUtils.js';

// Movement Zoom-Out constants
const DRAG_ZOOM_MIN = 0.3;
const DRAG_ZOOM_ANIMATION_DURATION = 250; // ms

/**
 * useNodeDrag — Extracts all node/group dragging behavior from NodeCanvas.
 *
 * Owns:
 *   - draggingNodeInfo state (single / multi-select / group shapes)
 *   - Drag zoom-out/restore animations
 *   - Edge panning (auto-pan when cursor near viewport edges during drag)
 *   - RAF-throttled position updates during drag
 *   - History recording on drag end
 *   - Node scale bump (1.15x on start, 1.0 on end)
 *   - DOM-bypass: writes CSS transforms directly to node/edge SVG elements during drag
 *     (no Zustand state updates, no React re-renders until drag end)
 *
 * Does NOT own:
 *   - Long-press timeout / click discrimination (handleNodeMouseDown stays in NodeCanvas)
 *   - Group-drop detection UI (NodeCanvas handles the dialog using returned draggedNodeIds)
 *   - Connection drawing (separate concern)
 */
export const useNodeDrag = ({
  // Canvas transform (from useCanvasTransform)
  panOffsetRef,
  zoomLevelRef,
  setPanOffset,
  setZoomLevel,

  // Container / geometry
  containerRef,
  canvasSize,
  canvasSizeRef,
  viewportSizeRef,
  viewportBoundsRef,
  mousePositionRef,

  // Graph data
  activeGraphId,
  nodes,
  nodeById,
  selectedInstanceIds,

  // Store actions
  storeActions,

  // Grid settings
  gridMode,
  gridSize,

  // Drag zoom settings
  dragZoomSettings,

  // External refs for coordination
  pinchSmoothingRef,
  placedLabelsRef,

  // DOM-bypass drag refs (from NodeCanvas)
  nodeByIdRef,
  baseDimsByIdRef,
  edgeCurveInfoRef,
  edgesByNodeIdRef,
  edgesRef,
  selectedInstanceIdsRef,
  enableAutoRoutingRef,
  routingStyleRef,
  groupsByNodeIdRef,
}) => {
  // ---------------------------------------------------------------------------
  // State & Refs
  // ---------------------------------------------------------------------------
  const [draggingNodeInfo, setDraggingNodeInfo] = useState(null);
  const draggingNodeInfoRef = useRef(null);
  // Sync synchronously (pre-paint, pre-RAF) so the drag-zoom animation's first
  // step — scheduled from the same event handler that calls setDraggingNodeInfo
  // — sees a populated ref. A post-paint useEffect here let the first zoom
  // frame skip performDragUpdate, leaving the node un-transformed while the
  // SVG zoom animated.
  useLayoutEffect(() => { draggingNodeInfoRef.current = draggingNodeInfo; }, [draggingNodeInfo]);

  const [preDragZoomLevel, setPreDragZoomLevel] = useState(null);

  // isAnimatingZoom is ref-only (no React state) to avoid re-renders during drag zoom animation.
  // Consumers read isAnimatingZoomRef.current directly.
  const isAnimatingZoomRef = useRef(false);

  const [longPressingInstanceId, setLongPressingInstanceId] = useState(null);

  const zoomOutInitiatedRef = useRef(false);
  const actualZoomedOutLevelRef = useRef(null);
  const actualZoomedOutPanRef = useRef(null);
  const preDragPanOffsetRef = useRef(null);
  const restoreInProgressRef = useRef(false);

  // Holds the previous drag's performCleanup while the zoom-restore animation
  // runs. If a new drag starts before the animation completes, the animation
  // RAF is cancelled and its onComplete never fires — leaving stale drag
  // positions in dragPositionsRef that leak into the next drag's finalUpdates.
  // The new drag's start forces this cleanup to run synchronously.
  const pendingZoomRestoreCleanupRef = useRef(null);

  const zoomAnimationRef = useRef({
    active: false,
    startTime: 0,
    startZoom: 1,
    targetZoom: 1,
    startPan: { x: 0, y: 0 },
    anchorWorld: { x: 0, y: 0 },
    anchorClient: { x: 0, y: 0 },
    animationId: null
  });

  const wasDraggingRef = useRef(false);
  const dragHistoryRecordedRef = useRef(false);
  const isEdgePanningRef = useRef(false);
  const panRafRef = useRef(null);

  // RAF throttling for drag position updates
  const pendingDragUpdate = useRef(null);
  const dragUpdateScheduled = useRef(false);

  // DOM-bypass drag state
  const dragPositionsRef = useRef(new Map());     // instanceId → {x, y}
  const dragNodeElsRef = useRef(new Map());       // instanceId → DOM <g> element
  const dragEdgeElsRef = useRef(new Map());       // edgeId → DOM <g> element(s)
  const dragGroupElsRef = useRef(new Map());      // groupId → DOM <g> element(s)
  const dragGroupMetaRef = useRef(new Map());     // groupId → { memberIds, elements[] }

  // ---------------------------------------------------------------------------
  // Grid Snapping Helpers
  // ---------------------------------------------------------------------------
  const snapToGridAnimated = useCallback((mouseX, mouseY, nodeWidth, nodeHeight, currentPos) => {
    return GeometryUtils.snapToGridAnimated(mouseX, mouseY, nodeWidth, nodeHeight, currentPos, gridMode, gridSize);
  }, [gridMode, gridSize]);

  // ---------------------------------------------------------------------------
  // DOM Element Caching (called once on drag start)
  // ---------------------------------------------------------------------------
  const cacheDOMElements = useCallback((nodeIds) => {
    const container = containerRef.current;
    if (!container) return;

    dragNodeElsRef.current.clear();
    dragEdgeElsRef.current.clear();
    dragGroupElsRef.current.clear();

    // Cache node <g> elements. Suppress the CSS transform transition inline
    // so DOM-bypass position writes apply instantly. Only the primary dragged
    // node carries the `.node.dragging` class (which already disables the
    // transition via CSS); members of a group- or multi-drag do not, so they
    // would otherwise lerp toward each new transform.
    const nodeIdSet = new Set(nodeIds);
    nodeIdSet.forEach(id => {
      const el = container.querySelector(`[data-instance-id="${id}"]`);
      if (el) {
        dragNodeElsRef.current.set(id, el);
        el.style.transition = 'none';
      }
    });

    // Cache edge <g> elements for all edges connected to dragged nodes
    const edgesByNode = edgesByNodeIdRef.current;
    const affectedEdgeIds = new Set();
    nodeIdSet.forEach(nodeId => {
      const edges = edgesByNode.get(nodeId);
      if (edges) edges.forEach(eid => affectedEdgeIds.add(eid));
    });

    affectedEdgeIds.forEach(edgeId => {
      // querySelectorAll returns all matches (edge appears in below + above blocks)
      const els = container.querySelectorAll(`[data-edge-id="${edgeId}"]`);
      if (els.length > 0) {
        // Store all matching elements (edge may be in both above/below groups)
        dragEdgeElsRef.current.set(edgeId, Array.from(els));
      }
    });

    // Cache group <g> elements and sub-element metadata for all groups containing dragged nodes
    const groupsByNode = groupsByNodeIdRef.current;
    dragGroupMetaRef.current.clear();
    nodeIdSet.forEach(nodeId => {
      const groups = groupsByNode.get(nodeId);
      if (groups) {
        groups.forEach(({ groupId, memberInstanceIds }) => {
          if (!dragGroupElsRef.current.has(groupId)) {
            const els = container.querySelectorAll(`[data-group-id="${groupId}"]`);
            if (els.length > 0) {
              const arr = Array.from(els);
              arr.forEach(el => { el.dataset.groupBaseTransform = el.style.transform || ''; });
              dragGroupElsRef.current.set(groupId, arr);

              // Cache sub-element references for direct attribute updates.
              // The label (rect+text) only lives on one sub per group — on the
              // `.group` element for regular groups, or on the separate
              // `.node-group-title` element for thing-groups. The `.node-group-bg`
              // sub has no label child, so derive shared dims at the group level.
              const elements = arr.map(el => {
                const isRegular = el.classList.contains('group');
                const isBg = el.classList.contains('node-group-bg');
                const labelG = el.querySelector(':scope > .group-label');
                const labelRect = labelG?.querySelector('rect');
                const labelText = labelG?.querySelector('text');
                return {
                  el,
                  type: isRegular ? 'regular' : isBg ? 'bg' : 'title',
                  directRects: Array.from(el.querySelectorAll(':scope > rect')),
                  labelRect,
                  labelText,
                  labelWidth: labelRect ? parseFloat(labelRect.getAttribute('width')) : 0,
                  labelHeight: labelRect ? parseFloat(labelRect.getAttribute('height')) : 0,
                };
              });
              let groupLabelWidth = 0;
              let groupLabelHeight = 0;
              for (const sub of elements) {
                if (sub.labelHeight > groupLabelHeight) {
                  groupLabelWidth = sub.labelWidth;
                  groupLabelHeight = sub.labelHeight;
                }
              }
              dragGroupMetaRef.current.set(groupId, {
                memberIds: memberInstanceIds ? [...memberInstanceIds] : [],
                labelWidth: groupLabelWidth,
                labelHeight: groupLabelHeight,
                elements,
              });
            }
          }
        });
      }
    });
  }, [containerRef, edgesByNodeIdRef, groupsByNodeIdRef]);

  // Re-cache DOM elements after React re-renders for drag start.
  // The primary node moves to a separate JSX block (isDragging=true) on re-render,
  // invalidating the DOM ref cached synchronously in startDragForNode.
  // Must run pre-paint: the drag-zoom animation's first RAF fires the same
  // frame as this commit, and needs the fresh DOM refs to write node/edge
  // transforms to the live elements rather than the detached pre-rerender ones.
  useLayoutEffect(() => {
    if (!draggingNodeInfo) return;
    const ids = [];
    if (draggingNodeInfo.relativeOffsets) {
      ids.push(draggingNodeInfo.primaryId);
      Object.keys(draggingNodeInfo.relativeOffsets).forEach(id => ids.push(id));
    } else if (draggingNodeInfo.instanceId) {
      ids.push(draggingNodeInfo.instanceId);
    } else if (draggingNodeInfo.memberOffsets) {
      draggingNodeInfo.memberOffsets.forEach(m => ids.push(m.id));
    }
    if (ids.length > 0) cacheDOMElements(ids);
  }, [draggingNodeInfo, cacheDOMElements]);

  // ---------------------------------------------------------------------------
  // Compute Position Updates (pure math, no side effects)
  // Returns [{instanceId, x, y}, ...]
  // ---------------------------------------------------------------------------
  const computePositionUpdates = useCallback((mouseCanvasX, mouseCanvasY, draggingInfo) => {
    if (!draggingInfo) return [];

    // Group drag via label
    if (draggingInfo.groupId && Array.isArray(draggingInfo.memberOffsets)) {
      return draggingInfo.memberOffsets.map(({ id, dx, dy }) => {
        const node = nodeByIdRef.current.get(id);
        const xRaw = mouseCanvasX - dx;
        const yRaw = mouseCanvasY - dy;
        if (!node || gridMode === 'off') {
          return { instanceId: id, x: xRaw, y: yRaw };
        }
        const dims = getNodeDimensions(node, false, null);
        const centerX = xRaw + dims.currentWidth / 2;
        const centerY = yRaw + dims.currentHeight / 2;
        const snappedCenterX = Math.floor(centerX / gridSize) * gridSize;
        const snappedCenterY = Math.floor(centerY / gridSize) * gridSize;
        return { instanceId: id, x: snappedCenterX - dims.currentWidth / 2, y: snappedCenterY - dims.currentHeight / 2 };
      });
    }

    // Multi-node drag
    if (draggingInfo.relativeOffsets) {
      const primaryInstanceId = draggingInfo.primaryId;
      const dx = mouseCanvasX - draggingInfo.initialMouseCanvas.x;
      const dy = mouseCanvasY - draggingInfo.initialMouseCanvas.y;
      let newPrimaryX = draggingInfo.initialPrimaryPos.x + dx;
      let newPrimaryY = draggingInfo.initialPrimaryPos.y + dy;

      if (gridMode !== 'off') {
        const primaryNode = nodeByIdRef.current.get(primaryInstanceId);
        if (primaryNode) {
          const dims = getNodeDimensions(primaryNode, false, null);
          const snapped = snapToGridAnimated(mouseCanvasX, mouseCanvasY, dims.currentWidth, dims.currentHeight, { x: primaryNode.x, y: primaryNode.y });
          newPrimaryX = snapped.x;
          newPrimaryY = snapped.y;
        }
      }

      const updates = [{ instanceId: primaryInstanceId, x: newPrimaryX, y: newPrimaryY }];
      Object.keys(draggingInfo.relativeOffsets).forEach(instanceId => {
        const rel = draggingInfo.relativeOffsets[instanceId];
        updates.push({ instanceId, x: newPrimaryX + rel.offsetX, y: newPrimaryY + rel.offsetY });
      });
      return updates;
    }

    // Single node drag
    const { instanceId, offset } = draggingInfo;
    const node = nodeByIdRef.current.get(instanceId);
    if (!node) return [];

    const dims = getNodeDimensions(node, false, null);
    let newX, newY;

    if (gridMode !== 'off') {
      const snapped = snapToGridAnimated(mouseCanvasX, mouseCanvasY, dims.currentWidth, dims.currentHeight, { x: node.x, y: node.y });
      newX = snapped.x;
      newY = snapped.y;
    } else {
      newX = mouseCanvasX - offset.x;
      newY = mouseCanvasY - offset.y;
    }
    return [{ instanceId, x: newX, y: newY }];
  }, [gridMode, gridSize, snapToGridAnimated, nodeByIdRef]);

  // ---------------------------------------------------------------------------
  // Update Edge DOM Elements During Drag (edges, arrows, labels)
  // ---------------------------------------------------------------------------
  const updateEdgesInDOM = useCallback((movedNodeIds) => {
    const edgesByNode = edgesByNodeIdRef.current;
    const affectedEdgeIds = new Set();
    movedNodeIds.forEach(nodeId => {
      const edges = edgesByNode.get(nodeId);
      if (edges) edges.forEach(eid => affectedEdgeIds.add(eid));
    });

    const curNodeById = nodeByIdRef.current;
    const curBaseDims = baseDimsByIdRef.current;
    const curCurveInfo = edgeCurveInfoRef.current;
    const curSelectedIds = selectedInstanceIdsRef.current;
    const isManhattanOrClean = enableAutoRoutingRef.current &&
      (routingStyleRef.current === 'manhattan' || routingStyleRef.current === 'clean');

    // Build edge data index from ALL edges (not just visible) — edgesByNodeIdRef now
    // spans all edges, so affectedEdgeIds may include edges that culled out. Looking
    // them up here lets drag update any whose DOM element was cached at drag start,
    // even if a subsequent culling pass would have excluded them from the visible set.
    const allEdges = edgesRef.current;
    const edgeDataMap = new Map();
    for (let i = 0; i < allEdges.length; i++) {
      const e = allEdges[i];
      if (affectedEdgeIds.has(e.id)) edgeDataMap.set(e.id, e);
    }

    affectedEdgeIds.forEach(edgeId => {
      const edgeEls = dragEdgeElsRef.current.get(edgeId);
      if (!edgeEls || edgeEls.length === 0) return;

      const edge = edgeDataMap.get(edgeId);
      if (!edge) return;

      // Get effective positions (dragPositionsRef for dragged, store for static)
      const dragPos = dragPositionsRef.current;
      const sStored = curNodeById.get(edge.sourceId);
      const dStored = curNodeById.get(edge.destinationId);
      if (!sStored || !dStored) return;

      const sPos = dragPos.get(edge.sourceId) || { x: sStored.x, y: sStored.y };
      const dPos = dragPos.get(edge.destinationId) || { x: dStored.x, y: dStored.y };

      const sDims = curBaseDims.get(edge.sourceId) || getNodeDimensions(sStored, false, null);
      const dDims = curBaseDims.get(edge.destinationId) || getNodeDimensions(dStored, false, null);

      // Self-loop: recompute arc from the moving node's current drag position.
      if (edge.sourceId === edge.destinationId) {
        const loop = calculateSelfLoopPath(sPos.x, sPos.y, sDims.currentWidth, sDims.currentHeight, curCurveInfo.get(edgeId));
        const apexX = loop.loopCx + loop.radius * Math.cos(loop.outwardAngle);
        const apexY = loop.loopCy + loop.radius * Math.sin(loop.outwardAngle);
        edgeEls.forEach(edgeEl => {
          const paths = edgeEl.querySelectorAll('path');
          paths.forEach(p => p.setAttribute('d', loop.path));
          const arrowG = edgeEl.querySelector('[data-arrow="self"]');
          if (arrowG) {
            arrowG.setAttribute('transform', `translate(${loop.anchorB.x}, ${loop.anchorB.y}) rotate(${loop.arrowAngleB + 90})`);
          }
          const textEls = edgeEl.querySelectorAll('text');
          textEls.forEach(t => {
            t.setAttribute('x', apexX);
            t.setAttribute('y', apexY);
          });
        });
        return;
      }

      // Create virtual nodes with updated positions for endpoint calculation
      const virtualSource = { ...sStored, x: sPos.x, y: sPos.y };
      const virtualDest = { ...dStored, x: dPos.x, y: dPos.y };

      // Match NodeCanvas edge-endpoint logic: border-clip only the arrow side(s),
      // centers for non-directed sides. Otherwise non-directed edges visually
      // terminate at the node border during drag instead of the center.
      const arrowsToward = edge.directionality?.arrowsToward instanceof Set
        ? edge.directionality.arrowsToward
        : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);
      const hasSourceArrow = arrowsToward.has(edge.sourceId);
      const hasDestArrow = arrowsToward.has(edge.destinationId);
      const isDirected = arrowsToward.size > 0;

      const centerX1 = virtualSource.x + sDims.currentWidth / 2;
      const centerY1 = virtualSource.y + sDims.currentHeight / 2;
      const centerX2 = virtualDest.x + dDims.currentWidth / 2;
      const centerY2 = virtualDest.y + dDims.currentHeight / 2;

      let endpoints;
      if (isManhattanOrClean) {
        endpoints = { x1: centerX1, y1: centerY1, x2: centerX2, y2: centerY2 };
      } else if (isDirected && (hasSourceArrow || hasDestArrow)) {
        const clipped = getVisualConnectionEndpoints(
          virtualSource, virtualDest, sDims, dDims,
          curSelectedIds.has(edge.sourceId),
          curSelectedIds.has(edge.destinationId)
        );
        endpoints = {
          x1: hasSourceArrow ? clipped.x1 : centerX1,
          y1: hasSourceArrow ? clipped.y1 : centerY1,
          x2: hasDestArrow ? clipped.x2 : centerX2,
          y2: hasDestArrow ? clipped.y2 : centerY2,
        };
      } else {
        endpoints = { x1: centerX1, y1: centerY1, x2: centerX2, y2: centerY2 };
      }

      // Get curve info for parallel edges
      const curveInfo = curCurveInfo.get(edgeId);
      const useCurve = curveInfo && curveInfo.totalInPair > 1;
      const parallelPath = calculateParallelEdgePath(
        endpoints.x1, endpoints.y1, endpoints.x2, endpoints.y2, curveInfo
      );

      // Update each edge <g> element (may appear in both above/below blocks)
      edgeEls.forEach(edgeEl => {
        // --- Update edge geometry (paths + lines) ---
        if (parallelPath.type === 'line' && !useCurve) {
          // Straight edge: update <line> elements
          const lines = edgeEl.querySelectorAll('line');
          lines.forEach(line => {
            line.setAttribute('x1', endpoints.x1);
            line.setAttribute('y1', endpoints.y1);
            line.setAttribute('x2', endpoints.x2);
            line.setAttribute('y2', endpoints.y2);
          });
          // Also update any <path> elements (glow, click target)
          const paths = edgeEl.querySelectorAll('path');
          paths.forEach(path => {
            const d = path.getAttribute('d');
            // Only update paths that look like simple lines (M...L...) not complex routes
            if (d && (d.startsWith('M') && d.includes('L') && !d.includes('Q') && !d.includes('C'))) {
              path.setAttribute('d', `M ${endpoints.x1} ${endpoints.y1} L ${endpoints.x2} ${endpoints.y2}`);
            }
          });
        } else {
          // Curved/parallel edge: update <path> elements
          const paths = edgeEl.querySelectorAll('path');
          paths.forEach(path => {
            path.setAttribute('d', parallelPath.path);
          });
          // Also update any straight <line> elements that might exist as click targets
          const lines = edgeEl.querySelectorAll('line');
          lines.forEach(line => {
            line.setAttribute('x1', endpoints.x1);
            line.setAttribute('y1', endpoints.y1);
            line.setAttribute('x2', endpoints.x2);
            line.setAttribute('y2', endpoints.y2);
          });
        }

        // --- Update arrow positions ---
        if (!isManhattanOrClean) {
          const arrowGs = edgeEl.querySelectorAll('[data-arrow]');
          if (arrowGs.length > 0) {
            if (useCurve && parallelPath.ctrlX != null) {
              // Curved: compute point on quadratic bezier at t near endpoints + tangent angle
              arrowGs.forEach(arrowG => {
                const type = arrowG.getAttribute('data-arrow');
                const t = type === 'source' ? 0.08 : 0.92;
                const pt = getPointOnQuadraticBezier(t,
                  parallelPath.startX, parallelPath.startY,
                  parallelPath.ctrlX, parallelPath.ctrlY,
                  parallelPath.endX, parallelPath.endY);
                const invT = 1 - t;
                const tx = 2 * invT * (parallelPath.ctrlX - parallelPath.startX) + 2 * t * (parallelPath.endX - parallelPath.ctrlX);
                const ty = 2 * invT * (parallelPath.ctrlY - parallelPath.startY) + 2 * t * (parallelPath.endY - parallelPath.ctrlY);
                const angle = Math.atan2(ty, tx) * (180 / Math.PI) + (type === 'source' ? 180 : 0);
                arrowG.setAttribute('transform', `translate(${pt.x}, ${pt.y}) rotate(${angle + 90})`);
              });
            } else {
              // Straight: arrows near endpoints, angle from line direction
              const dx = endpoints.x2 - endpoints.x1;
              const dy = endpoints.y2 - endpoints.y1;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len > 0) {
                const offset = 5;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                arrowGs.forEach(arrowG => {
                  const type = arrowG.getAttribute('data-arrow');
                  if (type === 'source') {
                    arrowG.setAttribute('transform',
                      `translate(${endpoints.x1 + (dx / len) * offset}, ${endpoints.y1 + (dy / len) * offset}) rotate(${angle + 180 + 90})`);
                  } else {
                    arrowG.setAttribute('transform',
                      `translate(${endpoints.x2 - (dx / len) * offset}, ${endpoints.y2 - (dy / len) * offset}) rotate(${angle + 90})`);
                  }
                });
              }
            }
          }
        }
        // Manhattan/clean arrows: stay at pre-drag positions (port logic is too complex to replicate)

        // --- Update edge labels ---
        // Centering must match the React render path exactly: place the label
        // at the apex of the VISIBLE (border-clipped) segment, not the
        // center-to-center line. Otherwise, on drop, the label snaps to the
        // visible-segment apex and visibly shifts. NodeCanvas does this same
        // calculation around line 9118: getVisualConnectionEndpoints +
        // calculateParallelEdgePath on those visible endpoints.
        const textEls = edgeEl.querySelectorAll('text');
        if (textEls.length > 0) {
          const visibleEndpoints = getVisualConnectionEndpoints(
            virtualSource, virtualDest, sDims, dDims,
            curSelectedIds.has(edge.sourceId),
            curSelectedIds.has(edge.destinationId)
          );
          const labelPlacementPath = calculateParallelEdgePath(
            visibleEndpoints.x1, visibleEndpoints.y1,
            visibleEndpoints.x2, visibleEndpoints.y2,
            curveInfo
          );
          let midX, midY, labelAngle;
          if (labelPlacementPath.apexX != null) {
            midX = labelPlacementPath.apexX;
            midY = labelPlacementPath.apexY;
            labelAngle = labelPlacementPath.labelAngle || 0;
          } else {
            midX = (visibleEndpoints.x1 + visibleEndpoints.x2) / 2;
            midY = (visibleEndpoints.y1 + visibleEndpoints.y2) / 2;
            labelAngle = Math.atan2(
              visibleEndpoints.y2 - visibleEndpoints.y1,
              visibleEndpoints.x2 - visibleEndpoints.x1
            ) * (180 / Math.PI);
          }
          const adj = (labelAngle > 90 || labelAngle < -90) ? labelAngle + 180 : labelAngle;
          textEls.forEach(t => {
            t.setAttribute('x', midX);
            t.setAttribute('y', midY);
            t.setAttribute('transform', `rotate(${adj}, ${midX}, ${midY})`);
          });
        }
      });
    });
  }, [nodeByIdRef, baseDimsByIdRef, edgeCurveInfoRef, edgesByNodeIdRef, edgesRef,
    selectedInstanceIdsRef, enableAutoRoutingRef, routingStyleRef]);

  // ---------------------------------------------------------------------------
  // Update Group Bounds in DOM (recomputes bounding boxes for affected groups)
  // ---------------------------------------------------------------------------
  const updateGroupBoundsInDOM = useCallback((movedNodeIds) => {
    if (dragGroupMetaRef.current.size === 0) return;

    const groupsByNode = groupsByNodeIdRef.current;
    const affectedGroupIds = new Set();
    movedNodeIds.forEach(nodeId => {
      const groups = groupsByNode.get(nodeId);
      if (groups) groups.forEach(({ groupId }) => affectedGroupIds.add(groupId));
    });
    if (affectedGroupIds.size === 0) return;

    const curNodeById = nodeByIdRef.current;
    const curBaseDims = baseDimsByIdRef.current;
    const dragPos = dragPositionsRef.current;

    // GROUP_SPACING must match NodeCanvas render (lines 8176-8190)
    const memberBoundaryPadding = Math.max(24, Math.round(gridSize * 0.2));
    const innerCanvasBorder = 32;
    const margin = memberBoundaryPadding + innerCanvasBorder;
    const titleToCanvasGap = 24;
    const titleTopMargin = 24;
    const titleBottomMargin = 24;

    affectedGroupIds.forEach(groupId => {
      const meta = dragGroupMetaRef.current.get(groupId);
      if (!meta) return;

      // Compute bounding box from all member positions (drag or store)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      meta.memberIds.forEach(id => {
        const dp = dragPos.get(id);
        const stored = curNodeById.get(id);
        const px = dp ? dp.x : (stored?.x ?? 0);
        const py = dp ? dp.y : (stored?.y ?? 0);
        const dims = curBaseDims.get(id) || { currentWidth: 200, currentHeight: 150 };
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px + dims.currentWidth > maxX) maxX = px + dims.currentWidth;
        if (py + dims.currentHeight > maxY) maxY = py + dims.currentHeight;
      });
      if (!isFinite(minX)) return;

      const rectX = minX - margin;
      const rectY = minY - margin;
      const rectW = (maxX - minX) + margin * 2;
      const rectH = (maxY - minY) + margin * 2;

      // Shared label dims at the group level (bg sub has no label child of its
      // own, so it must borrow from the title/regular sub to compute the
      // header strip correctly).
      const groupLabelWidth = meta.labelWidth || 0;
      const groupLabelHeight = meta.labelHeight || 0;
      const labelY = rectY - groupLabelHeight - titleToCanvasGap;
      const labelX = rectX + (rectW - groupLabelWidth) / 2;

      meta.elements.forEach(sub => {
        // Clear CSS transform — use raw attribute positioning instead
        sub.el.style.transform = '';
        sub.el.style.transformOrigin = '';

        if (sub.type === 'regular') {
          // Outline rect
          if (sub.directRects[0]) {
            sub.directRects[0].setAttribute('x', rectX);
            sub.directRects[0].setAttribute('y', rectY);
            sub.directRects[0].setAttribute('width', rectW);
            sub.directRects[0].setAttribute('height', rectH);
          }
          // Label position (centered above group). Also sync the label rect's
          // transform-origin — JSX computes it from the render-time labelX/Y,
          // which goes stale during drag and makes the scale(1.08) pop-up
          // scale from the wrong pivot.
          if (sub.labelRect) {
            sub.labelRect.setAttribute('x', labelX);
            sub.labelRect.setAttribute('y', labelY);
            sub.labelRect.style.transformOrigin = `${labelX + groupLabelWidth / 2}px ${labelY + groupLabelHeight / 2}px`;
            if (sub.labelText) {
              sub.labelText.setAttribute('x', labelX + groupLabelWidth / 2);
              sub.labelText.setAttribute('y', labelY + groupLabelHeight * 0.7 - 2);
            }
          }
        } else if (sub.type === 'bg') {
          // Thing-group background: outer rect + inner canvas rect.
          // Must mirror render math: outer spans from (labelY - titleTopMargin)
          // to (rectY + rectH); inner starts at (labelY + labelHeight + titleBottomMargin).
          const ngRectY = labelY - titleTopMargin;
          const ngRectH = (rectY + rectH) - ngRectY;
          const innerY = labelY + groupLabelHeight + titleBottomMargin;
          if (sub.directRects[0]) {
            sub.directRects[0].setAttribute('x', rectX);
            sub.directRects[0].setAttribute('y', ngRectY);
            sub.directRects[0].setAttribute('width', rectW);
            sub.directRects[0].setAttribute('height', ngRectH);
          }
          if (sub.directRects[1]) {
            sub.directRects[1].setAttribute('x', rectX + innerCanvasBorder);
            sub.directRects[1].setAttribute('y', innerY);
            sub.directRects[1].setAttribute('width', rectW - innerCanvasBorder * 2);
            sub.directRects[1].setAttribute('height', (rectY + rectH) - innerY - innerCanvasBorder);
          }
        } else if (sub.type === 'title') {
          // Thing-group title label — keep the label rect, its scale-pop
          // transform-origin, and the label text all in sync with the new
          // bbox-derived labelX/labelY.
          if (sub.labelRect) {
            sub.labelRect.setAttribute('x', labelX);
            sub.labelRect.setAttribute('y', labelY);
            sub.labelRect.style.transformOrigin = `${labelX + groupLabelWidth / 2}px ${labelY + groupLabelHeight / 2}px`;
            if (sub.labelText) {
              sub.labelText.setAttribute('x', labelX + groupLabelWidth / 2);
              sub.labelText.setAttribute('y', labelY + groupLabelHeight * 0.7 - 2);
            }
          }
        }
      });
    });
  }, [groupsByNodeIdRef, nodeByIdRef, baseDimsByIdRef, gridSize]);

  // ---------------------------------------------------------------------------
  // Core DOM Drag Update (replaces performDragUpdate — writes to DOM, not store)
  // ---------------------------------------------------------------------------
  const performDOMDragUpdate = useCallback((clientX, clientY, currentPan, currentZoom, draggingInfo) => {
    if (!draggingInfo) return;

    // Clear label placement cache during drag
    placedLabelsRef.current = new Map();

    // Calculate mouse position in canvas coordinates
    const rect = containerRef.current.getBoundingClientRect();
    const mouseCanvasX = (clientX - rect.left - currentPan.x) / currentZoom + canvasSizeRef.current.offsetX;
    const mouseCanvasY = (clientY - rect.top - currentPan.y) / currentZoom + canvasSizeRef.current.offsetY;

    // Compute new positions (pure math, same logic as before)
    const positionUpdates = computePositionUpdates(mouseCanvasX, mouseCanvasY, draggingInfo);
    if (positionUpdates.length === 0) return;

    // Store positions in ref (for flush on drag end)
    const movedNodeIds = new Set();
    positionUpdates.forEach(({ instanceId, x, y }) => {
      dragPositionsRef.current.set(instanceId, { x, y });
      movedNodeIds.add(instanceId);
    });

    // Apply CSS translate deltas to node DOM elements
    const curNodeById = nodeByIdRef.current;
    const curBaseDims = baseDimsByIdRef.current;
    positionUpdates.forEach(({ instanceId, x, y }) => {
      const nodeEl = dragNodeElsRef.current.get(instanceId);
      if (!nodeEl) return;

      const node = curNodeById.get(instanceId);
      if (!node) return;

      // Delta from React-rendered (stored) position
      const storedX = node.x ?? 0;
      const storedY = node.y ?? 0;
      const deltaX = x - storedX;
      const deltaY = y - storedY;

      const nodeScale = node.scale ?? 1;
      const dims = curBaseDims.get(instanceId);
      const cx = storedX + (dims?.currentWidth ?? 0) / 2;
      const cy = storedY + (dims?.currentHeight ?? 0) / 2;

      nodeEl.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${nodeScale})`;
      nodeEl.style.transformOrigin = `${cx}px ${cy}px`;
    });

    // Update connected edges in DOM
    updateEdgesInDOM(movedNodeIds);

    // Update group bounding boxes for ALL drag types (single, multi, group-label)
    updateGroupBoundsInDOM(movedNodeIds);
  }, [containerRef, canvasSizeRef, placedLabelsRef, computePositionUpdates, nodeByIdRef, baseDimsByIdRef, updateEdgesInDOM, updateGroupBoundsInDOM]);

  // Ref to hold latest performDOMDragUpdate (avoids restarting edge panning effect)
  const performDragUpdateRef = useRef(performDOMDragUpdate);
  useEffect(() => { performDragUpdateRef.current = performDOMDragUpdate; }, [performDOMDragUpdate]);

  // Re-apply DOM-bypass drag updates after every React commit while dragging.
  // During edge panning, `setPan` schedules a settled-state commit that re-runs
  // NodeCanvas's JSX; the edge-render path recomputes `x1`/`y1`/`x2`/`y2` from
  // *stored* node positions and writes them onto the same DOM nodes we just
  // updated, making connections flicker back to pre-drag coords for a frame.
  // This layout effect runs synchronously after commit, before paint, and
  // restores the correct drag-driven attributes. Fast path: no-op unless a
  // drag is actually in flight.
  useLayoutEffect(() => {
    const current = draggingNodeInfoRef.current;
    if (!current) return;
    const last = pendingDragUpdate.current;
    if (!last) return;
    // The pendingDragUpdate carries its own draggingNodeInfo snapshot. If it's
    // from a previous drag (left over when a new drag starts on the same
    // commit cycle), re-applying it would write the previous drag's node back
    // into dragPositionsRef and teleport it on release.
    if (last.draggingNodeInfo !== current) return;
    const { clientX, clientY, draggingNodeInfo: info } = last;
    performDragUpdateRef.current(
      clientX, clientY,
      panOffsetRef.current, zoomLevelRef.current,
      info
    );
  });

  // ---------------------------------------------------------------------------
  // Zoom Animations (drag zoom-out and restore)
  // ---------------------------------------------------------------------------
  const animateZoomToTarget = useCallback((targetZoom, anchorPoint = null, currentZoom = null, currentPan = null) => {
    // Stop any existing drag zoom animation
    if (zoomAnimationRef.current.animationId) {
      cancelAnimationFrame(zoomAnimationRef.current.animationId);
    }

    // Stop pinch smoothing animation to prevent conflicts
    if (pinchSmoothingRef.current.animationId) {
      cancelAnimationFrame(pinchSmoothingRef.current.animationId);
      pinchSmoothingRef.current.animationId = null;
      pinchSmoothingRef.current.isAnimating = false;
    }

    const startZoom = currentZoom !== null ? currentZoom : zoomLevelRef.current;
    const startPan = currentPan ? { ...currentPan } : { ...panOffsetRef.current };

    const clientX = anchorPoint ? anchorPoint.clientX : viewportSizeRef.current.width / 2;
    const clientY = anchorPoint ? anchorPoint.clientY : viewportSizeRef.current.height / 2;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // World coordinates of the anchor point at animation start
    const anchorWorldX = (clientX - rect.left - startPan.x) / startZoom + canvasSizeRef.current.offsetX;
    const anchorWorldY = (clientY - rect.top - startPan.y) / startZoom + canvasSizeRef.current.offsetY;

    zoomAnimationRef.current = {
      active: true,
      startTime: performance.now(),
      startZoom,
      targetZoom,
      startPan,
      anchorWorld: { x: anchorWorldX, y: anchorWorldY },
      anchorClient: { x: clientX, y: clientY },
      animationId: null
    };

    isAnimatingZoomRef.current = true;

    const step = (now) => {
      const state = zoomAnimationRef.current;
      if (!state.active) return;

      const elapsed = now - state.startTime;
      const progress = Math.min(1, elapsed / DRAG_ZOOM_ANIMATION_DURATION);
      const t = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      const currentZoomVal = state.startZoom + (state.targetZoom - state.startZoom) * t;

      // Pan to keep anchor point stable
      const newPanX = state.anchorClient.x - rect.left - (state.anchorWorld.x - canvasSizeRef.current.offsetX) * currentZoomVal;
      const newPanY = state.anchorClient.y - rect.top - (state.anchorWorld.y - canvasSizeRef.current.offsetY) * currentZoomVal;

      const minPanX = viewportSizeRef.current.width - canvasSizeRef.current.width * currentZoomVal;
      const minPanY = viewportSizeRef.current.height - canvasSizeRef.current.height * currentZoomVal;
      const clampedPanX = Math.min(0, Math.max(newPanX, minPanX));
      const clampedPanY = Math.min(0, Math.max(newPanY, minPanY));

      setZoomLevel(currentZoomVal);
      setPanOffset({ x: clampedPanX, y: clampedPanY });

      // Update node CSS transforms to track cursor during zoom animation
      const dragInfo = draggingNodeInfoRef.current;
      if (dragInfo) {
        const mouse = mousePositionRef.current;
        performDragUpdateRef.current(mouse.x, mouse.y,
          { x: clampedPanX, y: clampedPanY }, currentZoomVal, dragInfo);
      }

      if (progress < 1) {
        state.animationId = requestAnimationFrame(step);
      } else {
        if (zoomOutInitiatedRef.current && !restoreInProgressRef.current) {
          actualZoomedOutLevelRef.current = state.targetZoom;
          actualZoomedOutPanRef.current = { x: clampedPanX, y: clampedPanY };
        }
        state.active = false;
        state.animationId = null;
        isAnimatingZoomRef.current = false;
      }
    };

    zoomAnimationRef.current.animationId = requestAnimationFrame(step);
  }, [setZoomLevel, setPanOffset, panOffsetRef, zoomLevelRef, viewportSizeRef, containerRef, canvasSizeRef, pinchSmoothingRef]);

  const animateZoomAndPanToTarget = useCallback((targetZoom, targetPan, currentZoom, currentPan = null, onComplete = null) => {
    if (zoomAnimationRef.current.animationId) {
      cancelAnimationFrame(zoomAnimationRef.current.animationId);
    }
    if (pinchSmoothingRef.current.animationId) {
      cancelAnimationFrame(pinchSmoothingRef.current.animationId);
      pinchSmoothingRef.current.animationId = null;
      pinchSmoothingRef.current.isAnimating = false;
    }

    const startZoom = currentZoom !== null ? currentZoom : zoomLevelRef.current;
    const startPan = currentPan !== null ? { ...currentPan } : { ...panOffsetRef.current };

    zoomAnimationRef.current = {
      active: true,
      startTime: performance.now(),
      startZoom,
      targetZoom,
      startPan,
      targetPan,
      animationId: null
    };

    isAnimatingZoomRef.current = true;

    const step = (now) => {
      const state = zoomAnimationRef.current;
      if (!state.active) return;

      const elapsed = now - state.startTime;
      const progress = Math.min(1, elapsed / DRAG_ZOOM_ANIMATION_DURATION);
      const t = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      const currentZoomVal = state.startZoom + (state.targetZoom - state.startZoom) * t;
      const currentPanX = state.startPan.x + (state.targetPan.x - state.startPan.x) * t;
      const currentPanY = state.startPan.y + (state.targetPan.y - state.startPan.y) * t;

      setZoomLevel(currentZoomVal);
      setPanOffset({ x: currentPanX, y: currentPanY });

      if (progress < 1) {
        state.animationId = requestAnimationFrame(step);
      } else {
        state.active = false;
        state.animationId = null;
        isAnimatingZoomRef.current = false;
        if (onComplete) onComplete();
      }
    };

    zoomAnimationRef.current.animationId = requestAnimationFrame(step);
  }, [setZoomLevel, setPanOffset, panOffsetRef, zoomLevelRef, pinchSmoothingRef]);

  // ---------------------------------------------------------------------------
  // Trigger Drag Zoom-Out
  // ---------------------------------------------------------------------------
  const triggerDragZoomOut = useCallback((clientX, clientY) => {
    if (!dragZoomSettings.enabled) {
      zoomOutInitiatedRef.current = false;
      return;
    }

    const currentZoom = zoomLevelRef.current;
    if (currentZoom > DRAG_ZOOM_MIN && !zoomOutInitiatedRef.current) {
      zoomOutInitiatedRef.current = true;
      setPreDragZoomLevel(currentZoom);
      preDragPanOffsetRef.current = { ...panOffsetRef.current };

      const zoomFactor = 1.0 - dragZoomSettings.zoomAmount;
      const targetZoom = Math.max(DRAG_ZOOM_MIN, currentZoom * zoomFactor);

      animateZoomToTarget(targetZoom, { clientX, clientY }, currentZoom, { ...panOffsetRef.current });
    }
  }, [zoomLevelRef, panOffsetRef, animateZoomToTarget, dragZoomSettings]);

  // ---------------------------------------------------------------------------
  // Clear DOM Transforms (called on drag end or cancel)
  // ---------------------------------------------------------------------------
  const clearDOMTransforms = useCallback(() => {
    // Snapshot elements before clearing refs so we can defer restoring the
    // `transition` property until AFTER React commits the flushed store
    // positions. Otherwise React may not yet have re-rendered new SVG attrs
    // when the inline `transform` drops off, and the node's CSS-transform
    // change from `translate(dx,dy) scale(1)` → `scale(1)` would lerp across
    // the 0.05s `transform` transition — the "teleport + fly-in" artifact.
    const snapshotNodeEls = Array.from(dragNodeElsRef.current.values());
    dragNodeElsRef.current.forEach((el) => {
      el.style.transform = '';
      el.style.transformOrigin = '';
      // Leave `style.transition = 'none'` in place for now.
    });
    dragGroupElsRef.current.forEach(els => {
      els.forEach(el => {
        el.style.transform = '';
        delete el.dataset.groupBaseTransform;
      });
    });
    dragPositionsRef.current.clear();
    dragNodeElsRef.current.clear();
    dragEdgeElsRef.current.clear();
    dragGroupElsRef.current.clear();
    dragGroupMetaRef.current.clear();
    // The post-commit re-apply effect (useLayoutEffect near the top of this
    // hook) reads pendingDragUpdate unconditionally whenever draggingNodeInfoRef
    // is truthy. If we don't clear it here, the next drag's first commit will
    // fire this effect with the PREVIOUS drag's `draggingNodeInfo`, writing
    // the old node back into dragPositionsRef and teleporting it on release.
    pendingDragUpdate.current = null;

    // Double-rAF: first frame lets React commit + paint with the new stored
    // positions; second frame restores normal transition behavior for any
    // future hover/scale animations.
    if (snapshotNodeEls.length > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          snapshotNodeEls.forEach(el => { el.style.transition = ''; });
        });
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Finalize a prior drag whose zoom-restore animation was cancelled mid-flight
  // by a new drag starting. The cancelled RAF drops its onComplete, so the
  // prior drag's positions never flush to the store and dragPositionsRef stays
  // populated — which causes the next drag's finalUpdates to include stale
  // entries and teleport the previously-dragged node on release.
  // ---------------------------------------------------------------------------
  const flushPendingZoomRestoreCleanup = useCallback(() => {
    const cleanup = pendingZoomRestoreCleanupRef.current;
    if (!cleanup) return;
    pendingZoomRestoreCleanupRef.current = null;
    if (zoomAnimationRef.current.animationId) {
      cancelAnimationFrame(zoomAnimationRef.current.animationId);
      zoomAnimationRef.current.active = false;
      zoomAnimationRef.current.animationId = null;
      isAnimatingZoomRef.current = false;
    }
    cleanup();
    // Defense against the drag-zoom animation consuming a stale pendingDragUpdate
    // on its first step (before any handleDragMove has run for the new drag).
    pendingDragUpdate.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Start Drag for Node (single or multi-select)
  // ---------------------------------------------------------------------------
  const startDragForNode = useCallback((nodeData, clientX, clientY) => {
    if (!nodeData || !activeGraphId) return false;
    flushPendingZoomRestoreCleanup();
    const instanceId = nodeData.id;

    // Collect all node IDs that will be dragged (for DOM caching)
    const draggedIds = [];

    if (selectedInstanceIds.has(instanceId)) {
      // Multi-node drag
      const primaryNodeData = nodeById.get(instanceId);
      if (!primaryNodeData) return false;

      const initialPrimaryPos = { x: primaryNodeData.x, y: primaryNodeData.y };
      const initialPositions = {};
      draggedIds.push(instanceId);
      nodes.forEach(n => {
        if (selectedInstanceIds.has(n.id) && n.id !== instanceId) {
          initialPositions[n.id] = { offsetX: n.x - initialPrimaryPos.x, offsetY: n.y - initialPrimaryPos.y };
          draggedIds.push(n.id);
        }
      });

      const rect = containerRef.current?.getBoundingClientRect();
      const initMouseCanvasX = rect ? (clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX : 0;
      const initMouseCanvasY = rect ? (clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY : 0;

      setDraggingNodeInfo({
        initialMouseCanvas: { x: initMouseCanvasX, y: initMouseCanvasY },
        initialPrimaryPos,
        relativeOffsets: initialPositions,
        primaryId: instanceId
      });

      dragHistoryRecordedRef.current = false;
      triggerDragZoomOut(clientX, clientY);

      selectedInstanceIds.forEach(id => {
        storeActions.updateNodeInstance(activeGraphId, id, draft => { draft.scale = 1.15; }, { isDragging: true, phase: 'start', ignore: true });
      });

      // Cache DOM elements for all dragged nodes
      cacheDOMElements(draggedIds);
      return true;
    }

    // Single node drag
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const mouseCanvasX = (clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX;
    const mouseCanvasY = (clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY;
    const offset = { x: mouseCanvasX - nodeData.x, y: mouseCanvasY - nodeData.y };
    setDraggingNodeInfo({ instanceId, offset, initialPos: { x: nodeData.x, y: nodeData.y } });

    dragHistoryRecordedRef.current = false;
    triggerDragZoomOut(clientX, clientY);
    storeActions.updateNodeInstance(activeGraphId, instanceId, draft => { draft.scale = 1.15; }, { isDragging: true, phase: 'start', ignore: true });

    // Cache DOM elements
    cacheDOMElements([instanceId]);
    return true;
  }, [activeGraphId, selectedInstanceIds, nodes, nodeById, panOffsetRef, zoomLevelRef, canvasSize.offsetX, canvasSize.offsetY, containerRef, storeActions, triggerDragZoomOut, cacheDOMElements, flushPendingZoomRestoreCleanup]);

  // Ref for long-press timeout to always use latest startDragForNode
  const startDragForNodeRef = useRef(startDragForNode);
  useEffect(() => { startDragForNodeRef.current = startDragForNode; }, [startDragForNode]);

  // ---------------------------------------------------------------------------
  // Start Group Drag (from group label mousedown)
  // ---------------------------------------------------------------------------
  const startGroupDrag = useCallback((groupId, memberOffsets, clientX, clientY) => {
    flushPendingZoomRestoreCleanup();
    setDraggingNodeInfo({ groupId, memberOffsets });
    dragHistoryRecordedRef.current = false;
    triggerDragZoomOut(clientX, clientY);

    // Cache DOM elements for all group members
    const memberIds = memberOffsets.map(m => m.id);
    cacheDOMElements(memberIds);
  }, [triggerDragZoomOut, cacheDOMElements, flushPendingZoomRestoreCleanup]);

  // ---------------------------------------------------------------------------
  // Cancel Drag (for touch cancel, escape key, etc.)
  // ---------------------------------------------------------------------------
  const cancelDrag = useCallback(() => {
    clearDOMTransforms();
    setDraggingNodeInfo(null);
  }, [clearDOMTransforms]);

  // ---------------------------------------------------------------------------
  // Handle Drag Move (called from handleMouseMove in NodeCanvas)
  // ---------------------------------------------------------------------------
  const handleDragMove = useCallback((clientX, clientY) => {
    // Movement Zoom-Out: trigger when drag starts moving
    if (!zoomOutInitiatedRef.current && dragZoomSettings.enabled) {
      const currentZoom = zoomLevelRef.current;
      if (currentZoom > DRAG_ZOOM_MIN) {
        zoomOutInitiatedRef.current = true;
        setPreDragZoomLevel(currentZoom);
        const zoomFactor = 1.0 - dragZoomSettings.zoomAmount;
        const targetZoom = Math.max(DRAG_ZOOM_MIN, currentZoom * zoomFactor);
        animateZoomToTarget(targetZoom, { clientX, clientY }, currentZoom, { ...panOffsetRef.current });
      }
    } else if (!zoomOutInitiatedRef.current && !dragZoomSettings.enabled) {
      zoomOutInitiatedRef.current = false;
    }

    // Store latest drag coordinates (RAF-throttled)
    pendingDragUpdate.current = {
      clientX,
      clientY,
      draggingNodeInfo: draggingNodeInfoRef.current
    };

    if (!dragUpdateScheduled.current) {
      dragUpdateScheduled.current = true;
      requestAnimationFrame(() => {
        dragUpdateScheduled.current = false;

        // Skip if edge panning is active — panLoop handles positioning
        if (isEdgePanningRef.current) return;

        const update = pendingDragUpdate.current;
        if (!update) return;

        const { clientX, clientY, draggingNodeInfo } = update;
        const currentPan = panOffsetRef.current;
        const currentZoom = zoomLevelRef.current;

        performDragUpdateRef.current(clientX, clientY, currentPan, currentZoom, draggingNodeInfo);
      });
    }
  }, [dragZoomSettings, zoomLevelRef, panOffsetRef, animateZoomToTarget]);

  // ---------------------------------------------------------------------------
  // Handle Drag End (called from handleMouseUp in NodeCanvas)
  // Returns { draggedNodeIds, primaryNodeId, checkGroupDrop, wasGroupDrag }
  // ---------------------------------------------------------------------------
  const handleDragEnd = useCallback((clientX, clientY, graphsMap) => {
    const info = draggingNodeInfo;
    if (!info) return { draggedNodeIds: [], primaryNodeId: null, checkGroupDrop: false, wasGroupDrag: false };

    // --- Capture final positions (NOT flushed yet — deferred to performCleanup) ---
    const finalPositions = new Map(dragPositionsRef.current);
    const finalUpdates = finalPositions.size > 0
      ? Array.from(finalPositions.entries()).map(
        ([instanceId, { x, y }]) => ({ instanceId, x, y })
      )
      : [];

    // --- History Recording (use finalPositions from dragPositionsRef) ---
    if (!dragHistoryRecordedRef.current) {
      const patches = [];
      const inversePatches = [];

      const checkAndRecord = (id, initX, initY) => {
        const finalPos = finalPositions.get(id);
        if (finalPos && (Math.abs(finalPos.x - initX) > 0.01 || Math.abs(finalPos.y - initY) > 0.01)) {
          patches.push({ op: 'replace', path: ['graphs', activeGraphId, 'instances', id, 'x'], value: finalPos.x });
          patches.push({ op: 'replace', path: ['graphs', activeGraphId, 'instances', id, 'y'], value: finalPos.y });
          inversePatches.push({ op: 'replace', path: ['graphs', activeGraphId, 'instances', id, 'x'], value: initX });
          inversePatches.push({ op: 'replace', path: ['graphs', activeGraphId, 'instances', id, 'y'], value: initY });
          return true;
        }
        return false;
      };

      if (info.relativeOffsets) {
        checkAndRecord(info.primaryId, info.initialPrimaryPos.x, info.initialPrimaryPos.y);
        Object.entries(info.relativeOffsets).forEach(([id, rel]) => {
          checkAndRecord(id, info.initialPrimaryPos.x + rel.offsetX, info.initialPrimaryPos.y + rel.offsetY);
        });
      } else if (info.initialPos) {
        checkAndRecord(info.instanceId, info.initialPos.x, info.initialPos.y);
      }

      if (patches.length > 0) {
        useHistoryStore.getState().pushAction({
          domain: `graph-${activeGraphId}`,
          actionType: 'node_position',
          description: `Moved ${patches.length / 2} Node(s)`,
          patches,
          inversePatches
        });
        dragHistoryRecordedRef.current = true;
      }
    }

    // --- Collect IDs for scale reset ---
    const instanceIdsToReset = new Set();
    if (info.relativeOffsets) {
      instanceIdsToReset.add(info.primaryId);
      Object.keys(info.relativeOffsets).forEach(id => instanceIdsToReset.add(id));
    } else if (info.instanceId) {
      instanceIdsToReset.add(info.instanceId);
    }
    if (instanceIdsToReset.size === 0 && Array.isArray(info.memberOffsets) && info.memberOffsets.length > 0) {
      instanceIdsToReset.add(info.memberOffsets[0].id);
    }
    const primaryFinalizeId = info.primaryId || info.instanceId || (Array.isArray(info.memberOffsets) ? info.memberOffsets[0]?.id : null);

    // --- Collect dragged node IDs and determine if group-drop should be checked ---
    const draggedNodeIds = [];
    let checkGroupDrop = false;
    const wasGroupDrag = !!(info.groupId && Array.isArray(info.memberOffsets));

    if (!wasGroupDrag) {
      checkGroupDrop = true;
      if (info.relativeOffsets) {
        draggedNodeIds.push(info.primaryId);
        Object.keys(info.relativeOffsets).forEach(id => draggedNodeIds.push(id));
      } else if (info.instanceId) {
        draggedNodeIds.push(info.instanceId);
      }
    }

    // --- Compute Group Drag data (deferred to performCleanup) ---
    let groupDragUpdates = null;
    if (wasGroupDrag) {
      const rect = containerRef.current.getBoundingClientRect();
      const currentPan = panOffsetRef.current;
      const currentZoom = zoomLevelRef.current;

      const mouseCanvasX = (clientX - rect.left - currentPan.x) / currentZoom + canvasSizeRef.current.offsetX;
      const mouseCanvasY = (clientY - rect.top - currentPan.y) / currentZoom + canvasSizeRef.current.offsetY;

      const positionUpdates = info.memberOffsets.map(({ id, dx, dy }) => {
        const node = nodeByIdRef.current.get(id);
        const xRaw = mouseCanvasX - dx;
        const yRaw = mouseCanvasY - dy;
        if (!node) return { instanceId: id, x: xRaw, y: yRaw };
        if (gridMode === 'off') return { instanceId: id, x: xRaw, y: yRaw };
        const dims = getNodeDimensions(node, false, null);
        const centerX = xRaw + dims.currentWidth / 2;
        const centerY = yRaw + dims.currentHeight / 2;
        const snappedCenterX = Math.floor(centerX / gridSize) * gridSize;
        const snappedCenterY = Math.floor(centerY / gridSize) * gridSize;
        const snappedX = snappedCenterX - (dims.currentWidth / 2);
        const snappedY = snappedCenterY - (dims.currentHeight / 2);
        return { instanceId: id, x: snappedX, y: snappedY };
      });

      const graph = graphsMap?.get(activeGraphId);
      const groupName = graph?.groups?.get(info.groupId)?.name;

      groupDragUpdates = {
        updates: positionUpdates,
        groupId: info.groupId,
        groupName
      };
    }

    // --- Cleanup function: clears DOM transforms, resets scale, nulls drag state ---
    // Deferred to after zoom-restore animation if applicable, otherwise runs immediately.
    const performCleanup = () => {
      // Flush positions to store (deferred to avoid double-offset during zoom-restore)
      if (finalUpdates.length > 0) {
        storeActions.updateMultipleNodeInstancePositions(
          activeGraphId, finalUpdates, { isDragging: true, phase: 'move' }
        );
      }
      if (groupDragUpdates) {
        storeActions.updateMultipleNodeInstancePositions(
          activeGraphId, groupDragUpdates.updates,
          { finalize: true, type: 'node_position', groupId: groupDragUpdates.groupId, groupName: groupDragUpdates.groupName }
        );
      }

      clearDOMTransforms();

      let finalizeSent = false;
      setTimeout(() => {
        instanceIdsToReset.forEach(id => {
          const nodeExists = nodes.some(n => n.id === id);
          if (nodeExists) {
            const shouldFinalize = primaryFinalizeId ? id === primaryFinalizeId : !finalizeSent;
            storeActions.updateNodeInstance(
              activeGraphId,
              id,
              draft => { draft.scale = 1; },
              { phase: 'end', isDragging: false, finalize: shouldFinalize, ignore: true }
            );
            if (shouldFinalize) finalizeSent = true;
          }
        });
      }, 0);

      setDraggingNodeInfo(null);
      wasDraggingRef.current = true;
      setTimeout(() => { wasDraggingRef.current = false; }, 50);
      isEdgePanningRef.current = false;
    };

    // --- Zoom Restore (or immediate cleanup) ---
    const needsZoomRestore = preDragZoomLevel !== null && dragZoomSettings.enabled && !restoreInProgressRef.current;

    if (needsZoomRestore) {
      restoreInProgressRef.current = true;

      const targetZoom = preDragZoomLevel;
      const currentZoom = zoomLevelRef.current;
      const currentPan = panOffsetRef.current;

      const rect = containerRef.current.getBoundingClientRect();
      const dropX = clientX - rect.left;
      const dropY = clientY - rect.top;

      const dropWorldX = (dropX - currentPan.x) / currentZoom + canvasSizeRef.current.offsetX;
      const dropWorldY = (dropY - currentPan.y) / currentZoom + canvasSizeRef.current.offsetY;

      const targetPanX = dropX - (dropWorldX - canvasSizeRef.current.offsetX) * targetZoom;
      const targetPanY = dropY - (dropWorldY - canvasSizeRef.current.offsetY) * targetZoom;

      const minPanX = -(canvasSizeRef.current.width * targetZoom);
      const minPanY = -(canvasSizeRef.current.height * targetZoom);

      const clampedTargetPanX = Math.min(0, Math.max(targetPanX, minPanX));
      const clampedTargetPanY = Math.min(0, Math.max(targetPanY, minPanY));

      // Cleanup fires AFTER zoom animation completes — no visual gap.
      // Park the cleanup on a ref so a new drag starting mid-animation can
      // force it to run synchronously (otherwise the cancelled RAF drops it
      // and stale positions leak into the next drag's finalUpdates).
      pendingZoomRestoreCleanupRef.current = () => {
        performCleanup();
        restoreInProgressRef.current = false;
      };
      animateZoomAndPanToTarget(targetZoom, { x: clampedTargetPanX, y: clampedTargetPanY }, currentZoom, currentPan, () => {
        const cb = pendingZoomRestoreCleanupRef.current;
        if (cb) {
          pendingZoomRestoreCleanupRef.current = null;
          cb();
        }
      });

      setPreDragZoomLevel(null);
      zoomOutInitiatedRef.current = false;
      actualZoomedOutLevelRef.current = null;
      actualZoomedOutPanRef.current = null;
      preDragPanOffsetRef.current = null;
    } else {
      performCleanup();

      if (preDragZoomLevel !== null) {
        setPreDragZoomLevel(null);
        zoomOutInitiatedRef.current = false;
        actualZoomedOutLevelRef.current = null;
        actualZoomedOutPanRef.current = null;
        preDragPanOffsetRef.current = null;
        restoreInProgressRef.current = false;
      }
    }

    const primaryNodeId = info.primaryId || info.instanceId || null;
    return { draggedNodeIds, primaryNodeId, checkGroupDrop, wasGroupDrag, finalPositions };
  }, [draggingNodeInfo, nodes, activeGraphId, storeActions, nodeByIdRef, gridMode, gridSize,
    preDragZoomLevel, dragZoomSettings, zoomLevelRef, panOffsetRef, containerRef, canvasSizeRef,
    animateZoomAndPanToTarget, clearDOMTransforms]);

  // ---------------------------------------------------------------------------
  // Edge Panning Effect (auto-pan when cursor near viewport edges during drag)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!draggingNodeInfo) return;

    let animationFrameId;

    const panLoop = () => {
      if (isAnimatingZoomRef.current || restoreInProgressRef.current) {
        panRafRef.current = requestAnimationFrame(panLoop);
        return;
      }

      if (!draggingNodeInfoRef.current) return;

      const { x: mouseX, y: mouseY } = mousePositionRef.current;
      const bounds = viewportBoundsRef.current;
      const margin = 75;
      const maxSpeed = 15;

      let dx = 0;
      let dy = 0;

      if (mouseX < bounds.x + margin) {
        const dist = (bounds.x + margin) - mouseX;
        const ratio = Math.min(1, dist / margin);
        dx = -maxSpeed * Math.pow(ratio, 1.5);
      } else if (mouseX > bounds.x + bounds.width - margin) {
        const dist = mouseX - (bounds.x + bounds.width - margin);
        const ratio = Math.min(1, dist / margin);
        dx = maxSpeed * Math.pow(ratio, 1.5);
      }

      if (mouseY < bounds.y + margin) {
        const dist = (bounds.y + margin) - mouseY;
        const ratio = Math.min(1, dist / margin);
        dy = -maxSpeed * Math.pow(ratio, 1.5);
      } else if (mouseY > bounds.y + bounds.height - margin) {
        const dist = mouseY - (bounds.y + bounds.height - margin);
        const ratio = Math.min(1, dist / margin);
        dy = maxSpeed * Math.pow(ratio, 1.5);
      }

      if (dx !== 0 || dy !== 0) {
        isEdgePanningRef.current = true;

        const currentPan = panOffsetRef.current;
        const currentZoom = zoomLevelRef.current;

        const currentCanvasWidth = canvasSizeRef.current.width * currentZoom;
        const currentCanvasHeight = canvasSizeRef.current.height * currentZoom;

        const minX = viewportSizeRef.current.width - currentCanvasWidth;
        const minY = viewportSizeRef.current.height - currentCanvasHeight;

        const newX = Math.min(Math.max(currentPan.x - dx, minX), 0);
        const newY = Math.min(Math.max(currentPan.y - dy, minY), 0);

        if (newX !== currentPan.x || newY !== currentPan.y) {
          const newPan = { x: newX, y: newY };
          panOffsetRef.current = newPan;
          setPanOffset(newPan);

          performDragUpdateRef.current(mouseX, mouseY, newPan, currentZoom, draggingNodeInfoRef.current);
        }
      } else {
        isEdgePanningRef.current = false;
      }

      animationFrameId = requestAnimationFrame(panLoop);
    };

    animationFrameId = requestAnimationFrame(panLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [draggingNodeInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Convenience
  // ---------------------------------------------------------------------------
  const isDragging = !!draggingNodeInfo;

  return {
    // State
    draggingNodeInfo,
    draggingNodeInfoRef,
    isAnimatingZoomRef,
    longPressingInstanceId,
    setLongPressingInstanceId,
    wasDraggingRef,
    isEdgePanningRef,

    // Callbacks
    startDragForNode,
    startDragForNodeRef,
    startGroupDrag,
    cancelDrag,
    handleDragMove,
    handleDragEnd,

    // DOM-bypass access (for external consumers that need drag positions)
    dragPositionsRef,

    // Ref to the latest DOM-drag update fn — used by keyboard pan/zoom so a
    // dragged node tracks the mouse when the canvas moves under it without the
    // mouse moving.
    performDragUpdateRef,

    // Convenience
    isDragging,
  };
};
