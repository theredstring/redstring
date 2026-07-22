import React from 'react';
import { calculateSelfLoopPath } from '../../utils/canvas/selfLoopUtils.js';
import { estimateTextWidth } from '../../utils/canvas/edgeLabelPlacement.js';
import { getLightHueText, getDarkHueText } from '../../utils/colorUtils.js';
import useGraphStore from '../../store/graphStore.js';

const SelfLoopEdge = ({
  edge,
  node,
  nodeDims,
  curveInfo,
  isHovered,
  isSelected,
  edgeColor,
  showConnectionNames,
  selectedEdgeIds,
  storeActions,
  ignoreCanvasClick,
  setLongPressingInstanceId,
  setDrawingConnectionFrom,
  handleEdgePointerDownTouch,
  connectionName,
  connectionFontSize,
  connectionWidth = 1,
  placedLabelsRef,
}) => {
  const darkMode = useGraphStore(state => state.darkMode);
  const arrowsToward = edge.directionality?.arrowsToward instanceof Set
    ? edge.directionality.arrowsToward
    : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);
  const hasArrow = arrowsToward.has(node.id);

  const loop = calculateSelfLoopPath(node.x, node.y, nodeDims.currentWidth, nodeDims.currentHeight, curveInfo);

  const selectEdge = (multi) => {
    if (multi) {
      if (selectedEdgeIds.has(edge.id)) {
        storeActions.removeSelectedEdgeId(edge.id);
      } else {
        storeActions.addSelectedEdgeId(edge.id);
      }
    } else {
      storeActions.clearSelectedEdgeIds();
      storeActions.setSelectedEdgeId(edge.id);
    }
  };

  const handlePointerDown = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') {
      e.preventDefault?.();
      e.stopPropagation?.();
      ignoreCanvasClick.current = true;
      setLongPressingInstanceId(null);
      setDrawingConnectionFrom(null);
      selectEdge(e.ctrlKey || e.metaKey);
    }
    handleEdgePointerDownTouch(edge.id, e);
  };

  const handleTouchStart = (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    ignoreCanvasClick.current = true;
    setLongPressingInstanceId(null);
    setDrawingConnectionFrom(null);
    storeActions.clearSelectedEdgeIds();
    storeActions.setSelectedEdgeId(edge.id);
  };

  const handleClick = (e) => {
    e.stopPropagation();
    ignoreCanvasClick.current = true;
    selectEdge(e.ctrlKey || e.metaKey);
  };

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    let definingNodeId = null;
    if (edge.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      definingNodeId = edge.definitionNodeIds[0];
    } else if (edge.typeNodeId) {
      definingNodeId = edge.typeNodeId;
    }
    if (definingNodeId) {
      storeActions.openRightPanelNodeTab(definingNodeId);
    }
  };

  const toggleArrow = (e) => {
    e.stopPropagation();
    storeActions.updateEdge(edge.id, (draft) => {
      if (!draft.directionality) draft.directionality = { arrowsToward: new Set() };
      if (!draft.directionality.arrowsToward) draft.directionality.arrowsToward = new Set();
      if (draft.directionality.arrowsToward.has(node.id)) {
        draft.directionality.arrowsToward.delete(node.id);
      } else {
        draft.directionality.arrowsToward.add(node.id);
      }
    });
  };

  // Match regular-edge geometry so self-loops respond to the connection-width setting and
  // carry the same visual weight as ordinary connections (regular main line = 27 * cw).
  const cw = connectionWidth;
  const mainStrokeWidth = 27 * cw;
  const glowStrokeWidth = 20 * cw;
  const hitStrokeWidth = Math.max(50, 44 * cw);

  const renderDot = (anchor) => (
    <g>
      <circle
        cx={anchor.x}
        cy={anchor.y}
        r={Math.round(36 * cw)}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        onClick={toggleArrow}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <circle
        cx={anchor.x}
        cy={anchor.y}
        r={Math.round(30 * cw)}
        fill={edgeColor}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );

  return (
    <g key={`edge-${edge.id}`} data-edge-id={edge.id}>
      {(isSelected || isHovered) && (
        <path
          d={loop.path}
          fill="none"
          stroke={edgeColor}
          strokeWidth={glowStrokeWidth}
          opacity={isSelected ? '0.3' : '0.2'}
          style={{ filter: `drop-shadow(0 0 8px ${edgeColor})` }}
          strokeLinecap="round"
        />
      )}

      <path
        d={loop.path}
        fill="none"
        stroke={edgeColor}
        strokeWidth={mainStrokeWidth}
        style={{ transition: 'stroke 0.2s ease' }}
        strokeLinecap="round"
      />

      <path
        d={loop.path}
        fill="none"
        stroke="transparent"
        strokeWidth={hitStrokeWidth}
        style={{ cursor: 'pointer' }}
        onPointerDown={handlePointerDown}
        onTouchStart={handleTouchStart}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />

      {hasArrow && (
        <g
          data-arrow="self"
          transform={`translate(${loop.anchorB.x}, ${loop.anchorB.y}) rotate(${loop.arrowAngleB + 90}) scale(${cw})`}
          style={{ cursor: 'pointer' }}
          onClick={toggleArrow}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(isSelected || isHovered) && (
            <polygon
              points="-18,23 18,23 0,-23"
              fill={edgeColor}
              stroke={edgeColor}
              strokeWidth="8"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={isSelected ? '0.3' : '0.2'}
              style={{ filter: `drop-shadow(0 0 6px ${edgeColor})` }}
            />
          )}
          <polygon
            points="-26,34 26,34 0,-34"
            fill={edgeColor}
            stroke={edgeColor}
            strokeWidth="6"
            strokeLinejoin="round"
            strokeLinecap="round"
            paintOrder="stroke fill"
          />
        </g>
      )}

      {isHovered && !hasArrow && renderDot(loop.anchorB)}
      {isHovered && renderDot(loop.anchorA)}

      {showConnectionNames && connectionName && (() => {
        const fontSize = connectionFontSize || 24;
        // Place label at the arc apex (equivalent to midpoint of a straight edge).
        const lx = loop.loopCx + loop.radius * Math.cos(loop.outwardAngle);
        const ly = loop.loopCy + loop.radius * Math.sin(loop.outwardAngle);

        if (placedLabelsRef?.current) {
          const halfW = estimateTextWidth(connectionName, fontSize) / 2;
          const halfH = (fontSize * 1.1) / 2;
          placedLabelsRef.current.set(edge.id, {
            rect: { minX: lx - halfW, maxX: lx + halfW, minY: ly - halfH, maxY: ly + halfH },
            position: { x: lx, y: ly, angle: 0 },
          });
        }

        return (
          <g>
            <text
              x={lx}
              y={ly}
              fill={darkMode ? getDarkHueText(edgeColor) : getLightHueText(edgeColor)}
              fontSize={fontSize}
              fontWeight="bold"
              textAnchor="middle"
              dominantBaseline="middle"
              stroke={darkMode ? getLightHueText(edgeColor) : getDarkHueText(edgeColor)}
              strokeWidth={8 * (fontSize / 54)}
              strokeLinecap="round"
              strokeLinejoin="round"
              paintOrder="stroke fill"
              style={{ pointerEvents: 'none', fontFamily: "'EmOne', sans-serif" }}
            >
              {connectionName}
            </text>
          </g>
        );
      })()}
    </g>
  );
};

export default SelfLoopEdge;
