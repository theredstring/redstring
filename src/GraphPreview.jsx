import React, { useMemo } from 'react';
import { getNodeDimensions } from './utils.js';
import { NODE_HEIGHT, NODE_WIDTH, NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR } from './constants';
import useGraphStore from "./store/graphStore.jsx";

const GraphPreview = ({ nodes = [], edges = [], width, height }) => {
  // Access store for prototype data to determine edge colors
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore(state => state.edgePrototypes);

  // Helper function to get edge color based on type hierarchy
  const getEdgeColor = (edge, destNode) => {
    // First check definitionNodeIds (for custom connection types set via control panel)
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      const definitionNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
      if (definitionNode) {
        return definitionNode.color || NODE_DEFAULT_COLOR;
      }
    }
    
    // Then check typeNodeId (for base connection type)
    if (edge.typeNodeId) {
      // Special handling for base connection prototype - ensure it's black
      if (edge.typeNodeId === 'base-connection-prototype') {
        return '#000000'; // Black color for base connection
      }
      const edgePrototype = edgePrototypesMap.get(edge.typeNodeId);
      if (edgePrototype) {
        return edgePrototype.color || NODE_DEFAULT_COLOR;
      }
    }
    
    return destNode.color || NODE_DEFAULT_COLOR;
  };

  // Basic scaling logic (can be refined)
  const { scaledNodes, scaledEdges, viewBox, scale } = useMemo(() => {
    if (!nodes.length || !width || !height) {
      return { scaledNodes: [], scaledEdges: [], viewBox: '0 0 100 100', scale: 1 };
    }

    // Define padding around the bounding box
    const BOUNDING_BOX_PADDING = 20; // Pixels in original coordinates

    // 1. Find bounds of original nodes using getNodeDimensions
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const dims = getNodeDimensions(n, false, null);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + dims.currentWidth);
      maxY = Math.max(maxY, n.y + dims.currentHeight);
    });

    // Handle case with only one node or invalid bounds
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        const n = nodes[0] || { x: 0, y: 0 }; // Default if nodes is empty somehow
        const dims = nodes[0] ? getNodeDimensions(nodes[0], false, null) : { currentWidth: NODE_WIDTH, currentHeight: NODE_HEIGHT }; 
        minX = n.x;
        minY = n.y;
        maxX = n.x + dims.currentWidth;
        maxY = n.y + dims.currentHeight;
    }

    // Calculate base network dimensions
    const baseNetworkWidth = Math.max(maxX - minX, 1);
    const baseNetworkHeight = Math.max(maxY - minY, 1);

    // Add padding to the dimensions for scaling
    const networkWidth = baseNetworkWidth + 2 * BOUNDING_BOX_PADDING;
    const networkHeight = baseNetworkHeight + 2 * BOUNDING_BOX_PADDING;

    // 2. Calculate scale factors
    const scaleX = width / networkWidth;
    const scaleY = height / networkHeight;
    const finalScale = Math.min(scaleX, scaleY);

    // 3. Calculate offsets to center the scaled graph (account for padding)
    const scaledContentWidth = networkWidth * finalScale;
    const scaledContentHeight = networkHeight * finalScale;
    const offsetX = (width - scaledContentWidth) / 2 - ((minX - BOUNDING_BOX_PADDING) * finalScale);
    const offsetY = (height - scaledContentHeight) / 2 - ((minY - BOUNDING_BOX_PADDING) * finalScale);

    // 4. Scale node positions and dimensions
    const finalScaledNodes = nodes.map(node => {
        const dims = getNodeDimensions(node, false, null);
        return {
            id: node.id,
            x: node.x * finalScale + offsetX,
            y: node.y * finalScale + offsetY,
            width: dims.currentWidth * finalScale,
            height: dims.currentHeight * finalScale,
            textAreaHeight: dims.textAreaHeight * finalScale,
            imageWidth: dims.imageWidth,
            calculatedImageHeight: dims.calculatedImageHeight,
        };
    });

    // 5. Scale edge positions and include full edge data for arrows
    const finalScaledEdges = edges.map(edge => {
      const sourceNode = finalScaledNodes.find(n => n.id === edge.sourceId);
      const destNode = finalScaledNodes.find(n => n.id === edge.destinationId);
      if (!sourceNode || !destNode) return null;
      return {
        ...edge, // Include full edge data for directionality
        key: edge.id,
        sourceNode,
        destNode,
        x1: sourceNode.x + sourceNode.width / 2,
        y1: sourceNode.y + sourceNode.height / 2,
        x2: destNode.x + destNode.width / 2,
        y2: destNode.y + destNode.height / 2,
      };
    }).filter(Boolean);

    const vb = `0 0 ${width} ${height}`;

    return { scaledNodes: finalScaledNodes, scaledEdges: finalScaledEdges, viewBox: vb, scale: finalScale };

  }, [nodes, edges, width, height]);

  // Helper function to calculate edge intersection with rectangular nodes (adapted from NodeCanvas)
  const getNodeEdgeIntersection = (nodeX, nodeY, nodeWidth, nodeHeight, dirX, dirY) => {
    const centerX = nodeX + nodeWidth / 2;
    const centerY = nodeY + nodeHeight / 2;
    const halfWidth = nodeWidth / 2;
    const halfHeight = nodeHeight / 2;
    const intersections = [];
    
    if (dirX > 0) {
      const t = halfWidth / dirX;
      const y = dirY * t;
      if (Math.abs(y) <= halfHeight) intersections.push({ x: centerX + halfWidth, y: centerY + y, distance: t });
    }
    if (dirX < 0) {
      const t = -halfWidth / dirX;
      const y = dirY * t;
      if (Math.abs(y) <= halfHeight) intersections.push({ x: centerX - halfWidth, y: centerY + y, distance: t });
    }
    if (dirY > 0) {
      const t = halfHeight / dirY;
      const x = dirX * t;
      if (Math.abs(x) <= halfWidth) intersections.push({ x: centerX + x, y: centerY + halfHeight, distance: t });
    }
    if (dirY < 0) {
      const t = -halfHeight / dirY;
      const x = dirX * t;
      if (Math.abs(x) <= halfWidth) intersections.push({ x: centerX + x, y: centerY - halfHeight, distance: t });
    }
    
    return intersections.reduce((closest, current) => 
      !closest || current.distance < closest.distance ? current : closest, null);
  };

  // Render static SVG
  return (
    <svg width="100%" height="100%" viewBox={viewBox} style={{ display: 'block' }}>
      <defs>
        {/* Define clipPaths dynamically if needed, or keep one if IDs are unique enough within SVG */}
        {/* Example using node.id if nodes are guaranteed unique within the SVG output */}
        {scaledNodes.map(node => {
          const originalNode = nodes.find(n => n.id === node.id);
          if (!originalNode?.imageSrc) return null; // Only for image nodes
          // Get proper dimensions for this specific node
          const nodeDimensions = getNodeDimensions(originalNode, false, null);
          const scaledWidth = node.width;
          const scaledHeight = node.height;
          
          // Use scaled corner radius to match Node.jsx
          const imageCornerRadius = NODE_CORNER_RADIUS * scale;

          return (
            <clipPath key={`clip-${node.id}`} id={`clip-${node.id}`}>
              <rect x={node.x} y={node.y} width={scaledWidth} height={scaledHeight} rx={imageCornerRadius} ry={imageCornerRadius} />
            </clipPath>
          );
        })}
      </defs>

      <g>
        {/* Render Edges First */}
        {scaledEdges.map(edge => {
          // Calculate direction and length
          const dx = edge.x2 - edge.x1;
          const dy = edge.y2 - edge.y1;
          const length = Math.sqrt(dx * dx + dy * dy);
          
          if (length === 0) return null;
          
          // Calculate edge intersections for arrow positioning
          const sourceIntersection = getNodeEdgeIntersection(
            edge.sourceNode.x, edge.sourceNode.y, edge.sourceNode.width, edge.sourceNode.height,
            dx / length, dy / length
          );
          
          const destIntersection = getNodeEdgeIntersection(
            edge.destNode.x, edge.destNode.y, edge.destNode.width, edge.destNode.height,
            -dx / length, -dy / length
          );

          // Determine if each end should be shortened for arrows
          // Ensure arrowsToward is a Set (fix for loading from file)
          const arrowsToward = edge.directionality?.arrowsToward instanceof Set 
            ? edge.directionality.arrowsToward 
            : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);
          
          const shouldShortenSource = arrowsToward.has(edge.sourceId);
          const shouldShortenDest = arrowsToward.has(edge.destinationId);

          // Calculate arrow positions and angles if needed
          let sourceArrowX, sourceArrowY, destArrowX, destArrowY, sourceArrowAngle, destArrowAngle;
          
          if (shouldShortenSource || shouldShortenDest) {
            if (!sourceIntersection || !destIntersection) {
              // Fallback positioning
              sourceArrowX = edge.x1 + (dx / length) * 20 * scale;
              sourceArrowY = edge.y1 + (dy / length) * 20 * scale;
              destArrowX = edge.x2 - (dx / length) * 20 * scale;
              destArrowY = edge.y2 - (dy / length) * 20 * scale;
              sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
              destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
            } else {
              // Precise intersection positioning
              const arrowLength = 5 * scale;
              sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
              sourceArrowX = sourceIntersection.x + (dx / length) * arrowLength;
              sourceArrowY = sourceIntersection.y + (dy / length) * arrowLength;
              destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
              destArrowX = destIntersection.x - (dx / length) * arrowLength;
              destArrowY = destIntersection.y - (dy / length) * arrowLength;
            }
          }

          // Get edge color based on type hierarchy
          const edgeColor = getEdgeColor(edge, nodes.find(n => n.id === edge.destinationId));

          return (
            <g key={edge.key}>
              {/* Main edge line - even thinner stroke */}
              <line
                x1={shouldShortenSource ? (sourceIntersection?.x || edge.x1) : edge.x1}
                y1={shouldShortenSource ? (sourceIntersection?.y || edge.y1) : edge.y1}
                x2={shouldShortenDest ? (destIntersection?.x || edge.x2) : edge.x2}
                y2={shouldShortenDest ? (destIntersection?.y || edge.y2) : edge.y2}
                stroke={edgeColor}
                strokeWidth={Math.min(1.0, Math.max(0.2, 0.5 / scale)) || 0.2}
              />
              
              {/* Source Arrow - slightly bigger size */}
              {arrowsToward.has(edge.sourceId) && (
                <g transform={`translate(${sourceArrowX}, ${sourceArrowY}) rotate(${sourceArrowAngle + 90})`}>
                  <polygon
                    points={`${-10 * scale},${12 * scale} ${10 * scale},${12 * scale} 0,${-12 * scale}`}
                    fill={edgeColor}
                    stroke={edgeColor}
                    strokeWidth={Math.min(2.0, Math.max(0.2, 0.6 / scale)) || 0.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    paintOrder="stroke fill"
                  />
                </g>
              )}
              
              {/* Destination Arrow - slightly bigger size */}
              {arrowsToward.has(edge.destinationId) && (
                <g transform={`translate(${destArrowX}, ${destArrowY}) rotate(${destArrowAngle + 90})`}>
                  <polygon
                    points={`${-10 * scale},${12 * scale} ${10 * scale},${12 * scale} 0,${-12 * scale}`}
                    fill={edgeColor}
                    stroke={edgeColor}
                    strokeWidth={Math.min(2.0, Math.max(0.2, 0.6 / scale)) || 0.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    paintOrder="stroke fill"
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* Render Nodes */}
        {scaledNodes.map(node => {
          const originalNode = nodes.find(n => n.id === node.id);
          const imageSrc = originalNode?.imageSrc;
          const nodeColor = originalNode?.color || '#800000'; // Get node color or default
          const nodeName = originalNode?.name || 'Untitled';

          // Get proper dimensions for this specific node (like InnerNetwork does)
          const nodeDimensions = getNodeDimensions(originalNode, false, null);
          const scaledWidth = nodeDimensions.currentWidth * scale;
          const scaledHeight = nodeDimensions.currentHeight * scale;
          const scaledTextAreaHeight = nodeDimensions.textAreaHeight * scale;

          // FIX: Adjust node stroke width calculation - make thicker
          const nodeStrokeWidth = Math.min(3.0, Math.max(0.5, 1.6 / scale)) || 0.5; // Increased base factor and max limit

          // Determine if text should be shown (when node is large enough)
          const showText = scaledWidth > 15; // Show text when width exceeds 15px
          const fontSize = Math.max(4, Math.min(10, scaledWidth * 0.11)); // Slightly larger font relative to node size

          if (imageSrc) {
            // Calculate stroke offset and adjusted dimensions/radius for the stroke rect
            const strokeOffset = nodeStrokeWidth / 2;
            const strokeRectWidth = Math.max(0, scaledWidth - nodeStrokeWidth);
            const strokeRectHeight = Math.max(0, scaledHeight - nodeStrokeWidth);
            
            // Use same logic as clipPath for consistency
            const imageCornerRadius = NODE_CORNER_RADIUS * scale;
            const strokeRectRx = Math.max(0, imageCornerRadius - strokeOffset);
            const strokeRectRy = Math.max(0, imageCornerRadius - strokeOffset);
            
            return (
              // Remove clipPath from group
              <g 
                key={node.id}
              >
                <image
                  x={node.x} 
                  y={node.y}
                  width={scaledWidth}
                  height={scaledHeight}
                  href={imageSrc}
                  preserveAspectRatio="xMidYMid slice"
                  // Apply unique clipPath directly to image
                  clipPath={`url(#clip-${node.id})`}
                />
                {/* Adjust stroke rect position, size, and radius */}
                <rect 
                  x={node.x + strokeOffset} // Offset position
                  y={node.y + strokeOffset}
                  width={strokeRectWidth} // Adjusted size
                  height={strokeRectHeight} 
                  fill="none" 
                  stroke={nodeColor} 
                  strokeWidth={nodeStrokeWidth} 
                  rx={strokeRectRx} // Adjusted radius
                  ry={strokeRectRy} 
                />
                {/* Conditional text for image nodes - hidden when there's an image */}
                {showText && !imageSrc && (
                  <text
                    x={node.x + scaledWidth / 2}
                    y={node.y + scaledTextAreaHeight / 2} // Position in text area
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fill="#bdb5b5"
                    fontWeight="bold"
                    fontFamily="'EmOne', sans-serif"
                    style={{
                      pointerEvents: 'none',
                      userSelect: 'none'
                    }}
                  >
                    <tspan
                      x={node.x + scaledWidth / 2}
                      style={{
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {nodeName.length > 6 ? nodeName.substring(0, 6) + '...' : nodeName}
                    </tspan>
                  </text>
                )}
              </g>
            );
          } else {
            // --- Render Rect Node ---
            return (
              <g key={node.id}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={scaledWidth}
                  height={scaledHeight}
                  fill={nodeColor} // Use node color
                  // More rounded corners to match other network representations
                  rx={NODE_CORNER_RADIUS * scale} 
                  ry={NODE_CORNER_RADIUS * scale}
                />
                {/* Conditional text for rect nodes */}
                {showText && (
                  <text
                    x={node.x + scaledWidth / 2}
                    y={node.y + scaledTextAreaHeight / 2} // Position in text area
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fill="#bdb5b5"
                    fontWeight="bold"
                    fontFamily="'EmOne', sans-serif"
                    style={{
                      pointerEvents: 'none',
                      userSelect: 'none'
                    }}
                  >
                    <tspan
                      x={node.x + scaledWidth / 2}
                      style={{
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {nodeName.length > 6 ? nodeName.substring(0, 6) + '...' : nodeName}
                    </tspan>
                  </text>
                )}
              </g>
            );
          }
        })}
      </g>
    </svg>
  );
};

export default GraphPreview; 