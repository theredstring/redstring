import { useCallback, useEffect } from 'react';
import { applyLayout, FORCE_LAYOUT_DEFAULTS } from '../services/graphLayoutService.js';
import { getNodeDimensions } from '../utils'; // Assumed utility

export const useGraphLayout = ({
    activeGraphId,
    storeActions,
    graphsMap,
    nodes,
    edges,
    baseDimsById,
    canvasSize,
    resetConnectionLabelCache,
    // Layout settings
    layoutScalePreset = 1.0,
    layoutScaleMultiplier = 1.0,
    layoutIterationPreset = 100,
    groupLayoutAlgorithm = 'force-directed',
    // Force tuner settings — individual force params for consistency with AI and interactive sim
    forceTunerSettings = null,
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
    const applyAutoLayoutToActiveGraph = useCallback(() => {
        if (!activeGraphId) {
            alert('No active graph is selected for auto-layout.');
            return;
        }

        if (!nodes || nodes.length === 0) {
            alert('Active graph has no nodes to layout yet.');
            return;
        }

        // Skip auto-layout for very large graphs to prevent UI freeze
        if (nodes.length > 50) {
            console.log(`[useGraphLayout] Skipping auto-layout: graph too large (${nodes.length} nodes, threshold is 50)`);
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
                destinationId: edge.destinationId
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
            storeActions.updateMultipleNodeInstancePositions(
                activeGraphId,
                updates,
                { finalize: true, source: 'auto-layout', algorithm: 'force-directed' }
            );
            if (resetConnectionLabelCache) resetConnectionLabelCache();

            console.log('[useGraphLayout] Applied', groupLayoutAlgorithm, 'layout to graph', activeGraphId, 'for', updates.length, 'nodes.');

            setTimeout(() => {
                try {
                    moveOutOfBoundsNodesInBounds();
                } catch (boundErr) {
                    console.warn('[useGraphLayout] Bound correction failed:', boundErr);
                }
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('rs-auto-layout-complete', {
                        detail: { graphId: activeGraphId, nodeCount: updates.length }
                    }));
                }, 100);
            }, 0);
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
        forceTunerSettings
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
