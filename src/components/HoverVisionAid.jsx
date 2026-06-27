import React from 'react';
import UniversalNodeRenderer from '../UniversalNodeRenderer';
import { RENDERER_PRESETS } from '../UniversalNodeRenderer.presets';
import { getNodeDimensions } from '../utils.js';
import { measureTextWidth } from '../services/textMeasurement.js';
import useGraphStore from '../store/graphStore.jsx';

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
  verticalOffset = -25
}) => {
  const showHoverPreview = useGraphStore((state) => state.showHoverPreview ?? true);
  const hoverPreviewSize = useGraphStore((state) => state.hoverPreviewSize ?? 0.6);

  const hasConnection = Boolean(hoveredConnection?.source && hoveredConnection?.target);
  const hasNode = Boolean(!hasConnection && hoveredNode);
  const hasItem = Boolean(!hasConnection && !hasNode && activePieMenuItem);

  if (!showHoverPreview || (!hasConnection && !hasNode && !hasItem)) {
    return null;
  }

  // On no-mouse (touch) devices there is no real hover — a tap would otherwise pop this
  // preview up unexpectedly, so suppress the node/connection hover previews entirely.
  // (The pie-menu item label is kept; it's driven by the pie menu, not stray hovers.)
  const noHoverDevice = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none)').matches;
  if (noHoverDevice && !hasItem) {
    return null;
  }

  const NODE_PREVIEW_HEIGHT = 120;

  let content = null;

  // Hover Preview Size setting is the direct scale (default 0.6x) for node and
  // connection previews. The pie-menu item label is a fixed text pill, not a node
  // preview, so it renders at its original full size (1.0) and ignores the slider.
  const previewScale = hasItem ? 1.0 : hoverPreviewSize;

  const containerStyle = {
    position: 'absolute',
    top: headerHeight + verticalOffset,
    left: '50%',
    transform: `translateX(-50%) scale(${previewScale})`,
    transformOrigin: 'top center',
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
    const isSelfLoop = hoveredConnection.source.id === hoveredConnection.target.id;
    const sourceDims = getNodeDimensions(hoveredConnection.source, false);
    const targetDims = getNodeDimensions(hoveredConnection.target, false);

    // Use natural node widths (252px+ from canvas) but cap height so tall image
    // nodes don't make the preview excessively tall.
    const sourceW = Math.max(sourceDims.currentWidth, 220);
    const sourceH = Math.min(Math.max(sourceDims.currentHeight, 96), 200);
    const targetW = Math.max(targetDims.currentWidth, 220);
    const targetH = Math.min(Math.max(targetDims.currentHeight, 96), 200);

    const nodes = isSelfLoop
      ? [{ ...hoveredConnection.source, x: 0, y: 0, width: sourceW, height: sourceH }]
      : [
          { ...hoveredConnection.source, x: 0, y: 0, width: sourceW, height: sourceH },
          { ...hoveredConnection.target, x: 0, y: 0, width: targetW, height: targetH }
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

    // The renderer applies 0.8× to minHorizontalSpacing for 2-3 node layouts.
    // Pre-compensate: connectionGap = targetGap / 0.8 → actual SVG gap = targetGap.
    // Target at least 300px (225px visible at CSS 0.75) or 2× the longest label word.
    const renderFont = '24px "EmOne", sans-serif';
    const longestWordWidth = connections.reduce((max, conn) => {
      const name = conn.connectionName || 'Connection';
      const wordMax = name.split(' ').reduce((wmax, w) => Math.max(wmax, measureTextWidth(w, renderFont)), 0);
      return Math.max(max, wordMax);
    }, 0);

    const targetGap = Math.max(300, longestWordWidth * 2.0);
    const connectionGap = Math.ceil(targetGap / 0.8);

    // Size container generously so nodeScale would be 1.0 without the cap.
    // maxNodeScale={0.8} on the renderer then explicitly scales nodes — and
    // proportionally their fonts, padding, and corner radii — to 80%, freeing
    // the remaining space as additional gap for the connection label.
    const maxNodeHeight = Math.max(...nodes.map(n => n.height));
    const connectionContainerHeight = maxNodeHeight + 40;
    const totalNodeWidth = nodes.reduce((sum, n) => sum + n.width, 0) * (isSelfLoop ? 2 : 1);
    const calculatedWidth = Math.max(700, totalNodeWidth + connectionGap + 80);

    containerStyle.marginTop = -20;
    content = (
      <div style={{ display: 'inline-flex', padding: 0, borderRadius: '44px', background: 'transparent', overflow: 'visible' }}>
        <UniversalNodeRenderer
          {...RENDERER_PRESETS.CONNECTION_PANEL}
          renderContext="full"
          nodes={nodes}
          connections={connections}
          containerWidth={calculatedWidth}
          containerHeight={connectionContainerHeight}
          minHorizontalSpacing={connectionGap}
          cornerRadiusMultiplier={56}
          maxNodeScale={0.7}
          connectionFontScale={1.6}
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

    // 2. Tight container — nodes are now ~252px wide at 1x so we cap height to
    //    prevent the preview growing proportionally with the larger baseline.
    const nodeContainerWidth = Math.max(300, nodeWidth + 48);
    const nodeContainerHeight = Math.max(100, Math.min(200, nodeHeight + 24));
    
    containerStyle.marginTop = -18;
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
          cornerRadiusMultiplier={56}
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
