import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useViewportBounds } from '../hooks/useViewportBounds';
import { getNodeDimensions } from '../utils';
import { HEADER_HEIGHT, NODE_HEIGHT } from '../constants';
import useGraphStore from '../store/graphStore.js';

// How many distinct flare appearances exist. Every off-screen node draws a
// blurred, gradient-filled, box-shadowed flare, and all of that geometry is
// derived from `intensity`. Left continuous, each flare gets five freshly-built
// style strings on every pan/zoom frame, which React must diff and write, and
// which the compositor must re-rasterise. Quantised, the whole population
// collapses onto this many cached appearances.
const GLOW_INTENSITY_STEPS = 8;

// Cache of the inner flare's style object, keyed by everything it depends on.
// Returning the SAME object reference between frames is the point: React's
// style diff then finds nothing to update, so a flare that only moved costs one
// transform write instead of a full restyle.
const glowStyleCache = new Map();
const getFlareStyle = (color, intensity, isExclusiveMode) => {
  const key = `${color}|${intensity}|${isExclusiveMode ? 1 : 0}`;
  const hit = glowStyleCache.get(key);
  if (hit) return hit;

  // A flare is a soft glow, and it used to be drawn as THREE soft glows stacked
  // on top of each other: a radial-gradient fading out to transparent, a blur()
  // filter over the top of it, and a blurred box-shadow around the border box
  // which the filter then blurred a second time. Each one costs a full repaint
  // for every flare on every frame it moves, and with a graph's worth of
  // off-screen nodes there are a lot of flares. Measured on the live app, 150
  // flares, median / p90 frame time against an 8.3ms floor:
  //
  //   gradient + blur + shadow ....  9.3 / 30.4    55 of 126 frames over 16ms
  //   gradient + shadow ...........  8.4 / 15.8    14 of 142
  //   gradient + blur .............  8.8 / 17.2    51 of 135
  //   gradient alone ..............  8.3 /  9.3     3 of 142   <- at the floor
  //
  // A gradient that already runs to `transparent` IS the soft edge; the other
  // two were re-softening something soft. So the gradient does the whole job
  // now, grown to cover the area the blur used to bleed into and with its stops
  // pulled inward to keep the same falloff.
  const BLEED = 1.4; // what blur() used to add beyond the box
  const flareLength = (isExclusiveMode ? 10 + intensity * 4 : 14 + intensity * 6) * BLEED;
  const flareThickness = (isExclusiveMode ? 20 + intensity * 6 : 28 + intensity * 8) * BLEED;
  const glowAlpha = Math.round(intensity * 255 * 0.6).toString(16).padStart(2, '0');

  const style = {
    position: 'absolute',
    left: -flareLength / 2,
    top: -flareThickness / 2,
    width: flareLength,
    height: flareThickness,
    borderRadius: flareThickness,
    background: `radial-gradient(ellipse, ${color}${glowAlpha} 0%, ${color}30 45%, transparent 100%)`,
  };
  glowStyleCache.set(key, style);
  return style;
};

const EdgeGlowIndicator = ({
  nodes,
  baseDimensionsById,
  panOffset,
  zoomLevel,
  panOffsetRef,
  zoomLevelRef,
  glowUpdateRef,
  leftPanelExpanded,
  rightPanelExpanded,
  previewingNodeId,
  containerRef,
  showViewportDebug = false,
  showDirectionLines = false,
  canvasViewportSize // Pass in the fixed canvas viewport size
}) => {
  // Live pan/zoom state for rendering. Updated by an event-driven callback
  // registered into `glowUpdateRef` — NodeCanvas's RAF-coalesced culling loop
  // fires this on every transform change. No free-running RAF polling; zero
  // work during idle.
  const [livePan, setLivePan] = useState(panOffset);
  const [liveZoom, setLiveZoom] = useState(zoomLevel);
  const lastPanRef = useRef(panOffset);
  const lastZoomRef = useRef(zoomLevel);

  useEffect(() => {
    if (!glowUpdateRef || !panOffsetRef || !zoomLevelRef) return;
    const update = () => {
      const curPan = panOffsetRef.current;
      const curZoom = zoomLevelRef.current;
      const last = lastPanRef.current;
      if (curPan.x !== last.x || curPan.y !== last.y || curZoom !== lastZoomRef.current) {
        lastPanRef.current = curPan;
        lastZoomRef.current = curZoom;
        setLivePan(curPan);
        setLiveZoom(curZoom);
      }
    };
    glowUpdateRef.current = update;
    return () => {
      if (glowUpdateRef.current === update) glowUpdateRef.current = null;
    };
  }, [glowUpdateRef, panOffsetRef, zoomLevelRef]);

  // Sync from React state when refs aren't available (fallback)
  useEffect(() => {
    if (!panOffsetRef) setLivePan(panOffset);
  }, [panOffset, panOffsetRef]);
  useEffect(() => {
    if (!zoomLevelRef) setLiveZoom(zoomLevel);
  }, [zoomLevel, zoomLevelRef]);
  // Get TypeList visibility from store
  const typeListMode = useGraphStore(state => state.typeListMode);
  const typeListVisible = typeListMode !== 'closed';

  // Use the panel-based viewport bounds for positioning the overlay
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListVisible);

  // Use the fixed canvas viewport size for coordinate calculations
  const canvasSize = canvasViewportSize || { width: window.innerWidth, height: window.innerHeight };

  // The container's own rect, measured OUT of band.
  //
  // allNodeData below re-runs on every pan/zoom tick (livePan/liveZoom are set
  // from the transform callback), and it used to call getBoundingClientRect()
  // on each one. That read lands immediately after the canvas has written its
  // new SVG transform, so it forces a synchronous layout of a subtree that was
  // just dirtied — and the cost of that flush is not symmetric between the two
  // kinds of motion. A translate leaves SVG text layout intact; a SCALE change
  // invalidates it, so every glyph, every rotation and every <textPath>
  // arc-length parameterisation is resolved again before the rect can be
  // returned. Measured on the label harness (median cost of the read alone):
  //
  //             labels     pan     zoom
  //   lines only   600     0.1      0.3
  //   rotated      600     0.1      1.3
  //   textPath     600     0.1      4.9     <- 49x
  //
  // Flat under pan at any complexity, linear in label count under zoom. That is
  // exactly the shape of the complaint: zooming a Lombardi graph with labels on,
  // and nothing else.
  //
  // None of it was needed. This rect belongs to the canvas CONTAINER, a fixed
  // viewport-sized element that pan and zoom never move — only a resize or a
  // panel toggle changes it. So measure it on those, and let the per-frame path
  // read a plain object.
  const [containerRect, setContainerRect] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = containerRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setContainerRect(prev =>
        (prev && prev.left === r.left && prev.top === r.top
          && prev.width === r.width && prev.height === r.height)
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height }
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // Panel/type-list toggles resize the container without firing `resize`.
  }, [containerRef, leftPanelExpanded, rightPanelExpanded, typeListVisible, viewportBounds]);

  const nodeLookup = useMemo(() => {
    if (!nodes?.length) return new Map();
    const map = new Map();
    nodes.forEach(node => {
      map.set(node.id, node);
    });
    return map;
  }, [nodes]);

  const allNodeData = useMemo(() => {
    if (!nodes?.length || !viewportBounds) return [];

    // Container bounds, from the out-of-band measurement above — never read
    // layout here, this memo is on the per-frame path.
    const rect = containerRect;
    if (!rect) return []; // Not measured yet, no coordinate calculations possible

    // Calculate the actual visible viewport area in canvas coordinates
    // Use the fixed canvas size for consistent coordinate system
    const canvasViewportMinX = (-livePan.x) / liveZoom;
    const canvasViewportMinY = (-livePan.y) / liveZoom;
    const canvasViewportMaxX = canvasViewportMinX + canvasSize.width / liveZoom;
    const canvasViewportMaxY = canvasViewportMinY + canvasSize.height / liveZoom;

    const nodeData = [];

    nodes.forEach(node => {
      // Get node dimensions using the same pattern as working connections
      const isNodePreviewing = previewingNodeId === node.id;
      const precomputedDims = baseDimensionsById instanceof Map
        ? baseDimensionsById.get(node.id)
        : baseDimensionsById?.[node.id];
      const dims = isNodePreviewing
        ? getNodeDimensions(node, true, null)
        : precomputedDims || getNodeDimensions(node, false, null);

      // Calculate the center of the node using the EXACT same pattern as working connections
      // From NodeCanvas.jsx line 6040-6043: const x1 = sourceNode.x + sNodeDims.currentWidth / 2;
      // and line 6041: const y1 = sourceNode.y + (isSNodePreviewing ? NODE_HEIGHT / 2 : sNodeDims.currentHeight / 2);
      const nodeCenterX = node.x + dims.currentWidth / 2;
      const nodeCenterY = node.y + (isNodePreviewing ? NODE_HEIGHT / 2 : dims.currentHeight / 2);

      // Calculate where the node center appears in screen coordinates
      // Account for the canvas offset system (-50000, -50000) used in NodeCanvas
      // The canvas coordinate system: (0,0) is at center of 100k x 100k canvas
      // Node positions are in canvas coordinates, need to transform to screen coordinates
      const canvasOffsetX = -50000; // From canvasSize.offsetX
      const canvasOffsetY = -50000; // From canvasSize.offsetY

      // Transform from canvas coordinates to screen coordinates
      // NodeCanvas transform: translate(livePan.x - canvasOffsetX * liveZoom, livePan.y - canvasOffsetY * liveZoom) scale(liveZoom)
      // Simplified: screenPos = (canvasPos + (-canvasOffset)) * liveZoom + livePan
      // Since canvasOffset is -50000, -canvasOffset is +50000
      // IMPORTANT: Add rect.left and rect.top like the original working version
      const nodeScreenX = (nodeCenterX + (-canvasOffsetX)) * liveZoom + livePan.x + rect.left;
      const nodeScreenY = (nodeCenterY + (-canvasOffsetY)) * liveZoom + livePan.y + rect.top;

      // Convert to overlay coordinates relative to the viewport bounds
      const nodeOverlayX = nodeScreenX - viewportBounds.x;
      const nodeOverlayY = nodeScreenY - viewportBounds.y;

      // Check if the node center is outside the visible viewport area
      // Use viewportBounds for the actual visible area (accounts for panels)
      const isNodeCenterOutsideViewport = (
        nodeOverlayX < 0 ||  // to the left of visible viewport
        nodeOverlayX > viewportBounds.width ||   // to the right of visible viewport
        nodeOverlayY < 0 || // above visible viewport
        nodeOverlayY > viewportBounds.height       // below visible viewport
      );

      // Store all node data (for debug visualization)
      const nodeInfo = {
        id: node.id,
        nodeCenterX,
        nodeCenterY,
        nodeOverlayX,
        nodeOverlayY,
        isOutsideViewport: isNodeCenterOutsideViewport,
        label: node.name || node.prototype?.name || node.id
      };

      nodeData.push(nodeInfo);
    });

    return nodeData;
  }, [nodes, livePan, liveZoom, viewportBounds, previewingNodeId, containerRect, canvasSize, baseDimensionsById]);

  const offScreenGlows = useMemo(() => {
    const glows = [];

    allNodeData.forEach(nodeInfo => {
      if (!nodeInfo.isOutsideViewport) return; // Only create glows for nodes outside viewport

      // Calculate line intersection: where the line from viewport center to node intersects viewport boundary
      const containerW = viewportBounds.width;
      const containerH = viewportBounds.height;
      const centerX = containerW / 2;
      const centerY = containerH / 2;

      // Use the node position from nodeInfo
      const nodePxX = nodeInfo.nodeOverlayX;
      const nodePxY = nodeInfo.nodeOverlayY;

      // Calculate direction vector from center to node
      const dx = nodePxX - centerX;
      const dy = nodePxY - centerY;

      // Find intersection with viewport rectangle edges
      let screenX, screenY;

      // Calculate intersection with each edge and find the valid one
      const intersections = [];

      // Left edge (x = 0)
      if (dx !== 0) {
        const t = -centerX / dx;
        const y = centerY + t * dy;
        if (t > 0 && y >= 0 && y <= containerH) {
          intersections.push({ x: 0, y, t });
        }
      }

      // Right edge (x = containerW)
      if (dx !== 0) {
        const t = (containerW - centerX) / dx;
        const y = centerY + t * dy;
        if (t > 0 && y >= 0 && y <= containerH) {
          intersections.push({ x: containerW, y, t });
        }
      }

      // Top edge (y = 0)
      if (dy !== 0) {
        const t = -centerY / dy;
        const x = centerX + t * dx;
        if (t > 0 && x >= 0 && x <= containerW) {
          intersections.push({ x, y: 0, t });
        }
      }

      // Bottom edge (y = containerH)
      if (dy !== 0) {
        const t = (containerH - centerY) / dy;
        const x = centerX + t * dx;
        if (t > 0 && x >= 0 && x <= containerW) {
          intersections.push({ x, y: containerH, t });
        }
      }

      // Use the intersection with the smallest t (closest to center)
      if (intersections.length > 0) {
        const closestIntersection = intersections.reduce((min, curr) => curr.t < min.t ? curr : min);
        screenX = closestIntersection.x;
        screenY = closestIntersection.y;
      } else {
        // Fallback to center if no intersection found (shouldn't happen)
        screenX = centerX;
        screenY = centerY;
      }

      // Calculate intensity based on distance from viewport center
      const viewportCenterPxX = containerW / 2;
      const viewportCenterPxY = containerH / 2;
      const distance = Math.sqrt((nodePxX - viewportCenterPxX) ** 2 + (nodePxY - viewportCenterPxY) ** 2);
      // Snapped into buckets. Intensity feeds the flare's size, alpha, blur
      // radius, gradient stops and box-shadow — so a continuously-varying value
      // rebuilds five style strings per flare per frame, and React then diffs
      // and writes every one of them. Nobody can see a 1% change in a blur
      // radius; bucketing makes the appearance identical between frames so the
      // style objects below can be reused outright. See GLOW_INTENSITY_STEPS.
      const rawIntensity = Math.max(0.4, Math.min(1, 2000 / (distance + 200)));
      const intensity = Math.round(rawIntensity * GLOW_INTENSITY_STEPS) / GLOW_INTENSITY_STEPS;

      // Get node color (fallback to default if not specified)
      const node = nodeLookup.get(nodeInfo.id);
      const nodeColor = node?.color || node?.prototype?.color || '#8B0000';

      // Determine which edge we're on (to orient the flare)
      const edgeEpsilon = 0.75;
      let edge = 'left';
      if (Math.abs(screenX - 0) < edgeEpsilon) edge = 'left';
      else if (Math.abs(screenX - containerW) < edgeEpsilon) edge = 'right';
      else if (Math.abs(screenY - 0) < edgeEpsilon) edge = 'top';
      else if (Math.abs(screenY - containerH) < edgeEpsilon) edge = 'bottom';

      glows.push({
        id: nodeInfo.id,
        screenX, // Already relative to overlay container
        screenY, // Already relative to overlay container
        color: nodeColor,
        intensity,
        edge,
        nodeCenterX: nodeInfo.nodeCenterX,
        nodeCenterY: nodeInfo.nodeCenterY,
        label: nodeInfo.label
      });
    });

    return glows;
  }, [allNodeData, nodeLookup, viewportBounds]);

  if (!viewportBounds) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: viewportBounds.x, // Remove Math.max constraint to allow off-screen positioning
        top: viewportBounds.y,
        width: viewportBounds.width,
        height: viewportBounds.height,
        pointerEvents: 'none',
        zIndex: 1000
      }}
    >
      {/* Debug viewport bounds visualization - positioned absolutely */}
      {showViewportDebug && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            border: '4px solid red',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            zIndex: 999999
          }}
        />
      )}

      {/* Debug container outline */}
      {showViewportDebug && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            border: '2px solid rgba(0, 255, 0, 0.8)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: 999998
          }}
        />
      )}

      {/* Debug direction lines */}
      {showDirectionLines && (
        <svg
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 999998
          }}
        >
          {allNodeData.map(nodeInfo => {
            const centerX = viewportBounds.width / 2;
            const centerY = viewportBounds.height / 2;

            const nodeOverlayX = nodeInfo.nodeOverlayX;
            const nodeOverlayY = nodeInfo.nodeOverlayY;

            // Find the corresponding glow (if any)
            const glow = offScreenGlows.find(g => g.id === nodeInfo.id);

            return (
              <g key={`debug-${nodeInfo.id}`}>
                {/* Line from center to actual node position */}
                <line
                  x1={centerX}
                  y1={centerY}
                  x2={nodeOverlayX}
                  y2={nodeOverlayY}
                  stroke="rgba(0, 255, 0, 0.8)"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
                {/* Line from center to dot (only if glow exists) */}
                {glow && (
                  <line
                    x1={centerX}
                    y1={centerY}
                    x2={glow.screenX}
                    y2={glow.screenY}
                    stroke="rgba(255, 0, 0, 0.6)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                )}
                {/* Mark the actual node position */}
                <circle
                  cx={nodeOverlayX}
                  cy={nodeOverlayY}
                  r="4"
                  fill={nodeInfo.isOutsideViewport ? "rgba(0, 255, 0, 0.8)" : "rgba(0, 255, 0, 0.3)"}
                  stroke="white"
                  strokeWidth="1"
                />
              </g>
            );
          })}
        </svg>
      )}


      {/* Debug corner labels */}
      {showViewportDebug && (
        <>
          <div style={{ position: 'absolute', top: '5px', left: '5px', color: 'red', fontSize: '16px', fontWeight: 'bold', backgroundColor: 'yellow', padding: '4px', zIndex: 999999 }}>
            🔴 DEBUG MODE ON - VIEWPORT: {Math.round(viewportBounds.x)},{Math.round(viewportBounds.y)} {Math.round(viewportBounds.width)}x{Math.round(viewportBounds.height)}
          </div>
          <div style={{ position: 'absolute', top: '25px', left: '5px', color: 'red', fontSize: '10px' }}>
            TypeList: {typeListVisible ? 'VISIBLE' : 'HIDDEN'} | Left: {leftPanelExpanded ? 'OPEN' : 'CLOSED'} | Right: {rightPanelExpanded ? 'OPEN' : 'CLOSED'}
          </div>
          <div style={{ position: 'absolute', top: '40px', left: '5px', color: 'red', fontSize: '10px' }}>
            Header: {HEADER_HEIGHT}px | Window: {viewportBounds?.windowWidth || 'N/A'}x{viewportBounds?.windowHeight || 'N/A'}
          </div>
          <div style={{ position: 'absolute', top: '55px', left: '5px', color: 'red', fontSize: '10px' }}>
            Y Offset: {viewportBounds?.y || 'N/A'} | Expected: {HEADER_HEIGHT}
          </div>
          <div style={{ position: 'absolute', top: '70px', left: '5px', color: 'red', fontSize: '10px' }}>
            Container: left={Math.max(0, viewportBounds.x)} | Flares: {offScreenGlows.length}
          </div>
          {offScreenGlows.slice(0, 3).map((glow, idx) => (
            <div key={`debug-${glow.id}`} style={{ position: 'absolute', top: `${85 + idx * 15}px`, left: '5px', color: 'red', fontSize: '10px' }}>
              {glow.label}: edge={glow.edge}, pos=({Math.round(glow.screenX)},{Math.round(glow.screenY)})
            </div>
          ))}
        </>
      )}

      {/* Render individual glow dots.
          Split deliberately in two: the OUTER div carries the only thing that
          genuinely changes as the view moves (a transform), and the INNER div
          carries the expensive appearance — gradient, blur, shadow — from a
          cached, quantised style object. React then has one property to diff
          per flare per frame instead of a dozen freshly-built strings. */}
      {offScreenGlows.map(glow => {
        const { id, screenX, screenY, color, intensity, edge } = glow;

        // Orientation by edge
        const rotation = edge === 'left' ? 0
          : edge === 'right' ? 180
            : edge === 'top' ? 90
              : -90; // bottom

        // Position to ride slightly further out from the screen edge (3px offset)
        // The EdgeGlowIndicator container is positioned at viewportBounds.x/y
        // So flares should be positioned at the actual screen edge coordinates
        let translateX = screenX;
        let translateY = screenY;

        // Position 3px further out from each edge for better visibility
        if (edge === 'left') translateX = -3; // 3px to the left of left edge
        else if (edge === 'right') translateX = viewportBounds.width + 3; // 3px to the right of right edge
        else if (edge === 'top') translateY = -3; // 3px above top edge
        else if (edge === 'bottom') translateY = viewportBounds.height + 3; // 3px below bottom edge

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
              transform: `translate(${translateX}px, ${translateY}px) rotate(${rotation}deg)`,
              transformOrigin: 'center',
              zIndex: 1
            }}
          >
            {/* Single optimized glow layer */}
            <div style={getFlareStyle(color, intensity, viewportBounds.isExclusiveMode)} />
          </div>
        );
      })}
    </div>
  );
};

export default EdgeGlowIndicator;
