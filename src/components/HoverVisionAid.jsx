import React from 'react';
import UniversalNodeRenderer from '../UniversalNodeRenderer';
import { RENDERER_PRESETS } from '../UniversalNodeRenderer.presets';
import { getNodeDimensions } from '../utils.js';
import { measureTextWidth } from '../services/textMeasurement.js';

/**
 * HoverVisionAid displays a high-fidelity preview of nodes or connections
 * when the user hovers over elements on the canvas.
 * 
 * SCALING FIX: Uses standard getNodeDimensions(node, false) to avoid massive square mode.
 */
const HoverVisionAid = ({
  hoveredNode,
  hoveredConnection,
  activePieMenuItem,
  headerHeight = 60,
  verticalOffset = -18
}) => {
  const hasConnection = Boolean(hoveredConnection?.source && hoveredConnection?.target);
  const hasNode = Boolean(!hasConnection && hoveredNode);
  const hasItem = Boolean(!hasConnection && !hasNode && activePieMenuItem);

  if (!hasConnection && !hasNode && !hasItem) {
    return null;
  }

  // Dimension standards from UnifiedBottomControlPanel.jsx
  const CONNECTION_PREVIEW_HEIGHT = 180;
  const NODE_PREVIEW_HEIGHT = 120;
  const connectionLabelFont = '28px "EmOne", sans-serif';

  let content = null;

  const containerStyle = {
    position: 'absolute',
    top: headerHeight + verticalOffset,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'none',
    zIndex: 10,
    width: 'auto',
    maxWidth: '94vw'
  };

  if (hasConnection) {
    // 1. Prepare nodes with REAL dimensions (sync with Control Panel)
    // Use isPreviewing=false to get standard node geometry
    const sourceDims = getNodeDimensions(hoveredConnection.source, false);
    const targetDims = getNodeDimensions(hoveredConnection.target, false);

    const nodes = [
      {
        ...hoveredConnection.source,
        x: 0,
        y: 0,
        width: Math.max(sourceDims.currentWidth, 220),
        height: Math.max(sourceDims.currentHeight, 96)
      },
      {
        ...hoveredConnection.target,
        x: 0,
        y: 0,
        width: Math.max(targetDims.currentWidth, 220),
        height: Math.max(targetDims.currentHeight, 96)
      }
    ];

    const connections = [
      {
        id: hoveredConnection.id,
        sourceId: hoveredConnection.source.id,
        destinationId: hoveredConnection.target.id,
        connectionName: hoveredConnection.name || 'Connection',
        color: hoveredConnection.color,
        definitionNodeIds: hoveredConnection.definitionNodeIds,
        typeNodeId: hoveredConnection.typeNodeId,
        directionality: hoveredConnection.directionality
      }
    ];

    // 2. Port sizing formulas EXACTLY from UnifiedBottomControlPanel.jsx
    const baseSpacing = 200;
    const nodeSpacing = nodes.reduce((sum, n) => sum + (n.width * 0.4), 0) + (nodes.length * 90);
    
    const longestConnectionLabelWidth = connections.reduce((max, conn) => {
      const width = measureTextWidth(conn.connectionName, connectionLabelFont);
      return Math.max(max, width);
    }, 0);

    const connectionLabelSpace = Math.max(
      320,
      Math.ceil(longestConnectionLabelWidth + 220)
    );

    const calculatedWidth = Math.min(
      1800,
      baseSpacing + nodeSpacing + connectionLabelSpace
    );

    const dynamicMinHorizontalSpacing = Math.max(
      120,
      Math.min(
        connectionLabelSpace - 80,
        400
      )
    );

    containerStyle.marginTop = -8;
    content = (
      <div style={{ display: 'inline-flex', padding: 0, borderRadius: '44px', background: 'transparent', overflow: 'visible' }}>
        <UniversalNodeRenderer
          {...RENDERER_PRESETS.CONNECTION_PANEL}
          renderContext="full"
          nodes={nodes}
          connections={connections}
          containerWidth={calculatedWidth}
          containerHeight={CONNECTION_PREVIEW_HEIGHT}
          minHorizontalSpacing={dynamicMinHorizontalSpacing}
          cornerRadiusMultiplier={44}
          interactive={false}
          showHoverEffects={false}
          showConnectionDots={true}
          backgroundColor="transparent"
        />
      </div>
    );
  } else if (hasNode) {
    // 1. Prepare node with REAL dimensions (non-preview)
    const dims = getNodeDimensions(hoveredNode, false);
    const nodeWidth = Math.max(dims.currentWidth, 220);
    const nodeHeight = Math.max(dims.currentHeight, 96);
    
    // 2. Calculate container to fit (sync with Control Panel logic)
    const nodeContainerWidth = Math.max(340, nodeWidth + 80);
    const nodeContainerHeight = Math.max(120, nodeHeight + 40);
    
    containerStyle.marginTop = -6;
    content = (
      <div style={{ display: 'inline-flex', padding: 0, borderRadius: '36px', background: 'transparent', overflow: 'visible' }}>
        <UniversalNodeRenderer
          renderContext="full"
          nodes={[
            {
              ...hoveredNode,
              x: 0,
              y: 0,
              width: nodeWidth,
              height: nodeHeight
            }
          ]}
          connections={[]}
          containerWidth={nodeContainerWidth}
          containerHeight={nodeContainerHeight}
          padding={16}
          scaleMode="fit"
          cornerRadiusMultiplier={44}
          interactive={false}
          showHoverEffects={false}
          backgroundColor="transparent"
        />
      </div>
    );
  } else if (hasItem) {
    const pieMenuHeight = 36;
    const pieMenuPaddingX = 14;
    containerStyle.marginTop = -2;
    content = (
      <div
        style={{
          minWidth: 140,
          height: pieMenuHeight,
          borderRadius: pieMenuHeight / 2,
          border: '2px solid maroon',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'EmOne', sans-serif",
          fontSize: '14px',
          fontWeight: 700,
          color: 'maroon',
          background: '#DEDADA',
          letterSpacing: '0.04em',
          padding: `0 ${pieMenuPaddingX}px`,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)'
        }}
      >
        {activePieMenuItem.label}
      </div>
    );
  }

  return (
    <div className="hover-vision-aid" style={containerStyle}>
      {content}
    </div>
  );
};

export default HoverVisionAid;
