import { useState, useRef, useEffect, useCallback } from 'react';
import * as GeometryUtils from '../utils/canvas/geometryUtils.js';
import { getNodeDimensions } from '../utils.js';
import useHistoryStore from '../store/historyStore.js';
import { getVisualConnectionEndpoints } from '../utils/canvas/nodeHitbox.js';
import { calculateParallelEdgePath } from '../utils/canvas/parallelEdgeUtils.js';

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
  visibleEdgesRef,
  selectedInstanceIdsRef,
}) => {
  // ---------------------------------------------------------------------------
  // State & Refs
  // ---------------------------------------------------------------------------
  const [draggingNodeInfo, setDraggingNodeInfo] = useState(null);
  const draggingNodeInfoRef = useRef(null);
  useEffect(() => { draggingNodeInfoRef.current = draggingNodeInfo; }, [draggingNodeInfo]);

  const [preDragZoomLevel, setPreDragZoomLevel] = useState(null);

  const [isAnimatingZoom, setIsAnimatingZoom] = useState(false);
  const isAnimatingZoomRef = useRef(false);
  useEffect(() => { isAnimatingZoomRef.current = isAnimatingZoom; }, [isAnimatingZoom]);

  const [longPressingInstanceId, setLongPressingInstanceId] = useState(null);

  const zoomOutInitiatedRef = useRef(false);
  const actualZoomedOutLevelRef = useRef(null);
  const actualZoomedOutPanRef = useRef(null);
  const preDragPanOffsetRef = useRef(null);
  const restoreInProgressRef = useRef(false);

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
  const dragEdgeElsRef = useRef(new Map());       // edgeId → DOM <g> element

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

    // Cache node <g> elements
    const nodeIdSet = new Set(nodeIds);
    nodeIdSet.forEach(id => {
      const el = container.querySelector(`[data-instance-id="${id}"]`);
      if (el) dragNodeElsRef.current.set(id, el);
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
  }, [containerRef, edgesByNodeIdRef]);

  // ---------------------------------------------------------------------------
  // Compute Position Updates (pure math, no side effects)
  // Returns [{instanceId, x, y}, ...]
  // ---------------------------------------------------------------------------
  const computePositionUpdates = useCallback((mouseCanvasX, mouseCanvasY, draggingInfo) => {
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
  // Update Edge DOM Elements During Drag
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

    // Build edge data index on demand from visible edges
    const visEdges = visibleEdgesRef.current;
    const edgeDataMap = new Map();
    for (let i = 0; i < visEdges.length; i++) {
      const e = visEdges[i];
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

      // Create virtual nodes with updated positions for endpoint calculation
      const virtualSource = { ...sStored, x: sPos.x, y: sPos.y };
      const virtualDest = { ...dStored, x: dPos.x, y: dPos.y };

      const endpoints = getVisualConnectionEndpoints(
        virtualSource, virtualDest, sDims, dDims,
        curSelectedIds.has(edge.sourceId),
        curSelectedIds.has(edge.destinationId)
      );

      // Get curve info for parallel edges
      const curveInfo = curCurveInfo.get(edgeId);
      const parallelPath = calculateParallelEdgePath(
        endpoints.x1, endpoints.y1, endpoints.x2, endpoints.y2, curveInfo
      );

      // Update each edge <g> element (may appear in both above/below blocks)
      edgeEls.forEach(edgeEl => {
        if (parallelPath.type === 'line' && (!curveInfo || curveInfo.totalInPair <= 1)) {
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
      });
    });
  }, [nodeByIdRef, baseDimsByIdRef, edgeCurveInfoRef, edgesByNodeIdRef, visibleEdgesRef, selectedInstanceIdsRef]);

  // ---------------------------------------------------------------------------
  // Core DOM Drag Update (replaces performDragUpdate — writes to DOM, not store)
  // ---------------------------------------------------------------------------
  const performDOMDragUpdate = useCallback((clientX, clientY, currentPan, currentZoom, draggingInfo) => {
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
  }, [containerRef, canvasSizeRef, placedLabelsRef, computePositionUpdates, nodeByIdRef, baseDimsByIdRef, updateEdgesInDOM]);

  // Ref to hold latest performDOMDragUpdate (avoids restarting edge panning effect)
  const performDragUpdateRef = useRef(performDOMDragUpdate);
  useEffect(() => { performDragUpdateRef.current = performDOMDragUpdate; }, [performDOMDragUpdate]);

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

    setIsAnimatingZoom(true);

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

      if (progress < 1) {
        state.animationId = requestAnimationFrame(step);
      } else {
        if (zoomOutInitiatedRef.current && !restoreInProgressRef.current) {
          actualZoomedOutLevelRef.current = state.targetZoom;
          actualZoomedOutPanRef.current = { x: clampedPanX, y: clampedPanY };
        }
        state.active = false;
        state.animationId = null;
        setIsAnimatingZoom(false);
      }
    };

    zoomAnimationRef.current.animationId = requestAnimationFrame(step);
  }, [setZoomLevel, setPanOffset, panOffsetRef, zoomLevelRef, viewportSizeRef, containerRef, canvasSizeRef, pinchSmoothingRef]);

  const animateZoomAndPanToTarget = useCallback((targetZoom, targetPan, currentZoom, currentPan = null) => {
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

    setIsAnimatingZoom(true);

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
        setIsAnimatingZoom(false);
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
    dragNodeElsRef.current.forEach((el) => {
      el.style.transform = '';
      el.style.transformOrigin = '';
    });
    dragPositionsRef.current.clear();
    dragNodeElsRef.current.clear();
    dragEdgeElsRef.current.clear();
  }, []);

  // ---------------------------------------------------------------------------
  // Start Drag for Node (single or multi-select)
  // ---------------------------------------------------------------------------
  const startDragForNode = useCallback((nodeData, clientX, clientY) => {
    if (!nodeData || !activeGraphId) return false;
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
  }, [activeGraphId, selectedInstanceIds, nodes, nodeById, panOffsetRef, zoomLevelRef, canvasSize.offsetX, canvasSize.offsetY, containerRef, storeActions, triggerDragZoomOut, cacheDOMElements]);

  // Ref for long-press timeout to always use latest startDragForNode
  const startDragForNodeRef = useRef(startDragForNode);
  useEffect(() => { startDragForNodeRef.current = startDragForNode; }, [startDragForNode]);

  // ---------------------------------------------------------------------------
  // Start Group Drag (from group label mousedown)
  // ---------------------------------------------------------------------------
  const startGroupDrag = useCallback((groupId, memberOffsets, clientX, clientY) => {
    setDraggingNodeInfo({ groupId, memberOffsets });
    dragHistoryRecordedRef.current = false;
    triggerDragZoomOut(clientX, clientY);

    // Cache DOM elements for all group members
    const memberIds = memberOffsets.map(m => m.id);
    cacheDOMElements(memberIds);
  }, [triggerDragZoomOut, cacheDOMElements]);

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

    // --- Flush DOM-bypass positions to Zustand store ---
    const finalPositions = new Map(dragPositionsRef.current);
    if (finalPositions.size > 0) {
      const finalUpdates = Array.from(finalPositions.entries()).map(
        ([instanceId, { x, y }]) => ({ instanceId, x, y })
      );
      storeActions.updateMultipleNodeInstancePositions(
        activeGraphId,
        finalUpdates,
        { isDragging: true, phase: 'move' }
      );
    }

    // Clear DOM transforms before React re-renders with correct positions
    clearDOMTransforms();

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

    // --- Scale Reset ---
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

    // --- Finalize Group Drag (history + position commit) ---
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

      storeActions.updateMultipleNodeInstancePositions(
        activeGraphId,
        positionUpdates,
        { finalize: true, type: 'node_position', groupId: info.groupId, groupName }
      );
    }

    // --- Clear drag state ---
    setDraggingNodeInfo(null);

    wasDraggingRef.current = true;
    setTimeout(() => { wasDraggingRef.current = false; }, 50);

    isEdgePanningRef.current = false;

    // --- Zoom Restore ---
    if (preDragZoomLevel !== null && dragZoomSettings.enabled && !restoreInProgressRef.current) {
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

      animateZoomAndPanToTarget(targetZoom, { x: clampedTargetPanX, y: clampedTargetPanY }, currentZoom, currentPan);

      setPreDragZoomLevel(null);
      zoomOutInitiatedRef.current = false;
      actualZoomedOutLevelRef.current = null;
      actualZoomedOutPanRef.current = null;
      preDragPanOffsetRef.current = null;
      requestAnimationFrame(() => { restoreInProgressRef.current = false; });
    } else if (preDragZoomLevel !== null) {
      setPreDragZoomLevel(null);
      zoomOutInitiatedRef.current = false;
      actualZoomedOutLevelRef.current = null;
      actualZoomedOutPanRef.current = null;
      preDragPanOffsetRef.current = null;
      restoreInProgressRef.current = false;
    }

    const primaryNodeId = info.primaryId || info.instanceId || null;
    return { draggedNodeIds, primaryNodeId, checkGroupDrop, wasGroupDrag };
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
    isAnimatingZoom,
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

    // Convenience
    isDragging,
  };
};
