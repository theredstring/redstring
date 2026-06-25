
import { useRef, useEffect } from 'react';
import { useWindowGestureEnd } from './useWindowGestureEnd';

// Constants locally defined or passed? 
// Some constants seem global. I should duplicates them or export/import them.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
// Slider 0.5 maps to this base easing factor (current "good default").
// Slider value scales linearly: actual = clamp(0.05, slider * 2 * BASE, 1.0).
const TOUCH_PINCH_SENSITIVITY_BASE = 0.8;
const TOUCH_PINCH_CENTER_SMOOTHING = 0.1;
const MOVEMENT_THRESHOLD = 6;
const TOUCH_MOVEMENT_THRESHOLD = 12; // Higher than mouse
// Touch long-press is longer than the mouse equivalent (200ms) — fingers
// typically rest on the screen longer than a mouse click holds the button,
// and a too-short long-press promotes innocent taps into accidental drags.
// Must be >= NODE_DOUBLE_TAP_MS so a deliberate double-tap can't trip the
// drag-start during the first hold.
const LONG_PRESS_DURATION = 450;
const NODE_DOUBLE_TAP_MS = 400;

export const useCanvasTouch = ({
    containerRef,
    panOffset,
    panOffsetRef,
    zoomLevel,
    zoomLevelRef,
    canvasSize,
    isPaused,
    activeGraphId,
    startDragForNode,
    handleMouseMove,
    handleMouseUp,
    handleMouseDown,
    setPanStart,
    setIsPanning,
    setPanOffset,
    setZoomLevel,
    setPanAndZoom,
    stopPanMomentum,
    storeActions,
    selectedInstanceIds,
    setSelectedInstanceIds,
    selectedEdgeId,
    selectedEdgeIds,
    plusSign,
    setPlusSign,
    nodeNamePrompt,
    previewingNodeId,
    selectedNodeIdForPieMenu,
    setSelectedNodeIdForPieMenu,
    drawingConnectionFrom,
    setDrawingConnectionFrom,
    draggingNodeInfo,
    setDraggingNodeInfo,
    draggingNodeInfoRef,
    isAnimatingZoomRef,
    isPanningOrZooming,
    panSourceRef,
    panVelocityHistoryRef,
    isMouseDown,
    mouseMoved,
    startedOnNode,
    mouseInsideNode,
    mouseDownPosition,
    recentlyPanned,
    setLastInteractionType,
    groupControlPanelShouldShow,
    groupControlPanelVisible,
    setGroupControlPanelVisible,
    connectionControlPanelShouldShow,
    connectionControlPanelVisible,
    setConnectionControlPanelVisible,
    selectedGroup,
    setSelectedGroup,
    isInsideNode,
    getNodeDimensions,
    clampCoordinates,
    isTouchDeviceRef,
    suppressNextMouseDownRef,
    nodes,
    pinchRef,
    pinchSmoothingRef,
    ignoreCanvasClick,
    armGestureBlock,
    scheduleGestureBlockClear,
    touchSettings,
    nodeLiftDelay,
}) => {
    // --- Refs moved to hook ---
    const lastTouchRef = useRef({ x: 0, y: 0 });

    const touchState = useRef({
        isDragging: false,
        dragNodeId: null,
        startTime: 0,
        startPosition: { x: 0, y: 0 },
        currentPosition: { x: 0, y: 0 },
        hasMovedPastThreshold: false,
        longPressTimer: null,
        nodeElement: null,
        longPressReady: false,
        dragOffset: null
        // nodeData removed - use dragNodeId for fresh lookups to avoid stale closures
    });

    // Track most recent node tap for double-tap detection (mirrors mouse e.detail===2)
    const lastNodeTapRef = useRef({ id: null, ts: 0 });
    // Pending single-tap selection — deferred so a second tap can cancel it
    // before selection fires, matching the mouse CLICK_DELAY path.
    const pendingNodeTapRef = useRef(null);

    const suppressMouseDownResetTimeoutRef = useRef(null);

    const longPressingInstanceIdRef = useRef(null);
    const touchMultiPanRef = useRef(false);

    // Mirror selectedInstanceIds in a ref so the deferred single-tap selection
    // (fires 300ms after touchend) reads the latest value, not a stale closure.
    const selectedInstanceIdsRef = useRef(selectedInstanceIds);
    useEffect(() => { selectedInstanceIdsRef.current = selectedInstanceIds; });

    // Window-scoped pointer tracking for connection-draw and node-drag.
    // Element-routed events stop firing once the finger leaves the originating
    // node (or it's unmounted/re-rendered into the dragging block), and
    // bubble-phase document listeners can be short-circuited by element
    // stopPropagation. Window-scoped means: window pointermove keeps the
    // connection tip / drag position live regardless of which element is
    // under the cursor; useWindowGestureEnd (capture phase) guarantees the
    // release fires somewhere even if the finger ended up nowhere near the
    // source node (e.g. grid-snap drift during a drag).
    //
    // STABLE BOOLEAN dep on the move effect: drawingConnectionFrom is updated
    // to a new object on every move. Depending on the object directly would
    // detach + reattach the listener on every move — a tiny but real window
    // where a touch release could be missed.
    const handleMouseMoveRef = useRef(handleMouseMove);
    useEffect(() => { handleMouseMoveRef.current = handleMouseMove; });
    const handleMouseUpRef = useRef(handleMouseUp);
    useEffect(() => { handleMouseUpRef.current = handleMouseUp; });
    const isDrawingConnection = !!drawingConnectionFrom;
    const isDraggingNode = !!draggingNodeInfo;
    const hasActiveGesture = isDrawingConnection || isDraggingNode;
    useEffect(() => {
        if (!isDrawingConnection) return;
        const onPointerMove = (e) => {
            if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
            handleMouseMoveRef.current({
                clientX: e.clientX,
                clientY: e.clientY,
                stopPropagation: () => { },
                preventDefault: () => { }
            });
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
        };
    }, [isDrawingConnection]);

    // Single window+capture release listener for both gestures.
    // handleMouseUp dispatches internally via drawingConnectionFrom /
    // draggingNodeInfo state; the reentrancy guard in handleMouseUp dedups
    // against React onTouchEnd / onMouseUp firing the same release.
    useWindowGestureEnd(hasActiveGesture, (releaseEvent) => {
        handleMouseUpRef.current(releaseEvent);
    });

    // Reset touchState when an active gesture ends. handleNodeTouchEnd
    // (React onTouchEnd) is the normal cleanup path, but during drag the
    // node element is re-mounted into the dragging-render slot — touch
    // events that originated on the original element may not deliver to
    // any React handler. Without this effect, touchState.current.dragNodeId
    // stays set from the previous drag and:
    //   - handleTouchMoveCanvas's `if (... || touchState.current.dragNodeId)`
    //     guard blocks subsequent canvas pan
    //   - handleNodeTouchMove's threshold checks misread leftover state
    // Watching draggingNodeInfo + drawingConnectionFrom transitions catches
    // both drag-end and connection-draw-end paths.
    const prevGestureActiveRef = useRef(false);
    useEffect(() => {
        const wasActive = prevGestureActiveRef.current;
        const nowActive = hasActiveGesture;
        prevGestureActiveRef.current = nowActive;
        if (!wasActive || nowActive) return;
        // Gesture just ended — reset all touch-input state so the next
        // canvas pan / node touch starts from a clean slate.
        if (touchState.current.longPressTimer) {
            clearTimeout(touchState.current.longPressTimer);
        }
        if (touchState.current.nodeElement) {
            try {
                touchState.current.nodeElement.classList.remove('touch-active', 'long-press-active');
            } catch { }
        }
        touchState.current = {
            isDragging: false,
            dragNodeId: null,
            startTime: 0,
            startPosition: { x: 0, y: 0 },
            currentPosition: { x: 0, y: 0 },
            hasMovedPastThreshold: false,
            longPressTimer: null,
            nodeElement: null,
            longPressReady: false,
            dragOffset: null
        };
        isMouseDown.current = false;
        startedOnNode.current = false;
        mouseInsideNode.current = false;
        longPressingInstanceIdRef.current = null;
    }, [hasActiveGesture]);

    // Latest-value ref of drawingConnectionFrom so the touch long-press timer
    // (captured at touchstart) can bail when connection-draw is in progress.
    const drawingConnectionFromRef = useRef(drawingConnectionFrom);
    useEffect(() => { drawingConnectionFromRef.current = drawingConnectionFrom; });

    // Cancel the touch long-press timer the moment connection-draw starts.
    // Without this, a slow finger movement (>6px but <12px) triggers
    // connection-draw via the mouse path in NodeCanvas (which clears the
    // mouse timer but not ours), and the touch timer then fires startDragForNode
    // → triggerDragZoomOut concurrently with the active connection-draw.
    useEffect(() => {
        if (!drawingConnectionFrom) return;
        if (touchState.current.longPressTimer) {
            clearTimeout(touchState.current.longPressTimer);
            touchState.current.longPressTimer = null;
        }
    }, [drawingConnectionFrom]);

    // --- Helpers ---

    /** Check if a touch target is on the canvas surface (SVG, canvas-area bg) vs a UI overlay */
    const isCanvasSurfaceTarget = (target) => {
        if (!target || !containerRef.current) return true; // default to canvas
        // If the touch is directly on the canvas-area div itself, it's canvas
        if (target === containerRef.current) return true;
        // If the touch is inside the SVG (nodes, edges, canvas background), it's canvas
        const svg = containerRef.current.querySelector('svg');
        if (svg && (target === svg || svg.contains(target))) return true;
        // Everything else (panels, modals, selectors, buttons, overlays) is NOT canvas.
        // Many UI elements (UnifiedSelector, Panels) are DOM children of canvas-area
        // but positioned with fixed/absolute — they must not be intercepted.
        return false;
    };

    const normalizeTouchEvent = (e) => {
        // For touch end events, changedTouches has the final position where finger lifted
        const t = e.touches?.[0] || e.changedTouches?.[0];
        if (t) {
            return { clientX: t.clientX, clientY: t.clientY };
        }
        // Fallback to last known position
        return { clientX: lastTouchRef.current.x, clientY: lastTouchRef.current.y };
    };

    const setLongPressingInstanceId = (id) => {
        longPressingInstanceIdRef.current = id;
    };

    // --- Handlers ---

    const handleTouchStartCanvas = (e) => {
        // Don't intercept touches on UI overlays (panels, modals, buttons)
        if (!isCanvasSurfaceTarget(e.target)) return;

        // Reset stale ignoreCanvasClick from a previous tap/pan. Edge & node
        // touchstart handlers stopPropagation before this fires, so this
        // clears only for taps that genuinely start on bare canvas — leaving
        // element-claimed taps (which set the flag *after* this point) intact.
        if (ignoreCanvasClick) {
            ignoreCanvasClick.current = false;
        }

        if (e && e.cancelable) {
            e.preventDefault();
            e.stopPropagation();
        }
        // Only stop momentum if we're starting a new gesture with actual touches
        // Don't clear momentum during cleanup/end events
        if (e.touches && e.touches.length > 0) {
            stopPanMomentum();
        }
        isTouchDeviceRef.current = true;

        if (e.touches && e.touches.length >= 2) {
            // Pinch-to-zoom setup
            // Stop any momentum first
            stopPanMomentum();

            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dx = t2.clientX - t1.clientX;
            const dy = t2.clientY - t1.clientY;
            const dist = Math.hypot(dx, dy) || 1;
            const centerX = (t1.clientX + t2.clientX) / 2;
            const centerY = (t1.clientY + t2.clientY) / 2;
            const rect = containerRef.current.getBoundingClientRect();
            const worldX = (centerX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX;
            const worldY = (centerY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY;
            pinchRef.current = {
                active: true,
                startDist: dist,
                startZoom: zoomLevelRef.current,
                centerClient: { x: centerX, y: centerY },
                centerWorld: { x: worldX, y: worldY },
                lastCenterClient: { x: centerX, y: centerY },
                lastDist: dist
            };
            pinchSmoothingRef.current.lastFrameTime = performance.now();
            armGestureBlock?.();
            // Cancel any in-progress one-finger pan when second finger is placed
            isMouseDown.current = false;
            setIsPanning(false);
            setPanStart(null);
            // Removed global clickTimeoutIdRef access - assuming not critical for pinch start or handled by parent if needed. 
            // Actually, if we need to clear click timeout, we might need access. 
            // But clickTimeoutIdRef was used for double click logic for mouse usually.
            // Assuming handled by parent or acceptable minor regression in edge case.

            // potentialClickNodeRef.current = null; // Also omitted for simplicity unless critical

            touchMultiPanRef.current = false;
            return;
        }

        // Handle single touch - synthesize mouse event only once
        if (e.touches && e.touches.length === 1) {
            const t = e.touches[0];
            lastTouchRef.current = { x: t.clientX, y: t.clientY };
            isMouseDown.current = true;
            startedOnNode.current = false;
            mouseMoved.current = false;
            setPanStart({ x: t.clientX, y: t.clientY });
            panSourceRef.current = 'touch';
            // Attach document-level listeners to keep pan active even if finger leaves canvas
            try {
                const moveListener = (ev) => handleTouchMoveCanvas(ev);
                const endListener = (ev) => {
                    handleTouchEndCanvas(ev);
                    try {
                        document.removeEventListener('touchmove', moveListener, { passive: false });
                        document.removeEventListener('touchend', endListener, { passive: false });
                        document.removeEventListener('touchcancel', cancelListener, { passive: false });
                    } catch { }
                };
                const cancelListener = (ev) => {
                    handleTouchEndCanvas(ev);
                    try {
                        document.removeEventListener('touchmove', moveListener, { passive: false });
                        document.removeEventListener('touchend', endListener, { passive: false });
                        document.removeEventListener('touchcancel', cancelListener, { passive: false });
                    } catch { }
                };
                document.addEventListener('touchmove', moveListener, { passive: false });
                document.addEventListener('touchend', endListener, { passive: false });
                document.addEventListener('touchcancel', cancelListener, { passive: false });
            } catch { }
            const synthetic = {
                clientX: t.clientX,
                clientY: t.clientY,
                detail: 1,
                preventDefault: () => { try { e.preventDefault(); } catch { } },
                stopPropagation: () => { try { e.stopPropagation(); } catch { } }
            };
            handleMouseDown(synthetic);
        } else {
            // Fallback for other touch events
            const { clientX, clientY } = normalizeTouchEvent(e);
            lastTouchRef.current = { x: clientX, y: clientY };
            const synthetic = {
                clientX,
                clientY,
                ctrlKey: false,
                metaKey: false,
                preventDefault: () => { try { e.preventDefault(); } catch { } },
                stopPropagation: () => { try { e.stopPropagation(); } catch { } }
            };
            handleMouseDown(synthetic);
        }
    };

    const handleTouchMoveCanvas = (e) => {
        // Avoid per-move preventDefault/stopPropagation; rely on CSS `touch-action: none`

        // CRITICAL: If a node drag is active, let the document listener handle it exclusively
        if (touchState.current.isDragging || draggingNodeInfo || touchState.current.dragNodeId) {
            return; // Don't interfere with node drag
        }

        if (e.touches && e.touches.length >= 2) {
            // Initialize pinch if not already active
            if (!pinchRef.current.active) {
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const dx = t2.clientX - t1.clientX;
                const dy = t2.clientY - t1.clientY;
                const dist = Math.hypot(dx, dy) || 1;
                const centerX = (t1.clientX + t2.clientX) / 2;
                const centerY = (t1.clientY + t2.clientY) / 2;
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) {
                    const worldX = (centerX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX;
                    const worldY = (centerY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY;
                    pinchRef.current = {
                        active: true,
                        startDist: dist,
                        startZoom: zoomLevelRef.current,
                        centerClient: { x: centerX, y: centerY },
                        centerWorld: { x: worldX, y: worldY },
                        lastCenterClient: { x: centerX, y: centerY },
                        lastDist: dist
                    };
                    pinchSmoothingRef.current.lastFrameTime = performance.now();
                    armGestureBlock?.();
                    // Stop momentum and panning
                    stopPanMomentum();
                    isMouseDown.current = false;
                    setIsPanning(false);
                    setPanStart(null);
                }
            }

            // Touch-only pinch zoom (higher sensitivity), no two-finger pan on touch
            // Skip pinch zoom during drag to prevent interference with drag zoom animation
            if (draggingNodeInfoRef.current || isAnimatingZoomRef.current) return;
            isPanningOrZooming.current = true;
            const now = performance.now();
            const smoothing = pinchSmoothingRef.current;
            const lastTime = smoothing.lastFrameTime || now;
            const dt = Math.max(1, now - lastTime);
            smoothing.lastFrameTime = now;

            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const centerX = (t1.clientX + t2.clientX) / 2;
            const centerY = (t1.clientY + t2.clientY) / 2;
            const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
            pinchRef.current.centerClient = { x: centerX, y: centerY };
            const startDist = pinchRef.current.startDist || dist;
            const startZoom = pinchRef.current.startZoom || zoomLevelRef.current;
            const ratioFromStart = dist / (startDist || dist);
            const targetZoomRaw = startZoom * (ratioFromStart || 1);
            const pinchSlider = touchSettings?.zoomSensitivity ?? 0.7;
            const pinchSensitivity = Math.max(0.05, Math.min(1.0, pinchSlider * 2 * TOUCH_PINCH_SENSITIVITY_BASE));
            const easing = 1 - Math.pow(1 - pinchSensitivity, Math.min(6, dt / 16));
            // Atomic pan+zoom update: read prev values from refs and apply both
            // in a single DOM write to prevent the one-frame anchor jump that
            // sequential setZoom + setPan produces.
            {
                const prevZoom = zoomLevelRef.current;
                const prevPan = panOffsetRef.current;
                const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoomRaw || prevZoom));
                const newZoom = prevZoom + (targetZoom - prevZoom) * easing;
                if (!containerRef.current) {
                    pinchRef.current.lastDist = dist;
                    pinchRef.current.lastCenterClient = { x: centerX, y: centerY };
                    return;
                }
                const rect = containerRef.current.getBoundingClientRect();
                const rawWorldX = (centerX - rect.left - prevPan.x) / prevZoom + canvasSize.offsetX;
                const rawWorldY = (centerY - rect.top - prevPan.y) / prevZoom + canvasSize.offsetY;
                const prevWorld = pinchRef.current.centerWorld;
                const worldX = prevWorld ? prevWorld.x + (rawWorldX - prevWorld.x) * TOUCH_PINCH_CENTER_SMOOTHING : rawWorldX;
                const worldY = prevWorld ? prevWorld.y + (rawWorldY - prevWorld.y) * TOUCH_PINCH_CENTER_SMOOTHING : rawWorldY;
                pinchRef.current.centerWorld = { x: worldX, y: worldY };
                const newPan = {
                    x: centerX - rect.left - (worldX - canvasSize.offsetX) * newZoom,
                    y: centerY - rect.top - (worldY - canvasSize.offsetY) * newZoom,
                };
                setPanAndZoom(newPan, newZoom);
                pinchRef.current.lastDist = dist;
                pinchRef.current.lastCenterClient = { x: centerX, y: centerY };
            }
            return;
        }
        const { clientX, clientY } = normalizeTouchEvent(e);
        lastTouchRef.current = { x: clientX, y: clientY };

        // Record velocity for momentum calculation
        if (panSourceRef.current === 'touch') {
            const now = performance.now();
            panVelocityHistoryRef.current.push({ x: clientX, y: clientY, time: now });
            // Keep samples from last 100ms, but always keep at least the 10 most recent
            const cutoff = now - 100;
            const filtered = panVelocityHistoryRef.current.filter(s => s.time >= cutoff);
            // Ensure we keep at least 10 samples for momentum calculation
            if (filtered.length >= 10) {
                panVelocityHistoryRef.current = filtered;
            } else {
                // Keep the last 10 samples regardless of time
                panVelocityHistoryRef.current = panVelocityHistoryRef.current.slice(-10);
            }
        }

        // Update mouseInsideNode for touch events to maintain proper drag state
        if (longPressingInstanceIdRef.current) {
            const longPressNodeData = nodes.find(n => n.id === longPressingInstanceIdRef.current);
            if (longPressNodeData) {
                mouseInsideNode.current = isInsideNode(longPressNodeData, clientX, clientY);
            }
        }

        const synthetic = {
            clientX,
            clientY,
            preventDefault: () => { try { e.preventDefault(); } catch { } },
            stopPropagation: () => { try { e.stopPropagation(); } catch { } }
        };
        handleMouseMove(synthetic);
    };

    const handleTouchEndCanvas = (e) => {
        // Don't intercept touches on UI overlays (panels, modals, buttons)
        // But always process if a canvas gesture (pan/pinch/drag) is active
        const hasActiveGesture = isMouseDown.current || pinchRef.current.active || touchState.current.isDragging;
        if (!hasActiveGesture && !isCanvasSurfaceTarget(e.target)) return;

        if (e && e.cancelable) {
            e.preventDefault();
            e.stopPropagation();
        }
        // End pinch if active – no glide for two-finger gesture on touch
        if (pinchRef.current.active) {
            pinchRef.current.active = false;
            isPanningOrZooming.current = false;
            // Any multi-touch gesture must suppress the synthetic click that follows.
            // mouseMoved.current isn't reliable here because the first finger's lift
            // resets it before the second finger lifts. Set ignoreCanvasClick directly
            // and re-arm the dead zone so the click-time check has a positive signal
            // even if the second lift is delayed past the scheduled clear.
            if (ignoreCanvasClick) ignoreCanvasClick.current = true;
            armGestureBlock?.();
            scheduleGestureBlockClear?.();
            // Clear velocity history so next pan starts fresh
            panVelocityHistoryRef.current = [];

            // If there's still a touch remaining (2 fingers -> 1 finger), set up for single-finger pan.
            // Must mirror handleMouseDown's pan-state setup: without setIsPanning(true), the pan
            // branch in handleMouseMove (gated on `isPanning && !pinchRef.current.active`) never
            // enters, and the momentum-launch block in handleMouseUp (gated on `isPanning && panStart`)
            // is skipped entirely — so post-pinch flicks would accumulate velocity samples but never glide.
            if (e.touches && e.touches.length === 1) {
                const t = e.touches[0];
                setPanStart({ x: t.clientX, y: t.clientY });
                setIsPanning(true);
                panSourceRef.current = 'touch';
                isMouseDown.current = true;
                mouseMoved.current = false;
                startedOnNode.current = false;
                mouseDownPosition.current = { x: t.clientX, y: t.clientY };
            } else {
                // All fingers lifted - clear everything
                setPanStart(null);
                panSourceRef.current = null;
                setIsPanning(false);
                isMouseDown.current = false;
                mouseMoved.current = false;
            }
            return;
        }
        const { clientX, clientY } = normalizeTouchEvent(e);
        // Determine if this was a tap (minimal movement). Use a larger threshold for touch.
        const dxEnd = clientX - (mouseDownPosition.current?.x || clientX);
        const dyEnd = clientY - (mouseDownPosition.current?.y || clientY);
        const distEnd = Math.hypot(dxEnd, dyEnd);
        const tapThreshold = Math.max(MOVEMENT_THRESHOLD || 6, 16);
        const isTap = distEnd <= tapThreshold && !mouseMoved.current;
        const synthetic = {
            clientX,
            clientY,
            preventDefault: () => { try { e.preventDefault(); } catch { } },
            stopPropagation: () => { try { e.stopPropagation(); } catch { } },
            __source: 'canvas-touchend',
        };
        // Route to mouseUp to reuse inertia/glide for single-finger pan
        handleMouseUp(synthetic);
        // If an edge / node / UI element handled this tap, it raised
        // ignoreCanvasClick.current to claim the tap. Bail before touching
        // selection — otherwise we'd undo the work the element-level handler
        // just did (e.g. an edge tap that selected itself would get cleared
        // here when touchend bubbled to the canvas). Leave the flag set so
        // the synthesized click that follows also bails in handleCanvasClick.
        if (isTap && ignoreCanvasClick && ignoreCanvasClick.current) {
            touchMultiPanRef.current = false;
            return;
        }

        // Ensure touch tap behaves like click-off: close UI overlays if present.
        // Only group / connection (edge) panels need to suppress the plus-sign
        // spawn — node selection clears in the spawn block already (via the
        // selectedInstanceIds branch), and pie menu / existing plus sign are
        // independent of "is a control panel up?".
        if (isTap) {
            let dismissedControlPanel = false;

            if (groupControlPanelShouldShow || groupControlPanelVisible) {
                setGroupControlPanelVisible(false);
                dismissedControlPanel = true;
            }
            if (selectedGroup) {
                setSelectedGroup(null);
                dismissedControlPanel = true;
            }
            // Mirror the mouse handler — the panel can be visible / shouldShow
            // even when selectedEdgeIds is briefly empty (animation, race), so
            // check all four conditions the same way handleCanvasClick does.
            if (connectionControlPanelShouldShow || connectionControlPanelVisible || selectedEdgeId || selectedEdgeIds.size > 0) {
                if (connectionControlPanelShouldShow || connectionControlPanelVisible) {
                    setConnectionControlPanelVisible(false);
                }
                storeActions.setSelectedEdgeId(null);
                storeActions.clearSelectedEdgeIds();
                dismissedControlPanel = true;
            }
            if (selectedNodeIdForPieMenu) {
                setSelectedNodeIdForPieMenu(null);
            }
            if (plusSign && !nodeNamePrompt.visible) {
                setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
            }

            // Mirror click-to-plus-sign behavior, but skip the spawn if a
            // control panel was just dismissed (group / connection) — the
            // user tapped to close the panel, not to create a new node.
            if (!isPaused && !draggingNodeInfo && !drawingConnectionFrom && !recentlyPanned && !nodeNamePrompt.visible && activeGraphId) {
                if (selectedInstanceIds.size > 0) {
                    // Mimic click-off behavior: clear selection on tap
                    setSelectedInstanceIds(new Set());
                } else if (!plusSign && !dismissedControlPanel) {
                    const rect = containerRef.current.getBoundingClientRect();
                    const mouseX = (clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX;
                    const mouseY = (clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY;
                    setPlusSign({ x: mouseX, y: mouseY, mode: 'appear', tempName: '' });
                    setLastInteractionType('plus_sign_shown_touch');
                }
            }

            // Suppress the synthesized click that follows touchend — without
            // this, handleCanvasClick re-runs after React has flushed the
            // selection-clear above and sees an empty selection, which then
            // spawns a plus sign even though the user only meant to tap-off.
            if (ignoreCanvasClick) {
                ignoreCanvasClick.current = true;
            }
        }
        touchMultiPanRef.current = false;
    };

    const handleNodeTouchStart = (nodeData, e) => {
        // Window-scoped move + end tracking lives in:
        //   - useNodeDrag's window pointermove effect (handleDragMove)
        //   - useWindowGestureEnd (window+capture pointerup/touchend)
        // Both fire regardless of which element the finger is over, so the
        // older document-level touchmove/touchend listeners that used to be
        // attached here are redundant and have been removed.
        e.stopPropagation();
        if (isPaused || !activeGraphId) return;

        // Do NOT call e.preventDefault() here - React's onTouchStart is passive by default.
        // We rely on CSS touch-action: none to prevent scrolling.
        stopPanMomentum();

        const touch = e.touches[0];
        if (!touch) return;

        if (suppressMouseDownResetTimeoutRef.current) {
            clearTimeout(suppressMouseDownResetTimeoutRef.current);
        }
        suppressNextMouseDownRef.current = true;
        suppressMouseDownResetTimeoutRef.current = setTimeout(() => {
            suppressNextMouseDownRef.current = false;
            suppressMouseDownResetTimeoutRef.current = null;
        }, 650);

        const instanceId = nodeData.id;
        const now = performance.now();
        // If the user is mid-double-tap on this same node, the long-press
        // timer below would otherwise turn the second tap into a drag if the
        // finger lingers >200ms. Suppress it for this gesture.
        const lastTap = lastNodeTapRef.current;
        const isPotentialDoubleTap = lastTap.id === instanceId && (now - lastTap.ts) < NODE_DOUBLE_TAP_MS;

        const rect = containerRef.current?.getBoundingClientRect();
        let dragOffset = null;
        if (rect) {
            const mouseCanvasX = (touch.clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX;
            const mouseCanvasY = (touch.clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY;
            dragOffset = { x: mouseCanvasX - nodeData.x, y: mouseCanvasY - nodeData.y };
        }

        isMouseDown.current = true;
        mouseDownPosition.current = { x: touch.clientX, y: touch.clientY };
        mouseMoved.current = false;
        mouseInsideNode.current = true;
        startedOnNode.current = true;
        panSourceRef.current = 'touch';
        // Arm connection drawing by default (matches mouse behavior)
        setLongPressingInstanceId(instanceId);

        // Add touch feedback class
        const nodeElement = e.currentTarget;
        nodeElement.classList.add('touch-active');

        // Haptic feedback if available
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
                navigator.vibrate(10); // Short vibration for touch start
            } catch (e) { }
        }

        // Initialize touch state (drag can also start via long-press fallback)
        touchState.current = {
            isDragging: false,
            dragNodeId: instanceId,
            startTime: now,
            startPosition: { x: touch.clientX, y: touch.clientY },
            currentPosition: { x: touch.clientX, y: touch.clientY },
            hasMovedPastThreshold: false,
            longPressTimer: null,
            nodeElement: nodeElement,
            longPressReady: false,
            dragOffset
            // nodeData removed - use dragNodeId for fresh lookups to avoid stale closures
        };

        // Long-press fallback: begin NODE DRAG while finger is still down (mouse parity)
        if (touchState.current.longPressTimer) {
            clearTimeout(touchState.current.longPressTimer);
        }
        if (isPotentialDoubleTap) {
            // Skip long-press timer entirely — this finger is the second tap
            // of a double-tap and must not promote to a drag.
            return;
        }
        touchState.current.longPressTimer = setTimeout(() => {
            const ts = touchState.current;
            if (!ts) return;
            // Bail if a connection-draw is already in flight — the mouse path
            // in handleMouseMove can start one between 6–12px of movement
            // (mouse threshold vs touch threshold) without clearing this timer.
            if (drawingConnectionFromRef.current) return;
            // Long press detected! Start node drag (matches mouse behavior)
            // Don't check hasMovedPastThreshold - we want to start drag even if already moving
            if (isMouseDown.current && ts.dragNodeId === instanceId && !ts.isDragging) {
                // Set flag BEFORE starting drag to enable early exit path immediately
                ts.isDragging = true;
                // Recompute dragOffset from the CURRENT finger position so the node
                // doesn't jump when the finger drifted slightly during the hold.
                // The touchstart offset is stale: if the finger moved 5px left, using it
                // places the node 5px left on the first drag frame. Using the current
                // position as the new grip-lock prevents this while keeping the feel
                // of instant pickup (< TOUCH_MOVEMENT_THRESHOLD drift, so the user
                // wasn't intentionally moving — just natural hand wobble).
                const liveRect = containerRef.current?.getBoundingClientRect();
                const liveOffset = liveRect ? {
                    x: (ts.currentPosition.x - liveRect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX - nodeData.x,
                    y: (ts.currentPosition.y - liveRect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY - nodeData.y,
                } : ts.dragOffset;
                const started = startDragForNode(nodeData, ts.currentPosition.x, ts.currentPosition.y, liveOffset);
                if (started) {
                    ts.longPressReady = false;
                    setSelectedNodeIdForPieMenu(null);
                    // Cancel connection intent once dragging node
                    setLongPressingInstanceId(null);
                } else {
                    // Rollback if failed
                    ts.isDragging = false;
                }

                // Visual/Haptic feedback
                if (ts.nodeElement) {
                    ts.nodeElement.classList.add('long-press-active');
                }
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try {
                        navigator.vibrate(50);
                    } catch (e) { }
                }
            }
        // Scale the touch delay proportionally from the mouse delay (ratio 450/250 = 1.8),
        // but floor at NODE_DOUBLE_TAP_MS so a double-tap can't accidentally trigger drag.
        }, nodeLiftDelay != null ? Math.max(NODE_DOUBLE_TAP_MS, Math.round(nodeLiftDelay * 1.8)) : LONG_PRESS_DURATION);
    };

    const handleNodeTouchMove = (nodeData, e) => {
        if (isPaused || !activeGraphId || !touchState.current.dragNodeId) {
            return;
        }

        // Do NOT call e.preventDefault() or e.stopPropagation() here
        // The document-level listener (attached in handleNodeTouchStart) handles everything

        const touch = e.touches[0];
        if (!touch) {
            return;
        }

        const currentPos = { x: touch.clientX, y: touch.clientY };

        // Update current position
        touchState.current.currentPosition = currentPos;

        // PRIORITY 1: If drag is already active, just update position and return
        if (touchState.current.isDragging || draggingNodeInfo) {
            const synthetic = {
                clientX: touch.clientX,
                clientY: touch.clientY,
                stopPropagation: () => e.stopPropagation(),
                preventDefault: () => e.preventDefault()
            };
            handleMouseMove(synthetic);
            return; // Skip all other logic
        }

        // PRIORITY 2: Check if we should start drag or connection based on movement
        const deltaX = currentPos.x - touchState.current.startPosition.x;
        const deltaY = currentPos.y - touchState.current.startPosition.y;
        const distance = Math.hypot(deltaX, deltaY);

        // Check if we've moved past threshold
        if (!touchState.current.hasMovedPastThreshold && distance > TOUCH_MOVEMENT_THRESHOLD) {
            touchState.current.hasMovedPastThreshold = true;

            // Clear any pending long-press timer
            if (touchState.current.longPressTimer) {
                clearTimeout(touchState.current.longPressTimer);
                touchState.current.longPressTimer = null;
            }

            // Match mouse behavior: if longPressingInstanceId is set -> Connection Draw, else -> Node Drag
            // BUT: If drag is already started (isDragging=true), skip connection logic entirely
            if (!touchState.current.isDragging && longPressingInstanceIdRef.current && !draggingNodeInfo && !drawingConnectionFrom && !pinchRef.current.active) {
                // Check if we've left the node area (matches mouse behavior)
                const armedNode = nodes.find(n => n.id === longPressingInstanceIdRef.current);
                if (armedNode) {
                    const leftNodeArea = !isInsideNode(armedNode, touch.clientX, touch.clientY);
                    // Allow both patterns (same as mouse):
                    // 1) Move outside the node (original behavior)
                    // 2) Quick drag while still inside the node (desktop-friendly)
                    if (leftNodeArea || startedOnNode.current) {
                        // longPressingInstanceId is armed AND we left the node -> Start Connection Draw
                        const startNodeDims = getNodeDimensions(armedNode, previewingNodeId === armedNode.id, null);
                        const startPt = { x: armedNode.x + startNodeDims.currentWidth / 2, y: armedNode.y + startNodeDims.currentHeight / 2 };

                        if (!containerRef.current || typeof touch.clientX !== 'number' || typeof touch.clientY !== 'number') {
                            setLongPressingInstanceId(null);
                            return;
                        }

                        const rect = containerRef.current.getBoundingClientRect();
                        const rawX = (touch.clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX;
                        const rawY = (touch.clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY;

                        if (isNaN(rawX) || isNaN(rawY)) {
                            // Only abort initialization if NOT already dragging
                            if (!touchState.current.isDragging && !draggingNodeInfo) {
                                setLongPressingInstanceId(null);
                            }
                            return; // Skip this frame but don't clear drag state if already dragging
                        }

                        const { x: currentX, y: currentY } = clampCoordinates(rawX, rawY);
                        setDrawingConnectionFrom({ sourceInstanceId: armedNode.id, startX: startPt.x, startY: startPt.y, currentX, currentY });
                        setLongPressingInstanceId(null);
                    } else {
                        // Still inside node, haven't left yet -> Don't start connection, continue waiting
                        // This allows quick drags inside the node to become node drags instead
                    }
                }
            } else if (!touchState.current.isDragging && !longPressingInstanceIdRef.current) {
                // longPressingInstanceId NOT set (cleared by long press timeout) -> Start Node Drag
                if (!touchState.current.isDragging) {
                    // Set flag BEFORE to enable early exit path immediately
                    touchState.current.isDragging = true;
                    // Use touchstart-captured offset so grip stays locked even though
                    // the finger has moved past TOUCH_MOVEMENT_THRESHOLD by this point.
                    const dragStarted = startDragForNode(nodeData, touch.clientX, touch.clientY, touchState.current.dragOffset);
                    if (!dragStarted) {
                        // Rollback if start failed
                        touchState.current.isDragging = false;
                    } else {
                        touchState.current.longPressReady = false;
                        setSelectedNodeIdForPieMenu(null);
                        setLongPressingInstanceId(null);
                    }
                }
            }
        }

        // Drive shared move logic only once we're past threshold or a gesture is active.
        // Calling handleMouseMove unconditionally feeds every touchmove into the mouse
        // handler, which uses a 3px threshold — far below the 12px touch threshold —
        // and prematurely starts a connection draw on natural finger wobble.
        if (drawingConnectionFrom || touchState.current.hasMovedPastThreshold) {
            const synthetic = {
                clientX: touch.clientX,
                clientY: touch.clientY,
                stopPropagation: () => e.stopPropagation(),
                preventDefault: () => e.preventDefault()
            };
            handleMouseMove(synthetic);
        }
    };

    const handleNodeTouchCancel = (nodeData, e) => {
        if (e) {
            try { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } catch { }
        }
        // Mirror touch end cleanup
        isMouseDown.current = false;
        startedOnNode.current = false;
        setLongPressingInstanceId(null);
        if (pendingNodeTapRef.current) {
            clearTimeout(pendingNodeTapRef.current.timer);
            pendingNodeTapRef.current = null;
        }

        if (touchState.current.nodeElement) {
            touchState.current.nodeElement.classList.remove('touch-active', 'long-press-active');
        }

        if (touchState.current.longPressTimer) {
            clearTimeout(touchState.current.longPressTimer);
            touchState.current.longPressTimer = null;
        }

        if (touchState.current.isDragging || drawingConnectionFrom) {
            // Synthesize a mouse up to clear drag state
            const synthetic = {
                clientX: (e && e.changedTouches && e.changedTouches[0]?.clientX) || 0,
                clientY: (e && e.changedTouches && e.changedTouches[0]?.clientY) || 0,
                stopPropagation: () => { },
                preventDefault: () => { },
                __source: 'node-touchcancel',
            };
            handleMouseUp(synthetic);
        }

        // Reset touch state
        touchState.current = {
            isDragging: false,
            dragNodeId: null,
            startTime: 0,
            startPosition: { x: 0, y: 0 },
            currentPosition: { x: 0, y: 0 },
            hasMovedPastThreshold: false,
            longPressTimer: null,
            nodeElement: null,
            longPressReady: false,
            dragOffset: null,
            nodeData: null
        };

        // Same reasoning as handleNodeTouchEnd — handleMouseUp above (when a
        // drag/connection was in flight) handles deferred cleanup. If neither
        // was active, draggingNodeInfo is already null and this would be a
        // no-op. Calling cancelDrag would only fight the zoom-restore.
        mouseInsideNode.current = false;
    };

    const handleNodeTouchEnd = (nodeData, e) => {
        if (e) {
            e.stopPropagation();
            if (e.cancelable) {
                e.preventDefault();
            }
        }

        isMouseDown.current = false;
        startedOnNode.current = false;
        setLongPressingInstanceId(null);

        // Clean up CSS classes
        if (touchState.current.nodeElement) {
            touchState.current.nodeElement.classList.remove('touch-active', 'long-press-active');
        }

        // Clear long press timer
        if (touchState.current.longPressTimer) {
            clearTimeout(touchState.current.longPressTimer);
            touchState.current.longPressTimer = null;
        }

        if (suppressMouseDownResetTimeoutRef.current) {
            clearTimeout(suppressMouseDownResetTimeoutRef.current);
        }
        suppressNextMouseDownRef.current = true;
        suppressMouseDownResetTimeoutRef.current = setTimeout(() => {
            suppressNextMouseDownRef.current = false;
            suppressMouseDownResetTimeoutRef.current = null;
        }, 400);

        const touch = e.changedTouches[0];
        if (!touch) return;
        const synthetic = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            stopPropagation: () => e.stopPropagation(),
            preventDefault: () => e.preventDefault(),
            __source: 'node-touchend',
        };

        // Handle tap vs drag
        // Treat as tap only if: no movement past threshold, no drag in flight,
        // and no connection-draw in flight. A touch-and-hold without movement
        // still arms the long-press timer at 200ms which calls startDragForNode
        // and sets touchState.current.isDragging = true. Without the isDragging
        // guard here, the held-then-released gesture would also select the node.
        const wasDragOrConnection =
            touchState.current.isDragging ||
            !!draggingNodeInfo ||
            drawingConnectionFromRef.current;
        if (!touchState.current.hasMovedPastThreshold && !wasDragOrConnection && touchState.current.dragNodeId === nodeData.id) {
            // This was a tap, not a drag
            // Light haptic feedback for tap completion
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try {
                    navigator.vibrate(5);
                } catch (e) { }
            }

            // Double-tap detection (mirrors mouse e.detail===2 path in
            // handleNodeMouseDown): open the prototype's right-panel tab.
            const now = performance.now();
            const lastTap = lastNodeTapRef.current;
            const isDoubleTap = lastTap.id === nodeData.id && (now - lastTap.ts) < NODE_DOUBLE_TAP_MS;

            if (isDoubleTap) {
                lastNodeTapRef.current = { id: null, ts: 0 };
                // Cancel the deferred selection from the first tap so the
                // double-tap doesn't leave the node selected (mirrors mouse:
                // e.detail===2 clears the pending click timeout).
                if (pendingNodeTapRef.current) {
                    clearTimeout(pendingNodeTapRef.current.timer);
                    pendingNodeTapRef.current = null;
                }
                if (storeActions?.openRightPanelNodeTab && nodeData.prototypeId) {
                    storeActions.openRightPanelNodeTab(nodeData.prototypeId, nodeData.name);
                }
                if (typeof storeActions?.setRightPanelExpanded === 'function') {
                    storeActions.setRightPanelExpanded(true);
                }
            } else {
                lastNodeTapRef.current = { id: nodeData.id, ts: now };

                // Defer selection so a follow-up tap on the same node within
                // NODE_DOUBLE_TAP_MS can cancel it (mouse parity).
                if (pendingNodeTapRef.current) {
                    clearTimeout(pendingNodeTapRef.current.timer);
                    pendingNodeTapRef.current = null;
                }
                const tapNodeId = nodeData.id;
                const timer = setTimeout(() => {
                    pendingNodeTapRef.current = null;
                    const currentSelection = selectedInstanceIdsRef.current;
                    const wasSelected = currentSelection.has(tapNodeId);
                    setSelectedInstanceIds(prev => {
                        const newSelected = new Set(prev);
                        if (wasSelected) {
                            if (tapNodeId !== previewingNodeId) {
                                newSelected.delete(tapNodeId);
                            }
                        } else {
                            newSelected.add(tapNodeId);
                        }
                        return newSelected;
                    });
                    storeActions.updateNodeInstance(tapNodeId, { selected: !wasSelected });
                    if (!wasSelected) {
                        setSelectedNodeIdForPieMenu(tapNodeId);
                    }
                }, NODE_DOUBLE_TAP_MS);
                pendingNodeTapRef.current = { timer, nodeId: tapNodeId };
            }
        } else {
            // Drag verification
            if (touchState.current.isDragging) {
                // Drag end logic handled by mouseUp synthetic event
            }
        }

        handleMouseUp(synthetic);

        // Reset touch state
        touchState.current = {
            isDragging: false,
            dragNodeId: null,
            startTime: 0,
            startPosition: { x: 0, y: 0 },
            currentPosition: { x: 0, y: 0 },
            hasMovedPastThreshold: false,
            longPressTimer: null,
            nodeElement: null,
            longPressReady: false,
            dragOffset: null,
            nodeData: null
        };

        // Do NOT call setDraggingNodeInfo(null) here — it routes to cancelDrag,
        // which clears the drag CSS transforms before the zoom-restore animation
        // completes, snapping the node back to its pre-drag store position for
        // ~250ms before performCleanup flushes. handleMouseUp above already
        // triggers handleDragEnd's cleanup-at-start pipeline.
        mouseInsideNode.current = false;
    };

    // Pointer -> Touch compatibility helpers (function declarations to avoid TDZ)
    function toSyntheticTouchEventFromPointer(e) {
        return {
            touches: [{ clientX: e.clientX, clientY: e.clientY }],
            changedTouches: [{ clientX: e.clientX, clientY: e.clientY }],
            cancelable: true,
            stopPropagation: () => { try { e.stopPropagation(); } catch { } },
            preventDefault: () => { try { e.preventDefault(); } catch { } },
            currentTarget: e.currentTarget,
            __fromPointer: true
        };
    }

    function handleNodePointerDown(nodeData, e) {
        if (e && e.pointerType && e.pointerType !== 'mouse') {
            // Do NOT call e.preventDefault() - it blocks touch recognition
            // Let the touch event handlers manage the interaction
            try { e.stopPropagation(); } catch { }
            handleNodeTouchStart(nodeData, toSyntheticTouchEventFromPointer(e));
        }
    }

    function handleNodePointerMove(nodeData, e) {
        // Touch movement is handled via React onTouchMove on the node element.
        // Touch events stick to the originating element across the whole
        // gesture, but pointer events do not (and onPointerMove is unreliable
        // for touch on SVG <g> in iOS Safari). Restricting this to non-touch
        // pointer types (pen / stylus) avoids double-firing handleNodeTouchMove.
        if (!e || !e.pointerType || e.pointerType === 'mouse' || e.pointerType === 'touch') return;
        try { e.stopPropagation(); } catch { }
        handleNodeTouchMove(nodeData, toSyntheticTouchEventFromPointer(e));
    }

    function handleNodePointerUp(nodeData, e) {
        if (e && e.pointerType && e.pointerType !== 'mouse') {
            try { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } catch { }
            const synthetic = toSyntheticTouchEventFromPointer(e);
            synthetic.touches = [];
            handleNodeTouchEnd(nodeData, synthetic);
        }
    }

    function handleNodePointerCancel(nodeData, e) {
        if (e && e.pointerType && e.pointerType !== 'mouse') {
            try { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } catch { }
            const synthetic = toSyntheticTouchEventFromPointer(e);
            synthetic.touches = [];
            handleNodeTouchEnd(nodeData, synthetic);
        }
    }

    return {
        handleTouchStartCanvas,
        handleTouchMoveCanvas,
        handleTouchEndCanvas,
        handleNodeTouchStart,
        handleNodeTouchMove,
        handleNodeTouchEnd,
        handleNodeTouchCancel,
        handleNodePointerDown,
        handleNodePointerMove,
        handleNodePointerUp,
        handleNodePointerCancel
    };
};
