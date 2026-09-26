/**
 * Canvas pointer handlers (P4.04a): node press, pointer move, press and release
 * on the canvas, the canvas click, the connection-draw start and keyboard pan
 * travel, moved out of NodeCanvas verbatim. They were rebuilt on every render;
 * now NodeCanvas creates them once, so every consumer (the canvas element, the
 * touch layer, the group titles, the gamepad) holds stable functions.
 *
 * Everything they read from the canvas comes from `ctxRef.current`, which
 * NodeCanvas assigns on every render (see cameraController.js for why during
 * render). The next step (P4.04b) is the gesture state machine that replaces
 * the shared gesture refs these still read.
 */
import { getNodeDimensions } from '../../../utils.js';
import { clientToCanvas } from '../../../utils/canvas/viewportMath.js';
import { MOVEMENT_THRESHOLD, MIDDLE_MOUSE_ZOOM_SENSITIVITY, MAX_ZOOM, NODE_WIDTH, NODE_HEIGHT, PAN_DRAG_SENSITIVITY } from '../../../constants';
import { getActionHoverItem } from '../../../utils/canvas/actionHover.js';
import { haptic } from '../../../services/haptics.js';
import { TOUCH_PAN_DRAG_SENSITIVITY, isMac, TOUCH_MOMENTUM_STATIONARY_GAP_MS, TOUCH_MOMENTUM_VELOCITY_WINDOW_MS, TOUCH_MOMENTUM_LAUNCH_MIN_SPEED, PAN_MOMENTUM_MIN_SPEED } from '../../../utils/canvas/input/inputTuning.js';
import { v4 as uuidv4 } from 'uuid';
import { findGroupDropTarget, groupDropDialogFor } from '../groups/groupDropTarget.js';
import useGraphStore, { TRACKPAD_PAN_GLIDE_STRENGTH_DEFAULT } from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { setAddToGroupDialog, setSelfLoopDialog } from '../dialogs/canvasDialogs.js';
import { queueEdgeHandoff } from '../edges/edgeTransitions.js';

/** @param {{ current: object }} ctxRef */
export function createPointerHandlers(ctxRef) {
  const handleNodeMouseDown = (nodeData, e) => { // nodeData is now a hydrated node (instance + prototype)
    const { suppressNextMouseDownRef, stopZoomMomentum, stopTrackpadZoom, middleMouseZoomEnabled, stopPanMomentum, activeGraphId, middleMouseZoomRef, isPanningOrZooming, containerRef, isDoublePress, clickTimeoutIdRef, potentialClickNodeRef, storeActions, rightPanelExpanded, cancelAutoLayoutAnimation, isMouseDown, mouseDownPosition, mouseMoved, mouseInsideNode, startedOnNode, selectedInstanceIds, setSelectedInstanceIds, previewingNodeId, CLICK_DELAY, longPressTimeout, setLongPressingInstanceId, isTouchDeviceRef, startDragForNodeRef, nodeLiftDelay } = ctxRef.current;
    e.stopPropagation();
    if (suppressNextMouseDownRef.current) {
      suppressNextMouseDownRef.current = false;
      return;
    }
    // Ignore right-clicks (button === 2) so context menu can handle them without locking drag
    if (e && e.button === 2) {
      try { e.preventDefault(); } catch { }
      return;
    }
    // Pressing a node halts a settling trackpad zoom (see handleMouseDown).
    if (!e?.touches) {
      stopZoomMomentum();
      stopTrackpadZoom();
    }
    // Middle-button on a node: arm the zoom-by-drag gesture when the user has enabled
    // "Hold middle click to zoom"; if released without moving, mouseup opens the panel tab
    // (treating it like a double-click on a node).
    if (e && e.button === 1 && middleMouseZoomEnabled) {
      try { e.preventDefault(); } catch { }
      stopPanMomentum();
      if (!activeGraphId) return;
      middleMouseZoomRef.current = {
        anchorX: e.clientX,
        anchorY: e.clientY,
        moved: false,
        nodePrototypeId: nodeData.prototypeId,
        nodeName: nodeData.name,
      };
      isPanningOrZooming.current = true;
      try { containerRef.current?.requestPointerLock?.({ unadjustedMovement: true }); } catch { }
      return;
    }
    stopPanMomentum();
    if (!activeGraphId) return;

    const instanceId = nodeData.id; // This is the instance ID
    const prototypeId = nodeData.prototypeId;

    // --- Double-click ---
    // Gated on the previous press, not on e.detail alone — see lastPressRef.
    // Clicking along a row of Things at speed is an ordinary thing to do and
    // must stay a run of single clicks.
    if (isDoublePress(`node:${instanceId}`, e.clientX, e.clientY, e.detail)) {
      e.preventDefault();
      if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); clickTimeoutIdRef.current = null; }
      potentialClickNodeRef.current = null;
      // Open panel tab using the PROTOTYPE ID
      storeActions.openRightPanelNodeTab(prototypeId, nodeData.name);
      // Ensure right panel is expanded
      if (!rightPanelExpanded) {
        storeActions.setRightPanelExpanded(true);
      }
      return;
    }

    // --- Single click initiation & Long press ---
    // Deliberately not `e.detail === 1`: a fast click that the browser counted
    // as the second of a pair but which landed on a DIFFERENT Thing is still a
    // first click on this one, and dropping it on the floor was the other half
    // of the same bug.
    {
      // Touching a node freezes any in-flight auto-layout tween so it can't yank
      // the node out from under the grab during the lift delay (the wizard keeps
      // re-triggering layout as it streams new nodes).
      cancelAutoLayoutAnimation();
      isMouseDown.current = true;
      mouseDownPosition.current = { x: e.clientX, y: e.clientY };
      mouseMoved.current = false;
      mouseInsideNode.current = true;
      startedOnNode.current = true;

      // --- Handle Click vs Double Click Timing ---
      if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); }
      potentialClickNodeRef.current = nodeData;

      clickTimeoutIdRef.current = setTimeout(() => {
        if (potentialClickNodeRef.current?.id === instanceId && !mouseMoved.current && !isMouseDown.current) {
          // --- Execute Selection Logic ---
          const wasSelected = selectedInstanceIds.has(instanceId);
          setSelectedInstanceIds(prev => {
            const newSelected = new Set(prev);
            if (wasSelected) {
              if (instanceId !== previewingNodeId) { // previewingNodeId also needs to be an instanceId
                newSelected.delete(instanceId);
              }
            } else {
              newSelected.add(instanceId);
            }
            return newSelected;
          });
        }
        clickTimeoutIdRef.current = null;
        potentialClickNodeRef.current = null;
      }, CLICK_DELAY);

      // --- Setup Long Press for Drag/Connection ---
      clearTimeout(longPressTimeout.current);
      setLongPressingInstanceId(instanceId);
      longPressTimeout.current = setTimeout(() => {
        console.log('Long press timeout fired:', {
          instanceId,
          mouseInsideNode: mouseInsideNode.current,
          mouseMoved: mouseMoved.current,
          isTouchDevice: isTouchDeviceRef.current,
          willProceed: mouseInsideNode.current && (!mouseMoved.current || isTouchDeviceRef.current)
        });
        if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); clickTimeoutIdRef.current = null; }
        potentialClickNodeRef.current = null;

        if (mouseInsideNode.current && (!mouseMoved.current || isTouchDeviceRef.current)) {
          startDragForNodeRef.current(nodeData, e.clientX, e.clientY);
        }
        setLongPressingInstanceId(null);
      }, nodeLiftDelay);
    }
  };

  // RAF-based label clearing updates
  const pendingLabelClear = { current: null };
  const labelClearScheduled = { current: false };

  // RAF-based pan updates
  const pendingPanUpdate = { current: null };
  const panUpdateScheduled = { current: false };

  // RAF-based hover detection for edge/node hovering
  const pendingHoverCheck = { current: null };
  const hoverCheckScheduled = { current: false };

  /**
   * Starts a connection draw from the node the pointer is currently holding.
   *
   * Shared by the pointer-move path and the keyboard-pan path — see the note at
   * panTravelSinceMouseDownRef for why a pan counts as the same gesture. The
   * caller owns the "should this start" decision (armed node, threshold crossed,
   * nothing else in flight); this owns everything that happens once it does.
   *
   * @returns {boolean} true if a draw was started.
   */
  function beginConnectionDrawFromNode(armedInstanceId, clientX, clientY) {
    const { nodes, isInsideNode, startedOnNode, longPressTimeout, groupLongPressTimeout, mouseInsideNode, anchorPositionUpdatesRef, previewingNodeId, containerRef, setLongPressingInstanceId, panOffsetRef, zoomLevelRef, canvasSize, draggingNodeInfoRef, clampCoordinates, setDrawingConnectionFrom, connectionExitedSourceRef, connectionHoverTargetRef, connectionStretchTrack } = ctxRef.current;
    const srcNode = nodes.find(n => n.id === armedInstanceId);
    if (!srcNode) return false;

    // Allow both patterns:
    // 1) Move outside the node (original behavior)
    // 2) Quick drag while still inside the node (desktop-friendly)
    const leftNodeArea = !isInsideNode(srcNode, clientX, clientY);
    if (!leftNodeArea && !startedOnNode.current) return false;

    clearTimeout(longPressTimeout.current);
    clearTimeout(groupLongPressTimeout.current); // Cancel group drag if connection drawing starts
    mouseInsideNode.current = false;
    // For anchor nodes (thing group titles), use title dimensions from anchorPositionUpdatesRef
    const anchorInfo = srcNode.isGroupAnchor ? anchorPositionUpdatesRef.current.get(srcNode.id) : null;
    const startNodeDims = anchorInfo
      ? { currentWidth: anchorInfo.width, currentHeight: anchorInfo.height }
      : getNodeDimensions(srcNode, previewingNodeId === srcNode.id, null);
    // Take the pill's POSITION from the same place as its size. The stored
    // anchor instance only trails the pill (the flush effect syncs it a frame
    // later), so pairing srcNode.x with the pill's dims started the line off
    // the tab whenever the two hadn't caught up — right after a group drag,
    // most of all. setDrawingConnectionEnd already reads it this way.
    const startX = anchorInfo ? anchorInfo.x : srcNode.x;
    const startY = anchorInfo ? anchorInfo.y : srcNode.y;
    const startPt = { x: startX + startNodeDims.currentWidth / 2, y: startY + startNodeDims.currentHeight / 2 };

    // Validate mouse coordinates before calculating canvas position
    if (!containerRef.current || typeof clientX !== 'number' || typeof clientY !== 'number') {
      // If coordinates are invalid, don't start drawing connection
      setLongPressingInstanceId(null);
      return false;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const { x: rawX, y: rawY } = clientToCanvas(clientX, clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);

    // Validate calculated coordinates are not NaN
    if (isNaN(rawX) || isNaN(rawY)) {
      // Only clear if NOT already dragging
      if (!draggingNodeInfoRef.current) {
        setLongPressingInstanceId(null);
      }
      return false; // Skip this frame but don't abort active drag
    }

    const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);
    setDrawingConnectionFrom({ sourceInstanceId: armedInstanceId, startX: startPt.x, startY: startPt.y, currentX, currentY });
    connectionExitedSourceRef.current = false;
    // Seed the lattice at the gesture's actual starting length so the
    // first detent is a real crossing, not an artifact of starting
    // from zero.
    connectionHoverTargetRef.current = null;
    connectionStretchTrack.current.reset(
      Math.hypot(currentX - startPt.x, currentY - startPt.y) * zoomLevelRef.current
    );
    setLongPressingInstanceId(null); // Clear ID
    return true;
  }

  /**
   * Keyboard pan reporting its APPLIED per-frame displacement (screen px, already
   * clamped at the canvas edge — a pan that goes nowhere reports nothing).
   *
   * While a node is held, this travel is the pointer-relative motion that the
   * mouse never made, so it arms the connection draw on the same
   * MOVEMENT_THRESHOLD the pointer path uses.
   */
  function handleKeyboardPanTravel(dx, dy) {
    const { panTravelSinceMouseDownRef, isMouseDown, longPressingInstanceIdRef, draggingNodeInfoRef, drawingConnectionFromRef, pinchRef, mouseMoved, clickTimeoutIdRef, potentialClickNodeRef, mousePositionRef } = ctxRef.current;
    const travel = panTravelSinceMouseDownRef.current;
    const armedInstanceId = isMouseDown.current ? longPressingInstanceIdRef.current : null;
    // One arming is the accumulator's whole lifetime: zero it whenever the held
    // node changes or the button comes up.
    if (travel.armedId !== armedInstanceId) {
      travel.armedId = armedInstanceId;
      travel.x = 0;
      travel.y = 0;
    }
    if (!armedInstanceId) return;

    travel.x += dx;
    travel.y += dy;

    if (draggingNodeInfoRef.current || drawingConnectionFromRef.current || pinchRef.current.active) return;
    if (Math.hypot(travel.x, travel.y) <= MOVEMENT_THRESHOLD) return;

    // Mark the gesture as moved before starting the draw, exactly as the pointer
    // path does on threshold: the lift timer promotes a still-held node into a
    // node drag unless it sees movement, and mouseup reads the same flag to tell
    // a drag from a click.
    mouseMoved.current = true;
    if (clickTimeoutIdRef.current) {
      clearTimeout(clickTimeoutIdRef.current);
      clickTimeoutIdRef.current = null;
      potentialClickNodeRef.current = null;
    }

    const mouse = mousePositionRef.current;
    beginConnectionDrawFromNode(armedInstanceId, mouse.x, mouse.y);
  }

  /**
   * Handles pointer-move for dragging, panning, edge-preview, and hover detection.
   *
   * Bound once (the `.canvas-area` div); touch calls it synthetically. Branches:
   * - **Middle-mouse zoom drag**: uses `movementY` (pointer is locked) to drive zoom
   *   anchored at the original mousedown point.
   * - **Node drag**: updates the dragged node's canvas position; triggers viewport
   *   edge-scroll when the pointer is within the scroll margin.
   * - **Edge creation preview**: draws the in-progress edge line from source to cursor.
   * - **Canvas pan**: updates `panOffset` when in pan mode (no node targeted).
   * - **Hover detection**: debounced hit-test to update the hovered node/edge state.
   *
   * @param {MouseEvent|PointerEvent} e - The mouse-move event, or a synthetic one.
   */
  async function handleMouseMove(e) {
    const { mousePositionRef, activeGraphId, middleMouseZoomRef, draggingNodeInfo, isAnimatingZoomRef, containerRef, zoomOpIdRef, canvasWorker, zoomLevelRef, panOffsetRef, viewportSize, canvasSize, MIN_ZOOM, setPanAndZoom, isMouseDown, isPanning, pinchRef, clearLabelsOnMouseMove, lastMousePosRef, clampCoordinates, nodes, visibleNodeIds, semanticOrbitActiveRef, inputModeRef, clearHoverImmediate, isInsideNode, baseDimsById, commitHoverTarget, findNearestEdgeAtCanvasPoint, getEdgeHitThreshold, hoverStickyEdgeId, selectionStartRef, mouseDownPosition, mouseMoved, updateMarquee, clickTimeoutIdRef, potentialClickNodeRef, longPressingInstanceIdRef, draggingNodeInfoRef, drawingConnectionFrom, isPanningRef, startedOnNode, panStartRef, isPanningOrZooming, setIsPanning, lastPanVelocityRef, lastPanSampleRef, setPanStart, panSourceRef, isTouchDeviceRef, panVelocityHistoryRef, nodeDrag, setDrawingConnectionEnd, connectionStretchTrack, findConnectionDropTarget, connectionExitedSourceRef, connectionHoverTargetRef, abstractionCarouselVisible, touchSettingsRef, setPanOffset } = ctxRef.current;
    // Update mouse position for edge panning
    mousePositionRef.current = { x: e.clientX, y: e.clientY };

    if (!activeGraphId) return;

    // Middle-mouse zoom: vertical drag → zoom, anchored at the original mousedown point.
    // Pointer-locked, so use raw movementY (clientY is frozen) and drive zoom anchored at anchorX/Y.
    // Drag up (negative dy) zooms in; drag down zooms out, matching wheel convention.
    if (middleMouseZoomRef.current) {
      const state = middleMouseZoomRef.current;
      const dy = e.movementY || 0;
      const dx = e.movementX || 0;
      if (Math.abs(dx) + Math.abs(dy) > 0) state.moved = true;
      if (Math.abs(dy) < 0.5 || draggingNodeInfo || isAnimatingZoomRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const anchorMouseX = state.anchorX - rect.left;
      const anchorMouseY = state.anchorY - rect.top;
      const zoomDelta = dy * MIDDLE_MOUSE_ZOOM_SENSITIVITY;
      const opId = ++zoomOpIdRef.current;
      try {
        const result = await canvasWorker.calculateZoom({
          deltaY: zoomDelta,
          currentZoom: zoomLevelRef.current,
          mousePos: { x: anchorMouseX, y: anchorMouseY },
          panOffset: panOffsetRef.current,
          viewportSize, canvasSize, MIN_ZOOM, MAX_ZOOM,
        });
        if (opId === zoomOpIdRef.current) {
          setPanAndZoom(result.panOffset, result.zoomLevel);
        }
      } catch { /* ignore */ }
      return;
    }

    // Avoid per-frame logging during drag; logs removed for performance

    // Schedule RAF-throttled label clearing only while the mouse is pressed
    // (but not dragging/panning). When the mouse is up, the hover-detection RAF
    // below is the sole authority and drives clearing through the dwell timer —
    // clearing here every frame would cancel that timer before it can elapse.
    if (isMouseDown.current && !draggingNodeInfo && !isPanning && !pinchRef.current.active) {
      pendingLabelClear.current = e;
      if (!labelClearScheduled.current) {
        labelClearScheduled.current = true;
        requestAnimationFrame(() => {
          labelClearScheduled.current = false;
          if (pendingLabelClear.current) {
            clearLabelsOnMouseMove(pendingLabelClear.current);
          }
        });
      }
    }

    // Validate container and coordinates before processing
    if (!containerRef.current || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    // Track last client pointer position for Safari gesture anchoring
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    const { x: rawX, y: rawY } = clientToCanvas(e.clientX, e.clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
    const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);

    // Edge hover detection (only when not dragging/panning)
    // PERFORMANCE: Skip all hover updates during drag to reduce per-frame work
    if (!isMouseDown.current && !draggingNodeInfo && !isPanning) {
      // RAF-throttled hover detection - sync with display refresh for smoother performance
      pendingHoverCheck.current = { e, currentX, currentY, nodes, visibleNodeIds };

      if (!hoverCheckScheduled.current) {
        hoverCheckScheduled.current = true;
        requestAnimationFrame(() => {
          hoverCheckScheduled.current = false;
          if (!pendingHoverCheck.current) return;

          const { e: mouseEvent, currentX, currentY, nodes: nodeList, visibleNodeIds } = pendingHoverCheck.current;
          pendingHoverCheck.current = null;

          // Orbit mode: the graph is behind a scrim, so there is nothing here
          // to hover. Deliberately returns WITHOUT clearing — the orbit's own
          // items sit in a layer above this one and their hovers bubble through
          // here as ordinary canvas movement, so clearing would wipe the
          // preview the item just raised. Entering orbit clears once, in the
          // effect that syncs semanticOrbitActiveRef.
          if (semanticOrbitActiveRef.current) return;

          // Touch, on the other hand, does need clearing: touchscreens fire
          // hover events inconsistently and the preview gets stuck on tap.
          if (inputModeRef.current === 'touch') {
            clearHoverImmediate();
            return;
          }

          // PieMenu buttons take priority over nodes and connections.
          if (getActionHoverItem()) {
            clearHoverImmediate();
            return;
          }

          const hoveredNode = nodeList.find(
            (node) => visibleNodeIds.has(node.id) && !node.isGroupAnchor && isInsideNode(node, mouseEvent.clientX, mouseEvent.clientY)
          );

          if (hoveredNode) {
            const dims = baseDimsById.get(hoveredNode.id);
            commitHoverTarget({
              kind: 'node',
              id: hoveredNode.id,
              node: {
                id: hoveredNode.id,
                name: hoveredNode.name,
                color: hoveredNode.color,
                width: dims?.currentWidth ?? NODE_WIDTH,
                height: dims?.currentHeight ?? NODE_HEIGHT,
                prototypeId: hoveredNode.prototypeId
              }
            });
          } else {
            // Same geometric test the click / tap paths run, so the highlight
            // and the selection can never pick different connections. The one
            // difference is stickiness: hover is re-decided every frame and has
            // to stay still between frames, which a click does not.
            const edgeHit = findNearestEdgeAtCanvasPoint(
              currentX, currentY, getEdgeHitThreshold('mouse'),
              { stickyEdgeId: hoverStickyEdgeId() }
            );

            if (edgeHit) {
              commitHoverTarget({
                kind: 'connection',
                id: edgeHit.edgeId,
                edgeInfo: { edgeId: edgeHit.edgeId },
                connection: edgeHit.connection
              });
            } else {
              commitHoverTarget({ kind: 'none' });
            }
          }
        }); // Close RAF callback
      }
    }
    // PERFORMANCE: Don't clear hover states every frame during drag
    // They're already cleared at drag start in handleMouseDown

    // Selection Box Logic (skip during node drag for performance)
    if (selectionStartRef.current && isMouseDown.current && !draggingNodeInfo) {
      e.preventDefault();
      // Lets mouseup swallow the box's trailing click, which would deselect it all.
      if (Math.hypot(e.clientX - mouseDownPosition.current.x, e.clientY - mouseDownPosition.current.y) > MOVEMENT_THRESHOLD) mouseMoved.current = true;
      updateMarquee(currentX, currentY);
      return;
    }

    if (isMouseDown.current) {
      const dx = e.clientX - mouseDownPosition.current.x;
      const dy = e.clientY - mouseDownPosition.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MOVEMENT_THRESHOLD) {
        mouseMoved.current = true;
        if (clickTimeoutIdRef.current) { clearTimeout(clickTimeoutIdRef.current); clickTimeoutIdRef.current = null; potentialClickNodeRef.current = null; }
        // REMOVED: setSelectedNodeIdForPieMenu(null); 

        // Start drawing connection when dragging from a node (desktop quick-drag or long-press).
        // Use the ref for draggingNodeInfo — state can be one commit stale relative to the
        // long-press timer's setDraggingNodeInfo, which lets a mousemove firing in the same
        // tick slip past `!draggingNodeInfo` and start a phantom connection from the node.
        // Read the armed instance from the ref, not state: setLongPressingInstanceId's
        // React commit can lag a frame behind the mousedown that armed it (state now lives
        // in the useNodeDrag hook), so a quick-drag mousemove firing in the same tick would
        // otherwise see null and fail to start a connection — notably from thing-group titles.
        const armedInstanceId = longPressingInstanceIdRef.current;
        if (armedInstanceId && !draggingNodeInfo && !draggingNodeInfoRef.current && !pinchRef.current.active) {
          beginConnectionDrawFromNode(armedInstanceId, e.clientX, e.clientY);
        } else if (!draggingNodeInfo && !drawingConnectionFrom && !isPanningRef.current && !startedOnNode.current && !pinchRef.current.active && !panStartRef.current) {
          // Start panning after threshold exceeded. Use refs (not state) so we read the
          // synchronously-current values — important post-pinch where React may not have
          // committed setIsPanning(true) yet.
          isPanningOrZooming.current = true;
          setIsPanning(true);
          lastPanVelocityRef.current = { vx: 0, vy: 0 };
          lastPanSampleRef.current = { time: performance.now() };
          setPanStart({ x: e.clientX, y: e.clientY });
          panSourceRef.current = isTouchDeviceRef.current ? 'touch' : 'mouse';
          panVelocityHistoryRef.current = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
        }
      }
    }

    // Dragging Node or Group Logic (delegated to useNodeDrag hook)
    if (draggingNodeInfo) {
      if (!mouseMoved.current) mouseMoved.current = true;
      nodeDrag.handleDragMove(e.clientX, e.clientY);
    } else if (drawingConnectionFrom) {
      // Validate coordinates before updating
      if (typeof currentX === 'number' && typeof currentY === 'number' && !isNaN(currentX) && !isNaN(currentY)) {
        // Move the line first: this is the write that also decides whether the
        // gesture has left its source node, which the drop-target arming below
        // reads. Straight to the DOM, so it can run at pointer rate — the RAF hop
        // that used to sit here existed only to coalesce React renders that no
        // longer happen.
        setDrawingConnectionEnd(currentX, currentY);

        // Detents run off the raw pointer stream: the lattice should be sampled
        // at input rate so a fast flick crosses every boundary it actually
        // crossed.
        connectionStretchTrack.current.update(
          Math.hypot(currentX - drawingConnectionFrom.startX, currentY - drawingConnectionFrom.startY)
          * zoomLevelRef.current
        );

        // Edge-triggered "you're over something you can attach to". Fires once
        // on arrival, again if you leave and return, and again when crossing
        // straight from one node to another — but never repeatedly while the
        // finger rests on a target.
        const dropTargetId = findConnectionDropTarget(e.clientX, e.clientY);
        // Mirrors handleMouseUp's acceptance: any node but the source, or the
        // source itself once the gesture has left and come back (self-loop).
        const armedTarget = dropTargetId
          && (dropTargetId !== drawingConnectionFrom.sourceInstanceId || connectionExitedSourceRef.current)
          ? dropTargetId
          : null;
        if (armedTarget !== connectionHoverTargetRef.current) {
          connectionHoverTargetRef.current = armedTarget;
          if (armedTarget) haptic('connectionTarget', { force: true });
        }
        // Drives ConnectionDrawOverlay's target glow. Written every move, not
        // only on change, so a value left behind by an abandoned draw can't
        // outlive the first move of the next one (the setter skips no-ops).
        useCanvasUIStore.getState().setConnectionDropTargetId(armedTarget);
      }
    } else if (isPanningRef.current && !pinchRef.current.active) {
      if (abstractionCarouselVisible) {
        setIsPanning(false);
        return;
      }

      // Mark that mouse has moved for tap detection
      if (!mouseMoved.current) {
        mouseMoved.current = true;
      }

      // Update velocity history synchronously to avoid race conditions
      const now = performance.now();
      const history = panVelocityHistoryRef.current;
      history.push({ x: e.clientX, y: e.clientY, time: now });
      // Keep only last 100ms
      const cutoff = now - 100;
      while (history.length > 0 && history[0].time < cutoff) {
        history.shift();
      }

      pendingPanUpdate.current = e;
      if (!panUpdateScheduled.current) {
        panUpdateScheduled.current = true;
        requestAnimationFrame(() => {
          panUpdateScheduled.current = false;
          const e = pendingPanUpdate.current;
          const ps = panStartRef.current;
          if (!e || !ps?.x || !ps?.y) return;

          const now = performance.now();
          const dt = Math.max(1, now - (lastPanSampleRef.current.time || now));
          const touchPanMultiplier = (touchSettingsRef.current?.panSensitivity ?? 0.5) * 2;
          const dragSensitivity = panSourceRef.current === 'touch'
            ? TOUCH_PAN_DRAG_SENSITIVITY * touchPanMultiplier
            : PAN_DRAG_SENSITIVITY;
          const dxInput = (e.clientX - ps.x) * dragSensitivity;
          const dyInput = (e.clientY - ps.y) * dragSensitivity;
          const maxX = 0;
          const maxY = 0;
          const minX = viewportSize.width - canvasSize.width * zoomLevelRef.current;
          const minY = viewportSize.height - canvasSize.height * zoomLevelRef.current;
          let appliedDx = 0;
          let appliedDy = 0;
          // setPanOffset (transform.setPan) runs this updater synchronously, so
          // appliedDx/appliedDy are final once it returns. Keep the updater pure.
          setPanOffset(prev => {
            const targetX = prev.x + dxInput;
            const targetY = prev.y + dyInput;
            const clampedX = Math.min(Math.max(targetX, minX), maxX);
            const clampedY = Math.min(Math.max(targetY, minY), maxY);
            appliedDx = clampedX - prev.x;
            appliedDy = clampedY - prev.y;
            return { x: clampedX, y: clampedY };
          });
          if (appliedDx !== 0 || appliedDy !== 0) {
            setPanStart({ x: e.clientX, y: e.clientY });
          }

          if (Math.abs(appliedDx) > 0.01 || Math.abs(appliedDy) > 0.01) {
            // Calculate instantaneous velocity for reference
            lastPanVelocityRef.current = {
              vx: appliedDx / dt,
              vy: appliedDy / dt
            };
          } else {
            lastPanVelocityRef.current = { vx: 0, vy: 0 };
          }
          lastPanSampleRef.current = { time: now };
        });
      }
    }

    // (Removed per-move extra smoothing to avoid double updates)
  };

  /**
   * Handles mousedown to initiate drags, panning, edge creation, and selection.
   *
   * Button routing:
   * - **Right-click (button 2)**: exits immediately; the native context menu handles it.
   * - **Middle-click (button 1, zoom enabled)**: locks the pointer and starts the
   *   zoom-by-vertical-drag gesture.
   * - **Primary (button 0)**: hit-tests against nodes and edges to decide whether to
   *   start a node drag, an edge-creation drag, or a canvas pan. Also begins a
   *   rubber-band selection box if the click lands on empty canvas.
   *
   * @param {MouseEvent} e - The mousedown event from the SVG element.
   */
  async function handleMouseDown(e) {
    const { stopZoomMomentum, stopTrackpadZoom, middleMouseZoomEnabled, stopPanMomentum, activeGraphId, abstractionCarouselVisible, middleMouseZoomRef, isPanningOrZooming, containerRef, panelResizeControlRef, clickTimeoutIdRef, potentialClickNodeRef, isDoublePress, ignoreCanvasClick, isMouseDown, lastMousePosRef, mouseDownPosition, startedOnNode, mouseMoved, clearHoverImmediate, panOffsetRef, zoomLevelRef, canvasSize, beginMarquee, setPanStart, setIsPanning, lastPanVelocityRef, lastPanSampleRef, panSourceRef, isTouchDeviceRef, panVelocityHistoryRef } = ctxRef.current;
    // Ignore right-clicks (button === 2) so context menu can handle them without locking canvas panning
    if (e && e.button === 2) {
      try { e.preventDefault(); e.stopPropagation(); } catch { }
      return;
    }
    // Any press on the canvas halts a settling trackpad zoom — stopPanMomentum
    // deliberately leaves the zoom glide alone (see its comment), so stop it here.
    // Touch presses are handled in useCanvasTouch's touchstart.
    if (!e?.touches) {
      stopZoomMomentum();
      stopTrackpadZoom();
    }
    // Middle-button: start the zoom-by-drag gesture when enabled, suppressing browser autoscroll.
    // When disabled, plain middle-button falls through to the regular pan path.
    if (e && e.button === 1 && middleMouseZoomEnabled) {
      try { e.preventDefault(); e.stopPropagation(); } catch { }
      stopPanMomentum();
      if (!activeGraphId || abstractionCarouselVisible) return;
      middleMouseZoomRef.current = {
        anchorX: e.clientX,
        anchorY: e.clientY,
        moved: false,
        nodePrototypeId: null,
        nodeName: null,
      };
      isPanningOrZooming.current = true;
      try { containerRef.current?.requestPointerLock?.({ unadjustedMovement: true }); } catch { }
      return;
    }
    stopPanMomentum();
    if (!activeGraphId || abstractionCarouselVisible) return;
    // On touch/mobile: allow two-finger pan to bypass resizer/canvas checks
    if (e.touches && e.touches.length >= 2) {
      return;
    }
    // If user started on a resizer, do not start canvas panning
    if (panelResizeControlRef.current?.isDragging?.()) return;
    // Clear any pending single click on a node
    if (clickTimeoutIdRef.current) {
      clearTimeout(clickTimeoutIdRef.current);
      clickTimeoutIdRef.current = null;
      potentialClickNodeRef.current = null;
    }
    // A press on bare canvas ends any run of clicks on a Thing or a group
    // title, so the next press on one starts a fresh run rather than completing
    // a pair the user broke off in between.
    isDoublePress(null, e.clientX ?? 0, e.clientY ?? 0, 0);

    // NOTE: the connection selection is deliberately NOT cleared here. Panning must
    // preserve it — a pointer-down on bare canvas is the start of a gesture that may
    // turn out to be a pan, and killing the selection on press made the pie menu
    // vanish the instant you tried to drag the view around it. Click-off dismissal
    // now lives in handleCanvasClick, which runs on release and can tell a pan from
    // a click (ignoreCanvasClick).

    // Clear a stale ignoreCanvasClick left over from a previous element-claimed
    // click. Edge hitboxes (and the group title) raise the flag *and*
    // stopPropagation, so handleCanvasClick never runs to consume it — it then
    // survives to swallow the NEXT bare-canvas click, which is the one meant to
    // dismiss the connection control panel. That's the "first dismiss takes two
    // clicks" bug: click one only clears the flag. Only presses that genuinely
    // start on bare canvas clear it — element handlers raise the flag during the
    // click that follows their own mousedown, so theirs is left intact. Mirrors
    // handleTouchStartCanvas in useCanvasTouch.js, which already does this.
    const startedOnBareCanvas = (
      (e.target?.tagName === 'svg' && e.target.classList?.contains('canvas')) ||
      (e.target?.tagName === 'DIV' && e.target.classList?.contains('canvas-area'))
    );
    if (startedOnBareCanvas) {
      ignoreCanvasClick.current = false;
    }

    isMouseDown.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    mouseDownPosition.current = { x: e.clientX, y: e.clientY };
    startedOnNode.current = false;
    mouseMoved.current = false;
    // PERFORMANCE: Clear all hover states once at interaction start instead of every frame during drag
    clearHoverImmediate();

    if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current.getBoundingClientRect();
      const { x: startX, y: startY } = clientToCanvas(e.clientX, e.clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
      beginMarquee(startX, startY);
      return;
    }
    setPanStart({ x: e.clientX, y: e.clientY });
    setIsPanning(true);
    lastPanVelocityRef.current = { vx: 0, vy: 0 };
    lastPanSampleRef.current = { time: performance.now() };
    panSourceRef.current = isTouchDeviceRef.current ? 'touch' : 'mouse';
    panVelocityHistoryRef.current = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
  };
  /**
   * Handles mouseup to finalize drags, connections, pan momentum, and selection.
   *
   * Protected by a re-entry guard (`handleMouseUpInProgressRef`) because the event
   * fires on both the SVG element and the window capture listener in the same tick.
   * Branches:
   * - **Middle-mouse release**: ends the pointer-lock zoom gesture; if the cursor
   *   never moved and landed on a node, opens that node's right-panel tab.
   * - **Node drag end**: signals `SaveCoordinator` that the interaction is done,
   *   then commits the final position to the store.
   * - **Edge creation end**: if the cursor lifted over a valid target node, creates
   *   the edge; otherwise discards the in-progress connection.
   * - **Pan momentum**: launches a momentum animation from the recorded velocity history.
   * - **Selection box end**: finalizes the rubber-band selection.
   *
   * @param {MouseEvent} e - The mouseup event.
   */
  async function handleMouseUp(e) {
    const { middleMouseZoomRef, isPanningOrZooming, storeActions, rightPanelExpanded, handleMouseUpInProgressRef, activeGraphId, longPressTimeout, setLongPressingInstanceId, mouseInsideNode, drawingConnectionFrom, connectionDrawAbandonedRef, wasDrawingConnection, nodes, isInsideNode, findGroupTitleAtPoint, connectionExitedSourceRef, setDrawingConnectionFrom, connectionHoverTargetRef, draggingNodeInfoRef, dragPhaseRef, ignoreCanvasClick, nodeDrag, graphsMap, groupStructure, gridSize, selectionStartRef, mouseMoved, justCompletedBoxSelectRef, containerRef, panOffsetRef, zoomLevelRef, canvasSize, clampCoordinates, updateMarquee, endMarquee, isPanningRef, panStartRef, panSourceRef, panVelocityHistoryRef, lastPanVelocityRef, startPanMomentum, panMomentumRef, stopPanMomentum, setIsPanning, lastPanSampleRef, isMouseDown, startedOnNode, armGestureBlock, scheduleGestureBlockClear } = ctxRef.current;

    // console.log('[Mouse Up] Called, history length:', panVelocityHistoryRef.current.length, 'Stack:', new Error().stack.split('\n').slice(1, 4).join('\n'));

    // Middle-mouse release: end the zoom gesture. If it never moved and started on a node,
    // treat it like a double-click and open that node's right-panel tab.
    if (middleMouseZoomRef.current) {
      const state = middleMouseZoomRef.current;
      middleMouseZoomRef.current = null;
      isPanningOrZooming.current = false;
      try { document.exitPointerLock?.(); } catch { }
      if (!state.moved && state.nodePrototypeId) {
        storeActions.openRightPanelNodeTab(state.nodePrototypeId, state.nodeName);
        if (!rightPanelExpanded) storeActions.setRightPanelExpanded(true);
      }
      return;
    }

    // Atomic re-entry guard. Without this, window-capture pointerup +
    // React onMouseUp/onTouchEnd would all run this body in the same tick,
    // double-finalizing connections, drags, and selection boxes.
    if (handleMouseUpInProgressRef.current) return;
    handleMouseUpInProgressRef.current = true;
    try {

      if (!activeGraphId) return;
      clearTimeout(longPressTimeout.current);
      setLongPressingInstanceId(null); // Clear ID
      mouseInsideNode.current = false;

      // Finalize drawing connection. Re-entry already guarded at top of
      // handleMouseUp by handleMouseUpInProgressRef.
      if (drawingConnectionFrom && !connectionDrawAbandonedRef.current) {
        wasDrawingConnection.current = true; // Prevent PlusSign from appearing
        // Check nodes first, then fall back to group title areas
        let targetNodeData = nodes.find(n => !n.isGroupAnchor && isInsideNode(n, e.clientX, e.clientY));
        let targetId = targetNodeData?.id;

        // If no node hit, check group title areas for thing groups
        if (!targetId) {
          const hitGroup = findGroupTitleAtPoint(e.clientX, e.clientY);
          if (hitGroup) {
            targetId = hitGroup.anchorInstanceId;
          }
        }

        console.log('Connection end:', {
          clientX: e.clientX,
          clientY: e.clientY,
          targetId,
          sourceId: drawingConnectionFrom.sourceInstanceId
        });

        if (targetId && targetId === drawingConnectionFrom.sourceInstanceId && connectionExitedSourceRef.current) {
          // Self-loop gesture: exited source bounds then returned — ask to confirm.
          haptic('connectionMade', { force: true });
          setSelfLoopDialog({
            sourceInstanceId: targetId,
            position: { x: e.clientX, y: e.clientY }
          });
        } else if (targetId && targetId !== drawingConnectionFrom.sourceInstanceId) {
          // Only when the gesture landed on something. Releasing over empty
          // canvas makes no edge, so the detent stream just stops — silence is
          // the honest signal that nothing was connected.
          haptic('connectionMade', { force: true });
          const sourceId = drawingConnectionFrom.sourceInstanceId;

          // Allow multiple parallel edges between the same nodes
          // The curve offset rendering will display them properly
          const newEdgeId = uuidv4();
          const newEdgeData = { id: newEdgeId, sourceId, destinationId: targetId };
          // The drawn line morphs into the new connection rather than vanishing.
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            queueEdgeHandoff(newEdgeId,
              { x: drawingConnectionFrom.startX, y: drawingConnectionFrom.startY },
              clientToCanvas(e.clientX, e.clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize));
          }
          storeActions.addEdge(activeGraphId, newEdgeData);
        }
        setDrawingConnectionFrom(null);
        connectionExitedSourceRef.current = false;
        connectionHoverTargetRef.current = null;
      }

      // Drag finalization (delegated to useNodeDrag hook).
      // Read from refs, not state: setDraggingNodeInfo's React commit may not
      // have flushed by the time the window-capture pointerup arrives. The
      // dragPhaseRef === 'dragging' check is also handleDragEnd's own atomic
      // dedup, but we re-check here to skip the surrounding UI work too
      // (group-drop dialog, ignoreCanvasClick).
      if (draggingNodeInfoRef.current && dragPhaseRef.current === 'dragging') {
        // Any drag-release must suppress the synthetic canvas click the browser
        // fires immediately after mouseup — otherwise handleCanvasClick spawns
        // a plus sign at the drop point. The existing
        // `mouseMoved && !startedOnNode` guard further down doesn't catch
        // thing-group drags (startedOnNode is true for those), so set the
        // suppression unconditionally here.
        ignoreCanvasClick.current = true;
        const clientX = e.clientX || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0);
        const clientY = e.clientY || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0);
        const dragResult = nodeDrag.handleDragEnd(clientX, clientY, graphsMap);

        // Group-drop detection UI (stays in NodeCanvas — controls dialog)
        if (dragResult.checkGroupDrop && dragResult.draggedNodeIds.length > 0) {
          const graphData = activeGraphId ? graphsMap.get(activeGraphId) : null;
          const groups = graphData?.groups ? Array.from(graphData.groups.values()) : [];

          if (groups.length > 0) {
            const primaryNodeId = dragResult.primaryNodeId;
            const primaryNode = nodes.find(n => n.id === primaryNodeId);

            if (primaryNode) {
              const primaryDims = getNodeDimensions(primaryNode, false, null);
              // Use finalPositions (accurate during zoom-restore when store isn't flushed yet)
              const fp = dragResult.finalPositions?.get(primaryNodeId);
              const posX = fp ? fp.x : primaryNode.x;
              const posY = fp ? fp.y : primaryNode.y;
              const primaryCenterX = posX + primaryDims.currentWidth / 2;
              const primaryCenterY = posY + primaryDims.currentHeight / 2;

              const targetGroup = findGroupDropTarget({
                point: { x: primaryCenterX, y: primaryCenterY }, excludeNodeId: primaryNodeId,
                groups, nodes, groupDepths: groupStructure.groupDepths, gridSize,
              });
              if (targetGroup) {
                setAddToGroupDialog(groupDropDialogFor(targetGroup, dragResult.draggedNodeIds,
                  groupStructure.parentGroupIds, { x: e.clientX, y: e.clientY }));
              }
            }
          }
        }
      }

      // Finalize selection box
      if (selectionStartRef.current) {
        // Only a marquee that actually dragged swallows its trailing click. A
        // zero-drag Cmd+click also lands here and should keep behaving like the
        // plain click it is. Read before the reset further down in this handler.
        if (mouseMoved.current) justCompletedBoxSelectRef.current = true;
        // Finish on the release point and retire the marquee synchronously: the
        // control-panel effect reads selectionStart as "still box-selecting", so
        // it must clear on release for the panel to open.
        const rect = containerRef.current.getBoundingClientRect();
        const { x: rawX, y: rawY } = clientToCanvas(e.clientX, e.clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
        const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);
        updateMarquee(currentX, currentY);
        endMarquee();
      }

      // Finalize panning state.
      // Use refs (not state): React 18 batches updates; after a pinch→1-finger transition
      // sets isPanning=true via setIsPanning, the next touchend can fire before React commits,
      // leaving the latest closure with stale isPanning=false. Refs always reflect the current
      // synchronously-set value.
      let momentumStarted = false;
      if (isPanningRef.current && panStartRef.current) {
        const source = panSourceRef.current;
        // Glide (momentum panning) is opt-out per input modality, each with its
        // own toggle + strength in Settings → Input: touch glide under Touch,
        // trackpad two-finger pan glide under Trackpad, click-drag pan glide
        // under Mouse. All default to enabled.
        const settings = useGraphStore.getState();
        const glideAllowed =
          source === 'touch' ? (settings.touchSettings?.glideEnabled !== false)
          : source === 'trackpad' ? (settings.touchSettings?.trackpadPanGlideEnabled !== false)
          : source === 'mouse' ? (settings.mouseSettings?.glideEnabled !== false)
          : false;
        const glideStrength = source === 'touch'
          ? (settings.touchSettings?.glideStrength ?? 0.5)
          : source === 'trackpad'
          ? (settings.touchSettings?.trackpadPanGlideStrength ?? TRACKPAD_PAN_GLIDE_STRENGTH_DEFAULT)
          : (settings.mouseSettings?.glideStrength ?? 0.5);
        if (glideAllowed) {
          const isTouch = source === 'touch';
          // Mouse and touch are motion-driven (events only fire while moving), so
          // a pause before release should suppress glide. Trackpad is not.
          const motionDriven = isTouch || source === 'mouse';
          const history = panVelocityHistoryRef.current;
          let vx = 0, vy = 0;
          // For motion-driven input, use the gap between the last move and release
          // as the "held still" signal: move events only fire on motion, so a large
          // gap means the pointer paused before lifting — no momentum. Anchoring the
          // velocity window on release time directly (instead of on the last sample)
          // is too brittle, since a fast flick routinely has a 30-50ms lag between
          // the last move and pointer-up.
          const lastSample = history.length > 0 ? history[history.length - 1] : null;
          const gapSinceLastSample = lastSample ? (performance.now() - lastSample.time) : Infinity;
          const heldStill = motionDriven
            ? gapSinceLastSample > TOUCH_MOMENTUM_STATIONARY_GAP_MS
            : false;

          if (history.length >= 2 && !heldStill) {
            const last = lastSample;
            const cutoff = last.time - TOUCH_MOMENTUM_VELOCITY_WINDOW_MS;
            const recent = history.filter(s => s.time >= cutoff);
            if (recent.length >= 2) {
              const first = recent[0];
              const dt = last.time - first.time;
              if (dt > 1) {
                vx = (last.x - first.x) / dt;
                vy = (last.y - first.y) / dt;
              }
            }
          }

          // Fallback to instantaneous only for trackpad — for motion-driven input,
          // an empty window or held-still pointer means we want NO momentum.
          if (source === 'trackpad' && vx === 0 && vy === 0) {
            vx = lastPanVelocityRef.current.vx;
            vy = lastPanVelocityRef.current.vy;
          }

          // Mouse drag-panning applies PAN_DRAG_SENSITIVITY to pointer movement, but
          // the velocity above is measured from raw client coords. Scale it so the
          // glide continues at the same visual speed the canvas was moving.
          if (source === 'mouse') {
            vx *= PAN_DRAG_SENSITIVITY;
            vy *= PAN_DRAG_SENSITIVITY;
          }

          const speed = Math.hypot(vx, vy);
          const launchThreshold = isTouch ? TOUCH_MOMENTUM_LAUNCH_MIN_SPEED : PAN_MOMENTUM_MIN_SPEED;
          if (speed >= launchThreshold) {
            momentumStarted = startPanMomentum(vx, vy, source, glideStrength);
          }
        }
      }
      // Only stop momentum here if no glide is currently active. On touch,
      // handleMouseUp runs twice (React onTouchEnd + the document touchend
      // listener attached in useCanvasTouch). The first call launches momentum
      // and clears panSourceRef; the second call sees a null source, falls
      // through with momentumStarted=false, and would otherwise kill the glide
      // the first call just started. The re-entry guard above only catches
      // synchronous re-entrancy, not sequential calls in the same tick.
      if (!momentumStarted && !panMomentumRef.current.active) {
        stopPanMomentum();
        isPanningOrZooming.current = false; // Clear the flag when panning ends
      }
      setIsPanning(false);
      panSourceRef.current = null; // Reset pan source
      lastPanVelocityRef.current = { vx: 0, vy: 0 };
      panVelocityHistoryRef.current = [];
      lastPanSampleRef.current = { time: performance.now() };
      isMouseDown.current = false;
      // If mouse moved during a canvas pan (not on a node), suppress the canvas click
      // to prevent the plus sign from appearing after a drag
      if (mouseMoved.current && !startedOnNode.current) {
        ignoreCanvasClick.current = true;
        // Arm the post-gesture dead zone so a synthetic pointerup/click on PlusSign
        // (lifting finger lands on the button) is also rejected, not just the canvas tap.
        // Mouse pans use a shorter dead zone (150ms) — ignoreCanvasClick already handles
        // the first post-pan click; 350ms creates noticeable plus-sign spawn delay.
        armGestureBlock();
        scheduleGestureBlockClear(150);
      }
      // Reset mouseMoved.current immediately after mouse up logic is done
      // This prevents race condition with canvas click handler
      mouseMoved.current = false;
    } finally {
      handleMouseUpInProgressRef.current = false;
    }
  };
  const handleMouseUpCanvas = (e) => {
    // Stop propagation to prevent duplicate handleMouseUp calls from parent container
    e.stopPropagation();
    // Delegate to the main handleMouseUp to ensure consistent cleanup
    handleMouseUp(e);
  };

  const handleCanvasClick = (e) => {
    const {
      justCompletedBoxSelectRef, ignoreCanvasClick, gestureBlockRef, selectedInstanceIds, plusSign,
      semanticOrbitActive, exitOrbitMode, draggingNodeInfo, drawingConnectionFrom, nodeNamePrompt,
      activeGraphId, findEdgeAtClientPoint, selectedEdgeIds, selectedEdgeId, selectEdgeFromClick,
      connectionControlPanelShouldShow, connectionControlPanelVisible, edgePieMenuVisible, edgePieMenuRendered,
      setConnectionControlPanelVisible, setEdgePieMenuVisible, storeActions, wasDrawingConnection,
      isPieMenuActionInProgress, selectedGroup, groupControlPanelShouldShow, groupControlPanelVisible,
      setGroupControlPanelVisible, setSelectedGroup, abstractionCarouselVisible, selectedNodeIdForPieMenu,
      carouselAnimationState, justCompletedCarouselExit, carouselExitInProgressRef, containerRef, panOffsetRef,
      zoomLevelRef, canvasSize, setPlusSign,
    } = ctxRef.current;
    // The click that closes a marquee gesture isn't a click on empty canvas — it
    // must not deselect what the marquee just selected, exit orbit mode, or spawn
    // a plus sign. Consumed once, so the next real click behaves normally.
    if (justCompletedBoxSelectRef.current) {
      justCompletedBoxSelectRef.current = false;
      ignoreCanvasClick.current = false;
      return;
    }
    // Suppress canvas taps that arrive inside the post-pinch dead zone — otherwise
    // a finger lifting onto bare canvas after a multi-touch gesture spawns a stray PlusSign.
    // Allow deselection through even within the dead zone: the block was designed to suppress
    // plus-sign spawn, not to block deliberate click-off-to-deselect.
    if (gestureBlockRef.current) {
      if (selectedInstanceIds.size === 0 && !plusSign) return;
      // Fall through so selection-clear or plus-sign-dismiss code below can run.
    }
    // Exit semantic orbit mode on canvas click — but not after a pan.
    // ignoreCanvasClick is set true by handleMouseUp when a pan occurred.
    if (semanticOrbitActive) {
      if (ignoreCanvasClick.current) {
        // Clear the flag so the next click works, but don't exit orbit
        ignoreCanvasClick.current = false;
      } else {
        exitOrbitMode();
      }
      return;
    }

    // A click that lands on bare canvas but inside a connection's grab radius
    // selects that connection. The transparent SVG stroke is narrower than the
    // radius the hover highlight already lights up at, so without this a click
    // that visually lands "on" the line falls through to deselect / plus-sign —
    // the line appears to ignore you. Prefer the hover ref (already nearest-wins)
    // and fall back to the geometry for clicks that never dwelled.
    // Clicking the already-selected connection still falls through, so a second
    // click deselects.
    // A node-group's interior is canvas too: a click there picks a connection,
    // deselects or spawns a plus sign exactly as it would outside the group.
    const groupInteriorId = e.target.classList?.contains('node-group-interior')
      ? e.target.closest('[data-group-id]')?.getAttribute('data-group-id') ?? null
      : null;
    const isBareCanvasTarget = (
      (e.target.tagName === 'svg' && e.target.classList.contains('canvas')) ||
      (e.target.tagName === 'DIV' && e.target.classList.contains('canvas-area')) ||
      groupInteriorId !== null
    );
    if (isBareCanvasTarget && !ignoreCanvasClick.current && !draggingNodeInfo
      && !drawingConnectionFrom && !nodeNamePrompt.visible && activeGraphId) {
      const clickedEdgeId = useCanvasUIStore.getState().hoveredEdgeInfo?.edgeId
        || findEdgeAtClientPoint(e.clientX, e.clientY, 'mouse')?.edgeId;
      const alreadySoleSelection = clickedEdgeId
        && selectedEdgeIds.size <= 1
        && (selectedEdgeId === clickedEdgeId || selectedEdgeIds.has(clickedEdgeId));
      if (clickedEdgeId && !alreadySoleSelection) {
        selectEdgeFromClick(clickedEdgeId, e);
        return;
      }
    }

    // Priority: check the connection panel/menu before the generic selection handling
    // below, so clicking off always dismisses them. Not before the pan guards though —
    // the synthetic click that ends a pan must leave the connection selected.
    if (connectionControlPanelShouldShow || connectionControlPanelVisible || edgePieMenuVisible || edgePieMenuRendered || selectedEdgeId || selectedEdgeIds.size > 0) {
      if (ignoreCanvasClick.current) {
        ignoreCanvasClick.current = false;
        return;
      }
      if (connectionControlPanelShouldShow || connectionControlPanelVisible) {
        setConnectionControlPanelVisible(false);
      }
      if (edgePieMenuVisible || edgePieMenuRendered) {
        setEdgePieMenuVisible(false);
      }
      storeActions.setSelectedEdgeId(null);
      storeActions.clearSelectedEdgeIds();
      return;
    }

    if (wasDrawingConnection.current) {
      wasDrawingConnection.current = false;
      return;
    }
    if (isPieMenuActionInProgress) {
      return;
    }
    if (e.target.closest('g[data-plus-sign="true"]')) return;
    // Prevent canvas click when clicking on PieMenu elements
    if (e.target.closest('.pie-menu')) {
      return;
    }
    // Allow clicks on the canvas SVG, the canvas-area container div or a node-group's interior
    if (!isBareCanvasTarget) return;

    // For canvas clicks, we don't need to wait for the CLICK_DELAY since we're not dealing with double-click detection
    // Only check if we're in a state that should block canvas interactions
    if (draggingNodeInfo || drawingConnectionFrom || nodeNamePrompt.visible || !activeGraphId) {
      return;
    }
    if (ignoreCanvasClick.current) {
      ignoreCanvasClick.current = false;
      // Only bail if there's nothing to dismiss — otherwise fall through so the
      // first click after a pan/glide doesn't waste itself just clearing the flag.
      // selectedGroup must be included here too: selecting a group clears
      // selectedInstanceIds, so without this the very next click (meant to
      // deselect the group) gets silently swallowed and a second click is needed.
      if (selectedInstanceIds.size === 0 && !plusSign && !selectedGroup) return;
    }

    // Close Group panel on click-off like other panels
    if (groupControlPanelShouldShow || groupControlPanelVisible || selectedGroup) {
      if (groupControlPanelShouldShow || groupControlPanelVisible) {
        setGroupControlPanelVisible(false);
      }
      if (selectedGroup) {
        setSelectedGroup(null);
      }
      return;
    }

    // Explicitly close Connection Panel if visible
    // (Moved to top of function - removed from here)

    // DEFENSIVE: If carousel is visible but pie menu isn't, force close carousel
    if (abstractionCarouselVisible && !selectedNodeIdForPieMenu) {

      useCanvasUIStore.getState().dispatchPie({ type: 'CAROUSEL_TEARDOWN' });
      return;
    }

    // If carousel is visible and exiting, don't handle canvas clicks
    if (abstractionCarouselVisible && carouselAnimationState === 'exiting') {

      return;
    }

    if (selectedInstanceIds.size > 0) {
      // Don't clear selection if we just completed a carousel exit
      if (justCompletedCarouselExit) {

        return;
      }

      // Don't clear selection if carousel exit is in progress
      if (carouselExitInProgressRef.current) {

        return;
      }

      // Deselect and end any preview; the pie follows (PREVIEW_SET).
      useCanvasUIStore.getState().dispatchPie({ type: 'PREVIEW_SET', id: null, selection: [] });
      return;
    }

    // Clear selected edge when clicking on empty canvas
    if ((selectedEdgeId || selectedEdgeIds.size > 0) && !useCanvasUIStore.getState().hoveredEdgeInfo) {
      storeActions.setSelectedEdgeId(null);
      storeActions.clearSelectedEdgeIds();
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const { x: mouseX, y: mouseY } = clientToCanvas(e.clientX, e.clientY, rect, panOffsetRef.current, zoomLevelRef.current, canvasSize);
    // Prevent plus sign if pie menu is active or about to become active or hovering an edge
    if (!plusSign && selectedInstanceIds.size === 0 && !useCanvasUIStore.getState().hoveredEdgeInfo) {
      // clientX/Y and groupInteriorId are for the "Add to group?" offer once it lands (plusSignMorph).
      setPlusSign({ x: mouseX, y: mouseY, mode: 'appear', tempName: '', clientX: e.clientX, clientY: e.clientY, groupInteriorId });
    } else {
      if (nodeNamePrompt.visible) return;
      // A plus sign that's morphing into a node is committed — don't let a
      // stray/ghost canvas click cancel it mid-animation. On touch, tapping the
      // UnifiedSelector's submit/card fires a delayed synthesized click ~300ms
      // later that lands on the (now-uncovered) canvas; without this guard it
      // flips the morph to 'disappear' and the node is silently lost.
      if (plusSign && (plusSign.mode === 'morph' || plusSign.mode === 'preparing' || plusSign.mode === 'landed')) return;
      setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
    }
  };

  return {
    handleNodeMouseDown,
    pendingLabelClear,
    labelClearScheduled,
    pendingPanUpdate,
    panUpdateScheduled,
    pendingHoverCheck,
    hoverCheckScheduled,
    beginConnectionDrawFromNode,
    handleKeyboardPanTravel,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleMouseUpCanvas,
    handleCanvasClick,
  };
}
