import React, { useMemo } from 'react';
import { useViewportBounds } from '../hooks/useViewportBounds';
import { getNodeDimensions } from '../utils';
import { HEADER_HEIGHT, NODE_HEIGHT } from '../constants';
import useGraphStore from '../store/graphStore.jsx';

const EdgeGlowIndicator = ({ 
  nodes, 
  panOffset, 
  zoomLevel, 
  leftPanelExpanded, 
  rightPanelExpanded,
  previewingNodeId,
  containerRef,
  showViewportDebug = false,
  showDirectionLines = false,
  canvasViewportSize // Pass in the fixed canvas viewport size
}) => {
  // Get TypeList visibility from store
  const typeListMode = useGraphStore(state => state.typeListMode);
  const typeListVisible = typeListMode !== 'closed';
  
  // Use the panel-based viewport bounds for positioning the overlay
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListVisible);
  
  // Use the fixed canvas viewport size for coordinate calculations
  const canvasSize = canvasViewportSize || { width: window.innerWidth, height: window.innerHeight };

  const allNodeData = useMemo(() => {
    if (!nodes?.length || !viewportBounds) return [];

    // Get container bounds once for all nodes - use the EXACT same pattern as NodeCanvas
    const rect = containerRef?.current?.getBoundingClientRect();
    if (!rect) return []; // No container, no coordinate calculations possible

    // Calculate the actual visible viewport area in canvas coordinates
    // Use the fixed canvas size for consistent coordinate system
    const canvasViewportMinX = (-panOffset.x) / zoomLevel;
    const canvasViewportMinY = (-panOffset.y) / zoomLevel;
    const canvasViewportMaxX = canvasViewportMinX + canvasSize.width / zoomLevel;
    const canvasViewportMaxY = canvasViewportMinY + canvasSize.height / zoomLevel;

    const nodeData = [];

    nodes.forEach(node => {
      // Get node dimensions using the same pattern as working connections
      const isNodePreviewing = previewingNodeId === node.id;
      const dims = getNodeDimensions(node, isNodePreviewing, null);
      
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
      // NodeCanvas transform: translate(panOffset.x - canvasOffsetX * zoomLevel, panOffset.y - canvasOffsetY * zoomLevel) scale(zoomLevel)
      // This means: screenPos = (canvasPos * zoomLevel) + (panOffset + (-canvasOffset) * zoomLevel)
      // Simplified: screenPos = (canvasPos + (-canvasOffset)) * zoomLevel + panOffset
      // Since canvasOffset is -50000, -canvasOffset is +50000
      // IMPORTANT: Add rect.left and rect.top like the original working version
      const nodeScreenX = (nodeCenterX + (-canvasOffsetX)) * zoomLevel + panOffset.x + rect.left;
      const nodeScreenY = (nodeCenterY + (-canvasOffsetY)) * zoomLevel + panOffset.y + rect.top;
      
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
  }, [nodes, panOffset, zoomLevel, viewportBounds, previewingNodeId, containerRef, leftPanelExpanded, rightPanelExpanded, canvasSize]);

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
      const intensity = Math.max(0.4, Math.min(1, 2000 / (distance + 200)));

      // Get node color (fallback to default if not specified)
      const node = nodes.find(n => n.id === nodeInfo.id);
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
  }, [allNodeData, nodes, viewportBounds, leftPanelExpanded, rightPanelExpanded]);

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
      
      {/* Render individual glow dots */}
      {offScreenGlows.map(glow => {
        const { id, screenX, screenY, color, intensity, edge } = glow;

        // Flare sizing: extend further out while staying anchored at same spot
        const flareLength = 14 + intensity * 6; // px - reduced from 20+10 to 14+6 for smaller size
        const flareThickness = 28 + intensity * 8; // px - increased from 16+4 to 28+8 for more spread

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

        // Single optimized glow layer with combined effects - higher opacity
        const glowAlpha = Math.round(intensity * 255 * 0.6).toString(16).padStart(2, '0'); // increased from 0.4 to 0.6

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
            <div
              style={{
                position: 'absolute',
                left: -flareLength / 2,
                top: -flareThickness / 2,
                width: flareLength,
                height: flareThickness,
                borderRadius: flareThickness,
                background: `radial-gradient(ellipse, ${color}${glowAlpha} 0%, ${color}30 60%, transparent 100%)`, // increased opacity from 20 to 30
                filter: `blur(${Math.max(3, flareThickness * 0.25)}px)`, // increased blur from 0.15 to 0.25 for more spread
                boxShadow: `0 0 ${Math.max(6, flareThickness * 0.3)}px ${color}${glowAlpha}`, // increased box shadow from 0.2 to 0.3 for more spread
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export default EdgeGlowIndicator;
