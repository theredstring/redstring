import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import useGraphStore from '../store/graphStore.js';
import { performUndo, performRedo } from '../store/historyActions.js';
import { copySelection, pasteClipboard, copyEdgeDefinition, readConnectionClipboard, applyConnectionClipboard } from '../utils/clipboard';
import { getNodeDimensions } from '../utils';
import { NODE_DEFAULT_COLOR } from '../constants'; // Assumed constant exists

// Constants (moved from NodeCanvas.jsx)
const KEYBOARD_PAN_SPEED = 14.25;
const KEYBOARD_ZOOM_SPEED = 0.05;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;

export const useCanvasKeyboard = ({
    activeGraphId,
    storeActions,
    graphsMap,
    nodePrototypesMap,
    edgesMap,
    selectedInstanceIds,
    setSelectedInstanceIds,
    selectedEdgeId,
    selectedEdgeIds,
    clipboardRef,
    // Fired after every write to clipboardRef. A ref write re-renders nothing,
    // and the connection menu's Paste button only exists while the clipboard
    // holds something a connection can use — so it has to be told.
    onClipboardChange,
    keysPressed,
    mousePositionRef, // {x, y} in client coords
    panOffset,
    panOffsetRef,
    setPanOffset,
    zoomLevel,
    zoomLevelRef,
    setZoomLevel,
    applyTransform,  // direct DOM transform write (no React state)
    flushSettle,     // flush settled React state (call when movement ends)
    onTransformChange, // synchronous callback fired on every pan/zoom mutation (drives culling)
    isPanningOrZoomingRef, // shared ref — guards view-save timeout from firing during movement
    canvasSize, // {width, height, offsetX, offsetY}
    viewportSize, // {width, height}
    viewportBounds, // {x, y, width, height}
    draggingNodeInfo,
    draggingNodeInfoRef,
    performDragUpdateRef,
    isAnimatingZoomRef,
    minZoom, // dynamic MIN_ZOOM from NodeCanvas — must match wheel/trackpad clamp
    maxZoom, // dynamic MAX_ZOOM from NodeCanvas — must match wheel/trackpad clamp
    // UI State flags
    isPaused,
    nodeNamePrompt,
    connectionNamePrompt,
    abstractionPrompt,
    isHeaderEditing,
    isRightPanelInputFocused,
    isLeftPanelInputFocused,
    abstractionCarouselVisible,
    keyboardSettings,
    onDeleteNodes,
}) => {
    // Remember panel state for toggle behavior
    const panelStateBeforeHide = useRef({ left: true, right: true });

    // Tab hold-to-scrub state
    const tabHeldDown = useRef(false);
    const tabScrubActive = useRef(false);

    // Use a Ref to keep track of the latest prop values without restarting the effect
    // This is critical for performance to avoid tearing down and rebuilding the RAF loop every frame
    const props = {
        activeGraphId,
        storeActions,
        graphsMap,
        nodePrototypesMap,
        edgesMap,
        selectedInstanceIds,
        setSelectedInstanceIds,
        selectedEdgeId,
        selectedEdgeIds,
        clipboardRef,
        onClipboardChange,
        keysPressed,
        mousePositionRef, // {x, y} in client coords
        panOffset,
        panOffsetRef,
        setPanOffset,
        zoomLevel,
        zoomLevelRef,
        setZoomLevel,
        applyTransform,
        flushSettle,
        onTransformChange,
        isPanningOrZoomingRef,
        canvasSize, // {width, height, offsetX, offsetY}
        viewportSize, // {width, height}
        viewportBounds, // {x, y, width, height}
        draggingNodeInfo,
        draggingNodeInfoRef,
        performDragUpdateRef,
        isAnimatingZoomRef,
        minZoom,
        maxZoom,
        // UI State flags
        isPaused,
        nodeNamePrompt,
        connectionNamePrompt,
        abstractionPrompt,
        isHeaderEditing,
        isRightPanelInputFocused,
        isLeftPanelInputFocused,
        abstractionCarouselVisible,
        keyboardSettings,
        onDeleteNodes,
    };
    const paramsRef = useRef(props);
    paramsRef.current = props;

    // ---------------------------------------------------------------------------
    // 1. Global Undo/Redo Shortcuts
    // ---------------------------------------------------------------------------
    useEffect(() => {
        // Typing in a field must get the browser's own text undo. This handler
        // used to preventDefault on every Cmd+Z, which killed native undo inside
        // node name and description editors.
        const isTextEntryTarget = (target) => !!target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable === true
        );

        const handleKeyDown = (e) => {
            const key = e.key.toLowerCase();
            const cmdOrCtrl = e.ctrlKey || e.metaKey;
            if (!cmdOrCtrl) return;

            // Cmd+Y is the other conventional redo; it was documented but never wired.
            const isUndoKey = key === 'z' && !e.shiftKey;
            const isRedoKey = (key === 'z' && e.shiftKey) || key === 'y';
            if (!isUndoKey && !isRedoKey) return;

            if (isTextEntryTarget(e.target)) return;

            e.preventDefault();
            e.stopPropagation();

            // performUndo/performRedo also flush any in-progress coalesced edit
            // and navigate to the graph the change belongs to.
            if (isRedoKey) performRedo();
            else performUndo();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // ---------------------------------------------------------------------------
    // 2. Keyboard Movement (WASD / Arrows / Zoom)
    //    Writes directly to refs + DOM, completely bypassing React during movement.
    //    Only flushes settled React state when movement stops.
    // ---------------------------------------------------------------------------
    useEffect(() => {
        let lastFrameTime = performance.now();
        let animationFrameId;
        let wasMoving = false; // Track movement → flush settle when done

        const handleKeyboardMovement = (currentTime = performance.now()) => {
            const params = paramsRef.current;
            const {
                isPaused,
                nodeNamePrompt,
                connectionNamePrompt,
                abstractionPrompt,
                isHeaderEditing,
                isRightPanelInputFocused,
                isLeftPanelInputFocused,
                abstractionCarouselVisible,
                activeGraphId,
                viewportSize,
                canvasSize,
                panOffsetRef,
                zoomLevelRef,
                applyTransform,
                flushSettle,
                onTransformChange,
                isPanningOrZoomingRef,
                draggingNodeInfo,
                draggingNodeInfoRef,
                performDragUpdateRef,
                mousePositionRef,
                isAnimatingZoomRef,
                viewportBounds,
                keyboardSettings,
                minZoom,
                maxZoom
            } = params;

            // Match the wheel/trackpad zoom bounds (dynamic MIN_ZOOM/MAX_ZOOM from
            // NodeCanvas). Falling back to the old hardcoded 0.1/3.0 would let the
            // trackpad zoom out further than the keyboard, then snap on the way back in.
            const zoomFloor = minZoom ?? MIN_ZOOM;
            const zoomCeil = maxZoom ?? MAX_ZOOM;

            // Calculate delta time in seconds, capped to prevent huge jumps after tab freeze
            const deltaTime = Math.min(0.05, (currentTime - lastFrameTime) / 1000);
            lastFrameTime = currentTime;

            // Check for conditions that should disable keyboard controls
            const shouldDisableKeyboard =
                isPaused ||
                nodeNamePrompt?.visible ||
                connectionNamePrompt?.visible ||
                abstractionPrompt?.visible ||
                isHeaderEditing ||
                isRightPanelInputFocused ||
                isLeftPanelInputFocused ||
                abstractionCarouselVisible || // carousel locks the canvas view
                !activeGraphId;

            if (shouldDisableKeyboard) {
                if (wasMoving) { isPanningOrZoomingRef.current = false; flushSettle(); wasMoving = false; }
                return;
            }

            // reference frame rate for speed constants
            const frameRatio = deltaTime * 60;

            // Calculate movement (use lowercase only to avoid shift conflicts)
            let panDx = 0, panDy = 0;
            const panSensitivity = keyboardSettings?.panSensitivity ?? 0.5;
            const currentPanSpeed = KEYBOARD_PAN_SPEED * (panSensitivity * 2) * frameRatio;

            if (keysPressed.current['ArrowLeft'] || keysPressed.current['a']) panDx += currentPanSpeed;
            if (keysPressed.current['ArrowRight'] || keysPressed.current['d']) panDx -= currentPanSpeed;
            if (keysPressed.current['ArrowUp'] || keysPressed.current['w']) panDy += currentPanSpeed;
            if (keysPressed.current['ArrowDown'] || keysPressed.current['s']) panDy -= currentPanSpeed;

            let didMove = false;

            // Apply pan directly to ref + DOM — no scheduleSettle, zero React state during movement
            if (panDx !== 0 || panDy !== 0) {
                const prev = panOffsetRef.current;
                const newX = Math.max(viewportSize.width - canvasSize.width * zoomLevelRef.current, Math.min(0, prev.x + panDx));
                const newY = Math.max(viewportSize.height - canvasSize.height * zoomLevelRef.current, Math.min(0, prev.y + panDy));

                if (newX !== prev.x || newY !== prev.y) {
                    panOffsetRef.current = { x: newX, y: newY };
                    didMove = true;
                }
            }

            // Handle zoom — skip only while the drag-start auto-zoom animation
            // is running (isAnimatingZoomRef guards that window). Otherwise allow
            // manual Shift/Space zoom during a drag so the dragged node can track
            // the mouse across zoom changes, same way it does for pan.
            if (!isAnimatingZoomRef.current) {
                const baseFactor = 1.1;
                const sensitivity = keyboardSettings?.zoomSensitivity ?? 0.5;
                const zoomFactor = 1 + (baseFactor - 1) * sensitivity;
                const timeAdjustedZoomFactor = zoomFactor ** frameRatio;

                let zoomMultiplier = 1;
                if (keysPressed.current[' ']) zoomMultiplier = 1 / timeAdjustedZoomFactor; // Space = zoom out
                if (keysPressed.current['Shift']) zoomMultiplier = timeAdjustedZoomFactor; // Shift = zoom in

                if (zoomMultiplier !== 1) {
                    const prevZoom = zoomLevelRef.current;
                    const newZoom = Math.max(zoomFloor, Math.min(zoomCeil, prevZoom * zoomMultiplier));

                    if (newZoom !== prevZoom) {
                        zoomLevelRef.current = newZoom;
                        didMove = true;

                        // Adjust pan to keep view centered
                        const zoomRatio = newZoom / prevZoom;
                        const centerX = viewportBounds.width / 2;
                        const centerY = viewportBounds.height / 2;
                        const zoomCenterX = centerX + viewportBounds.x;
                        const zoomCenterY = centerY + viewportBounds.y;
                        const prev = panOffsetRef.current;
                        const newPanX = zoomCenterX - (zoomCenterX - prev.x) * zoomRatio;
                        const newPanY = zoomCenterY - (zoomCenterY - prev.y) * zoomRatio;
                        const minPanX = viewportSize.width - canvasSize.width * newZoom;
                        const minPanY = viewportSize.height - canvasSize.height * newZoom;
                        const finalPanX = Math.max(minPanX, Math.min(0, newPanX));
                        const finalPanY = Math.max(minPanY, Math.min(0, newPanY));
                        panOffsetRef.current = { x: finalPanX, y: finalPanY };
                    }
                }
            }

            if (didMove) {
                applyTransform();  // Single DOM write per frame — no React state
                // Fire culling callback synchronously — keyboard path writes refs directly
                // (bypassing setPan/setZoom), so onTransformChange is the only way culling
                // hears about keyboard-driven pan/zoom. Without this, visibility state is
                // frozen until the user touches the trackpad/mouse, causing nodes to vanish.
                onTransformChange?.();

                // If a node drag is live, re-project the mouse into world coords
                // against the NEW pan/zoom so the dragged node tracks the mouse
                // while the canvas moves under it. Same idea as edge-panning's
                // per-frame performDragUpdate, just triggered by keyboard.
                const activeDragInfo = draggingNodeInfoRef?.current;
                if (activeDragInfo && performDragUpdateRef?.current && mousePositionRef?.current) {
                    performDragUpdateRef.current(
                        mousePositionRef.current.x,
                        mousePositionRef.current.y,
                        panOffsetRef.current,
                        zoomLevelRef.current,
                        activeDragInfo
                    );
                }

                if (!wasMoving) isPanningOrZoomingRef.current = true; // guard view-save timeout
                wasMoving = true;
            } else if (wasMoving) {
                // Movement just ended — flush settled state for React consumers
                isPanningOrZoomingRef.current = false;
                flushSettle();
                wasMoving = false;
            }
        };

        const keyboardLoop = (timestamp) => {
            handleKeyboardMovement(timestamp);
            animationFrameId = requestAnimationFrame(keyboardLoop);
        };

        animationFrameId = requestAnimationFrame(keyboardLoop);
        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, []); // STABLE Loop - no dependencies needed as we use paramsRef

    // ---------------------------------------------------------------------------
    // 3. Tab hold-to-scrub (stable — no dependencies, uses refs + getState)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const handleTabKeyDown = (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                if (!e.repeat) {
                    tabHeldDown.current = true;
                }
                return;
            }

            // Directional key while Tab is held → scrub through open graph tabs
            // Normalize so Caps Lock / Shift don't break the comparison.
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            const scrubLeft = key === 'ArrowLeft' || key === 'a' || key === 'q';
            const scrubRight = key === 'ArrowRight' || key === 'd' || key === 'e';
            if (tabHeldDown.current && (scrubLeft || scrubRight)) {
                tabScrubActive.current = true;
                e.preventDefault();
                e.stopPropagation();
                const { openGraphIds, activeGraphId: currentActiveId, setActiveGraphTab } = useGraphStore.getState();
                const currentIndex = openGraphIds.indexOf(currentActiveId);

                if (scrubLeft) {
                    if (currentIndex > 0) {
                        setActiveGraphTab(openGraphIds[currentIndex - 1]);
                    }
                } else {
                    if (currentIndex < openGraphIds.length - 1) {
                        setActiveGraphTab(openGraphIds[currentIndex + 1]);
                    }
                }

                // Prevent panning by clearing from keysPressed
                keysPressed.current[key] = false;
            }
        };

        const handleTabKeyUp = (e) => {
            if (e.key === 'Tab') {
                const wasScrubbing = tabScrubActive.current;
                tabHeldDown.current = false;
                tabScrubActive.current = false;

                // Only toggle panels on release if no scrubbing happened (quick tap)
                if (!wasScrubbing) {
                    const { leftPanelExpanded, rightPanelExpanded, setLeftPanelExpanded, setRightPanelExpanded } = useGraphStore.getState();
                    const anyPanelOpen = leftPanelExpanded || rightPanelExpanded;

                    if (anyPanelOpen) {
                        panelStateBeforeHide.current = { left: leftPanelExpanded, right: rightPanelExpanded };
                        setLeftPanelExpanded(false);
                        setRightPanelExpanded(false);
                    } else {
                        setLeftPanelExpanded(panelStateBeforeHide.current.left);
                        setRightPanelExpanded(panelStateBeforeHide.current.right);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleTabKeyDown);
        window.addEventListener('keyup', handleTabKeyUp);
        return () => {
            window.removeEventListener('keydown', handleTabKeyDown);
            window.removeEventListener('keyup', handleTabKeyUp);
        };
    }, []); // STABLE — no dependencies, uses refs and getState() only

    // ---------------------------------------------------------------------------
    // 4. Shortcuts (Copy/Paste, Delete, etc.)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const handleKeyDown = (e) => {
            const isInputActive = isHeaderEditing || isRightPanelInputFocused || isLeftPanelInputFocused || nodeNamePrompt.visible;

            // Skip keys already handled by Tab-scrub
            if (e.key === 'Tab') return;
            const tabScrubKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            if (tabHeldDown.current && (tabScrubKey === 'ArrowLeft' || tabScrubKey === 'ArrowRight' || tabScrubKey === 'a' || tabScrubKey === 'd' || tabScrubKey === 'q' || tabScrubKey === 'e')) return;

            if (isInputActive || !activeGraphId) { return; }

            // Block destructive keys when AbstractionCarousel is visible, except in editable fields
            if (abstractionCarouselVisible) {
                const isDeleteOrBackspace = e.key === 'Delete' || e.key === 'Backspace';
                if (isDeleteOrBackspace) {
                    const target = e.target;
                    const isEditableTarget = target && (
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.isContentEditable === true
                    );
                    if (!isEditableTarget) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }
            }

            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

            // Copy (Ctrl/Cmd+C)
            if (cmdOrCtrl && e.key.toLowerCase() === 'c') {
                if (selectedInstanceIds.size > 0) {
                    e.preventDefault();
                    const currentGraph = graphsMap.get(activeGraphId);
                    if (currentGraph) {
                        const copied = copySelection(selectedInstanceIds, currentGraph, nodePrototypesMap, edgesMap);
                        clipboardRef.current = copied;
                        onClipboardChange?.();
                        console.log(`[useCanvasKeyboard] Copied ${selectedInstanceIds.size} nodes to clipboard`);
                    }
                    return;
                } else if (selectedEdgeId || selectedEdgeIds.size > 0) {
                    e.preventDefault();
                    const edgeIdToCopy = selectedEdgeId || Array.from(selectedEdgeIds)[0];
                    const edgeToCopy = edgesMap.get(edgeIdToCopy);
                    const copiedDefinition = copyEdgeDefinition(edgeToCopy);
                    if (copiedDefinition) {
                        clipboardRef.current = copiedDefinition;
                        onClipboardChange?.();
                        console.log(`[useCanvasKeyboard] Copied edge definitions to clipboard`);
                    }
                    return;
                }
            }

            // Cut (Ctrl/Cmd+X)
            if (cmdOrCtrl && e.key.toLowerCase() === 'x' && selectedInstanceIds.size > 0) {
                e.preventDefault();
                const currentGraph = graphsMap.get(activeGraphId);
                if (currentGraph) {
                    // First copy
                    const copied = copySelection(selectedInstanceIds, currentGraph, nodePrototypesMap, edgesMap);
                    clipboardRef.current = copied;
                    onClipboardChange?.();

                    // Then remove
                    storeActions.removeMultipleNodeInstances(activeGraphId, selectedInstanceIds);

                    // Clear selection
                    setSelectedInstanceIds(new Set());

                    console.log(`[useCanvasKeyboard] Cut ${selectedInstanceIds.size} nodes to clipboard`);
                }
                return;
            }

            // Paste (Ctrl/Cmd+V)
            if (cmdOrCtrl && e.key.toLowerCase() === 'v' && clipboardRef.current) {
                e.preventDefault();
                const currentGraph = graphsMap.get(activeGraphId);
                if (currentGraph) {
                    // With connections selected, paste means "define these" — from
                    // another connection's definition or from a single copied
                    // Thing. readConnectionClipboard decides which payloads qualify,
                    // and it is the same call the connection menu's Paste button is
                    // built from, so the button and the shortcut can't disagree.
                    const edgesToUpdate = new Set();
                    if (selectedEdgeId) edgesToUpdate.add(selectedEdgeId);
                    selectedEdgeIds.forEach(id => edgesToUpdate.add(id));
                    const connectionPayload = edgesToUpdate.size > 0
                        ? readConnectionClipboard(clipboardRef.current, nodePrototypesMap)
                        : null;

                    if (connectionPayload) {
                        applyConnectionClipboard(connectionPayload, edgesToUpdate, storeActions);
                        console.log(`[useCanvasKeyboard] Pasted "${connectionPayload.name}" onto ${edgesToUpdate.size} connections`);
                    } else if (clipboardRef.current.nodes) {
                        // Determine target position
                        let targetPos;

                        // NOTE: We need mouse position or fallback. 
                        // We use mousePositionRef passed from parent.
                        // Note: In original code, it queried '.canvas' DOM rect. 
                        // We can try to use viewportBounds or just query document.
                        // Querying document is easiest for now to match behavior.
                        const svgElement = document.querySelector('.canvas');
                        const rect = svgElement?.getBoundingClientRect();

                        if (rect && mousePositionRef.current) {
                            // Desktop: use mouse position converted to canvas coords
                            const clientX = mousePositionRef.current.x;
                            const clientY = mousePositionRef.current.y;
                            targetPos = {
                                x: (clientX - rect.left - panOffsetRef.current.x) / zoomLevelRef.current + canvasSize.offsetX,
                                y: (clientY - rect.top - panOffsetRef.current.y) / zoomLevelRef.current + canvasSize.offsetY
                            };
                            console.log(`[useCanvasKeyboard] Pasting at mouse position:`, targetPos);
                        } else {
                            // Mobile fallback: offset from original center
                            targetPos = {
                                x: clipboardRef.current.originalCenter.x + 50,
                                y: clipboardRef.current.originalCenter.y + 50
                            };
                            console.log(`[useCanvasKeyboard] Pasting at fallback position:`, targetPos);
                        }

                        const result = pasteClipboard(
                            clipboardRef.current,
                            activeGraphId,
                            targetPos,
                            storeActions,
                            currentGraph,
                            getNodeDimensions
                        );
                        setSelectedInstanceIds(new Set(result.newInstanceIds));
                    }
                }
                return;
            }

            const isDeleteKey = e.key === 'Delete' || e.key === 'Backspace';
            const nodesSelected = selectedInstanceIds.size > 0;
            const edgeSelected = selectedEdgeId !== null || selectedEdgeIds.size > 0;

            if (isDeleteKey && nodesSelected) {
                e.preventDefault();
                if (onDeleteNodes) {
                    onDeleteNodes(selectedInstanceIds);
                } else {
                    storeActions.removeMultipleNodeInstances(activeGraphId, selectedInstanceIds);
                }
                setSelectedInstanceIds(new Set());
            } else if (isDeleteKey && edgeSelected) {
                console.log('[useCanvasKeyboard] Delete key pressed with edge selected:', {
                    selectedEdgeId,
                    connectionNamePromptVisible: connectionNamePrompt.visible
                });

                if (!connectionNamePrompt.visible) {
                    e.preventDefault();

                    // Delete single selected edge
                    if (selectedEdgeId) {
                        storeActions.removeEdge(selectedEdgeId);
                    }

                    // Delete multiple selected edges
                    if (selectedEdgeIds.size > 0) {
                        selectedEdgeIds.forEach(edgeId => {
                            storeActions.removeEdge(edgeId);
                        });
                        storeActions.clearSelectedEdgeIds();
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        selectedInstanceIds,
        selectedEdgeId,
        selectedEdgeIds,
        isHeaderEditing,
        isRightPanelInputFocused,
        isLeftPanelInputFocused,
        nodeNamePrompt.visible,
        connectionNamePrompt.visible,
        abstractionCarouselVisible,
        activeGraphId,
        storeActions,
        graphsMap,
        nodePrototypesMap,
        edgesMap,
        panOffset,
        zoomLevel,
        canvasSize,
        clipboardRef,
        onClipboardChange,
        mousePositionRef, // Ensure ref is up to date (it is stable)
        setSelectedInstanceIds,
        onDeleteNodes,
    ]);
};
