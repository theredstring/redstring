import React, { useMemo, useState, useCallback, useRef } from 'react';
import useGraphStore from './store/graphStore.jsx';
import { getNodeDimensions } from './utils.js';

/**
 * Connection Text Component
 * 
 * A dedicated component for rendering connection names with proper styling,
 * colors, and stroke effects that match NodeCanvas appearance.
 */
const ConnectionText = ({ 
  connection, 
  sourcePoint, 
  targetPoint, 
  transform, 
  isHovered,
  fontScale = 1
}) => {
  if (!connection.connectionName) {
    return null;
  }

  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const midX = (sourcePoint.x + targetPoint.x) / 2;
  const midY = (sourcePoint.y + targetPoint.y) / 2;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const adjustedAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;
  const fontSize = Math.max(8, 16 * transform.scale * fontScale);
  const strokeWidth = Math.max(2, (connection.strokeWidth || 6 * transform.scale) * fontScale);
  
  return (
    <g>
      {/* Background glow for better readability */}
      {isHovered && (
        <text
          x={midX}
          y={midY}
          fill="none"
          fontSize={fontSize}
          fontWeight="bold"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${adjustedAngle}, ${midX}, ${midY})`}
          stroke={connection.color || '#000000'}
          strokeWidth={strokeWidth * 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.4"
          filter={`drop-shadow(0 0 4px ${connection.color || '#000000'})`}
          fontFamily="'EmOne', sans-serif"
          style={{ pointerEvents: 'none' }}
        >
          {connection.connectionName}
        </text>
      )}
      
      {/* Main text with stroke */}
      <text
        x={midX}
        y={midY}
        fill="#bdb5b5"
        fontSize={fontSize}
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(${adjustedAngle}, ${midX}, ${midY})`}
        stroke={connection.color || '#000000'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        paintOrder="stroke fill"
        fontFamily="'EmOne', sans-serif"
        style={{ pointerEvents: 'none' }}
      >
        {connection.connectionName}
      </text>
    </g>
  );
};

/**
 * Universal Node/Connection Renderer
 * 
 * A reusable component that can render nodes and connections at any scale
 * while maintaining exact proportionality and functionality from NodeCanvas.
 * 
 * Can be used in: panels, modals, control panels, previews, etc.
 */
const UniversalNodeRenderer = ({
  // Data
  nodes = [], // Array of node objects with {id, x, y, width, height, name, color}
  connections = [], // Array of connection objects 
  
  // Sizing
  containerWidth = 400,
  containerHeight = 200,
  scaleMode = 'fit', // 'fit' | 'fill' | 'fixed'
  minNodeSize = 40, // Minimum node size in pixels
  maxNodeSize = 240, // Maximum node size in pixels (allow wider nodes before downscaling)
  
  // Appearance
  backgroundColor = 'transparent',
  showGrid = false,
  padding = 20,
  
  // Layout
  alignNodesHorizontally = false, // For control panels - align all nodes on same Y axis
  minHorizontalSpacing = 140, // Minimum distance between nodes when aligned horizontally
  
  // Interactivity
  interactive = true,
  showHoverEffects = true,
  showConnectionDots = true,
  
  // Callbacks
  onNodeClick,
  onNodeHover,
  onConnectionClick,
  onConnectionHover,
  onToggleArrow,
  
  // Advanced
  routingStyle = 'smart', // 'straight' | 'smart' | 'curved'
  className = '',
  connectionFontScale = 1,
  nodeFontScale = 1,
  connectionStrokeScale = 1, // Allow manual override of connection stroke width scaling
  
  // Styling tweaks
  cornerRadiusMultiplier = 28
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState(null);
  const [stableHoveredConnectionId, setStableHoveredConnectionId] = useState(null);
  const hoverTimeoutRef = useRef(null);
  
  const graphsMap = useGraphStore((state) => state.graphs);
  const activeGraphId = useGraphStore((state) => state.activeGraphId);
  const nodePrototypesMap = useGraphStore((state) => state.nodePrototypes);
  
  // Get actual node instances if not provided
  const instances = useMemo(() => {
    if (!activeGraphId || !graphsMap) return new Map();
    return graphsMap.get(activeGraphId)?.instances || new Map();
  }, [activeGraphId, graphsMap]);

  // Calculate connection path based on routing style
  const calculateConnectionPath = useCallback((sourceNode, targetNode, style, scale, hasSourceArrow, hasTargetArrow) => {
    const sourceCenterX = sourceNode.x + sourceNode.width / 2;
    const sourceCenterY = sourceNode.y + sourceNode.height / 2;
    const targetCenterX = targetNode.x + targetNode.width / 2;
    const targetCenterY = targetNode.y + targetNode.height / 2;
    
    // Arrow tip length for cutting the line (slightly larger for clearer spacing)
    const arrowTipLength = 24 * scale;

    if (style === 'straight') {
      // Cut line short for arrows
      const dx = targetCenterX - sourceCenterX;
      const dy = targetCenterY - sourceCenterY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const unitX = dx / length;
      const unitY = dy / length;
      
      const startX = hasSourceArrow ? sourceCenterX + unitX * arrowTipLength : sourceCenterX;
      const startY = hasSourceArrow ? sourceCenterY + unitY * arrowTipLength : sourceCenterY;
      const endX = hasTargetArrow ? targetCenterX - unitX * arrowTipLength : targetCenterX;
      const endY = hasTargetArrow ? targetCenterY - unitY * arrowTipLength : targetCenterY;
      
      return {
        path: `M ${startX} ${startY} L ${endX} ${endY}`,
        sourcePoint: { x: sourceCenterX, y: sourceCenterY },
        targetPoint: { x: targetCenterX, y: targetCenterY }
      };
    }

    // Smart routing - choose optimal connection points
    const dx = targetCenterX - sourceCenterX;
    const dy = targetCenterY - sourceCenterY;
    
    let sourcePoint, targetPoint;
    
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal connection
      if (dx > 0) {
        sourcePoint = { x: sourceNode.x + sourceNode.width, y: sourceCenterY };
        targetPoint = { x: targetNode.x, y: targetCenterY };
      } else {
        sourcePoint = { x: sourceNode.x, y: sourceCenterY };
        targetPoint = { x: targetNode.x + targetNode.width, y: targetCenterY };
      }
    } else {
      // Vertical connection
      if (dy > 0) {
        sourcePoint = { x: sourceCenterX, y: sourceNode.y + sourceNode.height };
        targetPoint = { x: targetCenterX, y: targetNode.y };
      } else {
        sourcePoint = { x: sourceCenterX, y: sourceNode.y };
        targetPoint = { x: targetCenterX, y: targetNode.y + targetNode.height };
      }
    }

    // Apply arrow tip cutting to smart routing points
    let finalSourcePoint = sourcePoint;
    let finalTargetPoint = targetPoint;
    
    if (hasSourceArrow || hasTargetArrow) {
      const dx = targetPoint.x - sourcePoint.x;
      const dy = targetPoint.y - sourcePoint.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length > 0) {
        const unitX = dx / length;
        const unitY = dy / length;
        
        if (hasSourceArrow) {
          finalSourcePoint = {
            x: sourcePoint.x + unitX * arrowTipLength,
            y: sourcePoint.y + unitY * arrowTipLength
          };
        }
        
        if (hasTargetArrow) {
          finalTargetPoint = {
            x: targetPoint.x - unitX * arrowTipLength,
            y: targetPoint.y - unitY * arrowTipLength
          };
        }
      }
    }

    if (style === 'curved') {
      // Add curve
      const midX = (finalSourcePoint.x + finalTargetPoint.x) / 2;
      const midY = (finalSourcePoint.y + finalTargetPoint.y) / 2;
      const curveOffset = Math.min(50, Math.abs(dx) * 0.3, Math.abs(dy) * 0.3) * scale;
      const controlX = midX + (Math.abs(dx) > Math.abs(dy) ? 0 : curveOffset);
      const controlY = midY + (Math.abs(dx) > Math.abs(dy) ? curveOffset : 0);
      
      return {
        path: `M ${finalSourcePoint.x} ${finalSourcePoint.y} Q ${controlX} ${controlY} ${finalTargetPoint.x} ${finalTargetPoint.y}`,
        sourcePoint,
        targetPoint
      };
    }

    return {
      path: `M ${finalSourcePoint.x} ${finalSourcePoint.y} L ${finalTargetPoint.x} ${finalTargetPoint.y}`,
      sourcePoint,
      targetPoint
    };
  }, []);

  // Helper to get connection display name - using ConnectionBrowser's WORKING logic
  const getConnectionName = useCallback((connection, nodePrototypesMap) => {
    // Copy the exact working logic from ConnectionBrowser lines 468-481
    let connectionName = 'Connection';
    
    // First try to get name from edge's definition node (if it has one)
    if (connection.definitionNodeIds && connection.definitionNodeIds.length > 0) {
      const definitionNode = nodePrototypesMap.get(connection.definitionNodeIds[0]);
      if (definitionNode) {
        connectionName = definitionNode.name || 'Connection';
      }
    } else if (connection.typeNodeId) {
      // Fallback to edge prototype type
      const edgePrototype = nodePrototypesMap.get(connection.typeNodeId);
      if (edgePrototype) {
        connectionName = edgePrototype.name || 'Connection';
      }
    }
    
    return connectionName;
  }, []);

  // Helper to get connection color
  const getConnectionColor = useCallback((connection) => {
    if (connection.color) return connection.color;
    if (connection.edgePrototype?.color) return connection.edgePrototype.color;
    return '#8B0000'; // Default connection color
  }, []);

  // Calculate scaled layout
  const { scaledNodes, scaledConnections, transform } = useMemo(() => {
    if (!nodes.length) {
      return { scaledNodes: [], scaledConnections: [], transform: { scale: 1, offsetX: 0, offsetY: 0 } };
    }

    // If nodes don't have positions, get them from instances
    const nodesWithPositions = nodes.map((node, index) => {
      let x, y, width, height;
      
      if (node.x !== undefined && node.y !== undefined) {
        x = node.x;
        y = node.y;
        if (node.width && node.height) {
          width = node.width;
          height = node.height;
        } else {
          // Use the exact same getNodeDimensions function as Node.jsx
          const dims = getNodeDimensions(node, false, null);
          width = dims.currentWidth;
          height = dims.currentHeight;
        }
      } else {
        const instance = instances.get(node.id);
        x = instance?.x || 0;
        y = instance?.y || 0;
        if (instance?.width && instance?.height) {
          width = instance.width;
          height = instance.height;
        } else if (node.width && node.height) {
          width = node.width;
          height = node.height;
        } else {
          // Use the exact same getNodeDimensions function as Node.jsx
          const dims = getNodeDimensions(node, false, null);
          width = dims.currentWidth;
          height = dims.currentHeight;
        }
      }
      
      // If alignNodesHorizontally is true, arrange nodes in a horizontal line
      if (alignNodesHorizontally) {
        const nodeSpacing = 200; // Space between nodes
        x = index * nodeSpacing;
        y = 0; // Same Y for all nodes
      }
      
      return {
        ...node,
        x,
        y,
        width,
        height
      };
    });

    // Calculate bounding box
    const minX = Math.min(...nodesWithPositions.map(n => n.x));
    const maxX = Math.max(...nodesWithPositions.map(n => n.x + n.width));
    const minY = Math.min(...nodesWithPositions.map(n => n.y));
    const maxY = Math.max(...nodesWithPositions.map(n => n.y + n.height));
    
    const boundingWidth = maxX - minX;
    const boundingHeight = maxY - minY;
    
    // Calculate scale to fit container with padding
    const availableWidth = containerWidth - (padding * 2);
    const availableHeight = containerHeight - (padding * 2);

    // Special handling for horizontal alignment contexts (e.g., connection control panel)
    if (alignNodesHorizontally) {
      const baseWidths = nodesWithPositions.map(n => n.width);
      const baseHeights = nodesWithPositions.map(n => n.height);
      const sumWidths = baseWidths.reduce((a, b) => a + b, 0);
      const maxHeight = Math.max(...baseHeights, 1);
      const gaps = Math.max(0, nodesWithPositions.length - 1);
      
      // Calculate proportional spacing based on node count and container size
      // Smaller spacing for more nodes to fit better, but maintain readability
      let spacing;
      if (nodesWithPositions.length === 1) {
        spacing = 0;
      } else if (nodesWithPositions.length <= 3) {
        spacing = Math.max(16, minHorizontalSpacing * 0.8); // Reduce spacing slightly for 2-3 nodes
      } else if (nodesWithPositions.length <= 6) {
        spacing = Math.max(12, minHorizontalSpacing * 0.6); // More compact for 4-6 nodes
      } else {
        spacing = Math.max(8, minHorizontalSpacing * 0.4); // Very compact for 7+ nodes
      }
      
      const widthForNodes = Math.max(1, availableWidth - gaps * spacing);
      const scaleByWidth = Math.min(1, widthForNodes / Math.max(1, sumWidths));
      const scaleByHeight = Math.min(1, availableHeight / Math.max(1, maxHeight));
      const nodeScale = Math.min(scaleByWidth, scaleByHeight);

      // Lay out nodes centered horizontally with proportional spacing, scaling proportionally
      const scaledWidths = baseWidths.map(w => w * nodeScale);
      const scaledHeights = baseHeights.map(h => h * nodeScale);
      const totalScaledWidth = scaledWidths.reduce((a, b) => a + b, 0) + gaps * spacing;
      const startX = padding + (availableWidth - totalScaledWidth) / 2;
      let cursorX = startX;
      const scaledNodes = nodesWithPositions.map((n, i) => {
        const w = scaledWidths[i];
        const h = scaledHeights[i];
        const x = cursorX;
        const y = padding + (availableHeight - h) / 2;
        cursorX += w + (i < nodesWithPositions.length - 1 ? spacing : 0);
        return {
          ...n,
          x,
          y,
          width: w,
          height: h,
          cornerRadius: Math.max(1, cornerRadiusMultiplier * nodeScale)
        };
      });

      const scaledConnections = connections.map(conn => {
        const sourceNode = scaledNodes.find(n => n.id === conn.sourceId);
        const targetNode = scaledNodes.find(n => n.id === (conn.destinationId || conn.targetId));
        if (!sourceNode || !targetNode) return null;
        const arrowsToward = conn.directionality?.arrowsToward || new Set();
        const hasSourceArrow = arrowsToward.has(conn.sourceId);
        const hasTargetArrow = arrowsToward.has(conn.destinationId || conn.targetId);
        const { path, sourcePoint, targetPoint } = calculateConnectionPath(
          sourceNode,
          targetNode,
          routingStyle,
          nodeScale,
          hasSourceArrow,
          hasTargetArrow
        );
        
        // Calculate adaptive stroke width based on average node size
        const avgNodeSize = (sourceNode.width + sourceNode.height + targetNode.width + targetNode.height) / 4;
        const baseStrokeMultiplier = Math.max(0.02, Math.min(0.08, avgNodeSize / 1000)); // Scales with node size
        const adaptiveStrokeWidth = Math.max(1.5, avgNodeSize * baseStrokeMultiplier * connectionStrokeScale);
        
        return {
          ...conn,
          path,
          sourcePoint,
          targetPoint,
          hasSourceArrow,
          hasTargetArrow,
          strokeWidth: adaptiveStrokeWidth,
          connectionName: conn.connectionName || conn.edgePrototype?.name || conn.name || 'Connection'
        };
      }).filter(Boolean);

      return {
        scaledNodes,
        scaledConnections,
        transform: { scale: nodeScale, offsetX: 0, offsetY: 0 }
      };
    }
    
    let scale;
    if (scaleMode === 'fit') {
      scale = Math.min(availableWidth / boundingWidth, availableHeight / boundingHeight);
    } else if (scaleMode === 'fill') {
      scale = Math.max(availableWidth / boundingWidth, availableHeight / boundingHeight);
    } else {
      scale = 1; // fixed
    }
    
    // Respect provided node sizes; do not clamp to a fixed visual size
    
    // Calculate centering offset
    const scaledWidth = boundingWidth * scale;
    const scaledHeight = boundingHeight * scale;
    const offsetX = (containerWidth - scaledWidth) / 2 - (minX * scale);
    const offsetY = (containerHeight - scaledHeight) / 2 - (minY * scale);

    // Apply transforms to nodes
    const scaledNodes = nodesWithPositions.map(node => ({
      ...node,
      x: node.x * scale + offsetX,
      y: node.y * scale + offsetY,
      width: node.width * scale,
      height: node.height * scale,
      cornerRadius: Math.max(1, cornerRadiusMultiplier * scale)
    }));

    // Process connections
    const scaledConnections = connections.map(conn => {
      const sourceNode = scaledNodes.find(n => n.id === conn.sourceId);
      const targetNode = scaledNodes.find(n => n.id === (conn.destinationId || conn.targetId));
      
      if (!sourceNode || !targetNode) return null;
      
      // Calculate arrow states first
      const arrowsToward = conn.directionality?.arrowsToward || new Set();
      const hasSourceArrow = arrowsToward.has(conn.sourceId);
      const hasTargetArrow = arrowsToward.has(conn.destinationId || conn.targetId);
      
      // Calculate connection path with arrow awareness
      const { path, sourcePoint, targetPoint } = calculateConnectionPath(
        sourceNode, 
        targetNode, 
        routingStyle,
        scale,
        hasSourceArrow,
        hasTargetArrow
      );
      
      // Calculate adaptive stroke width based on average node size
      const avgNodeSize = (sourceNode.width + sourceNode.height + targetNode.width + targetNode.height) / 4;
      const baseStrokeMultiplier = Math.max(0.02, Math.min(0.08, avgNodeSize / 1000)); // Scales with node size
      const adaptiveStrokeWidth = Math.max(1.5, avgNodeSize * baseStrokeMultiplier * connectionStrokeScale);
      
      return {
        ...conn,
        path,
        sourcePoint,
        targetPoint,
        hasSourceArrow,
        hasTargetArrow,
        strokeWidth: adaptiveStrokeWidth,
        color: getConnectionColor(conn),
        connectionName: conn.connectionName || getConnectionName(conn, nodePrototypesMap)
      };
    }).filter(Boolean);

    return { 
      scaledNodes, 
      scaledConnections, 
      transform: { scale, offsetX, offsetY }
    };
  }, [nodes, connections, instances, containerWidth, containerHeight, scaleMode, minNodeSize, maxNodeSize, padding, routingStyle, alignNodesHorizontally, calculateConnectionPath, connectionStrokeScale, nodePrototypesMap, getConnectionName, getConnectionColor]);

  // Event handlers
  const handleNodeMouseEnter = (node) => {
    // Clear connection hover state when hovering over nodes
    setHoveredConnectionId(null);
    setStableHoveredConnectionId(null);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    
    setHoveredNodeId(node.id);
    onNodeHover?.(node, true);
  };

  const handleNodeMouseLeave = (node) => {
    setHoveredNodeId(null);
    onNodeHover?.(node, false);
  };

  const handleConnectionMouseEnter = (connection) => {
    
    // Clear any pending leave timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    
    setHoveredConnectionId(connection.id);
    setStableHoveredConnectionId(connection.id);
    onConnectionHover?.(connection, true);
  };

  const handleConnectionMouseLeave = (connection) => {
    
    setHoveredConnectionId(null);
    
    // Debounce the stable hover state to prevent flicker
    hoverTimeoutRef.current = setTimeout(() => {
      setStableHoveredConnectionId(null);
      onConnectionHover?.(connection, false);
    }, 100); // 100ms delay before actually hiding dots
  };

  return (
    <div 
      className={`universal-node-renderer ${className}`}
      style={{ 
        width: containerWidth, 
        height: containerHeight,
        backgroundColor,
        borderRadius: '8px',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <svg
        width={containerWidth}
        height={containerHeight}
        style={{ display: 'block' }}
      >
        {/* Grid background if enabled */}
        {showGrid && (
          <defs>
            <pattern
              id="grid"
              width={20 * transform.scale}
              height={20 * transform.scale}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${20 * transform.scale} 0 L 0 0 0 ${20 * transform.scale}`}
                fill="none"
                stroke="#e0e0e0"
                strokeWidth="1"
              />
            </pattern>
          </defs>
        )}

        {showGrid && (
          <rect width="100%" height="100%" fill="url(#grid)" />
        )}

        {/* Render connections first (behind nodes) */}
        {scaledConnections.map(conn => {
          const isHovered = hoveredConnectionId === conn.id;
          const isStableHovered = stableHoveredConnectionId === conn.id;
          
          // Calculate adjusted connection path for consistent dot/arrow positioning
          const dotRadius = Math.max(6, 10 * transform.scale);
          let adjustedPath = conn.path;
          let adjustedSourcePoint = conn.sourcePoint;
          let adjustedTargetPoint = conn.targetPoint;
          
          // Safety check: ensure source and target points exist
          if (conn.sourcePoint && conn.targetPoint && 
              typeof conn.sourcePoint.x === 'number' && typeof conn.sourcePoint.y === 'number' &&
              typeof conn.targetPoint.x === 'number' && typeof conn.targetPoint.y === 'number') {
            
            const dx = conn.targetPoint.x - conn.sourcePoint.x;
            const dy = conn.targetPoint.y - conn.sourcePoint.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            
            if (length > 0) {
              const unitX = dx / length;
              const unitY = dy / length;
              
              // Calculate dot/arrow positions (8% from nodes)
              const dotOffset = 0.08 * length;
              
              // Only shorten the line on sides where there are arrows or when hovering to show dots
              let shouldShortenSource = conn.hasSourceArrow || (isStableHovered && !conn.hasSourceArrow);
              let shouldShortenTarget = conn.hasTargetArrow || (isStableHovered && !conn.hasTargetArrow);
              
              // Calculate adjusted points based on what should be shortened
              adjustedSourcePoint = shouldShortenSource ? {
                x: conn.sourcePoint.x + unitX * dotOffset,
                y: conn.sourcePoint.y + unitY * dotOffset
              } : conn.sourcePoint;
              
              adjustedTargetPoint = shouldShortenTarget ? {
                x: conn.targetPoint.x - unitX * dotOffset,
                y: conn.targetPoint.y - unitY * dotOffset
              } : conn.targetPoint;
              
              // Create adjusted path - only shorten where needed
              adjustedPath = `M ${adjustedSourcePoint.x} ${adjustedSourcePoint.y} L ${adjustedTargetPoint.x} ${adjustedTargetPoint.y}`;
            }
          }
          
          return (
            <g key={`connection-${conn.id}`}>
              {/* Glow filter disabled - was causing connections to disappear */}
              
              {/* Invisible hover area that matches the visual connection line exactly */}
              {interactive && adjustedPath && (
                <path
                  d={adjustedPath}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(8, conn.strokeWidth * 2)} // Just wide enough for easy clicking
                  strokeLinecap="round"
                  style={{ 
                    cursor: 'pointer',
                    pointerEvents: 'stroke'
                  }}
                  onMouseEnter={(e) => {
                    handleConnectionMouseEnter(conn);
                  }}
                  onMouseLeave={(e) => {
                    // Don't leave if moving to a dot (prevents flicker)
                    if (e.relatedTarget?.tagName === 'circle') {
                      return;
                    }
                    
                    handleConnectionMouseLeave(conn);
                  }}
                  onClick={() => onConnectionClick?.(conn)}
                />
              )}
              
              {/* Main connection path - always use adjusted path for consistent positioning */}
              {adjustedPath && (
                <path
                  d={adjustedPath}
                  fill="none"
                  stroke={conn.color || '#000000'}
                  strokeWidth={Math.max(4, conn.strokeWidth * 1.5)}
                  strokeLinecap="round"
                  filter={isHovered ? `drop-shadow(0 0 8px ${conn.color || '#000000'})` : 'none'}
                  style={{ 
                    pointerEvents: 'none', // Don't interfere with hover area above
                    transition: 'none' // Disable animation temporarily
                  }}
                />
              )}
              
              {/* Direction arrows - match NodeCanvas style */}
              {conn.hasSourceArrow && (() => {
                // Use adjusted source point for consistent arrow positioning
                const arrowX = adjustedSourcePoint.x;
                const arrowY = adjustedSourcePoint.y;
                const dx = conn.targetPoint.x - conn.sourcePoint.x;
                const dy = conn.targetPoint.y - conn.sourcePoint.y;
                const sourceArrowAngle = Math.atan2(-dy, -dx) * 180 / Math.PI; // Point toward the source node
                
                // Calculate arrow scale based on stroke width (maintains proportions)
                const arrowScale = Math.max(0.5, conn.strokeWidth / 6); // Base arrow size is for strokeWidth=6
                
                return (
                  <g 
                    transform={`translate(${arrowX}, ${arrowY}) rotate(${sourceArrowAngle + 90})`}
                    style={{ cursor: interactive ? 'pointer' : 'default' }}
                    onClick={interactive ? (e) => { e.stopPropagation(); onToggleArrow?.(conn.id, conn.sourceId); } : undefined}
                  >
                    {/* Background glow for arrow - only on hover */}
                    {isHovered && (
                      <polygon
                        points={`${-16 * arrowScale},${20 * arrowScale} ${16 * arrowScale},${20 * arrowScale} 0,${-20 * arrowScale}`}
                        fill={conn.color || '#000000'}
                        stroke={conn.color || '#000000'}
                        strokeWidth={Math.max(2, conn.strokeWidth * 1.2)}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity="0.3"
                        style={{ 
                          filter: `blur(2px) drop-shadow(0 0 6px ${conn.color || '#000000'})`,
                          pointerEvents: 'none'
                        }}
                      />
                    )}
                    {/* Main arrow */}
                    <polygon
                      points={`${-16 * arrowScale},${20 * arrowScale} ${16 * arrowScale},${20 * arrowScale} 0,${-20 * arrowScale}`}
                      fill={conn.color || '#000000'}
                      stroke={conn.color || '#000000'}
                      strokeWidth={Math.max(1.5, conn.strokeWidth * 0.8)}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      paintOrder="stroke fill"
                      filter={isHovered ? `drop-shadow(0 0 8px ${conn.color || '#000000'})` : 'none'}
                    />
                    
                    {/* Invisible larger hitbox for easier clicking */}
                    <polygon
                      points={`${-22 * arrowScale},${26 * arrowScale} ${22 * arrowScale},${26 * arrowScale} 0,${-26 * arrowScale}`}
                      fill="transparent"
                      stroke="transparent"
                      style={{ 
                        cursor: 'pointer',
                        pointerEvents: 'auto'
                      }}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        onToggleArrow?.(conn.id, conn.sourceId); 
                      }}
                    />
                  </g>
                );
              })()}
              
              {conn.hasTargetArrow && (() => {
                // Use adjusted target point for consistent arrow positioning
                const arrowX = adjustedTargetPoint.x;
                const arrowY = adjustedTargetPoint.y;
                const dx = conn.targetPoint.x - conn.sourcePoint.x;
                const dy = conn.targetPoint.y - conn.sourcePoint.y;
                const destArrowAngle = Math.atan2(dy, dx) * 180 / Math.PI; // Point toward the target node
                
                // Calculate arrow scale based on stroke width (maintains proportions)
                const arrowScale = Math.max(0.5, conn.strokeWidth / 6); // Base arrow size is for strokeWidth=6
                
                return (
                  <g 
                    transform={`translate(${arrowX}, ${arrowY}) rotate(${destArrowAngle + 90})`}
                    style={{ cursor: interactive ? 'pointer' : 'default' }}
                    onClick={interactive ? (e) => { e.stopPropagation(); onToggleArrow?.(conn.id, conn.targetId || conn.destinationId); } : undefined}
                  >
                    {/* Background glow for arrow - only on hover */}
                    {isHovered && (
                      <polygon
                        points={`${-16 * arrowScale},${20 * arrowScale} ${16 * arrowScale},${20 * arrowScale} 0,${-20 * arrowScale}`}
                        fill={conn.color || '#000000'}
                        stroke={conn.color || '#000000'}
                        strokeWidth={Math.max(2, conn.strokeWidth * 1.2)}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity="0.3"
                        style={{ 
                          filter: `blur(2px) drop-shadow(0 0 6px ${conn.color || '#000000'})`,
                          pointerEvents: 'none'
                        }}
                      />
                    )}
                    {/* Main arrow */}
                    <polygon
                      points={`${-16 * arrowScale},${20 * arrowScale} ${16 * arrowScale},${20 * arrowScale} 0,${-20 * arrowScale}`}
                      fill={conn.color || '#000000'}
                      stroke={conn.color || '#000000'}
                      strokeWidth={Math.max(1.5, conn.strokeWidth * 0.8)}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      paintOrder="stroke fill"
                      filter={isHovered ? `drop-shadow(0 0 8px ${conn.color || '#000000'})` : 'none'}
                    />
                    
                    {/* Invisible larger hitbox for easier clicking */}
                    <polygon
                      points={`${-22 * arrowScale},${26 * arrowScale} ${22 * arrowScale},${26 * arrowScale} 0,${-26 * arrowScale}`}
                      fill="transparent"
                      stroke="transparent"
                      style={{ 
                        cursor: 'pointer',
                        pointerEvents: 'auto'
                      }}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        onToggleArrow?.(conn.id, conn.targetId || conn.destinationId); 
                      }}
                    />
                  </g>
                );
              })()}
              
              {/* Connection name text - rendered on top of connection */}
              <ConnectionText
                connection={conn}
                sourcePoint={adjustedSourcePoint}
                targetPoint={adjustedTargetPoint}
                transform={transform}
                isHovered={isStableHovered}
                fontScale={connectionFontScale}
              />
              
              {/* Render dots within the connection group to access adjusted points */}
              {interactive && showConnectionDots && isStableHovered && (
                <g key={`dots-${conn.id}`}>
                  {/* Only show source dot if there's no source arrow */}
                  {!conn.hasSourceArrow && (() => {
                    // Use adjusted source point for consistent dot positioning
                    const dotX = adjustedSourcePoint.x;
                    const dotY = adjustedSourcePoint.y;
                    
                    // Calculate dot scale based on stroke width (maintains proportions)
                    const dotScale = Math.max(0.5, conn.strokeWidth / 6); // Base dot size is for strokeWidth=6
                    
                    return (
                      <g>
                        <defs>
                          <filter id={`dot-glow-${conn.id}-source`} x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation={Math.max(2, 3 * dotScale)} result="coloredBlur"/>
                            <feMerge> 
                              <feMergeNode in="coloredBlur"/>
                              <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                          </filter>
                        </defs>
                        <circle
                          cx={dotX}
                          cy={dotY}
                          r={Math.max(3, 10 * dotScale)}
                          fill={conn.color || '#000000'}
                          opacity={1}
                          filter={`url(#dot-glow-${conn.id}-source)`}
                          style={{ 
                            cursor: 'pointer',
                            pointerEvents: 'auto'
                          }}
                          onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation(); 
                            onToggleArrow?.(conn.id, conn.sourceId); 
                          }}
                        />
                        
                        {/* Invisible larger hitbox for easier clicking */}
                        <circle
                          cx={dotX}
                          cy={dotY}
                          r={Math.max(6, 18 * dotScale)}
                          fill="transparent"
                          stroke="transparent"
                          style={{ 
                            cursor: 'pointer',
                            pointerEvents: 'auto'
                          }}
                          onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation(); 
                            onToggleArrow?.(conn.id, conn.sourceId); 
                          }}
                        />
                      </g>
                    );
                  })()}
                  
                  {/* Only show target dot if there's no target arrow */}
                  {!conn.hasTargetArrow && (() => {
                    // Use adjusted target point for consistent dot positioning
                    const dotX = adjustedTargetPoint.x;
                    const dotY = adjustedTargetPoint.y;
                    
                    // Calculate dot scale based on stroke width (maintains proportions)
                    const dotScale = Math.max(0.5, conn.strokeWidth / 6); // Base dot size is for strokeWidth=6
                    
                    return (
                      <g>
                        <defs>
                          <filter id={`dot-glow-${conn.id}-target`} x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation={Math.max(2, 3 * dotScale)} result="coloredBlur"/>
                            <feMerge> 
                              <feMergeNode in="coloredBlur"/>
                              <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                          </filter>
                        </defs>
                        <circle
                          cx={dotX}
                          cy={dotY}
                          r={Math.max(3, 10 * dotScale)}
                          fill={conn.color || '#000000'}
                          opacity={1}
                          filter={`url(#dot-glow-${conn.id}-target)`}
                          style={{ 
                            cursor: 'pointer',
                            pointerEvents: 'auto'
                          }}
                          onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation(); 
                            onToggleArrow?.(conn.id, conn.targetId || conn.destinationId); 
                          }}
                        />
                        
                        {/* Invisible larger hitbox for easier clicking */}
                        <circle
                          cx={dotX}
                          cy={dotY}
                          r={Math.max(6, 18 * dotScale)}
                          fill="transparent"
                          stroke="transparent"
                          style={{ 
                            cursor: 'pointer',
                            pointerEvents: 'auto'
                          }}
                          onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation(); 
                            onToggleArrow?.(conn.id, conn.targetId || conn.destinationId); 
                          }}
                        />
                      </g>
                    );
                  })()}
                </g>
              )}
            </g>
          );
        })}
        
        {/* Render nodes on top */}
        {scaledNodes.map(node => {
          const isHovered = hoveredNodeId === node.id;
          
          // Calculate text sizing and padding to exactly match Node.jsx proportions
          const nameString = typeof node.name === 'string' ? node.name : '';
          
          // Use Node.jsx's exact font size, line height, and padding calculations
          // Special handling for groups - larger text and different padding
          const baseFontSize = node.isGroup ? 24 : 20; // Slightly smaller font for groups to avoid oversizing short words
          const baseLineHeight = node.isGroup ? 32 : 26; // Match Node.jsx line height
          const baseVerticalPadding = node.isGroup ? 18 : 12; // Tighter vertical padding to match compact multi-line display
          const baseSingleLineSidePadding = node.isGroup ? 30 : 22; // Generous side padding for compact labels
          const baseMultiLineSidePadding = node.isGroup ? 36 : 30; // More breathing room for wrapped group names
          const baseAverageCharWidth = node.isGroup ? 14 : 12; // Adjust width estimation for larger type
          
          // Apply transform scale to all measurements
          const computedFontSize = Math.max(6, baseFontSize * transform.scale * nodeFontScale);
          const computedLineHeight = Math.max(12, baseLineHeight * transform.scale * nodeFontScale);
          let verticalPadding = baseVerticalPadding * transform.scale;
          const singleLineSidePadding = baseSingleLineSidePadding * transform.scale;
          const multiLineSidePadding = baseMultiLineSidePadding * transform.scale;
          const averageCharWidth = baseAverageCharWidth * transform.scale;
          const cornerRadius = Math.max(1, cornerRadiusMultiplier * transform.scale); // NODE_CORNER_RADIUS baseline
          
          // Determine multiline exactly like Node.jsx does
          const availableTextWidth = Math.max(0, node.width - (2 * singleLineSidePadding));
          const charsPerLine = Math.max(1, Math.floor(availableTextWidth / averageCharWidth));
          const isMultiline = nameString.length > charsPerLine;
          if (node.isGroup && isMultiline) {
            verticalPadding = Math.max(verticalPadding, (baseVerticalPadding + 6) * transform.scale);
          }
          
          return (
            <g 
              key={`node-${node.id}`}
              style={{ cursor: interactive ? 'pointer' : 'default' }}
              onMouseEnter={interactive ? () => handleNodeMouseEnter(node) : undefined}
              onMouseLeave={interactive ? () => handleNodeMouseLeave(node) : undefined}
              onClick={interactive ? () => onNodeClick?.(node) : undefined}
            >
              {/* Node background - special styling for groups */}
              <rect
                className="node-background"
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={cornerRadius}
                ry={cornerRadius}
                fill={node.isGroup ? '#bdb5b5' : (node.color || '#800000')}
                stroke={node.isGroup ? (node.color || '#8B0000') : 'none'}
                strokeWidth={node.isGroup ? Math.max(3, 6 * transform.scale) : 0}
                style={{ 
                  cursor: interactive ? 'pointer' : 'default',
                  transition: 'width 0.3s ease, height 0.3s ease, fill 0.2s ease'
                }}
                onMouseEnter={interactive ? () => handleNodeMouseEnter(node) : undefined}
                onMouseLeave={interactive ? () => handleNodeMouseLeave(node) : undefined}
                onClick={interactive ? () => onNodeClick?.(node) : undefined}
              />
              
              {/* Text using foreignObject like Node.jsx */}
              <foreignObject
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                style={{ 
                  pointerEvents: 'none',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    padding: `${verticalPadding}px ${isMultiline ? multiLineSidePadding : singleLineSidePadding}px`,
                    boxSizing: 'border-box',
                    userSelect: 'none',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: `${computedFontSize}px`,
                      fontWeight: 'bold',
                      color: node.isGroup ? (node.color || '#8B0000') : '#bdb5b5',
                      lineHeight: `${computedLineHeight}px`,
                      letterSpacing: '-0.2px',
                      whiteSpace: 'normal',
                      overflowWrap: 'break-word',
                      wordBreak: 'break-word',
                      textAlign: 'center',
                      minWidth: 0,
                      display: 'inline-block',
                      width: '100%',
                      fontFamily: 'EmOne, sans-serif',
                      hyphens: 'auto',
                    }}
                  >
                    {nameString}
                  </span>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default UniversalNodeRenderer;
