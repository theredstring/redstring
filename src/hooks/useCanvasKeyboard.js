import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import useGraphStore from '../store/graphStore';
import useHistoryStore from '../store/historyStore';
import { copySelection, pasteClipboard } from '../utils/clipboard';
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
    keysPressed,
    mousePositionRef, // {x, y} in client coords
    panOffset,
    setPanOffset,
    zoomLevel,
    setZoomLevel,
    canvasSize, // {width, height, offsetX, offsetY}
    viewportSize, // {width, height}
    viewportBounds, // {x, y, width, height}
    draggingNodeInfo,
    isAnimatingZoom,
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
        keysPressed,
        mousePositionRef, // {x, y} in client coords
        panOffset,
        setPanOffset,
        zoomLevel,
        setZoomLevel,
        canvasSize, // {width, height, offsetX, offsetY}
        viewportSize, // {width, height}
        viewportBounds, // {x, y, width, height}
        draggingNodeInfo,
        isAnimatingZoom,
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
    };
    const paramsRef = useRef(props);
    paramsRef.current = props;

    // ---------------------------------------------------------------------------
    // 1. Global Undo/Redo Shortcuts
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Check for Ctrl+Z or Cmd+Z
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                const isRedo = e.shiftKey;

                // Prevent default browser undo/redo
                e.preventDefault();
                e.stopPropagation();

                const { undo, redo, canUndo, canRedo } = useHistoryStore.getState();
                const { applyPatches } = useGraphStore.getState();

                if (isRedo) {
                    if (canRedo()) redo(applyPatches);
                } else {
                    if (canUndo()) undo(applyPatches);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // ---------------------------------------------------------------------------
    // 2. Keyboard Movement (WASD / Arrows / Zoom)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        let lastFrameTime = performance.now();
        let animationFrameId;

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
                activeGraphId,
                viewportSize,
                canvasSize,
                zoomLevel,
                draggingNodeInfo,
                isAnimatingZoom,
                setPanOffset,
                setZoomLevel,
                viewportBounds,
                keyboardSettings
            } = params;

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
                !activeGraphId;

            if (shouldDisableKeyboard) return;

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

            // Apply movement
            if (panDx !== 0 || panDy !== 0) {
                setPanOffset(prevPan => {
                    const newX = Math.max(viewportSize.width - canvasSize.width * zoomLevel, Math.min(0, prevPan.x + panDx));
                    const newY = Math.max(viewportSize.height - canvasSize.height * zoomLevel, Math.min(0, prevPan.y + panDy));

                    // Only update if actually different to avoid redundant renders
                    if (newX === prevPan.x && newY === prevPan.y) return prevPan;
                    return { x: newX, y: newY };
                });
            }

            // Handle zoom (stable approach)
            // Skip keyboard zoom during drag to prevent interference with drag zoom animation
            if (draggingNodeInfo || isAnimatingZoom) return;

            // USE GEOMETRIC ZOOM: consistent relative change across zoom levels
            const baseFactor = 1.1;
            const sensitivity = keyboardSettings?.zoomSensitivity ?? 0.5;
            // Map 0 -> 1 sensitivity to 1.0 -> baseFactor scaling
            const zoomFactor = 1 + (baseFactor - 1) * sensitivity;

            // Adjust factor by frame ratio to keep speed consistent across refresh rates
            const timeAdjustedZoomFactor = zoomFactor ** frameRatio;

            let zoomMultiplier = 1;
            if (keysPressed.current[' ']) zoomMultiplier = 1 / timeAdjustedZoomFactor; // Space = zoom out
            if (keysPressed.current['Shift']) zoomMultiplier = timeAdjustedZoomFactor; // Shift = zoom in

            if (zoomMultiplier !== 1) {
                setZoomLevel(prevZoom => {
                    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * zoomMultiplier));

                    // Only adjust pan if zoom actually changed
                    if (newZoom !== prevZoom) {
                        const zoomRatio = newZoom / prevZoom;
                        // Use the actual visible viewport center, not the full window center
                        const centerX = viewportBounds.width / 2;
                        const centerY = viewportBounds.height / 2;

                        // Update pan to keep view centered, with boundary constraints
                        setPanOffset(prevPan => {
                            // The zoom center should be relative to the viewport bounds
                            const zoomCenterX = centerX + viewportBounds.x;
                            const zoomCenterY = centerY + viewportBounds.y;

                            const newPanX = zoomCenterX - (zoomCenterX - prevPan.x) * zoomRatio;
                            const newPanY = zoomCenterY - (zoomCenterY - prevPan.y) * zoomRatio;

                            // Apply zoom boundaries
                            const maxPanX = 0;
                            const minPanX = viewportSize.width - canvasSize.width * newZoom;
                            const maxPanY = 0;
                            const minPanY = viewportSize.height - canvasSize.height * newZoom;

                            const finalPanX = Math.max(minPanX, Math.min(maxPanX, newPanX));
                            const finalPanY = Math.max(minPanY, Math.min(maxPanY, newPanY));

                            // Only update if actually different
                            if (finalPanX === prevPan.x && finalPanY === prevPan.y) return prevPan;
                            return { x: finalPanX, y: finalPanY };
                        });
                    }

                    return newZoom;
                });
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
    // 3. Shortcuts (Copy/Paste, Delete, etc.)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const handleKeyDown = (e) => {
            const isInputActive = isHeaderEditing || isRightPanelInputFocused || isLeftPanelInputFocused || nodeNamePrompt.visible;

            // TAB key: track hold state, defer panel toggle to keyup
            if (e.key === 'Tab') {
                e.preventDefault();
                if (!e.repeat && !tabHeldDown.current) {
                    tabHeldDown.current = true;
                }
                return;
            }

            // Tab-scrub: pressing a directional key while Tab is held activates scrub mode
            if (tabHeldDown.current && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'a' || e.key === 'd')) {
                tabScrubActive.current = true;
                e.preventDefault();
                e.stopPropagation();
                const { openGraphIds, activeGraphId: currentActiveId, setActiveGraphTab } = useGraphStore.getState();
                const currentIndex = openGraphIds.indexOf(currentActiveId);

                if (e.key === 'ArrowLeft' || e.key === 'a') {
                    if (currentIndex > 0) {
                        setActiveGraphTab(openGraphIds[currentIndex - 1]);
                    }
                } else {
                    if (currentIndex < openGraphIds.length - 1) {
                        setActiveGraphTab(openGraphIds[currentIndex + 1]);
                    }
                }

                // Prevent panning by clearing from keysPressed
                const normalizedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
                keysPressed.current[normalizedKey] = false;
                return;
            }

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
                        console.log(`[useCanvasKeyboard] Copied ${selectedInstanceIds.size} nodes to clipboard`);
                    }
                    return;
                } else if (selectedEdgeId || selectedEdgeIds.size > 0) {
                    e.preventDefault();
                    const edgeIdToCopy = selectedEdgeId || Array.from(selectedEdgeIds)[0];
                    const edgeToCopy = edgesMap.get(edgeIdToCopy);
                    if (edgeToCopy) {
                        clipboardRef.current = {
                            type: 'edge_definitions',
                            definitions: {
                                color: edgeToCopy.color,
                                typeNodeId: edgeToCopy.typeNodeId,
                                definitionNodeIds: [...(edgeToCopy.definitionNodeIds || [])]
                            }
                        };
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
                    if (clipboardRef.current.type === 'edge_definitions') {
                        // Paste edge definitions onto selected edges
                        const edgesToUpdate = new Set();
                        if (selectedEdgeId) edgesToUpdate.add(selectedEdgeId);
                        selectedEdgeIds.forEach(id => edgesToUpdate.add(id));

                        if (edgesToUpdate.size > 0) {
                            const defs = clipboardRef.current.definitions;
                            edgesToUpdate.forEach(edgeId => {
                                storeActions.updateEdge(edgeId, (draft) => {
                                    if (defs.color) draft.color = defs.color;
                                    draft.typeNodeId = defs.typeNodeId;
                                    draft.definitionNodeIds = [...defs.definitionNodeIds];
                                });
                            });
                            console.log(`[useCanvasKeyboard] Pasted edge definitions to ${edgesToUpdate.size} edges`);
                        }
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
                                x: (clientX - rect.left - panOffset.x) / zoomLevel + canvasSize.offsetX,
                                y: (clientY - rect.top - panOffset.y) / zoomLevel + canvasSize.offsetY
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
                storeActions.removeMultipleNodeInstances(activeGraphId, selectedInstanceIds);
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

        const handleKeyUp = (e) => {
            if (e.key === 'Tab') {
                const wasScrubbing = tabScrubActive.current;
                tabHeldDown.current = false;
                tabScrubActive.current = false;

                // Only toggle panels on release if scrub mode was never activated (quick tap)
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

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
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
        mousePositionRef, // Ensure ref is up to date (it is stable)
        setSelectedInstanceIds
    ]);
};
