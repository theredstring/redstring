
import { useRef, useEffect } from 'react';

// Constants locally defined or passed? 
// Some constants seem global. I should duplicates them or export/import them.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const TOUCH_PINCH_SENSITIVITY = 0.05;
const TOUCH_PINCH_CENTER_SMOOTHING = 0.1;
const MOVEMENT_THRESHOLD = 6;
const TOUCH_MOVEMENT_THRESHOLD = 12; // Higher than mouse
const LONG_PRESS_DURATION = 500;

export const useCanvasTouch = ({
    containerRef,
    panOffset,
    zoomLevel,
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

    const docTouchListenersRef = useRef(null);
    const handleNodeTouchMoveRef = useRef(null);
    const handleNodeTouchEndRef = useRef(null);
    const handleNodeTouchCancelRef = useRef(null);

    const suppressMouseDownResetTimeoutRef = useRef(null);

    const longPressingInstanceIdRef = useRef(null);
    const touchMultiPanRef = useRef(false);

    // Update refs on every render to avoid stale closures in event listeners
    useEffect(() => {
        handleNodeTouchMoveRef.current = handleNodeTouchMove;
        handleNodeTouchEndRef.current = handleNodeTouchEnd;
        handleNodeTouchCancelRef.current = handleNodeTouchCancel;
    });

    // --- Helpers ---

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
            const worldX = (centerX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
            const worldY = (centerY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
            pinchRef.current = {
                active: true,
                startDist: dist,
                startZoom: zoomLevel,
                centerClient: { x: centerX, y: centerY },
                centerWorld: { x: worldX, y: worldY },
                lastCenterClient: { x: centerX, y: centerY },
                lastDist: dist
            };
            pinchSmoothingRef.current.lastFrameTime = performance.now();
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
                    const worldX = (centerX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
                    const worldY = (centerY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
                    pinchRef.current = {
                        active: true,
                        startDist: dist,
                        startZoom: zoomLevel,
                        centerClient: { x: centerX, y: centerY },
                        centerWorld: { x: worldX, y: worldY },
                        lastCenterClient: { x: centerX, y: centerY },
                        lastDist: dist
                    };
                    pinchSmoothingRef.current.lastFrameTime = performance.now();
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
            const startZoom = pinchRef.current.startZoom || zoomLevel;
            const ratioFromStart = dist / (startDist || dist);
            const targetZoomRaw = startZoom * (ratioFromStart || 1);
            const easing = 1 - Math.pow(1 - TOUCH_PINCH_SENSITIVITY, Math.min(6, dt / 16));
            setZoomLevel(prevZoom => {
                const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoomRaw || prevZoom));
                const newZoom = prevZoom + (targetZoom - prevZoom) * easing;
                if (!containerRef.current) {
                    pinchRef.current.lastDist = dist;
                    pinchRef.current.lastCenterClient = { x: centerX, y: centerY };
                    return prevZoom;
                }
                const rect = containerRef.current.getBoundingClientRect();
                setPanOffset(prevPan => {
                    const rawWorldX = (centerX - rect.left - prevPan.x) / prevZoom + canvasSize.offsetX;
                    const rawWorldY = (centerY - rect.top - prevPan.y) / prevZoom + canvasSize.offsetY;
                    const prevWorld = pinchRef.current.centerWorld;
                    const worldX = prevWorld ? prevWorld.x + (rawWorldX - prevWorld.x) * TOUCH_PINCH_CENTER_SMOOTHING : rawWorldX;
                    const worldY = prevWorld ? prevWorld.y + (rawWorldY - prevWorld.y) * TOUCH_PINCH_CENTER_SMOOTHING : rawWorldY;
                    pinchRef.current.centerWorld = { x: worldX, y: worldY };
                    return {
                        x: centerX - rect.left - (worldX - canvasSize.offsetX) * newZoom,
                        y: centerY - rect.top - (worldY - canvasSize.offsetY) * newZoom
                    };
                });
                pinchRef.current.lastDist = dist;
                pinchRef.current.lastCenterClient = { x: centerX, y: centerY };
                return newZoom;
            });
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
        if (e && e.cancelable) {
            e.preventDefault();
            e.stopPropagation();
        }
        // End pinch if active – no glide for two-finger gesture on touch
        if (pinchRef.current.active) {
            pinchRef.current.active = false;
            isPanningOrZooming.current = false;
            // Clear velocity history so next pan starts fresh
            panVelocityHistoryRef.current = [];
            // lastPanVelocityRef.current = { vx: 0, vy: 0 }; // Omitted as not passed, should be handled by stopPanMomentum? 
            // Actually stopPanMomentum might clear it, or we rely on empty history.

            // If there's still a touch remaining (2 fingers -> 1 finger), set up for single-finger pan
            if (e.touches && e.touches.length === 1) {
                const t = e.touches[0];
                setPanStart({ x: t.clientX, y: t.clientY });
                panSourceRef.current = 'touch';
                isMouseDown.current = true;
                mouseMoved.current = false;
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
            stopPropagation: () => { try { e.stopPropagation(); } catch { } }
        };
        // Route to mouseUp to reuse inertia/glide for single-finger pan
        handleMouseUp(synthetic);
        // Ensure touch tap behaves like click-off: close UI overlays if present
        if (isTap) {
            if (groupControlPanelShouldShow || groupControlPanelVisible) {
                setGroupControlPanelVisible(false);
            }
            if (selectedGroup) {
                setSelectedGroup(null);
            }
            if (selectedEdgeId || selectedEdgeIds.size > 0) {
                storeActions.setSelectedEdgeId(null);
                storeActions.clearSelectedEdgeIds();
            }
            if (selectedNodeIdForPieMenu) {
                setSelectedNodeIdForPieMenu(null);
            }
            if (plusSign && !nodeNamePrompt.visible) {
                setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
            }
        }
        // If it was a tap on empty canvas, mirror click-to-plus-sign behavior
        if (isTap) {
            if (!isPaused && !draggingNodeInfo && !drawingConnectionFrom && !recentlyPanned && !nodeNamePrompt.visible && activeGraphId) {
                if (selectedInstanceIds.size > 0) {
                    // Mimic click-off behavior: clear selection on tap
                    setSelectedInstanceIds(new Set());
                } else if (!plusSign) {
                    const rect = containerRef.current.getBoundingClientRect();
                    const mouseX = (clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
                    const mouseY = (clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
                    setPlusSign({ x: mouseX, y: mouseY, mode: 'appear', tempName: '' });
                    setLastInteractionType('plus_sign_shown_touch');
                }
            }
        }
        touchMultiPanRef.current = false;
    };

    const handleNodeTouchStart = (nodeData, e) => {
        // Attach document-level listeners only once per touch session
        // Check if listeners are already attached to avoid duplicates
        if (!docTouchListenersRef.current) {
            try {
                // Create dedicated listeners with fresh node lookups to avoid stale closures
                const moveListener = (ev) => {
                    const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
                    if (!freshNodeData || !touchState.current.dragNodeId) {
                        return;
                    }
                    if (handleNodeTouchMoveRef.current) {
                        handleNodeTouchMoveRef.current(freshNodeData, ev);
                    }
                };
                const endListener = (ev) => {
                    const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
                    if (freshNodeData && handleNodeTouchEndRef.current) {
                        handleNodeTouchEndRef.current(freshNodeData, ev);
                    }
                    try {
                        document.removeEventListener('touchmove', moveListener, { passive: false });
                        document.removeEventListener('touchend', endListener, { passive: false });
                        document.removeEventListener('touchcancel', cancelListener, { passive: false });
                    } catch (err) {
                        // ignore
                    }
                    docTouchListenersRef.current = null;
                };
                const cancelListener = (ev) => {
                    const freshNodeData = nodes.find(n => n.id === touchState.current.dragNodeId);
                    if (freshNodeData && handleNodeTouchCancelRef.current) {
                        handleNodeTouchCancelRef.current(freshNodeData, ev);
                    }
                    else if (freshNodeData && handleNodeTouchEndRef.current) {
                        handleNodeTouchEndRef.current(freshNodeData, ev);
                    }
                    try {
                        document.removeEventListener('touchmove', moveListener, { passive: false });
                        document.removeEventListener('touchend', endListener, { passive: false });
                        document.removeEventListener('touchcancel', cancelListener, { passive: false });
                    } catch { }
                    docTouchListenersRef.current = null;
                };
                document.addEventListener('touchmove', moveListener, { passive: false });
                document.addEventListener('touchend', endListener, { passive: false });
                document.addEventListener('touchcancel', cancelListener, { passive: false });
                docTouchListenersRef.current = { moveListener, endListener, cancelListener };
            } catch (err) {
                // ignore
            }
        }
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

        const rect = containerRef.current?.getBoundingClientRect();
        let dragOffset = null;
        if (rect) {
            const mouseCanvasX = (touch.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
            const mouseCanvasY = (touch.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;
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
        touchState.current.longPressTimer = setTimeout(() => {
            const ts = touchState.current;
            if (!ts) return;
            // Long press detected! Start node drag (matches mouse behavior)
            // Don't check hasMovedPastThreshold - we want to start drag even if already moving
            if (isMouseDown.current && ts.dragNodeId === instanceId && !ts.isDragging) {
                // Set flag BEFORE starting drag to enable early exit path immediately
                ts.isDragging = true;
                const started = startDragForNode(nodeData, ts.currentPosition.x, ts.currentPosition.y);
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
        }, LONG_PRESS_DURATION);
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
                        const rawX = (touch.clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
                        const rawY = (touch.clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;

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
                    const dragStarted = startDragForNode(nodeData, touch.clientX, touch.clientY);
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

        // Drive shared move logic for both node-drag and connection-draw
        const synthetic = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            stopPropagation: () => e.stopPropagation(),
            preventDefault: () => e.preventDefault()
        };
        handleMouseMove(synthetic);
    };

    const handleNodeTouchCancel = (nodeData, e) => {
        if (e) {
            try { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } catch { }
        }
        // Mirror touch end cleanup
        isMouseDown.current = false;
        startedOnNode.current = false;
        setLongPressingInstanceId(null);

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
                clientX: (e && e.changedTouches && e.changedTouches[0]?.clientX) || lastMousePosRef.current?.x || 0,
                clientY: (e && e.changedTouches && e.changedTouches[0]?.clientY) || lastMousePosRef.current?.y || 0,
                stopPropagation: () => { },
                preventDefault: () => { }
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

        setDraggingNodeInfo(null);
        mouseInsideNode.current = false;
        // Detach any outstanding document listeners
        if (docTouchListenersRef.current) {
            const { moveListener, endListener, cancelListener } = docTouchListenersRef.current;
            try {
                document.removeEventListener('touchmove', moveListener, { passive: false });
                document.removeEventListener('touchend', endListener, { passive: false });
                document.removeEventListener('touchcancel', cancelListener, { passive: false });
            } catch { }
            docTouchListenersRef.current = null;
        }
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
            preventDefault: () => e.preventDefault()
        };

        // Handle tap vs drag
        if (!touchState.current.hasMovedPastThreshold && touchState.current.dragNodeId === nodeData.id) {
            // This was a tap, not a drag
            // Light haptic feedback for tap completion
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try {
                    navigator.vibrate(5);
                } catch (e) { }
            }

            // Handle double-tap for definition navigation
            const now = performance.now();
            const timeSinceStart = now - touchState.current.startTime;

            if (timeSinceStart < 300) { // Quick tap
                // Placeholder for future double-tap behavior
            }

            const wasSelected = selectedInstanceIds.has(nodeData.id);
            setSelectedInstanceIds(prev => {
                const newSelected = new Set(prev);
                if (e.shiftKey || e.metaKey) {
                    if (wasSelected) {
                        newSelected.delete(nodeData.id);
                    } else {
                        newSelected.add(nodeData.id);
                    }
                } else {
                    newSelected.clear();
                    newSelected.add(nodeData.id);
                }
                return newSelected;
            });
            // Also update store - important for sidebar updates
            storeActions.updateNodeInstance(nodeData.id, { selected: !wasSelected });

            // Handle pie menu on tap
            if (!wasSelected) {
                setSelectedNodeIdForPieMenu(nodeData.id);
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

        setDraggingNodeInfo(null);
        mouseInsideNode.current = false;
        // Detach listeners if pending
        if (docTouchListenersRef.current) {
            const { moveListener, endListener, cancelListener } = docTouchListenersRef.current;
            try {
                document.removeEventListener('touchmove', moveListener, { passive: false });
                document.removeEventListener('touchend', endListener, { passive: false });
                document.removeEventListener('touchcancel', cancelListener, { passive: false });
            } catch { }
            docTouchListenersRef.current = null;
        }
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
        if (e && e.pointerType && e.pointerType !== 'mouse') {
            try { e.stopPropagation(); } catch { }
            handleNodeTouchMove(nodeData, toSyntheticTouchEventFromPointer(e));
        }
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
