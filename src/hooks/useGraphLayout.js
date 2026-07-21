import { useCallback, useEffect, useRef } from 'react';
import { applyLayout, FORCE_LAYOUT_DEFAULTS, deriveGroupVisualBounds } from '../services/graphLayoutService.js';
import { getNodeDimensions } from '../utils'; // Assumed utility
import { HEADER_HEIGHT } from '../constants';

/**
 * Resolve the displayed connection name for an edge.
 * Mirrors the rendering logic in NodeCanvas.jsx.
 */
function resolveConnectionName(edge, nodePrototypesMap, edgePrototypesMap) {
    if (edge.connectionName) return edge.connectionName;
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
        const defNode = nodePrototypesMap?.get(edge.definitionNodeIds[0]);
        if (defNode?.name) return defNode.name;
    }
    if (edge.typeNodeId) {
        const edgeProto = edgePrototypesMap?.get(edge.typeNodeId);
        if (edgeProto?.name) return edgeProto.name;
    }
    return '';
}

export const useGraphLayout = ({
    activeGraphId,
    storeActions,
    graphsMap,
    nodes,
    edges,
    baseDimsById,
    canvasSize,
    resetConnectionLabelCache,
    // Prototype maps for resolving edge connection names
    nodePrototypesMap = null,
    edgePrototypesMap = null,
    // Layout settings
    layoutScalePreset = 1.0,
    layoutScaleMultiplier = 1.0,
    layoutIterationPreset = 100,
    groupLayoutAlgorithm = 'force-directed',
    // Force tuner settings — individual force params for consistency with AI and interactive sim
    forceTunerSettings = null,
    // Resolved connection label font (59.4 × textSettings.fontSize ×
    // connectionLabelSize) so layout reserves the space labels actually render at
    connectionFontSize = 59.4,
    // Zoom/pan control for zoom-to-fit after auto-layout
    setZoomLevel = null,
    setPanOffset = null,
    // Full transform controller (useCanvasTransform) — when provided, the
    // camera tweens to the zoom-to-fit target alongside the node motion
    canvasTransform = null,
    viewportSize = null,
    maxZoom = 3,
}) => {
    // ---------------------------------------------------------------------------
    // 1. Move Out of Bounds Nodes
    // ---------------------------------------------------------------------------
    const moveOutOfBoundsNodesInBounds = useCallback(() => {
        if (!nodes || nodes.length === 0 || !canvasSize) return;

        // Find nodes that are outside canvas bounds
        const outOfBoundsNodes = [];
        const canvasMinX = canvasSize.offsetX;
        const canvasMinY = canvasSize.offsetY;
        const canvasMaxX = canvasSize.offsetX + canvasSize.width;
        const canvasMaxY = canvasSize.offsetY + canvasSize.height;

        nodes.forEach(node => {
            const dims = baseDimsById.get(node.id);
            if (!dims) return;

            const nodeLeft = node.x;
            const nodeTop = node.y;
            const nodeRight = node.x + dims.currentWidth;
            const nodeBottom = node.y + dims.currentHeight;

            // Check if node is outside bounds
            if (nodeLeft < canvasMinX || nodeRight > canvasMaxX ||
                nodeTop < canvasMinY || nodeBottom > canvasMaxY) {
                outOfBoundsNodes.push({
                    ...node,
                    dims,
                    left: nodeLeft,
                    top: nodeTop,
                    right: nodeRight,
                    bottom: nodeBottom
                });
            }
        });

        if (outOfBoundsNodes.length === 0) {
            return;
        }

        // Calculate bounding box of all out-of-bounds nodes
        let groupMinX = Infinity, groupMinY = Infinity;
        let groupMaxX = -Infinity, groupMaxY = -Infinity;

        outOfBoundsNodes.forEach(node => {
            groupMinX = Math.min(groupMinX, node.left);
            groupMinY = Math.min(groupMinY, node.top);
            groupMaxX = Math.max(groupMaxX, node.right);
            groupMaxY = Math.max(groupMaxY, node.bottom);
        });

        const groupWidth = groupMaxX - groupMinX;
        const groupHeight = groupMaxY - groupMinY;

        // Calculate safe area within canvas (with padding)
        const padding = 1000;
        const safeMinX = canvasMinX + padding;
        const safeMinY = canvasMinY + padding;
        const safeMaxX = canvasMaxX - padding;
        const safeMaxY = canvasMaxY - padding;
        const safeWidth = safeMaxX - safeMinX;
        const safeHeight = safeMaxY - safeMinY;

        // Calculate where to place the group (center it in safe area)
        const targetCenterX = safeMinX + safeWidth / 2;
        const targetCenterY = safeMinY + safeHeight / 2;
        const currentCenterX = groupMinX + groupWidth / 2;
        const currentCenterY = groupMinY + groupHeight / 2;

        // Calculate offset to move the group
        const offsetX = targetCenterX - currentCenterX;
        const offsetY = targetCenterY - currentCenterY;

        // Apply the offset to all out-of-bounds nodes
        const positionUpdates = outOfBoundsNodes.map(node => ({
            instanceId: node.id,
            x: node.x + offsetX,
            y: node.y + offsetY
        }));

        storeActions.updateMultipleNodeInstancePositions(activeGraphId, positionUpdates);
        if (resetConnectionLabelCache) resetConnectionLabelCache();
    }, [nodes, baseDimsById, canvasSize, storeActions, activeGraphId, resetConnectionLabelCache]);


    // ---------------------------------------------------------------------------
    // 2. Auto Layout
    // ---------------------------------------------------------------------------
    // In-flight layout animation frame (cancelled if a new layout starts)
    const layoutAnimRef = useRef(null);
    useEffect(() => () => {
        if (layoutAnimRef.current) cancelAnimationFrame(layoutAnimRef.current);
    }, []);

    // Computes final positions with the batch engine, then moves each node
    // directly to its target with one eased motion. The animation is real
    // (edges/labels/groups all follow the nodes) but the path is direct —
    // no live-physics wandering, orbiting, or rotation.
    const applyAutoLayoutToActiveGraph = useCallback((opts = {}) => {
        const { animate = true, duration = 750 } = opts;
        if (!activeGraphId) {
            alert('No active graph is selected for auto-layout.');
            return;
        }

        if (!nodes || nodes.length === 0) {
            alert('Active graph has no nodes to layout yet.');
            return;
        }

        // Skip auto-layout for very large graphs to prevent UI freeze
        if (nodes.length > 200) {
            console.log(`[useGraphLayout] Skipping auto-layout: graph too large (${nodes.length} nodes, threshold is 200)`);
            return;
        }

        // Show loading indicator for large graphs
        if (nodes.length > 20) {
            console.log(`[useGraphLayout] Applying auto-layout to ${nodes.length} nodes...`);
        }

        const graphData = activeGraphId ? graphsMap.get(activeGraphId) : null;

        const layoutNodes = nodes.map(node => {
            const cachedDims = baseDimsById.get(node.id);
            const realDims = cachedDims && cachedDims.currentWidth && cachedDims.currentHeight
                ? cachedDims
                : getNodeDimensions(node, false, null);
            // Fallback to defaults if realDims or constants are missing
            const nodeSpacing = (FORCE_LAYOUT_DEFAULTS && FORCE_LAYOUT_DEFAULTS.nodeSpacing) || 250;

            const labelWidth = realDims?.currentWidth ?? nodeSpacing;
            const labelHeight = realDims?.currentHeight ?? nodeSpacing;

            return {
                id: node.id,
                prototypeId: node.prototypeId,
                x: typeof node.x === 'number' ? node.x : 0,
                y: typeof node.y === 'number' ? node.y : 0,
                width: labelWidth,
                height: labelHeight,
                labelWidth,
                labelHeight,
                imageHeight: realDims?.calculatedImageHeight ?? 0,
                nodeSize: Math.max(labelWidth, labelHeight, nodeSpacing)
            };
        });

        const layoutEdges = edges
            .filter(edge => edge && edge.sourceId && edge.destinationId)
            .map(edge => ({
                sourceId: edge.sourceId,
                destinationId: edge.destinationId,
                name: resolveConnectionName(edge, nodePrototypesMap, edgePrototypesMap)
            }));

        const layoutWidth = Math.max(2000, canvasSize?.width || 2000);
        const layoutHeight = Math.max(2000, canvasSize?.height || 2000);
        const layoutPadding = Math.max(300, Math.min(layoutWidth, layoutHeight) * 0.08);

        const groups = Array.from(graphData?.groups?.values() || []);
        const layoutOptions = {
            width: layoutWidth,
            height: layoutHeight,
            padding: layoutPadding,
            layoutScale: layoutScalePreset,
            layoutScaleMultiplier,
            iterationPreset: layoutIterationPreset,
            // When groups exist, let groupSeparatedLayout handle the two-phase approach
            // (layout each group independently → position groups in space).
            // Without groups, preserve existing positions for incremental refinement.
            useExistingPositions: groups.length === 0,
            groups,
            edgeLabelFontSize: connectionFontSize,
            // Pass full force tuner parameters so auto-layout uses
            // the same configuration as the interactive simulation and AI.
            ...(forceTunerSettings ? {
                repulsionStrength: forceTunerSettings.repulsionStrength,
                attractionStrength: forceTunerSettings.attractionStrength,
                linkDistance: forceTunerSettings.linkDistance,
                minLinkDistance: forceTunerSettings.minLinkDistance,
                centerStrength: forceTunerSettings.centerStrength,
                collisionRadius: forceTunerSettings.collisionRadius,
                edgeAvoidance: forceTunerSettings.edgeAvoidance,
                alphaDecay: forceTunerSettings.alphaDecay,
                velocityDecay: forceTunerSettings.velocityDecay,
                // Group force parameters
                groupAttractionStrength: forceTunerSettings.groupAttractionStrength,
                groupRepulsionStrength: forceTunerSettings.groupRepulsionStrength,
                groupExclusionStrength: forceTunerSettings.groupExclusionStrength,
                minGroupDistance: forceTunerSettings.minGroupDistance,
                groupBoundaryPadding: forceTunerSettings.groupBoundaryPadding,
                stiffness: forceTunerSettings.stiffness,
            } : {})
        };

        try {
            // Assuming applyLayout is available/imported
            let updates = applyLayout(layoutNodes, layoutEdges, groupLayoutAlgorithm, layoutOptions);

            if (!updates || updates.length === 0) {
                console.warn('[useGraphLayout] Layout produced no updates.');
                return;
            }

            // Recentering: shift layout output so it's centered within current canvas
            if (canvasSize && updates.length > 0) {
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;
                updates.forEach(update => {
                    if (update.x < minX) minX = update.x;
                    if (update.y < minY) minY = update.y;
                    if (update.x > maxX) maxX = update.x;
                    if (update.y > maxY) maxY = update.y;
                });
                if (Number.isFinite(minX) && Number.isFinite(maxX)) {
                    const producedCenterX = (minX + maxX) / 2;
                    const producedCenterY = (minY + maxY) / 2;
                    const targetCenterX = canvasSize.offsetX + canvasSize.width / 2;
                    const targetCenterY = canvasSize.offsetY + canvasSize.height / 2;
                    const shiftX = targetCenterX - producedCenterX;
                    const shiftY = targetCenterY - producedCenterY;
                    updates = updates.map(update => ({
                        ...update,
                        x: Math.round(update.x + shiftX),
                        y: Math.round(update.y + shiftY)
                    }));
                }
            }

            if (resetConnectionLabelCache) resetConnectionLabelCache();

            // Compute the zoom-to-fit camera target framed on the FINAL positions
            let cameraTarget = null;
            // Screen-space margins around the framed content. The margin is a
            // fixed pixel breathing room; top/bottom add the UI that overlays
            // the canvas (fixed header bar, floating bottom control panel).
            const FIT_MARGIN = 20;
            const BOTTOM_PANEL_ALLOWANCE = 130;
            const marginTop = HEADER_HEIGHT + FIT_MARGIN;
            const marginBottom = BOTTOM_PANEL_ALLOWANCE + FIT_MARGIN;
            // Visible-area center in screen space — the point the framed
            // content should center on (shared by target, tween start, and
            // per-frame pan derivation so the motion doesn't drift)
            const visCenterX = viewportSize ? viewportSize.width / 2 : 0;
            const visCenterY = viewportSize
                ? marginTop + (viewportSize.height - marginTop - marginBottom) / 2
                : 0;
            if (viewportSize && updates.length > 0 && (canvasTransform || (setZoomLevel && setPanOffset))) {
                const finalPosById = new Map(updates.map(u => [u.instanceId, u]));
                const dimsFor = (instanceId) => {
                    const node = layoutNodes.find(n => n.id === instanceId);
                    const dims = baseDimsById.get(instanceId);
                    return {
                        width: dims?.currentWidth || node?.width || 150,
                        height: dims?.currentHeight || node?.height || 150
                    };
                };

                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                updates.forEach(update => {
                    const { width, height } = dimsFor(update.instanceId);
                    minX = Math.min(minX, update.x);
                    minY = Math.min(minY, update.y);
                    maxX = Math.max(maxX, update.x + width);
                    maxY = Math.max(maxY, update.y + height);
                });

                // Fold in group rect chrome (border margins + title bars) —
                // framing raw node bounds crops group rects and titles, which
                // reads as over-zoomed
                groups.forEach(group => {
                    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
                    (group.memberInstanceIds || []).forEach(id => {
                        const u = finalPosById.get(id);
                        if (!u) return;
                        const { width, height } = dimsFor(id);
                        gMinX = Math.min(gMinX, u.x);
                        gMinY = Math.min(gMinY, u.y);
                        gMaxX = Math.max(gMaxX, u.x + width);
                        gMaxY = Math.max(gMaxY, u.y + height);
                    });
                    if (!Number.isFinite(gMinX)) return;
                    const vb = deriveGroupVisualBounds(group, { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY });
                    minX = Math.min(minX, vb.x);
                    minY = Math.min(minY, vb.y);
                    maxX = Math.max(maxX, vb.x + vb.w);
                    maxY = Math.max(maxY, vb.y + vb.h);
                });

                const nodesWidth = Math.max(1, maxX - minX);
                const nodesHeight = Math.max(1, maxY - minY);
                const nodesCenterX = (minX + maxX) / 2;
                const nodesCenterY = (minY + maxY) / 2;

                const availW = Math.max(100, viewportSize.width - FIT_MARGIN * 2);
                const availH = Math.max(100, viewportSize.height - marginTop - marginBottom);
                // Fit everything in the visible area with the fixed margin —
                // but never zoom IN past natural size to frame a small graph
                let targetZoom = Math.min(availW / nodesWidth, availH / nodesHeight);
                targetZoom = Math.max(Math.min(targetZoom, 1.0, maxZoom), 0.05);

                cameraTarget = {
                    zoom: targetZoom,
                    centerX: nodesCenterX,
                    centerY: nodesCenterY,
                    pan: {
                        x: visCenterX - (nodesCenterX - canvasSize.offsetX) * targetZoom,
                        y: visCenterY - (nodesCenterY - canvasSize.offsetY) * targetZoom
                    }
                };
            }

            const applyCameraInstant = () => {
                if (!cameraTarget) return;
                if (canvasTransform?.jumpTo) {
                    canvasTransform.jumpTo(cameraTarget.pan, cameraTarget.zoom);
                } else {
                    setZoomLevel(cameraTarget.zoom);
                    setPanOffset(cameraTarget.pan);
                }
            };

            const finishLayout = () => {
                storeActions.updateMultipleNodeInstancePositions(
                    activeGraphId,
                    updates,
                    { finalize: true, source: 'auto-layout', algorithm: 'force-directed' }
                );
                if (resetConnectionLabelCache) resetConnectionLabelCache();
                try {
                    moveOutOfBoundsNodesInBounds();
                } catch (boundErr) {
                    console.warn('[useGraphLayout] Bound correction failed:', boundErr);
                }
                window.dispatchEvent(new CustomEvent('rs-auto-layout-complete', {
                    detail: { graphId: activeGraphId, nodeCount: updates.length }
                }));
                console.log('[useGraphLayout] Applied', groupLayoutAlgorithm, 'layout to graph', activeGraphId, 'for', updates.length, 'nodes.');
            };

            if (!animate) {
                applyCameraInstant();
                finishLayout();
                return;
            }

            // Camera tween start state: current world-space viewport center +
            // zoom, read from the transform controller's live refs. The center
            // lerps while zoom interpolates in log space (constant perceived
            // zoom rate); pan is derived each frame so the focus stays smooth.
            let camStart = null;
            if (cameraTarget && canvasTransform?.panRef && canvasTransform?.zoomRef) {
                const p0 = canvasTransform.panRef.current;
                const z0 = canvasTransform.zoomRef.current;
                camStart = {
                    zoom: z0,
                    centerX: (visCenterX - p0.x) / z0 + canvasSize.offsetX,
                    centerY: (visCenterY - p0.y) / z0 + canvasSize.offsetY
                };
            } else {
                // No transform controller — reframe instantly, nodes still tween
                applyCameraInstant();
            }

            // Direct eased tween: current position → computed position.
            // One coherent motion, no redundant physics exploration.
            if (layoutAnimRef.current) cancelAnimationFrame(layoutAnimRef.current);
            const startPositions = new Map(layoutNodes.map(n => [n.id, { x: n.x, y: n.y }]));
            const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
            const startTime = performance.now();

            const tick = (now) => {
                const t = Math.min(1, (now - startTime) / duration);
                const k = easeInOutCubic(t);

                if (camStart) {
                    const z = camStart.zoom * Math.pow(cameraTarget.zoom / camStart.zoom, k);
                    const cx = camStart.centerX + (cameraTarget.centerX - camStart.centerX) * k;
                    const cy = camStart.centerY + (cameraTarget.centerY - camStart.centerY) * k;
                    canvasTransform.setPanAndZoom(
                        {
                            x: visCenterX - (cx - canvasSize.offsetX) * z,
                            y: visCenterY - (cy - canvasSize.offsetY) * z
                        },
                        z
                    );
                }

                const frame = updates.map(u => {
                    const s = startPositions.get(u.instanceId) || { x: u.x, y: u.y };
                    return {
                        instanceId: u.instanceId,
                        x: s.x + (u.x - s.x) * k,
                        y: s.y + (u.y - s.y) * k
                    };
                });
                storeActions.updateMultipleNodeInstancePositions(activeGraphId, frame, { skipSave: true });
                if (t < 1) {
                    layoutAnimRef.current = requestAnimationFrame(tick);
                } else {
                    layoutAnimRef.current = null;
                    if (camStart) applyCameraInstant(); // lands exactly + flushes settled state
                    finishLayout();
                }
            };
            layoutAnimRef.current = requestAnimationFrame(tick);
        } catch (error) {
            console.error('[useGraphLayout] Failed to apply layout:', error);
            alert(`Auto-layout failed: ${error.message}`);
        }
    }, [
        activeGraphId,
        baseDimsById,
        nodes,
        edges,
        storeActions,
        moveOutOfBoundsNodesInBounds,
        resetConnectionLabelCache,
        layoutScalePreset,
        layoutScaleMultiplier,
        layoutIterationPreset,
        canvasSize,
        groupLayoutAlgorithm,
        graphsMap,
        forceTunerSettings,
        connectionFontSize,
        setZoomLevel,
        setPanOffset,
        canvasTransform,
        viewportSize,
        maxZoom
    ]);


    // ---------------------------------------------------------------------------
    // 3. Condense Nodes
    // ---------------------------------------------------------------------------
    const condenseGraphNodes = useCallback(() => {
        if (!activeGraphId || !nodes?.length || !canvasSize) return;
        const targetX = canvasSize.offsetX + canvasSize.width / 2;
        const targetY = canvasSize.offsetY + canvasSize.height / 2;
        const radius = Math.min(160, Math.max(60, 160 - nodes.length));
        const updates = nodes.map((node, index) => {
            const angle = (2 * Math.PI * index) / nodes.length;
            return {
                instanceId: node.id,
                x: targetX + Math.cos(angle) * radius * 0.3,
                y: targetY + Math.sin(angle) * radius * 0.3
            };
        });

        storeActions.updateMultipleNodeInstancePositions(
            activeGraphId,
            updates,
            { finalize: true, source: 'condense' }
        );
        if (resetConnectionLabelCache) resetConnectionLabelCache();
    }, [activeGraphId, nodes, canvasSize, storeActions, resetConnectionLabelCache]);


    // ---------------------------------------------------------------------------
    // 4. Auto-correct on Mount/Update
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (nodes && nodes.length > 0 && activeGraphId) {
            // Small delay to ensure dimensions are calculated
            const timer = setTimeout(() => {
                moveOutOfBoundsNodesInBounds();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [activeGraphId, nodes, moveOutOfBoundsNodesInBounds]); // Added dependencies

    return {
        moveOutOfBoundsNodesInBounds,
        applyAutoLayoutToActiveGraph,
        condenseGraphNodes
    };
};
