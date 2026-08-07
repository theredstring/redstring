import { useCallback, useEffect, useRef, useState } from 'react';
import { FORCE_LAYOUT_DEFAULTS, LAYOUT_ITERATION_PRESETS, deriveGroupVisualBounds } from '../services/graphLayoutService.js';
import { runLayout, cancelLayout } from '../services/layoutRunner.js';
import { EDGE_LABEL_BASE_FONT_SIZE } from '../services/layoutGeometry.js';
import { getNodeDimensions } from '../utils'; // Assumed utility
import { snapPositionToGrid } from '../utils/canvas/geometryUtils.js';
import { HEADER_HEIGHT } from '../constants';

// ── Layout time budget ──────────────────────────────────────────────────────
// The force solver runs synchronously on the main thread, and each iteration
// costs O(n²) node-node repulsion plus O(n·e) node-edge repulsion. So the
// preset iteration counts (300 / 600 / 1200) blow up quickly with graph size:
// measured, 100 nodes at 600 iterations already blocks for ~760ms, and 253
// nodes for ~3.8s. Rather than gate on node count, cap the *work*.
//
// Throughput is NOT constant in that work term. Measured on this solver it runs
// ~12k work units/ms on small graphs but falls to ~2.7k by 800 nodes — the
// per-iteration Map and edge-segment reallocation makes large graphs pay a GC
// and cache penalty the raw loop count doesn't capture. Assuming a flat rate
// under-predicts an 800-node layout by ~5x, so the rate is degraded by node
// count; the divisor below is fitted to measurements at n = 100/253/400/800.
const LAYOUT_UNITS_PER_MS_BASE = 12000;
const LAYOUT_THROUGHPUT_KNEE = 400;
const layoutUnitsPerMs = (nodeCount) =>
    LAYOUT_UNITS_PER_MS_BASE / (1 + (nodeCount / LAYOUT_THROUGHPUT_KNEE) ** 2);

// How long a layout pass may take. Since the solver runs in a worker this is
// wait-with-a-progress-bar time, not frozen-UI time, so it can be far more
// generous than a main-thread budget could — the cap exists to stop quality
// gains that cost seconds, not to protect the frame rate.
const LAYOUT_TIME_BUDGET_MS = 2500;
// Floor: below this the simulation hasn't settled anything and the result is
// worse than not running. Graphs big enough to hit the floor overrun the time
// budget — reported via `overBudget` rather than silently absorbed.
const MIN_LAYOUT_ITERATIONS = 80;
// Node count below which auto-layout finishes too quickly for a progress
// indicator to be anything but a flash, so it isn't shown at all.
const LAYOUT_INDICATOR_MIN_NODES = 35;
// Must track FORCE_LAYOUT_DEFAULTS.alphaMin — the cooling schedule below is
// derived so the run actually reaches it.
const LAYOUT_ALPHA_MIN = 0.001;

/**
 * Work units for one solver iteration — the two nested loops that dominate it.
 */
const iterationWorkUnits = (nodeCount, edgeCount) =>
    (nodeCount * nodeCount) / 2 + nodeCount * edgeCount;

/**
 * Cap iterations so a layout pass fits inside LAYOUT_TIME_BUDGET_MS.
 *
 * Cutting iterations alone would be a bug: every force in the solver is scaled
 * by `alpha`, which cools by `alpha *= (1 - alphaDecay)` each iteration. Ending
 * a run early leaves alpha high, so the sim stops while still hot and the final
 * positions are unsettled. So the cooling schedule is re-derived to land on
 * alphaMin over however many steps the budget allows — a short run and a long
 * run then anneal through the same schedule at different resolutions, which is
 * what an annealing schedule is supposed to do.
 *
 * `presetAlphaDecay` is accepted but no longer used; the preset's decay is now
 * fully determined by its iteration count.
 */
function computeIterationBudget(nodeCount, edgeCount, presetIterations, presetAlphaDecay) {
    const perIteration = iterationWorkUnits(nodeCount, edgeCount);
    const unitsPerMs = layoutUnitsPerMs(nodeCount);
    const affordable = perIteration > 0
        ? Math.floor((LAYOUT_TIME_BUDGET_MS * unitsPerMs) / perIteration)
        : presetIterations;

    const iterations = Math.max(MIN_LAYOUT_ITERATIONS, Math.min(presetIterations, affordable));
    const estimatedMs = Math.round((perIteration * iterations) / unitsPerMs);

    // Cool all the way to the floor, over whatever iteration count we can
    // afford. This used to target the PRESET's end-of-run alpha instead:
    //
    //     const targetFinalAlpha = (1 - presetAlphaDecay) ** presetIterations;
    //
    // which for all three presets is ~0.008-0.011 against an alphaMin of 0.001.
    // Every preset therefore stopped 8-11x above the floor, still visibly
    // moving — `deep` didn't settle harder than `fast`, it took four times as
    // long to reach the same unfinished state. That is why one press of
    // auto-layout looked unfinished regardless of the chosen preset, and why
    // pressing it a second time (which reheats to alpha 1.0 from the current
    // positions) kept improving the result.
    const alphaDecay = 1 - LAYOUT_ALPHA_MIN ** (1 / iterations);

    return { iterations, alphaDecay, estimatedMs, overBudget: estimatedMs > LAYOUT_TIME_BUDGET_MS };
}

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
    // How the edges will be DRAWN. Lombardi routes every edge as an arc, which
    // changes both which layout suits a given shape and how much room each edge
    // needs — the conditional dispatcher in patternLayouts reads both of these.
    routingStyle = 'straight',
    lombardiCurvature = 1.0,
    // Whether a non-straight routing style may override the layout algorithm.
    // Escape hatch: set false to keep the chosen algorithm no matter what the
    // edges are drawn with.
    routingDrivesAlgorithm = true,
    // Which solver runs the placement. See FORCE_LAYOUT_DEFAULTS.solver.
    layoutSolver = 'force',
    // Force tuner settings — individual force params for consistency with AI and interactive sim
    forceTunerSettings = null,
    // Resolved connection label font (base × textSettings.fontSize ×
    // connectionLabelSize) so layout reserves the space labels actually render at
    connectionFontSize = EDGE_LABEL_BASE_FONT_SIZE,
    // Zoom/pan control for zoom-to-fit after auto-layout
    setZoomLevel = null,
    setPanOffset = null,
    // Full transform controller (useCanvasTransform) — when provided, the
    // camera tweens to the zoom-to-fit target alongside the node motion
    canvasTransform = null,
    viewportSize = null,
    // Panel-adjusted visible viewport (useViewportBounds) — the same rect the
    // edge glow indicators frame against. Screen-space; converted to container
    // coordinates via containerRef so zoom-to-fit centers on the area the user
    // can actually see between the panels.
    viewportBounds = null,
    containerRef = null,
    maxZoom = 3,
    // Grid snapping — auto-layout aligns final positions to grid vertices per snapMode
    gridMode = 'off',
    gridSize = 200,
    gridSnapMode = 'if-enabled',
    // Live drag state. The auto-layout animation rewrites every node's position
    // each frame; if it runs while the user is grabbing/dragging a node it fights
    // (and overwrites) the drag, making nodes feel unpickable — notably while the
    // wizard streams and keeps re-triggering layout as it adds nodes. We read this
    // ref to skip starting, and to freeze an in-flight animation, on interaction.
    draggingNodeInfoRef = null,
}) => {
    // Whether bulk auto-placement should snap to the grid, given the current
    // grid mode and the user's snap preference. The standalone snap-to-grid
    // action bypasses this (it's an explicit user request).
    const shouldSnapAutoLayout = gridSnapMode === 'always'
        || (gridSnapMode === 'if-enabled' && gridMode !== 'off');
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
    // Solver progress, or null when nothing is running. Drives the layout
    // indicator; because the solve happens in a worker, these updates actually
    // render while it runs.
    // { progress: 0..1, nodeCount, estimatedMs }
    const [layoutProgress, setLayoutProgress] = useState(null);
    const reportLayoutProgress = useCallback((state) => setLayoutProgress(state), []);

    // Abandon an in-flight solve. Nodes keep their current positions — nothing
    // has been written to the store yet at this point.
    const cancelAutoLayout = useCallback(() => {
        cancelLayout();
        setLayoutProgress(null);
    }, []);

    // Never leave a worker solving for an unmounted canvas.
    useEffect(() => () => cancelLayout(), []);

    // In-flight layout animation frame (cancelled if a new layout starts)
    const layoutAnimRef = useRef(null);
    useEffect(() => () => {
        if (layoutAnimRef.current) cancelAnimationFrame(layoutAnimRef.current);
    }, []);

    // Freeze any in-flight auto-layout animation, leaving nodes where they
    // currently sit (no final-position snap). Called when the user starts
    // interacting with a node so the layout tween stops fighting the grab.
    const cancelAutoLayoutAnimation = useCallback(() => {
        if (layoutAnimRef.current) {
            cancelAnimationFrame(layoutAnimRef.current);
            layoutAnimRef.current = null;
        }
    }, []);

    // Computes final positions with the batch engine, then moves each node
    // directly to its target with one eased motion. The animation is real
    // (edges/labels/groups all follow the nodes) but the path is direct —
    // no live-physics wandering, orbiting, or rotation.
    const applyAutoLayoutToActiveGraph = useCallback((opts = {}) => {
        const { animate = true, duration = 750 } = opts;
        // Don't start a layout that would fight an active node grab/drag. This is
        // the common case while the wizard streams: it keeps adding nodes (each
        // re-triggering layout) as the user tries to pick a node up.
        if (draggingNodeInfoRef?.current) return;
        if (!activeGraphId) {
            alert('No active graph is selected for auto-layout.');
            return;
        }

        if (!nodes || nodes.length === 0) {
            alert('Active graph has no nodes to layout yet.');
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
                // Keep the id: Lombardi's tangent fan is keyed by it, and
                // parallel edges are exactly the case it has to tell apart.
                id: edge.id,
                sourceId: edge.sourceId,
                destinationId: edge.destinationId,
                name: resolveConnectionName(edge, nodePrototypesMap, edgePrototypesMap),
                // Which way the arrow POINTS, which is not always the order the
                // connection was drawn in — topology detection orients trees by
                // this. Sent as a plain array: the solver runs in a worker, and
                // an array survives every path (structured clone and JSON) that
                // a Set does not.
                directionality: { arrowsToward: [...(edge.directionality?.arrowsToward || [])] }
            }));

        const layoutWidth = Math.max(2000, canvasSize?.width || 2000);
        const layoutHeight = Math.max(2000, canvasSize?.height || 2000);
        const layoutPadding = Math.max(300, Math.min(layoutWidth, layoutHeight) * 0.08);

        const groups = Array.from(graphData?.groups?.values() || []);

        const iterPreset = LAYOUT_ITERATION_PRESETS[layoutIterationPreset]
            || LAYOUT_ITERATION_PRESETS.balanced;
        const { iterations: presetIterations, alphaDecay: presetAlphaDecay } = iterPreset;
        const budget = computeIterationBudget(nodes.length, layoutEdges.length, presetIterations, presetAlphaDecay);

        if (budget.iterations < presetIterations) {
            console.log(`[useGraphLayout] ${nodes.length} nodes / ${layoutEdges.length} edges: capping iterations ${presetIterations} → ${budget.iterations} (~${budget.estimatedMs}ms)`);
        }
        if (budget.overBudget) {
            console.warn(`[useGraphLayout] Over time budget even at the ${MIN_LAYOUT_ITERATIONS}-iteration floor — this run should take ~${(budget.estimatedMs / 1000).toFixed(1)}s.`);
        }

        const layoutOptions = {
            width: layoutWidth,
            height: layoutHeight,
            padding: layoutPadding,
            layoutScale: layoutScalePreset,
            layoutScaleMultiplier,
            iterationPreset: layoutIterationPreset,
            // Override the preset's schedule (config spreads options last). Both
            // values must move together — see computeIterationBudget.
            iterations: budget.iterations,
            alphaDecay: budget.alphaDecay,
            // When groups exist, let groupSeparatedLayout handle the two-phase approach
            // (layout each group independently → position groups in space).
            // Without groups, preserve existing positions for incremental refinement.
            useExistingPositions: groups.length === 0,
            groups,
            edgeLabelFontSize: connectionFontSize,
            routingStyle,
            lombardiCurvature,
            solver: layoutSolver,
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

        // The solver runs in a worker (see layoutRunner.js), so everything from
        // here on is the completion path — it lands one or more frames later,
        // with the canvas fully interactive in between.
        const onLayoutComplete = (rawUpdates) => {
          // Solving is done — the tween that follows is its own feedback, so the
          // progress indicator retires here rather than lingering through it.
          reportLayoutProgress(null);

          // The entry guard only covers a drag already in progress when layout
          // starts. Now that solving is asynchronous the user can also grab a
          // node *during* it, so re-check on arrival: the tween's own guard
          // handles the animated path, but animate:false would otherwise write
          // positions straight over the drag.
          if (draggingNodeInfoRef?.current) {
              console.log('[useGraphLayout] Discarding layout result — a node grab started mid-solve.');
              return;
          }

          try {
            let updates = rawUpdates;

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

            // Grid snapping: align each node's center to the nearest grid vertex,
            // the same motion as picking up a node and dropping it with the grid on.
            // Done before camera framing so the view frames the snapped positions.
            if (shouldSnapAutoLayout && gridSize > 0) {
                const dimsById = new Map(layoutNodes.map(n => [n.id, { w: n.width, h: n.height }]));
                updates = updates.map(update => {
                    const dims = dimsById.get(update.instanceId) || { w: 0, h: 0 };
                    const snapped = snapPositionToGrid(update.x, update.y, dims.w, dims.h, gridSize);
                    return { ...update, x: Math.round(snapped.x), y: Math.round(snapped.y) };
                });
            }

            if (resetConnectionLabelCache) resetConnectionLabelCache();

            // Compute the zoom-to-fit camera target framed on the FINAL positions
            let cameraTarget = null;
            // Screen-space margins around the framed content. The margin is a
            // fixed pixel breathing room; bottom adds the floating bottom
            // control panel that overlays the canvas within the visible area.
            const FIT_MARGIN = 20;
            const BOTTOM_PANEL_ALLOWANCE = 130;
            // Visible rect in CONTAINER coordinates (the space panOffset lives
            // in). Prefer the panel-adjusted viewport (same rect the edge glow
            // indicators use) so open panels don't hide the framed content;
            // fall back to the raw window-sized viewport minus the header.
            const containerRect = containerRef?.current?.getBoundingClientRect();
            const visRect = (viewportBounds && containerRect)
                ? {
                    x: viewportBounds.x - containerRect.left,
                    y: viewportBounds.y - containerRect.top,
                    width: viewportBounds.width,
                    height: viewportBounds.height
                }
                : viewportSize
                    ? { x: 0, y: HEADER_HEIGHT, width: viewportSize.width, height: viewportSize.height - HEADER_HEIGHT }
                    : null;
            const marginTop = FIT_MARGIN;
            const marginBottom = BOTTOM_PANEL_ALLOWANCE + FIT_MARGIN;
            // Visible-area center in container space — the point the framed
            // content should center on (shared by target, tween start, and
            // per-frame pan derivation so the motion doesn't drift)
            const visCenterX = visRect ? visRect.x + visRect.width / 2 : 0;
            const visCenterY = visRect
                ? visRect.y + marginTop + (visRect.height - marginTop - marginBottom) / 2
                : 0;
            if (visRect && updates.length > 0 && (canvasTransform || (setZoomLevel && setPanOffset))) {
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

                const availW = Math.max(100, visRect.width - FIT_MARGIN * 2);
                const availH = Math.max(100, visRect.height - marginTop - marginBottom);
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
                // A node grab/drag started mid-animation — freeze in place and
                // hand control to the drag rather than yanking nodes to the layout.
                if (draggingNodeInfoRef?.current) {
                    layoutAnimRef.current = null;
                    return;
                }
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
            reportLayoutProgress(null);
            alert(`Auto-layout failed: ${error.message}`);
          }
        };

        // Small graphs solve in a frame or two, where an indicator is just a
        // flash — so only graphs past LAYOUT_INDICATOR_MIN_NODES report at all.
        // The clears below stay unconditional: they're cheap and they guarantee
        // nothing can leave a stale indicator on screen.
        const showIndicator = nodes.length > LAYOUT_INDICATOR_MIN_NODES;

        // Ratchet. The solver's progress is scoped per nested run now, but the
        // bar animates its width over 120ms, so any value that did go backwards
        // would be visible as a rewind. Clamping to the maximum seen makes that
        // cosmetically impossible regardless of what the solver reports.
        let highWaterMark = 0;
        const publishProgress = (progress) => {
            if (!showIndicator) return;
            highWaterMark = Math.max(highWaterMark, progress || 0);
            reportLayoutProgress({
                progress: highWaterMark,
                nodeCount: nodes.length,
                estimatedMs: budget.estimatedMs
            });
        };

        publishProgress(0);

        // ── Routing style steers algorithm selection ────────────────────────
        // `routingStyle` reaches the solver in options, but applyLayout
        // dispatches on the ALGORITHM, and the store's default is
        // 'node-driven' → forceDirectedLayout. So the shape-aware pipelines —
        // Lombardi's, and now the orthogonal one — were only reachable if the
        // user had gone and picked "Pattern (Auto-Detect)" by hand. A curved or
        // orthogonal routing style is a request for a layout that suits it, so
        // unless an algorithm was explicitly chosen, route through 'pattern'
        // and let it dispatch per component.
        const wantsShapeAwareLayout = routingStyle !== 'straight'
            && routingDrivesAlgorithm
            && (groupLayoutAlgorithm === 'node-driven' || groupLayoutAlgorithm === 'force-directed');
        const algorithm = wantsShapeAwareLayout ? 'pattern' : groupLayoutAlgorithm;

        runLayout(layoutNodes, layoutEdges, algorithm, layoutOptions, {
            onProgress: publishProgress,
            onDone: onLayoutComplete,
            onError: (message) => {
                console.error('[useGraphLayout] Layout worker failed:', message);
                reportLayoutProgress(null);
                alert(`Auto-layout failed: ${message}`);
            }
        });
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
        routingStyle,
        lombardiCurvature,
        routingDrivesAlgorithm,
        layoutSolver,
        graphsMap,
        forceTunerSettings,
        connectionFontSize,
        setZoomLevel,
        setPanOffset,
        canvasTransform,
        viewportSize,
        viewportBounds,
        containerRef,
        maxZoom,
        shouldSnapAutoLayout,
        gridSize,
        reportLayoutProgress
    ]);

    // ---------------------------------------------------------------------------
    // 2b. Snap all nodes to grid (explicit user action)
    // ---------------------------------------------------------------------------
    // Snaps every node in the active graph to the nearest grid vertex with one
    // eased motion, regardless of grid mode or snap preference. Mirrors the
    // pick-up-and-drop snap so an explicit "Snap to Grid" always lands cleanly.
    const snapAnimRef = useRef(null);
    useEffect(() => () => {
        if (snapAnimRef.current) cancelAnimationFrame(snapAnimRef.current);
    }, []);

    const snapActiveGraphToGrid = useCallback((opts = {}) => {
        const { animate = true, duration = 300 } = opts;
        if (!activeGraphId || !nodes || nodes.length === 0) return;
        const size = gridSize > 0 ? gridSize : 200;

        const targets = nodes.map(node => {
            const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
            const w = dims?.currentWidth ?? 0;
            const h = dims?.currentHeight ?? 0;
            const startX = typeof node.x === 'number' ? node.x : 0;
            const startY = typeof node.y === 'number' ? node.y : 0;
            const snapped = snapPositionToGrid(startX, startY, w, h, size);
            return {
                instanceId: node.id,
                startX,
                startY,
                x: Math.round(snapped.x),
                y: Math.round(snapped.y),
            };
        });

        // Nothing to move — skip the animation entirely.
        const moved = targets.some(t => t.x !== t.startX || t.y !== t.startY);
        if (!moved) return;

        const finishSnap = () => {
            storeActions.updateMultipleNodeInstancePositions(
                activeGraphId,
                targets.map(t => ({ instanceId: t.instanceId, x: t.x, y: t.y })),
                { finalize: true, source: 'snap-to-grid' }
            );
            if (resetConnectionLabelCache) resetConnectionLabelCache();
        };

        if (!animate) {
            finishSnap();
            return;
        }

        if (snapAnimRef.current) cancelAnimationFrame(snapAnimRef.current);
        const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const startTime = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - startTime) / duration);
            const k = easeInOutCubic(t);
            const frame = targets.map(target => ({
                instanceId: target.instanceId,
                x: target.startX + (target.x - target.startX) * k,
                y: target.startY + (target.y - target.startY) * k,
            }));
            storeActions.updateMultipleNodeInstancePositions(activeGraphId, frame, { skipSave: true });
            if (t < 1) {
                snapAnimRef.current = requestAnimationFrame(tick);
            } else {
                snapAnimRef.current = null;
                finishSnap();
            }
        };
        snapAnimRef.current = requestAnimationFrame(tick);
    }, [activeGraphId, nodes, baseDimsById, gridSize, storeActions, resetConnectionLabelCache]);

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
        condenseGraphNodes,
        snapActiveGraphToGrid,
        cancelAutoLayoutAnimation,
        // Solver state for the layout indicator: null when idle, otherwise
        // { progress, nodeCount, estimatedMs }
        layoutProgress,
        cancelAutoLayout
    };
};
