import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import * as GeometryUtils from '../utils/canvas/geometryUtils.js';
import { getNodeDimensions } from '../utils.js';
import useHistoryStore from '../store/historyStore.js';
import useGraphStore from '../store/graphStore.js';
import { getVisualConnectionEndpoints } from '../utils/canvas/nodeHitbox.js';
import { calculateParallelEdgePath, getTrimmedBezierPath, getCurvedArrowPlacement, DEFAULT_TIP_INSET } from '../utils/canvas/parallelEdgeUtils.js';
import { calculateSelfLoopPath } from '../utils/canvas/selfLoopUtils.js';
import { computeGroupLayout, GROUP_LAYOUT_CONSTANTS } from '../services/groupLayout.js';
import { measureTextWidth as pretextMeasureTextWidth } from '../services/textMeasurement.js';
import saveCoordinator from '../services/SaveCoordinator.js';

// Movement Zoom-Out constants
const DRAG_ZOOM_MIN = 0.1;
const DRAG_ZOOM_ANIMATION_DURATION = 250; // ms
// Additive zoom-out floor — keeps the drag-zoom feeling substantial when
// already zoomed out. Pure multiplicative shrinkage approaches DRAG_ZOOM_MIN
// asymptotically, so each drag at low zoom does almost nothing. The additive
// floor (scaled by zoomAmount so it stays proportional to user intent)
// guarantees a minimum perceptible zoom-out regardless of starting zoom.
const DRAG_ZOOM_ADDITIVE_SCALE = 0.2;

// Node lift-on-grab animation. The scale ramps 1 → node.scale (1.15) over this
// duration when a drag starts. Position (translate) must stay instant — it and
// scale share one `transform` string with `transition:none` — so the scale
// portion is interpolated in JS each frame rather than via a CSS transition.
const LIFT_DURATION = 100; // ms
// Drop-on-release: the scale settles node.scale → 1 when the drag ends. Kept
// snappier than the lift so the node "lands" rather than drifting back down.
const DROP_DURATION = 50; // ms
// Lift target scale. Both the lift ramp and the drop read node.scale, so this
// is the single knob for how far the node grows on grab. Boosted when drag-zoom
// is on: the canvas zoom-out/in works against the node's own scale, so a bigger
// pop is needed to read through it.
const LIFT_SCALE = 1.15;
const LIFT_SCALE_ZOOM = 1.4;

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
  multiConnectionCurveRef,
  groupsByNodeIdRef,
  groupsByIdRef,
  childGroupIdsByGroupIdRef,
  anchorPositionUpdatesRef,
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

  const [longPressingInstanceId, setLongPressingInstanceIdState] = useState(null);
  // Mirror the armed instance into a ref so consumers (the mousemove handler in
  // NodeCanvas) can read the synchronously-current value. React state can be one
  // commit stale across this hook boundary — that staleness made quick-drag
  // connections from nodes and thing-group titles silently fail to arm.
  const longPressingInstanceIdRef = useRef(null);
  const setLongPressingInstanceId = useCallback((value) => {
    longPressingInstanceIdRef.current = value;
    setLongPressingInstanceIdState(value);
  }, []);

  const zoomOutInitiatedRef = useRef(false);
  const actualZoomedOutLevelRef = useRef(null);
  const actualZoomedOutPanRef = useRef(null);
  const preDragPanOffsetRef = useRef(null);

  // Single source of truth for drag lifecycle. Replaces the older
  // `restoreInProgressRef` boolean and ad-hoc state checks scattered across
  // pointermove/edge-pan effects. State machine:
  //   'idle'        — no drag in flight
  //   'dragging'    — finger/mouse actively moving the node
  //   'finalizing'  — release received, performCleanup running synchronously
  //   'restoring'   — performCleanup done, zoom-restore animation in flight
  // Read by handleDragEnd (atomic dedup), the window pointermove effect, and
  // the edge-pan loop. NodeCanvas reads it via the exposed ref to gate the
  // drag-end block in handleMouseUp.
  const dragPhaseRef = useRef('idle');

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

  // Lift-on-grab animation state (see LIFT_DURATION). liftStartTimeRef holds the
  // performance.now() of the current drag's start (null when not lifting);
  // liftRafRef is the standalone rAF loop that ramps the scale even if the
  // pointer never moves.
  const liftStartTimeRef = useRef(null);
  const liftRafRef = useRef(null);
  // Target scale the lift ramps toward, captured synchronously at drag start.
  // The store's `draft.scale = liftScale` only reaches the animation loops after
  // a React commit round-trips through nodeByIdRef — so ramping toward `node.scale`
  // holds the target at 1 for the first frames, then snaps once the echo lands
  // mid-ramp (worse under drag-zoom: bigger target + a flood of setZoomLevel
  // commits). Reading this ref instead makes the target known on frame one.
  // Null for group-member drags (no per-node lift), which fall back to node.scale.
  const liftTargetScaleRef = useRef(null);

  // Drop-on-release animation state (see DROP_DURATION). dropPendingRef carries
  // the per-node entries captured at drag-end so the post-commit layout effect
  // can re-apply the lift scale (React strips the inline transform on the
  // not-dragging commit) and ramp it back to 1; dropRafRef is that loop.
  const dropRafRef = useRef(null);
  const dropPendingRef = useRef(null);

  // DOM-bypass drag state
  const dragPositionsRef = useRef(new Map());     // instanceId → {x, y} (latest computed)
  // Tracks what's actually been written to the DOM, separate from
  // dragPositionsRef. The post-commit useLayoutEffect clears this whenever
  // React renders, because a static React commit overwrites the DOM with
  // store-based positions for nodes/edges/labels — so the next drag tick
  // must re-apply everything regardless of whether computed positions changed.
  // Without this split, the frame-diff fast-path would skip restoring DOM
  // after a commit (since computed positions match prev), leaving edge lines
  // and labels stuck at the stored positions while the dragged group keeps
  // moving via its own setTransform path.
  const appliedPositionsRef = useRef(new Map());  // instanceId → {x, y} (last written to DOM)
  const dragNodeElsRef = useRef(new Map());       // instanceId → DOM <g> element
  const dragEdgeElsRef = useRef(new Map());       // edgeId → [{el, paths, lines, arrows, selfArrow, texts}, ...]
  const dragEdgeDataRef = useRef(new Map());      // edgeId → edge record (frozen at drag start)
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
    dragEdgeDataRef.current.clear();
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

    // Cache edge <g> elements for all edges connected to dragged nodes,
    // along with their sub-elements (paths/lines/arrows/texts) and the edge
    // data record. updateEdgesInDOM runs per frame; without this, it would
    // call querySelectorAll 4-5 times per edge per frame and rebuild an O(N)
    // edge index from edgesRef every frame — the dominant cost of group drag.
    const edgesByNode = edgesByNodeIdRef.current;
    const affectedEdgeIds = new Set();
    nodeIdSet.forEach(nodeId => {
      const edges = edgesByNode.get(nodeId);
      if (edges) edges.forEach(eid => affectedEdgeIds.add(eid));
    });

    // A dragged member can resize its containing thing-group, which moves the
    // group's outer box. External connections attach to the group's ANCHOR (not
    // the dragged member), so cache the anchor's edges too — otherwise they only
    // re-clip against the new box on drop, lagging the live resize.
    const groupsByNodeForCache = groupsByNodeIdRef.current;
    const groupsByIdForCache = groupsByIdRef?.current;
    if (groupsByIdForCache) {
      nodeIdSet.forEach(nodeId => {
        const groups = groupsByNodeForCache.get(nodeId);
        if (!groups) return;
        groups.forEach(({ groupId }) => {
          const anchorId = groupsByIdForCache.get(groupId)?.anchorInstanceId;
          if (!anchorId || nodeIdSet.has(anchorId)) return;
          const anchorEdges = edgesByNode.get(anchorId);
          if (anchorEdges) anchorEdges.forEach(eid => affectedEdgeIds.add(eid));
        });
      });
    }

    const edgeDataIndex = new Map();
    const allEdges = edgesRef.current;
    for (let i = 0; i < allEdges.length; i++) {
      const e = allEdges[i];
      if (affectedEdgeIds.has(e.id)) edgeDataIndex.set(e.id, e);
    }
    dragEdgeDataRef.current = edgeDataIndex;

    affectedEdgeIds.forEach(edgeId => {
      // querySelectorAll returns all matches (edge appears in below + above blocks)
      const els = container.querySelectorAll(`[data-edge-id="${edgeId}"]`);
      if (els.length > 0) {
        const cachedEls = Array.from(els).map(el => ({
          el,
          paths: Array.from(el.querySelectorAll('path')),
          lines: Array.from(el.querySelectorAll('line')),
          arrows: Array.from(el.querySelectorAll('[data-arrow]')),
          selfArrow: el.querySelector('[data-arrow="self"]'),
          texts: Array.from(el.querySelectorAll('text')),
        }));
        dragEdgeElsRef.current.set(edgeId, cachedEls);
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
  }, [containerRef, edgesByNodeIdRef, groupsByNodeIdRef, groupsByIdRef]);

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

    // Group drag via label — each member snaps to its own nearest grid cell
    // (preserves the multidrag-like feel). The frame-diff fast-path in
    // performDOMDragUpdate skips DOM work on frames where no member crossed
    // a grid line, so this stays cheap.
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
        const snappedCenterX = Math.round(centerX / gridSize) * gridSize;
        const snappedCenterY = Math.round(centerY / gridSize) * gridSize;
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

    // Edge data index was built once at drag start; reuse it.
    const edgeDataMap = dragEdgeDataRef.current;

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

      let sPos = dragPos.get(edge.sourceId) || { x: sStored.x, y: sStored.y };
      let dPos = dragPos.get(edge.destinationId) || { x: dStored.x, y: dStored.y };

      let sDims = curBaseDims.get(edge.sourceId) || getNodeDimensions(sStored, false, null);
      let dDims = curBaseDims.get(edge.destinationId) || getNodeDimensions(dStored, false, null);

      // Thing-group anchors render as their title box (synced into anchorPositionUpdatesRef
      // each React frame), NOT the stored instance position + default node dims. Mirror that
      // here so the drag-time line and label exactly match the settled (drop) render — and so
      // the label can be pushed off the group's outer bounds the same way.
      const sAnchor = sStored.isGroupAnchor ? anchorPositionUpdatesRef?.current?.get(edge.sourceId) : null;
      const eAnchor = dStored.isGroupAnchor ? anchorPositionUpdatesRef?.current?.get(edge.destinationId) : null;
      if (sAnchor) {
        sDims = { currentWidth: sAnchor.width, currentHeight: sAnchor.height };
        if (!dragPos.has(edge.sourceId)) sPos = { x: sAnchor.x, y: sAnchor.y };
      }
      if (eAnchor) {
        dDims = { currentWidth: eAnchor.width, currentHeight: eAnchor.height };
        if (!dragPos.has(edge.destinationId)) dPos = { x: eAnchor.x, y: eAnchor.y };
      }

      // Self-loop: recompute arc from the moving node's current drag position.
      if (edge.sourceId === edge.destinationId) {
        const loop = calculateSelfLoopPath(sPos.x, sPos.y, sDims.currentWidth, sDims.currentHeight, curCurveInfo.get(edgeId));
        const apexX = loop.loopCx + loop.radius * Math.cos(loop.outwardAngle);
        const apexY = loop.loopCy + loop.radius * Math.sin(loop.outwardAngle);
        edgeEls.forEach(({ paths, selfArrow, texts }) => {
          paths.forEach(p => p.setAttribute('d', loop.path));
          if (selfArrow) {
            selfArrow.setAttribute('transform', `translate(${loop.anchorB.x}, ${loop.anchorB.y}) rotate(${loop.arrowAngleB + 90})`);
          }
          texts.forEach(t => {
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
        // Clip arrow-side endpoints against a thing-group's full outer box (not the
        // anchor tab) so the drag-time line + arrow terminate just outside the box,
        // matching the settled render and keeping the arrowhead visible.
        const clipped = getVisualConnectionEndpoints(
          virtualSource, virtualDest, sDims, dDims,
          curSelectedIds.has(edge.sourceId),
          curSelectedIds.has(edge.destinationId),
          true,
          sAnchor?.outerBounds || null,
          eAnchor?.outerBounds || null
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
      const dragCurveSpacing = 200 * (multiConnectionCurveRef?.current ?? 1.0);
      const parallelPath = calculateParallelEdgePath(
        endpoints.x1, endpoints.y1, endpoints.x2, endpoints.y2, curveInfo, dragCurveSpacing
      );
      // Shared curved arrow placement + trim t values (same helper as the settled
      // render). Match the settled arrow scale (connectionWidth) so tips land
      // identically before and after drop.
      const dragConnectionWidth = useGraphStore.getState().textSettings?.connectionWidth ?? 1;
      const curvedArrowPlacement = (useCurve && parallelPath.ctrlX != null)
        ? getCurvedArrowPlacement(parallelPath, dragConnectionWidth, DEFAULT_TIP_INSET)
        : null;

      // Update each edge <g> element (may appear in both above/below blocks)
      edgeEls.forEach(({ paths, lines, arrows: arrowGs, texts }) => {
        // --- Update edge geometry (paths + lines) ---
        if (parallelPath.type === 'line' && !useCurve) {
          // Straight edge: update <line> elements
          lines.forEach(line => {
            line.setAttribute('x1', endpoints.x1);
            line.setAttribute('y1', endpoints.y1);
            line.setAttribute('x2', endpoints.x2);
            line.setAttribute('y2', endpoints.y2);
          });
          // Also update any <path> elements (glow, click target)
          paths.forEach(path => {
            const d = path.getAttribute('d');
            // Only update paths that look like simple lines (M...L...) not complex routes
            if (d && (d.startsWith('M') && d.includes('L') && !d.includes('Q') && !d.includes('C'))) {
              path.setAttribute('d', `M ${endpoints.x1} ${endpoints.y1} L ${endpoints.x2} ${endpoints.y2}`);
            }
          });
        } else {
          // Curved/parallel edge: update <path> elements. When an arrow is present,
          // trim the curve to the back of that end's arrowhead (trimT) so the curve's
          // round cap tucks under the triangle and never overshoots it mid-drag.
          let curveD = parallelPath.path;
          if (curvedArrowPlacement && (hasSourceArrow || hasDestArrow)) {
            const tStart = hasSourceArrow ? curvedArrowPlacement.source.trimT : 0;
            const tEnd = hasDestArrow ? curvedArrowPlacement.dest.trimT : 1;
            curveD = getTrimmedBezierPath(
              parallelPath.startX, parallelPath.startY,
              parallelPath.ctrlX, parallelPath.ctrlY,
              parallelPath.endX, parallelPath.endY,
              tStart, tEnd
            ).path;
          }
          paths.forEach(path => {
            path.setAttribute('d', curveD);
          });
          // Also update any straight <line> elements that might exist as click targets
          lines.forEach(line => {
            line.setAttribute('x1', endpoints.x1);
            line.setAttribute('y1', endpoints.y1);
            line.setAttribute('x2', endpoints.x2);
            line.setAttribute('y2', endpoints.y2);
          });
        }

        // --- Update arrow positions ---
        if (!isManhattanOrClean) {
          if (arrowGs.length > 0) {
            if (useCurve && parallelPath.ctrlX != null && curvedArrowPlacement) {
              // Curved: shared placement puts the arrow tip a fixed px from the endpoint
              // with the tangent angle, matching the settled render exactly.
              arrowGs.forEach(arrowG => {
                const type = arrowG.getAttribute('data-arrow');
                const p = type === 'source' ? curvedArrowPlacement.source : curvedArrowPlacement.dest;
                arrowG.setAttribute('transform', `translate(${p.x}, ${p.y}) rotate(${p.angle + 90}) scale(${dragConnectionWidth})`);
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
                      `translate(${endpoints.x1 + (dx / len) * offset}, ${endpoints.y1 + (dy / len) * offset}) rotate(${angle + 180 + 90}) scale(${dragConnectionWidth})`);
                  } else {
                    arrowG.setAttribute('transform',
                      `translate(${endpoints.x2 - (dx / len) * offset}, ${endpoints.y2 - (dy / len) * offset}) rotate(${angle + 90}) scale(${dragConnectionWidth})`);
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
        // visible-segment apex and visibly shifts. When an endpoint is a
        // thing-group anchor, clip against the group's full outer box (kept
        // fresh in anchorPositionUpdatesRef by updateGroupBoundsInDOM, which
        // runs earlier this frame) so the midpoint sits centered on the truly
        // visible run — no separate slide-off-box step.
        if (texts.length > 0) {
          const visibleEndpoints = getVisualConnectionEndpoints(
            virtualSource, virtualDest, sDims, dDims,
            curSelectedIds.has(edge.sourceId),
            curSelectedIds.has(edge.destinationId),
            true,
            sAnchor?.outerBounds || null,
            eAnchor?.outerBounds || null
          );
          const labelPlacementPath = calculateParallelEdgePath(
            visibleEndpoints.x1, visibleEndpoints.y1,
            visibleEndpoints.x2, visibleEndpoints.y2,
            curveInfo,
            dragCurveSpacing
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
          texts.forEach(t => {
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
    if (dragGroupMetaRef.current.size === 0) return null;

    const groupsByNode = groupsByNodeIdRef.current;
    const groupsById = groupsByIdRef?.current || new Map();
    const affectedGroupIds = new Set();
    movedNodeIds.forEach(nodeId => {
      const groups = groupsByNode.get(nodeId);
      if (groups) groups.forEach(({ groupId }) => affectedGroupIds.add(groupId));
    });
    if (affectedGroupIds.size === 0) return null;

    // Anchor instance IDs of node-groups whose box changed this frame. Returned so
    // the caller can also refresh those groups' external connections (which attach
    // to the anchor, not the dragged member).
    const affectedAnchorIds = new Set();

    const curNodeById = nodeByIdRef.current;
    const curBaseDims = baseDimsByIdRef.current;
    const dragPos = dragPositionsRef.current;
    const C = GROUP_LAYOUT_CONSTANTS;
    const innerCanvasBorder = C.innerCanvasBorder;

    // Duck-typed nodesById for the helper: overlay live drag positions on top of
    // the stored snapshot. The helper only reads `.id`, `.x`, `.y`, so returning
    // either a tiny synth object or the original stored node is fine.
    const dragNodesById = {
      get(id) {
        const dp = dragPos.get(id);
        if (dp) return { id, x: dp.x, y: dp.y };
        return curNodeById.get(id);
      }
    };

    // Shared cache across all groups in this frame so multi-parent containment
    // doesn't recompute the same child layout repeatedly.
    // Match the static render's label sizing (NodeCanvas): node-title size
    // (45 * fontSize * nodeScale). Without this the tab re-measured at the fixed
    // 36px base with no scale on grab and jumped size mid-drag.
    const ts = useGraphStore.getState().textSettings;
    const labelScale = ts?.nodeScale ?? 1;
    const labelFontSize = 45 * (ts?.fontSize ?? 1) * labelScale;
    const layoutContext = {
      nodesById: dragNodesById,
      dimsById: curBaseDims,
      groupsById,
      groupsByMemberId: groupsByNode,
      childGroupIdsByGroupId: childGroupIdsByGroupIdRef?.current,
      gridSize,
      measureLabelWidth: (text) => pretextMeasureTextWidth(text || 'Group', `bold ${labelFontSize}px "EmOne", sans-serif`),
      labelScale,
      labelFontSize,
      _cache: new Map(),
    };

    affectedGroupIds.forEach(groupId => {
      const meta = dragGroupMetaRef.current.get(groupId);
      if (!meta) return;
      const group = groupsById.get(groupId);
      if (!group) return;

      const layout = computeGroupLayout(group, layoutContext);
      if (!layout || !layout.ok) return;

      const { rect, label, nodeGroupRect, innerCanvasY } = layout;
      const rectX = rect.x, rectY = rect.y, rectW = rect.w, rectH = rect.h;
      const labelX = label.x, labelY = label.y;
      const groupLabelWidth = label.w, groupLabelHeight = label.h;

      // Keep the anchor's synced title position AND full outer box fresh during
      // the drag so connection labels on edges touching this thing-group clip
      // against the live group box (not last-commit bounds). updateEdgesInDOM
      // reads this for the same frame, so it must run after this pass.
      if (layout.isNodeGroup && group.anchorInstanceId && anchorPositionUpdatesRef?.current) {
        const vb = layout.visualBounds;
        anchorPositionUpdatesRef.current.set(group.anchorInstanceId, {
          x: labelX, y: labelY,
          width: groupLabelWidth, height: groupLabelHeight,
          groupId,
          outerBounds: vb ? { x: vb.x, y: vb.y, width: vb.w, height: vb.h } : null,
        });
        affectedAnchorIds.add(group.anchorInstanceId);
      }

      if (typeof window !== 'undefined' && window.__groupBoundsDebug) {
        const now = performance.now();
        if (!window.__groupBoundsDebugLastLog) window.__groupBoundsDebugLastLog = new Map();
        const last = window.__groupBoundsDebugLastLog.get(groupId) || 0;
        if (now - last > 250) {
          window.__groupBoundsDebugLastLog.set(groupId, now);
          const memberStates = meta.memberIds.map(id => {
            const dp = dragPos.get(id);
            const stored = curNodeById.get(id);
            return {
              id,
              hasDragPos: !!dp,
              hasStored: !!stored,
              x: Math.round(dp ? dp.x : (stored?.x ?? 0)),
              y: Math.round(dp ? dp.y : (stored?.y ?? 0)),
              fellBackToZero: !dp && !stored,
            };
          });
          console.log('[GROUP-DRAG]', {
            groupId,
            metaMemberIds: meta.memberIds,
            memberStates,
            droppedOrphanIds: layout.droppedOrphanIds,
            bbox: { minX: Math.round(layout.bbox.minX), minY: Math.round(layout.bbox.minY), maxX: Math.round(layout.bbox.maxX), maxY: Math.round(layout.bbox.maxY) },
            rect: { x: Math.round(rectX), y: Math.round(rectY), w: Math.round(rectW), h: Math.round(rectH) },
            label: { x: Math.round(labelX), y: Math.round(labelY), w: groupLabelWidth, h: groupLabelHeight },
            nestedContributors: layout.nestedContributors,
          });
        }
      }

      meta.elements.forEach(sub => {
        // Clear CSS transform — use raw attribute positioning instead
        sub.el.style.transform = '';
        sub.el.style.transformOrigin = '';

        if (sub.type === 'regular') {
          if (sub.directRects[0]) {
            sub.directRects[0].setAttribute('x', rectX);
            sub.directRects[0].setAttribute('y', rectY);
            sub.directRects[0].setAttribute('width', rectW);
            sub.directRects[0].setAttribute('height', rectH);
          }
          if (sub.labelRect) {
            sub.labelRect.setAttribute('x', labelX);
            sub.labelRect.setAttribute('y', labelY);
            // Re-center the 1.08 lift matrix on the pill's current bbox center. Uses the
            // `transform` attribute (local user space) instead of CSS transform-box:fill-box,
            // which — combined with the drag drop-shadow filter — clips the stroke. Clear any
            // stale CSS transform so it can't fight the attribute.
            const lcx = labelX + groupLabelWidth / 2;
            const lcy = labelY + groupLabelHeight / 2;
            const liftMatrix = `translate(${lcx} ${lcy}) scale(1.08) translate(${-lcx} ${-lcy})`;
            sub.labelRect.setAttribute('transform', liftMatrix);
            sub.labelRect.style.transform = '';
            sub.labelRect.style.transformBox = '';
            sub.labelRect.style.transformOrigin = '';
            if (sub.labelText) {
              sub.labelText.setAttribute('x', labelX + groupLabelWidth / 2);
              sub.labelText.setAttribute('y', labelY + groupLabelHeight / 2); // dominantBaseline:central centers it
              // Pop the text with the pill, pivoting off the same center.
              sub.labelText.setAttribute('transform', liftMatrix);
            }
          }
        } else if (sub.type === 'bg') {
          // Node-group background: outer rect spans the title-included box;
          // inner canvas inset starts below the label.
          if (sub.directRects[0]) {
            sub.directRects[0].setAttribute('x', rectX);
            sub.directRects[0].setAttribute('y', nodeGroupRect.y);
            sub.directRects[0].setAttribute('width', rectW);
            sub.directRects[0].setAttribute('height', nodeGroupRect.h);
          }
          if (sub.directRects[1]) {
            sub.directRects[1].setAttribute('x', rectX + innerCanvasBorder);
            sub.directRects[1].setAttribute('y', innerCanvasY);
            sub.directRects[1].setAttribute('width', rectW - innerCanvasBorder * 2);
            sub.directRects[1].setAttribute('height', (rectY + rectH) - innerCanvasY - innerCanvasBorder);
          }
        } else if (sub.type === 'title') {
          if (sub.labelRect) {
            sub.labelRect.setAttribute('x', labelX);
            sub.labelRect.setAttribute('y', labelY);
            // Re-center the 1.08 lift matrix on the pill's current bbox center. Uses the
            // `transform` attribute (local user space) instead of CSS transform-box:fill-box,
            // which — combined with the drag drop-shadow filter — clips the stroke. Clear any
            // stale CSS transform so it can't fight the attribute.
            const lcx = labelX + groupLabelWidth / 2;
            const lcy = labelY + groupLabelHeight / 2;
            const liftMatrix = `translate(${lcx} ${lcy}) scale(1.08) translate(${-lcx} ${-lcy})`;
            sub.labelRect.setAttribute('transform', liftMatrix);
            sub.labelRect.style.transform = '';
            sub.labelRect.style.transformBox = '';
            sub.labelRect.style.transformOrigin = '';
            if (sub.labelText) {
              sub.labelText.setAttribute('x', labelX + groupLabelWidth / 2);
              sub.labelText.setAttribute('y', labelY + groupLabelHeight / 2); // dominantBaseline:central centers it
              // Pop the text with the pill, pivoting off the same center.
              sub.labelText.setAttribute('transform', liftMatrix);
            }
          }
        }
      });
    });

    return affectedAnchorIds;
  }, [groupsByNodeIdRef, groupsByIdRef, nodeByIdRef, baseDimsByIdRef, gridSize]);

  // ---------------------------------------------------------------------------
  // Core DOM Drag Update (replaces performDragUpdate — writes to DOM, not store)
  // ---------------------------------------------------------------------------
  const performDOMDragUpdate = useCallback((clientX, clientY, currentPan, currentZoom, draggingInfo) => {
    if (!draggingInfo) return;

    // Calculate mouse position in canvas coordinates
    const rect = containerRef.current.getBoundingClientRect();
    const mouseCanvasX = (clientX - rect.left - currentPan.x) / currentZoom + canvasSizeRef.current.offsetX;
    const mouseCanvasY = (clientY - rect.top - currentPan.y) / currentZoom + canvasSizeRef.current.offsetY;

    // Compute new positions (pure math, same logic as before)
    const positionUpdates = computePositionUpdates(mouseCanvasX, mouseCanvasY, draggingInfo);
    if (positionUpdates.length === 0) return;

    // Diff against what's currently on DOM. With grid snap engaged, the
    // cursor moves smoothly but snapped positions only change when crossing
    // a grid line — so most frames need zero DOM work and we can skip per-node
    // transform writes, edge endpoint recompute, and group bbox recompute.
    // Critical: comparing against `appliedPositionsRef` (not just the latest
    // computed positions) ensures we re-apply everything after a React commit
    // overwrites the DOM with stale store-based positions — which is the bug
    // that left edge lines/labels stuck at old coords during grid drag.
    const movedNodeIds = new Set();
    positionUpdates.forEach(({ instanceId, x, y }) => {
      dragPositionsRef.current.set(instanceId, { x, y });
      const prev = appliedPositionsRef.current.get(instanceId);
      if (!prev || prev.x !== x || prev.y !== y) {
        movedNodeIds.add(instanceId);
      }
    });
    if (movedNodeIds.size === 0) return;

    // Clear label placement cache only when something actually moved
    placedLabelsRef.current = new Map();

    // Apply CSS translate deltas to node DOM elements (only those that moved)
    const curNodeById = nodeByIdRef.current;
    const curBaseDims = baseDimsByIdRef.current;
    positionUpdates.forEach(({ instanceId, x, y }) => {
      if (!movedNodeIds.has(instanceId)) return;
      const nodeEl = dragNodeElsRef.current.get(instanceId);
      if (!nodeEl) return;

      const node = curNodeById.get(instanceId);
      if (!node) return;

      // Delta from React-rendered (stored) position
      const storedX = node.x ?? 0;
      const storedY = node.y ?? 0;
      const deltaX = x - storedX;
      const deltaY = y - storedY;

      const targetScale = liftTargetScaleRef.current ?? node.scale ?? 1;
      // Interpolate the lift scale in JS: translate tracks the pointer instantly
      // (transition is disabled during drag), so the grow-on-grab is ramped here
      // per frame instead. ease-out cubic, 1 → node.scale over LIFT_DURATION.
      const lift = liftStartTimeRef.current == null
        ? 1
        : Math.min(1, (performance.now() - liftStartTimeRef.current) / LIFT_DURATION);
      const nodeScale = 1 + (targetScale - 1) * (1 - Math.pow(1 - lift, 3));
      const dims = curBaseDims.get(instanceId);
      const cx = storedX + (dims?.currentWidth ?? 0) / 2;
      const cy = storedY + (dims?.currentHeight ?? 0) / 2;

      nodeEl.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${nodeScale})`;
      nodeEl.style.transformOrigin = `${cx}px ${cy}px`;
      appliedPositionsRef.current.set(instanceId, { x, y });
    });

    // Update group bounding boxes FIRST for ALL drag types (single, multi,
    // group-label). This also refreshes each thing-group's live outer box into
    // anchorPositionUpdatesRef, which updateEdgesInDOM reads below to center
    // connection labels on the visible (outside-the-group) segment this frame.
    // Returns the anchor IDs of any node-groups whose box changed — their
    // external connections attach to the anchor (not the dragged member), so we
    // fold them into the edge-update set to keep those edges tracking the resize.
    const resizedAnchorIds = updateGroupBoundsInDOM(movedNodeIds);

    // Update connected edges in DOM
    let edgeUpdateIds = movedNodeIds;
    if (resizedAnchorIds && resizedAnchorIds.size > 0) {
      edgeUpdateIds = new Set(movedNodeIds);
      resizedAnchorIds.forEach(id => edgeUpdateIds.add(id));
    }
    updateEdgesInDOM(edgeUpdateIds);
  }, [containerRef, canvasSizeRef, placedLabelsRef, computePositionUpdates, nodeByIdRef, baseDimsByIdRef, updateEdgesInDOM, updateGroupBoundsInDOM]);

  // ---------------------------------------------------------------------------
  // Lift-on-grab animation
  // ---------------------------------------------------------------------------
  // Ramps the node scale 1 → node.scale over LIFT_DURATION. performDOMDragUpdate
  // already interpolates the same ramp on pointer-move frames, but that only
  // fires while the pointer moves. This standalone rAF loop guarantees the grow
  // completes smoothly even if the user grabs a node and holds still. Both paths
  // read liftStartTimeRef so they stay in sync when they run on the same frame.
  const runLiftAnimation = useCallback(() => {
    if (liftRafRef.current) cancelAnimationFrame(liftRafRef.current);
    // A drop from the previous release may still be settling on these same
    // elements — cancel it so the two ramps don't write competing scales.
    if (dropRafRef.current) {
      cancelAnimationFrame(dropRafRef.current);
      dropRafRef.current = null;
    }
    dropPendingRef.current = null;
    liftStartTimeRef.current = performance.now();

    const step = () => {
      const t = Math.min(1, (performance.now() - liftStartTimeRef.current) / LIFT_DURATION);
      const lift = 1 - Math.pow(1 - t, 3);

      const curNodeById = nodeByIdRef.current;
      const curBaseDims = baseDimsByIdRef.current;
      dragNodeElsRef.current.forEach((nodeEl, instanceId) => {
        const node = curNodeById.get(instanceId);
        if (!node) return;
        const storedX = node.x ?? 0;
        const storedY = node.y ?? 0;
        const applied = appliedPositionsRef.current.get(instanceId);
        const deltaX = (applied ? applied.x : storedX) - storedX;
        const deltaY = (applied ? applied.y : storedY) - storedY;
        const targetScale = liftTargetScaleRef.current ?? node.scale ?? 1;
        const scale = 1 + (targetScale - 1) * lift;
        const dims = curBaseDims.get(instanceId);
        const cx = storedX + (dims?.currentWidth ?? 0) / 2;
        const cy = storedY + (dims?.currentHeight ?? 0) / 2;
        nodeEl.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scale})`;
        nodeEl.style.transformOrigin = `${cx}px ${cy}px`;
      });

      if (t < 1) {
        liftRafRef.current = requestAnimationFrame(step);
      } else {
        liftRafRef.current = null;
      }
    };
    liftRafRef.current = requestAnimationFrame(step);
  }, [nodeByIdRef, baseDimsByIdRef]);

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
    // React just committed and overwrote the DOM with stored-position values
    // for nodes/edges/labels. Clear the applied-positions tracker so the
    // re-apply below treats every node as "moved" and writes everything back.
    appliedPositionsRef.current.clear();
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
        if (zoomOutInitiatedRef.current && dragPhaseRef.current !== 'restoring') {
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

      // Hybrid model: multiplicative shrinkage (scale-invariant at high zoom)
      // plus an additive floor (preserves feel at low zoom, where multiplicative
      // delta vanishes and the DRAG_ZOOM_MIN clamp would otherwise dominate).
      const amount = dragZoomSettings.zoomAmount;
      const multiplicativeDelta = currentZoom * amount;
      const additiveDelta = amount * DRAG_ZOOM_ADDITIVE_SCALE;
      const totalDelta = Math.max(multiplicativeDelta, additiveDelta);
      const targetZoom = Math.max(DRAG_ZOOM_MIN, currentZoom - totalDelta);

      animateZoomToTarget(targetZoom, { clientX, clientY }, currentZoom, { ...panOffsetRef.current });
    }
  }, [zoomLevelRef, panOffsetRef, animateZoomToTarget, dragZoomSettings]);

  // ---------------------------------------------------------------------------
  // Clear DOM Transforms (called on drag end or cancel)
  // ---------------------------------------------------------------------------
  const clearDOMTransforms = useCallback((options = {}) => {
    const { animateDrop = false } = options;
    // Stop any in-flight lift ramp so it can't write a scale back onto a node
    // after we've cleared its transform below.
    if (liftRafRef.current) {
      cancelAnimationFrame(liftRafRef.current);
      liftRafRef.current = null;
    }
    liftStartTimeRef.current = null;
    // Drop reads the settled lift scale from node.scale (captured below), not this
    // ref, so it's safe to release the animation-target hint now.
    liftTargetScaleRef.current = null;
    // Cancel any drop still settling from a previous release (rapid
    // release→re-grab), so its tail can't clear the transform of the node
    // we're about to re-animate.
    if (dropRafRef.current) {
      cancelAnimationFrame(dropRafRef.current);
      dropRafRef.current = null;
    }

    // Capture drop-animation entries BEFORE the refs below are cleared. On a
    // normal release each lifted node shrinks from its lift scale back to 1
    // about its final (flushed) center; the actual ramp runs in the post-commit
    // layout effect, since React strips the inline transform when isDragging
    // flips false. Skipped on cancel (animateDrop:false — positions aren't
    // flushed) and for unlifted nodes (group members, scale 1).
    if (animateDrop) {
      const curNodeById = nodeByIdRef.current;
      const curBaseDims = baseDimsByIdRef.current;
      const entries = [];
      dragNodeElsRef.current.forEach((_el, id) => {
        const node = curNodeById.get(id);
        const fromScale = node?.scale ?? 1;
        if (fromScale <= 1.0001) return; // not lifted — nothing to settle
        const pos = dragPositionsRef.current.get(id) || (node ? { x: node.x, y: node.y } : null);
        if (!pos) return;
        const dims = curBaseDims.get(id);
        const cx = pos.x + (dims?.currentWidth ?? 0) / 2;
        const cy = pos.y + (dims?.currentHeight ?? 0) / 2;
        // Store the id, NOT the element: the dragged node renders in a separate
        // `draggingNodeToRender` JSX branch, so the not-dragging commit unmounts
        // this <g> and mounts a fresh one in the normal node list. The layout
        // effect re-queries the live element by id after that commit.
        entries.push({ id, cx, cy, fromScale });
      });
      dropPendingRef.current = entries.length > 0 ? { entries } : null;
    }

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
    // Drop the pill lift matrix we set per-frame, so the label doesn't stay scaled
    // if React's not-dragging re-render (which clears the `transform` prop) lags a frame.
    dragGroupMetaRef.current.forEach(meta => {
      meta.elements?.forEach(sub => {
        if (sub.labelRect) sub.labelRect.removeAttribute('transform');
        if (sub.labelText) sub.labelText.removeAttribute('transform');
      });
    });
    dragPositionsRef.current.clear();
    appliedPositionsRef.current.clear();
    dragNodeElsRef.current.clear();
    dragEdgeElsRef.current.clear();
    dragEdgeDataRef.current.clear();
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
    // future hover/scale animations. Skipped when a drop animation is pending —
    // it keeps `transition:none` while it drives the ramp and restores it at the
    // end, so touching transition here would let the CSS transform-transition
    // fight the ramp.
    if (snapshotNodeEls.length > 0 && !dropPendingRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          snapshotNodeEls.forEach(el => { el.style.transition = ''; });
        });
      });
    }
  }, [nodeByIdRef, baseDimsByIdRef]);

  // ---------------------------------------------------------------------------
  // Drop-on-release animation (runs after the not-dragging commit)
  // ---------------------------------------------------------------------------
  // Fires on the commit where draggingNodeInfo → null. React has just stripped
  // the inline transform it set during drag and moved each node's SVG to its
  // flushed final position. This layout effect runs before paint, so it can
  // re-apply the lift scale about the final center (no scale-1 frame is shown)
  // and then ramp it to 1 over DROP_DURATION. Entries were captured in
  // clearDOMTransforms; a null pending ref means this was a cancel or a plain
  // (unlifted) release, so there's nothing to settle.
  useLayoutEffect(() => {
    if (draggingNodeInfo) return;
    const pending = dropPendingRef.current;
    if (!pending) return;
    dropPendingRef.current = null;

    if (dropRafRef.current) cancelAnimationFrame(dropRafRef.current);

    // Resolve the LIVE element for each node by id. The <g> that was being
    // dragged has just been unmounted (it lived in the draggingNodeToRender
    // branch); the node now renders in the normal list as a fresh element.
    const container = containerRef.current;
    const targets = pending.entries.reduce((acc, e) => {
      const el = container?.querySelector(`[data-instance-id="${e.id}"]`);
      if (el) acc.push({ el, cx: e.cx, cy: e.cy, fromScale: e.fromScale });
      return acc;
    }, []);
    if (targets.length === 0) return;

    // Apply the starting (lift) scale synchronously so the frame painted right
    // after the position flush is continuous with where the node visually was,
    // instead of snapping to 1 for a frame before the ramp begins.
    targets.forEach(({ el, cx, cy, fromScale }) => {
      el.style.transition = 'none';
      el.style.transformOrigin = `${cx}px ${cy}px`;
      el.style.transform = `scale(${fromScale})`;
    });

    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / DROP_DURATION);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      targets.forEach(({ el, cx, cy, fromScale }) => {
        const scale = fromScale + (1 - fromScale) * eased;
        el.style.transform = `scale(${scale})`;
        el.style.transformOrigin = `${cx}px ${cy}px`;
      });
      if (t < 1) {
        dropRafRef.current = requestAnimationFrame(step);
      } else {
        dropRafRef.current = null;
        // Hand the node back to React's natural (transform-free) render and
        // restore CSS-driven transitions for future hover/scale animations.
        targets.forEach(({ el }) => {
          el.style.transform = '';
          el.style.transformOrigin = '';
          el.style.transition = '';
        });
      }
    };
    dropRafRef.current = requestAnimationFrame(step);
  }, [draggingNodeInfo, containerRef]);

  // ---------------------------------------------------------------------------
  // Centralized reset of pre-drag refs after a zoom-restore completes (or is
  // cancelled by a new drag). Called from animateZoomAndPanToTarget's
  // onComplete, from handleDragEnd's no-restore branch, and from cancelDrag.
  // Cleanup-at-start (in handleDragEnd) means store positions are already
  // flushed by the time we get here — no stale-position concern.
  // ---------------------------------------------------------------------------
  const resetZoomRestoreRefs = useCallback(() => {
    setPreDragZoomLevel(null);
    zoomOutInitiatedRef.current = false;
    actualZoomedOutLevelRef.current = null;
    actualZoomedOutPanRef.current = null;
    preDragPanOffsetRef.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Cancel an in-flight zoom-restore so a new drag can start cleanly.
  // Cancels the RAF, clears stale pendingDragUpdate, and resets pre-drag refs.
  // No cleanup-flush needed: handleDragEnd already ran performCleanup
  // synchronously when the prior drag finalized.
  // ---------------------------------------------------------------------------
  const cancelInFlightZoomRestore = useCallback(() => {
    if (dragPhaseRef.current !== 'restoring') return;
    if (zoomAnimationRef.current.animationId) {
      cancelAnimationFrame(zoomAnimationRef.current.animationId);
      zoomAnimationRef.current.active = false;
      zoomAnimationRef.current.animationId = null;
      isAnimatingZoomRef.current = false;
    }
    resetZoomRestoreRefs();
    pendingDragUpdate.current = null;
    dragPhaseRef.current = 'idle';
  }, [resetZoomRestoreRefs]);

  // ---------------------------------------------------------------------------
  // Start Drag for Node (single or multi-select)
  // ---------------------------------------------------------------------------
  // `presetOffset` (canvas-space) locks the grip-point to where the finger first
  // landed on the node. Touch passes this from touchstart so finger-on-node
  // stays consistent even though long-press waits 500ms before drag begins.
  // Mouse passes 3 args and the offset is computed from clientX/Y as before.
  const startDragForNode = useCallback((nodeData, clientX, clientY, presetOffset = null) => {
    if (!nodeData || !activeGraphId) return false;
    // Cancel any in-flight zoom-restore from the previous drag so this new
    // drag's zoom-out anchors at the current zoom, not whatever frame the
    // restore was on. Cleanup-at-start (in handleDragEnd) already flushed
    // the prior drag's positions, so there's no stale state to carry over.
    cancelInFlightZoomRestore();
    dragPhaseRef.current = 'dragging';
    const instanceId = nodeData.id;

    // Prime mousePositionRef with the drag-start coords so the zoom-out
    // animation's first frame anchors the node to the actual finger position.
    // On mouse this happens via continuous mousemove updates; on touch nothing
    // updates this ref until a window pointermove fires post-drag-start, so
    // the first animation frame would otherwise read a stale value and yank
    // the node off the grip-point until the next pointermove arrives.
    mousePositionRef.current = { x: clientX, y: clientY };

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

      let initMouseCanvasX, initMouseCanvasY;
      if (presetOffset) {
        // Synthesize initialMouseCanvas so (initialMouseCanvas - initialPrimaryPos) === presetOffset.
        // performDOMDragUpdate's multi-node math (newPrimary = initialPrimaryPos + (mouse - initialMouseCanvas))
        // then keeps the original grip-offset locked.
        initMouseCanvasX = initialPrimaryPos.x + presetOffset.x;
        initMouseCanvasY = initialPrimaryPos.y + presetOffset.y;
      } else {
        const rect = containerRef.current?.getBoundingClientRect();
        initMouseCanvasX = rect ? (clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX : 0;
        initMouseCanvasY = rect ? (clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY : 0;
      }

      const multiInfo = {
        initialMouseCanvas: { x: initMouseCanvasX, y: initMouseCanvasY },
        initialPrimaryPos,
        relativeOffsets: initialPositions,
        primaryId: instanceId
      };
      setDraggingNodeInfo(multiInfo);

      dragHistoryRecordedRef.current = false;
      triggerDragZoomOut(clientX, clientY);

      const liftScale = dragZoomSettings.enabled ? LIFT_SCALE_ZOOM : LIFT_SCALE;
      liftTargetScaleRef.current = liftScale;
      selectedInstanceIds.forEach(id => {
        storeActions.updateNodeInstance(activeGraphId, id, draft => { draft.scale = liftScale; }, { isDragging: true, phase: 'start', ignore: true });
      });

      // Cache DOM elements for all dragged nodes
      cacheDOMElements(draggedIds);
      runLiftAnimation();
      return true;
    }

    // Single node drag
    let offset;
    if (presetOffset) {
      offset = { x: presetOffset.x, y: presetOffset.y };
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const mouseCanvasX = (clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX;
      const mouseCanvasY = (clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY;
      offset = { x: mouseCanvasX - nodeData.x, y: mouseCanvasY - nodeData.y };
    }
    const singleInfo = { instanceId, offset, initialPos: { x: nodeData.x, y: nodeData.y } };
    setDraggingNodeInfo(singleInfo);

    dragHistoryRecordedRef.current = false;
    triggerDragZoomOut(clientX, clientY);
    const liftScale = dragZoomSettings.enabled ? LIFT_SCALE_ZOOM : LIFT_SCALE;
    liftTargetScaleRef.current = liftScale;
    storeActions.updateNodeInstance(activeGraphId, instanceId, draft => { draft.scale = liftScale; }, { isDragging: true, phase: 'start', ignore: true });

    // Cache DOM elements
    cacheDOMElements([instanceId]);
    runLiftAnimation();
    return true;
  }, [activeGraphId, selectedInstanceIds, nodes, nodeById, panOffsetRef, zoomLevelRef, canvasSize.offsetX, canvasSize.offsetY, containerRef, storeActions, triggerDragZoomOut, cacheDOMElements, cancelInFlightZoomRestore, runLiftAnimation, dragZoomSettings]);

  // Ref for long-press timeout to always use latest startDragForNode
  const startDragForNodeRef = useRef(startDragForNode);
  useEffect(() => { startDragForNodeRef.current = startDragForNode; }, [startDragForNode]);

  // ---------------------------------------------------------------------------
  // Start Group Drag (from group label mousedown)
  // ---------------------------------------------------------------------------
  const startGroupDrag = useCallback((groupId, memberOffsets, clientX, clientY) => {
    cancelInFlightZoomRestore();
    dragPhaseRef.current = 'dragging';
    // Prime mousePositionRef before triggerDragZoomOut so the zoom-out
    // animation's first frame reads the actual touch position. Without this,
    // touch group drag flashes to a stale coord (often {0,0}) for one frame
    // before the first pointermove corrects it. Mirrors startDragForNode.
    mousePositionRef.current = { x: clientX, y: clientY };
    setDraggingNodeInfo({ groupId, memberOffsets });
    dragHistoryRecordedRef.current = false;
    // Group members don't get a per-node lift scale — fall back to node.scale (1)
    // rather than a stale target left over from a prior single/multi-node drag.
    liftTargetScaleRef.current = null;
    triggerDragZoomOut(clientX, clientY);

    // Cache DOM elements for all group members
    const memberIds = memberOffsets.map(m => m.id);
    cacheDOMElements(memberIds);
  }, [triggerDragZoomOut, cacheDOMElements, cancelInFlightZoomRestore, mousePositionRef]);

  // ---------------------------------------------------------------------------
  // Cancel Drag (for touch cancel, escape key, etc.)
  // ---------------------------------------------------------------------------
  const cancelDrag = useCallback(() => {
    clearDOMTransforms();
    setDraggingNodeInfo(null);
    dragPhaseRef.current = 'idle';
    resetZoomRestoreRefs();
    // Release the SaveCoordinator gate. Without this, an aborted drag (touch
    // cancel, escape key) would leave isGlobalDragging latched until the 2.5s
    // self-heal fires — blocking autosave in the meantime.
    saveCoordinator.signalInteractionEnd({ source: 'drag-cancel' });
  }, [clearDOMTransforms, resetZoomRestoreRefs]);

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

  // Ref so the window-level effect below doesn't re-attach listeners every
  // time handleDragMove rebuilds (e.g., dragZoomSettings change).
  const handleDragMoveRef = useRef(handleDragMove);
  useEffect(() => { handleDragMoveRef.current = handleDragMove; }, [handleDragMove]);

  // ---------------------------------------------------------------------------
  // Window-Scoped Drag Tracking
  // ---------------------------------------------------------------------------
  // Touch events stop firing on the original element once the finger leaves
  // it, and pointer-capture / document-level touchmove fallbacks are
  // unreliable across browsers and emulators. Once a drag is in flight,
  // tracking lives at window scope: window pointermove fires for the active
  // pointer regardless of which element is under it. This bypasses the entire
  // element-routed event chain (touch → pointer → React → handleMouseMove)
  // and feeds clientX/Y straight into the drag pipeline.
  useEffect(() => {
    if (!draggingNodeInfo) return;
    const onPointerMove = (e) => {
      if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
      // Keep edge-pan / zoom-anchor refs in sync with live pointer position.
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      handleDragMoveRef.current(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [draggingNodeInfo, mousePositionRef]);

  // ---------------------------------------------------------------------------
  // Handle Drag End (called from handleMouseUp in NodeCanvas)
  // Returns { draggedNodeIds, primaryNodeId, checkGroupDrop, wasGroupDrag }
  // ---------------------------------------------------------------------------
  const handleDragEnd = useCallback((clientX, clientY, graphsMap) => {
    // Atomic re-entry guard. Multiple release paths (window-capture pointerup,
    // React onMouseUp, React onTouchEnd) can call handleMouseUp in the same
    // tick; without this, performCleanup runs twice and the second call hits
    // the `else` branch below (immediate cleanup mid-animation).
    if (dragPhaseRef.current !== 'dragging') {
      return { draggedNodeIds: [], primaryNodeId: null, checkGroupDrop: false, wasGroupDrag: false };
    }
    // Read from the ref, not the state — `draggingNodeInfo` (state) can be
    // one commit stale relative to `setDraggingNodeInfo` calls inside
    // startDragForNode (e.g., when handleMouseUp fires in the same tick as
    // the long-press timeout). The ref is updated synchronously.
    const info = draggingNodeInfoRef.current || draggingNodeInfo;
    if (!info) {
      dragPhaseRef.current = 'idle';
      return { draggedNodeIds: [], primaryNodeId: null, checkGroupDrop: false, wasGroupDrag: false };
    }
    dragPhaseRef.current = 'finalizing';

    // Snap drag state to the actual release position. The last pointermove can
    // fire a few px before touchend, so dragPositionsRef + pendingDragUpdate
    // hold the LAST-MOVE coords. But the zoom-restore animation below is
    // anchored at the release coords — that mismatch is what causes the
    // node and its edges to "glitch to a different spot" for a frame during
    // and at the end of the 250ms restore. Re-run the drag update at the
    // release coords so finalPositions, the JS-set DOM transforms, and the
    // layoutEffect's reapply all agree on the drop point.
    performDragUpdateRef.current(clientX, clientY, panOffsetRef.current, zoomLevelRef.current, info);
    if (pendingDragUpdate.current) {
      pendingDragUpdate.current = {
        ...pendingDragUpdate.current,
        clientX,
        clientY,
      };
    }

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

      // Match computePositionUpdates: per-member independent snap.
      const positionUpdates = info.memberOffsets.map(({ id, dx, dy }) => {
        const node = nodeByIdRef.current.get(id);
        const xRaw = mouseCanvasX - dx;
        const yRaw = mouseCanvasY - dy;
        if (!node || gridMode === 'off') return { instanceId: id, x: xRaw, y: yRaw };
        const dims = getNodeDimensions(node, false, null);
        const centerX = xRaw + dims.currentWidth / 2;
        const centerY = yRaw + dims.currentHeight / 2;
        const snappedCenterX = Math.round(centerX / gridSize) * gridSize;
        const snappedCenterY = Math.round(centerY / gridSize) * gridSize;
        return {
          instanceId: id,
          x: snappedCenterX - (dims.currentWidth / 2),
          y: snappedCenterY - (dims.currentHeight / 2),
        };
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

      clearDOMTransforms({ animateDrop: true });

      // Reset scale 1.15 → 1 synchronously so it batches into the same React
      // commit as the position flush above. Previously this was wrapped in
      // setTimeout(0), which left the node rendered at its new position with
      // scale 1.15 for one frame after the zoom-restore animation ended,
      // then snapped to scale 1 on the next macrotask — the "slight pause" felt at drop.
      //
      // Context options: keep phase:'move'/isDragging:true so SaveCoordinator's
      // global drag gate stays held through the zoom-restore animation that
      // follows. handleDragEnd explicitly calls saveCoordinator.signalInteractionEnd()
      // after the animation completes (or immediately when no restore is needed)
      // — releasing the gate THERE moves the worker structured-clone postMessage
      // off the rAF tail and removes the stutter at the end of the drop.
      let finalizeSent = false;
      instanceIdsToReset.forEach(id => {
        const nodeExists = nodes.some(n => n.id === id);
        if (nodeExists) {
          const shouldFinalize = primaryFinalizeId ? id === primaryFinalizeId : !finalizeSent;
          storeActions.updateNodeInstance(
            activeGraphId,
            id,
            draft => { draft.scale = 1; },
            { phase: 'move', isDragging: true, finalize: shouldFinalize, ignore: true }
          );
          if (shouldFinalize) finalizeSent = true;
        }
      });

      setDraggingNodeInfo(null);
      wasDraggingRef.current = true;
      setTimeout(() => { wasDraggingRef.current = false; }, 50);
      isEdgePanningRef.current = false;
    };

    // --- Cleanup-at-start: flush positions, scale, DOM transforms NOW ---
    // Linear lerp of zoom + pan in animateZoomAndPanToTarget keeps the
    // canvas-space drop point at fixed screen coordinates throughout the
    // animation (algebra: screen(t) = pan(t) + zoom(t)*world stays constant
    // when both lerp with the same t and target pan was solved against
    // target zoom). Clearing the DOM transform now is therefore visually
    // safe — the node renders from the (now-flushed) store at its
    // canvas-space drop position, which corresponds to the same screen
    // position throughout the zoom-restore animation. The drop visibly
    // completes at release; zoom animates around already-final state.
    performCleanup();

    // --- Zoom restore (animation only — cleanup already done) ---
    const needsZoomRestore = preDragZoomLevel !== null && dragZoomSettings.enabled;

    if (needsZoomRestore) {
      dragPhaseRef.current = 'restoring';

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

      animateZoomAndPanToTarget(targetZoom, { x: clampedTargetPanX, y: clampedTargetPanY }, currentZoom, currentPan, () => {
        resetZoomRestoreRefs();
        dragPhaseRef.current = 'idle';
        // Release the SaveCoordinator gate now that the animation is done.
        // performCleanup kept it held (phase:'move') so the worker structured-
        // clone postMessage wouldn't fire mid-animation and stutter the tail.
        saveCoordinator.signalInteractionEnd({ source: 'drag-end-after-restore' });
      });
      // Clear pre-drag refs synchronously so a new drag starting mid-animation
      // doesn't see stale preDragZoomLevel and skip its own zoom-out.
      setPreDragZoomLevel(null);
      zoomOutInitiatedRef.current = false;
      preDragPanOffsetRef.current = null;
    } else {
      resetZoomRestoreRefs();
      dragPhaseRef.current = 'idle';
      // No animation to wait on — release the gate immediately. performCleanup
      // sent phase:'move' to be conservative; without this call the gate would
      // stay latched until the next phase:'end' mutation.
      saveCoordinator.signalInteractionEnd({ source: 'drag-end-no-restore' });
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
      if (isAnimatingZoomRef.current || dragPhaseRef.current !== 'dragging') {
        panRafRef.current = requestAnimationFrame(panLoop);
        return;
      }

      if (!draggingNodeInfoRef.current) return;

      // Setting-gated: respect the user's edge-pan preference. Read each tick
      // so toggling in Settings takes effect immediately without restarting
      // the loop.
      if (useGraphStore.getState().mouseSettings?.nodeDragEdgePanEnabled === false) {
        isEdgePanningRef.current = false;
        animationFrameId = requestAnimationFrame(panLoop);
        return;
      }

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
    dragPhaseRef,
    isAnimatingZoomRef,
    longPressingInstanceId,
    longPressingInstanceIdRef,
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
