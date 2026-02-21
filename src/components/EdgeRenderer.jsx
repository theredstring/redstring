/**
 * Centralized Edge Renderer Component
 * Handles all edge rendering logic including parallel edge curve offsets,
 * glow effects, arrows, hover states, and connection names.
 */

import React from 'react';
import { calculateParallelEdgePath } from '../utils/canvas/parallelEdgeUtils.js';
import { generateManhattanRoutingPath, generateCleanRoutingPath } from '../utils/canvas/edgeRouting.js';
import { getTextColor } from '../utils/colorUtils.js';

/**
 * Build a rounded SVG path from ordered polyline points
 */
function buildRoundedPathFromPoints(pts, r = 8) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    if (i < pts.length - 1) {
      const next = pts[i + 1];
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const backX = curr.x - Math.sign(dx1) * r;
      const backY = curr.y - Math.sign(dy1) * r;
      const forwardX = curr.x + Math.sign(dx2) * r;
      const forwardY = curr.y + Math.sign(dy2) * r;
      d += ` L ${backX},${backY} Q ${curr.x},${curr.y} ${forwardX},${forwardY}`;
    } else {
      d += ` L ${curr.x},${curr.y}`;
    }
  }
  return d;
}

/**
 * Estimate text width for label placement
 */
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.6; // Rough estimate
}

/**
 * EdgeRenderer Component
 * Renders a single edge with all its visual elements
 */
export default function EdgeRenderer({
  edge,
  sourceNode,
  destNode,
  curveInfo,
  isHovered,
  isSelected,
  edgeColor,
  strokeWidth,
  showConnectionNames,
  enableAutoRouting,
  routingStyle,
  manhattanBends,
  cleanLaneOffsets,
  cleanLaneSpacing,
  sNodeDims,
  eNodeDims,
  x1,
  y1,
  x2,
  y2,
  startX,
  startY,
  endX,
  endY,
  manhattanPathD,
  manhattanSourceSide,
  manhattanDestSide,
  arrowsToward,
  connectionName,
  midX,
  midY,
  angle,
  sourceArrowX,
  sourceArrowY,
  sourceArrowAngle,
  destArrowX,
  destArrowY,
  destArrowAngle,
  onEdgeClick,
  onEdgeDoubleClick,
  onEdgePointerDown,
  onEdgeTouchStart,
  onArrowClick,
  NODE_HEIGHT,
  nodePrototypesMap,
  edgePrototypesMap,
  NODE_DEFAULT_COLOR
}) {
  // Calculate parallel edge path if needed
  const parallelPath = calculateParallelEdgePath(startX, startY, endX, endY, curveInfo);
  const useCurve = parallelPath.type === 'curve';

  return (
    <g key={`edge-${edge.id}`}>
      {/* Glow effect for selected or hovered edge */}
      {(isSelected || isHovered) && (
        enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean') ? (
          <path
            d={routingStyle === 'manhattan' ? manhattanPathD : (() => {
              const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
              return buildRoundedPathFromPoints(cleanPts, 8);
            })()}
            fill="none"
            stroke={edgeColor}
            strokeWidth="12"
            opacity={isSelected ? "0.3" : "0.2"}
            style={{
              filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
            }}
            strokeLinecap="round"
          />
        ) : useCurve ? (
          <path
            d={parallelPath.path}
            fill="none"
            stroke={edgeColor}
            strokeWidth="12"
            opacity={isSelected ? "0.3" : "0.2"}
            style={{
              filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
            }}
            strokeLinecap="round"
          />
        ) : (
          <line
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
            stroke={edgeColor}
            strokeWidth="12"
            opacity={isSelected ? "0.3" : "0.2"}
            style={{
              filter: `blur(3px) drop-shadow(0 0 8px ${edgeColor})`
            }}
          />
        )
      )}

      {/* Main edge path */}
      {enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean') ? (
        <>
          {routingStyle === 'manhattan' && !arrowsToward.has(sourceNode.id) && (
            <line x1={x1} y1={y1} x2={startX} y2={startY} stroke={edgeColor} strokeWidth={showConnectionNames ? "16" : "6"} strokeLinecap="round" />
          )}
          {routingStyle === 'manhattan' && !arrowsToward.has(destNode.id) && (
            <line x1={endX} y1={endY} x2={x2} y2={y2} stroke={edgeColor} strokeWidth={showConnectionNames ? "16" : "6"} strokeLinecap="round" />
          )}
          <path
            d={routingStyle === 'manhattan' ? manhattanPathD : (() => {
              const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
              return buildRoundedPathFromPoints(cleanPts, 8);
            })()}
            fill="none"
            stroke={edgeColor}
            strokeWidth={showConnectionNames ? "16" : "6"}
            style={{ transition: 'stroke 0.2s ease' }}
            strokeLinecap="round"
          />
        </>
      ) : useCurve ? (
        <path
          d={parallelPath.path}
          fill="none"
          stroke={edgeColor}
          strokeWidth={showConnectionNames ? "16" : "6"}
          style={{ transition: 'stroke 0.2s ease' }}
          strokeLinecap="round"
        />
      ) : (
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={edgeColor}
          strokeWidth={showConnectionNames ? "16" : "6"}
          style={{ transition: 'stroke 0.2s ease' }}
        />
      )}

      {/* Connection name text */}
      {showConnectionNames && connectionName && (
        <g>
          <text
            x={useCurve ? parallelPath.apexX : midX}
            y={useCurve ? parallelPath.apexY : midY}
            fill={getTextColor(edgeColor || '#800000')}
            fontSize="24"
            fontWeight="bold"
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${angle > 90 || angle < -90 ? angle + 180 : angle}, ${useCurve ? parallelPath.apexX : midX}, ${useCurve ? parallelPath.apexY : midY})`}
            stroke={edgeColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            paintOrder="stroke fill"
            style={{ pointerEvents: 'none', fontFamily: "'EmOne', sans-serif" }}
          >
            {connectionName}
          </text>
        </g>
      )}

      {/* Invisible click area for edge selection */}
      {enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean') ? (
        <path
          d={routingStyle === 'manhattan' ? manhattanPathD : (() => {
            const cleanPts = generateCleanRoutingPath(edge, sourceNode, destNode, sNodeDims, eNodeDims, cleanLaneOffsets, cleanLaneSpacing);
            return buildRoundedPathFromPoints(cleanPts, 8);
          })()}
          fill="none"
          stroke="transparent"
          strokeWidth="40"
          style={{ cursor: 'pointer' }}
          onPointerDown={onEdgePointerDown}
          onTouchStart={onEdgeTouchStart}
          onClick={onEdgeClick}
          onDoubleClick={onEdgeDoubleClick}
        />
      ) : useCurve ? (
        <path
          d={parallelPath.path}
          fill="none"
          stroke="transparent"
          strokeWidth="40"
          style={{ cursor: 'pointer' }}
          onPointerDown={onEdgePointerDown}
          onTouchStart={onEdgeTouchStart}
          onClick={onEdgeClick}
          onDoubleClick={onEdgeDoubleClick}
        />
      ) : (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth="40"
          style={{ cursor: 'pointer' }}
          onPointerDown={onEdgePointerDown}
          onTouchStart={onEdgeTouchStart}
          onClick={onEdgeClick}
          onDoubleClick={onEdgeDoubleClick}
        />
      )}

      {/* Direction arrows */}
      {arrowsToward.has(sourceNode.id) && sourceArrowX !== undefined && (
        <g
          transform={`translate(${sourceArrowX}, ${sourceArrowY}) rotate(${sourceArrowAngle + 90})`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => onArrowClick?.(sourceNode.id, e)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(isSelected || isHovered) && (
            <polygon
              points="-12,15 12,15 0,-15"
              fill={edgeColor}
              stroke={edgeColor}
              strokeWidth="8"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={isSelected ? "0.3" : "0.2"}
              style={{
                filter: `blur(2px) drop-shadow(0 0 6px ${edgeColor})`
              }}
            />
          )}
          <polygon
            points={showConnectionNames ? "-18,22 18,22 0,-22" : "-12,15 12,15 0,-15"}
            fill={edgeColor}
            stroke={edgeColor}
            strokeWidth="6"
            strokeLinejoin="round"
            strokeLinecap="round"
            paintOrder="stroke fill"
          />
        </g>
      )}

      {arrowsToward.has(destNode.id) && destArrowX !== undefined && (
        <g
          transform={`translate(${destArrowX}, ${destArrowY}) rotate(${destArrowAngle + 90})`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => onArrowClick?.(destNode.id, e)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(isSelected || isHovered) && (
            <polygon
              points="-12,15 12,15 0,-15"
              fill={edgeColor}
              stroke={edgeColor}
              strokeWidth="8"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={isSelected ? "0.3" : "0.2"}
              style={{
                filter: `blur(2px) drop-shadow(0 0 6px ${edgeColor})`
              }}
            />
          )}
          <polygon
            points={showConnectionNames ? "-18,22 18,22 0,-22" : "-12,15 12,15 0,-15"}
            fill={edgeColor}
            stroke={edgeColor}
            strokeWidth="6"
            strokeLinejoin="round"
            strokeLinecap="round"
            paintOrder="stroke fill"
          />
        </g>
      )}

      {/* Hover dots for straight routing */}
      {isHovered && (!enableAutoRouting || routingStyle === 'straight') && (
        <>
          {!arrowsToward.has(sourceNode.id) && sourceArrowX !== undefined && (
            <g>
              <circle
                cx={sourceArrowX}
                cy={sourceArrowY}
                r="20"
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={(e) => onArrowClick?.(sourceNode.id, e)}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <circle
                cx={sourceArrowX}
                cy={sourceArrowY}
                r={showConnectionNames ? "16" : "8"}
                fill={edgeColor}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          )}
          {!arrowsToward.has(destNode.id) && destArrowX !== undefined && (
            <g>
              <circle
                cx={destArrowX}
                cy={destArrowY}
                r="20"
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={(e) => onArrowClick?.(destNode.id, e)}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <circle
                cx={destArrowX}
                cy={destArrowY}
                r={showConnectionNames ? "16" : "8"}
                fill={edgeColor}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          )}
        </>
      )}
    </g>
  );
}

