import React from 'react';
import {
    NODE_WIDTH,
    NODE_HEIGHT,
    NODE_PADDING,
    AVERAGE_CHAR_WIDTH,
    LINE_HEIGHT_ESTIMATE,
    EXPANDED_NODE_WIDTH,
    NAME_AREA_FACTOR,
    NODE_CORNER_RADIUS,
    NODE_DEFAULT_COLOR,
    CONNECTION_WIDTH_BASE_SCALE
} from './constants'; // Import necessary constants
import { getNodeDimensions } from './utils.js'; // Import from utils.js
import { getTextColor } from './utils/colorUtils.js';
import { buildNodeFontString, wrapTextToLines, measureTextWidth } from './services/textMeasurement.js';
import { useTheme } from './hooks/useTheme.js';
import useGraphStore from "./store/graphStore.js";

// --- Canvas parity constants ---
// The decomposition preview is a *scaled-down canvas*, not its own visual language:
// every value below is the number NodeCanvas/Node.jsx already use, so a mini-node
// is the real node under a `scale()` rather than a separately-tuned lookalike.
const LABEL_FONT_BASE = 45;         // Node.jsx: 45 * fontSize * effNodeScale
const LABEL_LINE_HEIGHT_BASE = 39;  // Node.jsx: 39 * fontSize * lineSpacing * effNodeScale
const LABEL_V_PADDING_BASE = 34;    // Node.jsx: .node-name-container vertical padding
const BG_INSET = 6;                 // Node.jsx: background rect inset (and its rx reduction)
const EDGE_STROKE_BASE = 27;        // NodeCanvas: 27 * connectionWidth
const ARROW_OFFSET_BASE = 12;       // NodeCanvas: straight-edge arrow `offset`
const ARROW_POINTS = '-26,34 26,34 0,-34'; // NodeCanvas arrowhead, drawn at scale(connectionWidth)

// Legibility cutoff. Once the proportional label projects below this many pixels in
// the preview's own space it stops being text and starts being a smudge — drop it and
// let the node read as a colored block. (Previously the label was *boosted* to stay
// readable, which is what made mini-nodes look like tiny text floating in fat padding:
// a 28px cap against a box sized for 45px text.)
const MIN_LABEL_PX = 7;

/** Longest prefix of `text` that fits `maxWidth`, suffixed with an ellipsis. */
const truncateToWidth = (text, fontString, maxWidth) => {
  if (!text || maxWidth <= 0) return text;
  if (measureTextWidth(text, fontString) <= maxWidth) return text;
  let clipped = text.trimEnd();
  while (clipped.length > 0 && measureTextWidth(`${clipped}…`, fontString) > maxWidth) {
    clipped = clipped.slice(0, -1).trimEnd();
  }
  return clipped ? `${clipped}…` : '';
};

// --- InnerNetwork Component ---
// Rename connections to edges, expect plain data objects
const InnerNetwork = ({ nodes, edges, width, height, padding }) => {
  // Access store for prototype data to determine edge colors
  const theme = useTheme();
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore(state => state.edgePrototypes);
  const textSettings = useGraphStore(state => state.textSettings);
  const nodeScaleGlobal = textSettings?.nodeScale ?? 1.0;
  const connectionWidth = (textSettings?.connectionWidth ?? 1.0) * CONNECTION_WIDTH_BASE_SCALE;

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
    
    return destNode?.color || NODE_DEFAULT_COLOR;
  };
  // Check for edges instead of connections
  if (!nodes || nodes.length === 0 || !edges || width <= 0 || height <= 0) {
    return null; 
  }

  // --- Bounding Box Calculation ---
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(node => {
    // Use dimensions of the original nodes passed in (plain data)
    const dims = getNodeDimensions(node, false, null); // Ensure getNodeDimensions handles plain data
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + dims.currentWidth);
    maxY = Math.max(maxY, node.y + dims.currentHeight);
  });

  // Define padding around the bounding box
  const BOUNDING_BOX_PADDING = 20; // Pixels in original coordinates

  // Calculate base network dimensions from bounding box
  const baseNetworkWidth = nodes.length > 0 ? Math.max(maxX - minX, NODE_WIDTH * nodeScaleGlobal) : NODE_WIDTH * nodeScaleGlobal;
  const baseNetworkHeight = nodes.length > 0 ? Math.max(maxY - minY, NODE_HEIGHT * nodeScaleGlobal) : NODE_HEIGHT * nodeScaleGlobal;

  // Add padding to the dimensions before scaling
  const networkWidth = baseNetworkWidth + 2 * BOUNDING_BOX_PADDING;
  const networkHeight = baseNetworkHeight + 2 * BOUNDING_BOX_PADDING;

  if (networkWidth <= 0 || networkHeight <= 0) {
      return null; 
  }

  // --- Scaling and Translation Calculation ---
  const availableWidth = width - 2 * padding;
  const availableHeight = height - 2 * padding;

  if (availableWidth <= 0 || availableHeight <= 0) {
      return null;
  }

  const scaleX = availableWidth / networkWidth;
  const scaleY = availableHeight / networkHeight;
  const scale = Math.min(scaleX, scaleY); // Calculate scale to fit padded box

  const scaledNetworkWidth = networkWidth * scale; 
  const scaledNetworkHeight = networkHeight * scale; 

  // Adjust translation to account for the padded bounding box origin (minX - padding)
  const translateX = padding + (availableWidth - scaledNetworkWidth) / 2 - ((minX - BOUNDING_BOX_PADDING) * scale);
  const translateY = padding + (availableHeight - scaledNetworkHeight) / 2 - ((minY - BOUNDING_BOX_PADDING) * scale);

  // Edges keep their true canvas weight (27 * connectionWidth in graph coordinates), so
  // they thin out with the rest of the drawing instead of staying a fixed screen width.
  // The `1 / scale` floor is only a don't-vanish backstop for extreme zoom-outs.
  const edgeStrokeWidth = Math.max(EDGE_STROKE_BASE * connectionWidth, 1 / scale);

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

  return (
    // Apply calculated transform to the parent group
    <g transform={`translate(${translateX}, ${translateY}) scale(${scale})`} pointerEvents="none">
      <defs>
        {nodes.filter(node => node.thumbnailSrc).map(node => {
          const dimensions = getNodeDimensions(node, false, null);
          return (
            <clipPath key={`inner-node-clip-${node.id}`} id={`inner-node-clip-${node.id}`}>
              <rect
                x={node.x + (dimensions.scaledPadding ?? NODE_PADDING)}
                y={node.y + dimensions.textAreaHeight}
                width={dimensions.imageWidth}
                height={dimensions.calculatedImageHeight}
                rx={dimensions.scaledCornerRadius ?? NODE_CORNER_RADIUS}
                ry={dimensions.scaledCornerRadius ?? NODE_CORNER_RADIUS}
              />
            </clipPath>
          );
        })}
      </defs>
      {/* Render Edges using original coordinates (scaled by parent g) */}
      {/* Iterate over edges */}
      {edges.map((edge, idx) => {
        // Access IDs directly from edge data object
        const sourceId = edge.sourceId;
        const destId = edge.destinationId;

        if (!sourceId || !destId) {
            console.warn(`InnerNetwork edge at index ${idx} missing ID`, edge);
            return null;
        }

        // Find node data using the IDs in the nodes array prop
        const sNodeData = nodes.find(n => n.id === sourceId);
        const eNodeData = nodes.find(n => n.id === destId);

        if (!sNodeData || !eNodeData) {
             // Use edge.id from data object
             console.warn(`InnerNetwork could not find nodes for edge ${edge.id}`, { sourceId, destId });
             return null;
        }

        // Get original dimensions for center calculation from plain node data
        const sNodeDims = getNodeDimensions(sNodeData, false, null);
        const eNodeDims = getNodeDimensions(eNodeData, false, null);

        // Calculate center points using the *up-to-date* node data from the `nodes` prop
        // Access coordinates directly
        const sCenterX = sNodeData.x + sNodeDims.currentWidth / 2;
        const sCenterY = sNodeData.y + sNodeDims.currentHeight / 2;
        const eCenterX = eNodeData.x + eNodeDims.currentWidth / 2;
        const eCenterY = eNodeData.y + eNodeDims.currentHeight / 2;

        // Calculate direction and length for arrow positioning
        const dx = eCenterX - sCenterX;
        const dy = eCenterY - sCenterY;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) {
          return (
            <line
              key={`inner-conn-${edge.id || idx}`}
              x1={sCenterX}
              y1={sCenterY}
              x2={eCenterX}
              y2={eCenterY}
              stroke="rgba(0,0,0,0.6)"
              strokeWidth={edgeStrokeWidth}
            />
          );
        }

        // Calculate edge intersections for arrow positioning
        const sourceIntersection = getNodeEdgeIntersection(
          sNodeData.x, sNodeData.y, sNodeDims.currentWidth, sNodeDims.currentHeight,
          dx / length, dy / length
        );
        
        const destIntersection = getNodeEdgeIntersection(
          eNodeData.x, eNodeData.y, eNodeDims.currentWidth, eNodeDims.currentHeight,
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
            sourceArrowX = sCenterX + (dx / length) * 15;
            sourceArrowY = sCenterY + (dy / length) * 15;
            destArrowX = eCenterX - (dx / length) * 15;
            destArrowY = eCenterY - (dy / length) * 15;
            sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
            destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          } else {
            // Precise intersection positioning — same slope-aware pull-back NodeCanvas
            // uses for straight edges, so arrowheads sit off the node at the same
            // distance they would on the real canvas.
            const angleDeg = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
            const normalizedAngle = angleDeg > 90 ? 180 - angleDeg : angleDeg;
            const isQuantizedSlope = normalizedAngle < 15 || normalizedAngle > 75;
            const arrowLength = (isQuantizedSlope ? ARROW_OFFSET_BASE * 0.6 : ARROW_OFFSET_BASE) * connectionWidth;
            sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
            sourceArrowX = sourceIntersection.x + (dx / length) * arrowLength;
            sourceArrowY = sourceIntersection.y + (dy / length) * arrowLength;
            destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);
            destArrowX = destIntersection.x - (dx / length) * arrowLength;
            destArrowY = destIntersection.y - (dy / length) * arrowLength;
          }
        }

        // Get edge color based on type hierarchy
        const edgeColor = getEdgeColor(edge, eNodeData);

        return (
          <g key={`inner-conn-${edge.id || idx}`}>
            {/* Main edge line */}
            <line
              x1={shouldShortenSource ? (sourceIntersection?.x || sCenterX) : sCenterX}
              y1={shouldShortenSource ? (sourceIntersection?.y || sCenterY) : sCenterY}
              x2={shouldShortenDest ? (destIntersection?.x || eCenterX) : eCenterX}
              y2={shouldShortenDest ? (destIntersection?.y || eCenterY) : eCenterY}
              stroke={edgeColor}
              strokeWidth={edgeStrokeWidth}
            />

            {/* Source Arrow */}
            {arrowsToward.has(edge.sourceId) && (
              <g transform={`translate(${sourceArrowX}, ${sourceArrowY}) rotate(${sourceArrowAngle + 90}) scale(${connectionWidth})`}>
                <polygon
                  points={ARROW_POINTS}
                  fill={edgeColor}
                  stroke={edgeColor}
                  strokeWidth={6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  paintOrder="stroke fill"
                />
              </g>
            )}

            {/* Destination Arrow */}
            {arrowsToward.has(edge.destinationId) && (
              <g transform={`translate(${destArrowX}, ${destArrowY}) rotate(${destArrowAngle + 90}) scale(${connectionWidth})`}>
                <polygon
                  points={ARROW_POINTS}
                  fill={edgeColor}
                  stroke={edgeColor}
                  strokeWidth={6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  paintOrder="stroke fill"
                />
              </g>
            )}
          </g>
        );
      })}

      {/* Render Nodes with titles using original coordinates and dimensions (scaled by parent g) */}
      {nodes.map((node) => {
         // Get original dimensions 
         const dimensions = getNodeDimensions(node, false, null);
         const titleHeight = dimensions.textAreaHeight || NODE_HEIGHT * NAME_AREA_FACTOR;
         const hasThumbnail = Boolean(node.thumbnailSrc);

         return (
           <g key={`inner-node-${node.id}`}>
             {/* Node background — same 6px inset + reduced corner radius Node.jsx draws */}
             <rect
               x={node.x + BG_INSET}
               y={node.y + BG_INSET}
               width={dimensions.currentWidth - 2 * BG_INSET}
               height={dimensions.currentHeight - 2 * BG_INSET}
               rx={(dimensions.scaledCornerRadius ?? NODE_CORNER_RADIUS) - BG_INSET}
               ry={(dimensions.scaledCornerRadius ?? NODE_CORNER_RADIUS) - BG_INSET}
               fill={node.color || NODE_DEFAULT_COLOR || 'maroon'}
               stroke="rgba(0,0,0,0.3)"
               strokeWidth={Math.max(0.5, 1 / scale)}
             />

             {hasThumbnail && (
                <image
                    href={node.thumbnailSrc}
                    x={node.x + (dimensions.scaledPadding ?? NODE_PADDING)}
                    y={node.y + dimensions.textAreaHeight}
                    width={dimensions.imageWidth}
                    height={dimensions.calculatedImageHeight}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#inner-node-clip-${node.id})`}
                />
             )}

             {/* Node title — rendered at the node's TRUE canvas typography (font, line
                 height, wrapping and padding all straight from Node.jsx), so the label
                 fills its box in the same proportion it does on the canvas. Only the
                 fitting `scale` on the parent <g> makes it small. */}
             {(() => {
               const effScale = nodeScaleGlobal * (node.sizeMul ?? 1.0);
               const augTs = {
                 ...textSettings,
                 fontSize: (textSettings?.fontSize ?? 1.0) * effScale,
               };
               const fontSize = LABEL_FONT_BASE * augTs.fontSize;

               // Size cutoff: below this the glyphs are noise. Drop the label rather
               // than inflate it out of proportion to keep it "readable".
               if (fontSize * scale < MIN_LABEL_PX) return null;

               const lineHeight = LABEL_LINE_HEIGHT_BASE * augTs.fontSize * (textSettings?.lineSpacing ?? 1.0);
               const fontString = buildNodeFontString(augTs);
               const maxTextWidth = dimensions.currentWidth - 2 * (dimensions.scaledPadding ?? NODE_PADDING);
               const rawName = node.name || 'Untitled';

               // Same wrapping engine getNodeDimensions used to size this box, so the
               // line count here matches the line count the box was built for.
               let lines = wrapTextToLines(rawName, maxTextWidth, fontString);
               if (lines.length === 0) lines = [rawName];

               // Clamp to the lines that actually fit the text area, then ellipsize.
               const vPadding = LABEL_V_PADDING_BASE * effScale;
               const maxLines = Math.max(1, Math.floor((titleHeight - 2 * vPadding) / lineHeight));
               if (lines.length > maxLines) {
                 lines = lines.slice(0, maxLines);
                 lines[maxLines - 1] = truncateToWidth(`${lines[maxLines - 1]}…`, fontString, maxTextWidth);
               }
               // A single word wider than the box can't be wrapped by the engine
               // (Node.jsx breaks it mid-glyph); clip it instead of letting it bleed out.
               lines = lines.map(line => truncateToWidth(line, fontString, maxTextWidth));

               const centerY = node.y + titleHeight / 2;
               const fill = getTextColor(node.color || NODE_DEFAULT_COLOR || 'maroon', theme.darkMode);

               return lines.map((line, i) => (
                 <text
                   key={`inner-node-label-${node.id}-${i}`}
                   x={node.x + dimensions.currentWidth / 2}
                   y={centerY + (i - (lines.length - 1) / 2) * lineHeight}
                   textAnchor="middle"
                   dominantBaseline="central"
                   fontSize={fontSize}
                   fill={fill}
                   fontWeight="bold"
                   fontFamily="'EmOne', sans-serif"
                   style={{ pointerEvents: 'none', userSelect: 'none' }}
                 >
                   {line}
                 </text>
               ));
             })()}
           </g>
         );
      })}
    </g>
  );
};

export default InnerNetwork;