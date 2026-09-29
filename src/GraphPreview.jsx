import React, { useId, useMemo } from 'react';
import { NODE_CORNER_RADIUS } from './constants';
import useGraphStore from "./store/graphStore.js";
import { blendColors } from './utils/colorUtils.js';
import { useTheme } from './hooks/useTheme.js';
import { GROUP_LAYOUT_CONSTANTS } from './services/groupLayout.js';
import { connectionColor, connectionRoutingSettings, CONNECTION_STROKE_BASE } from './utils/canvas/settledConnection.js';
import { layoutWebPreview, layoutPreviewConnections } from './components/webPreview/webPreviewLayout.js';
import PreviewConnection from './components/webPreview/PreviewConnection.jsx';
import { safeImageSrc } from './utils/safeUrl.js';

// Canvas nodes round at NODE_CORNER_RADIUS * 1.4 (see getNodeDimensions)
const PREVIEW_CORNER_RADIUS = NODE_CORNER_RADIUS * 1.4;

// Canvas geometry, in world units (see renderConnectionEdge / NodeCanvas).
// The preview draws in world coordinates and lets the viewBox do the fitting,
// so every one of these keeps the proportion it has on the canvas: a sprawling
// web shown small gets thin connections, a two-node web shown large gets thick
// ones — exactly as zooming the canvas would.
const PLAIN_GROUP_STROKE = 12;
const PLAIN_GROUP_DASH = '16 12';
const GROUP_PILL_STROKE = 6;
const GROUP_PILL_RADIUS = 20;
const NODE_GROUP_INTERIOR_TINT = 0.07; // matches NodeCanvas
const BOUNDING_BOX_PADDING = 20;
// Below this on screen a connection disappears into antialiasing, so a very
// large web gets a floor rather than a strictly proportional line.
const MIN_CONNECTION_PX = 0.75;

const GraphPreview = ({ nodes = [], edges = [], groups = null, width, height }) => {
  const theme = useTheme();
  // useId's colons are not valid inside url(#...) references.
  const clipPrefix = useId().replace(/:/g, '');
  // Access store for prototype data to determine edge and group colors
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore(state => state.edgePrototypes);
  const textSettings = useGraphStore(state => state.textSettings);
  const gridSize = useGraphStore(state => state.gridSettings?.size || 200);

  const autoLayoutSettings = useGraphStore(state => state.autoLayoutSettings);

  const layout = useMemo(() => {
    if (!nodes.length || !width || !height) return null;

    // Nodes, groups and anchors as the canvas lays them out.
    const web = layoutWebPreview({ nodes, groups, nodePrototypes: nodePrototypesMap, textSettings, gridSize });
    if (!web) return null;
    const { boxes, hiddenIds, groupShapes, topSlot } = web;
    const { minX, minY, maxX, maxY } = web.bounds;

    // The box takes its shape from the viewBox, so widen whichever side falls
    // short of width:height and keep the web centered in it.
    let vbW = Math.max(maxX - minX, 1) + BOUNDING_BOX_PADDING * 2;
    let vbH = Math.max(maxY - minY, 1) + BOUNDING_BOX_PADDING * 2;
    const aspect = width / height;
    if (vbW / vbH < aspect) vbW = vbH * aspect;
    else vbH = vbW / aspect;
    const vbX = (minX + maxX) / 2 - vbW / 2;
    const vbY = (minY + maxY) / 2 - vbH / 2;
    const scale = width / vbW;

    // Connections in the user's connection style, exactly as the canvas draws them.
    const settings = connectionRoutingSettings({ autoLayoutSettings, textSettings });
    const connections = layoutPreviewConnections(web, nodes, edges, settings, scale);

    return {
      boxes, hiddenIds, groupShapes, connections, topSlot, scale,
      connectionWidth: settings.connectionWidth,
      viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
      clipRegion: { x: vbX - vbW, y: vbY - vbH, w: vbW * 3, h: vbH * 3 },
    };
  }, [nodes, edges, groups, width, height, nodePrototypesMap, textSettings, autoLayoutSettings, gridSize]);

  if (!layout) {
    return <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ display: 'block' }} />;
  }

  const { boxes, hiddenIds, groupShapes, connections, topSlot, viewBox, scale, clipRegion, connectionWidth } = layout;
  const nodesById = new Map(nodes.map(n => [n.id, n]));

  // Proportional to the canvas, with a legibility floor for huge webs. The
  // arrowheads ride the same factor so they stay in proportion to the line.
  const naturalStroke = CONNECTION_STROKE_BASE * connectionWidth;
  const floorBoost = Math.max(1, MIN_CONNECTION_PX / (naturalStroke * scale));
  const lineStroke = naturalStroke * floorBoost;
  const arrowScale = connectionWidth * floorBoost;

  const renderConnection = ({ edge, geometry }) => (
    <PreviewConnection
      key={edge.id}
      geometry={geometry}
      color={connectionColor(edge, nodesById.get(edge.destinationId), nodePrototypesMap, edgePrototypesMap)}
      strokeWidth={lineStroke}
      arrowScale={arrowScale}
      clipRegion={clipRegion}
      clipId={`${clipPrefix}-conn-clip-${edge.id}`}
    />
  );

  const renderGroup = (g) => {
    const C = GROUP_LAYOUT_CONSTANTS;
    const { rect, label } = g;
    if (g.isNodeGroup) {
      return (
        <g key={g.id}>
          <rect x={rect.x} y={g.nodeGroupRect.y} width={rect.w} height={g.nodeGroupRect.h}
            rx={C.nodeGroupCornerRadius} ry={C.nodeGroupCornerRadius} fill={g.color} />
          <rect
            x={rect.x + C.innerCanvasBorder}
            y={g.innerCanvasY}
            width={rect.w - C.innerCanvasBorder * 2}
            height={(rect.y + rect.h) - g.innerCanvasY - C.innerCanvasBorder}
            rx={C.innerCanvasCornerRadius} ry={C.innerCanvasCornerRadius}
            fill={blendColors(theme.canvas.bg, g.color, NODE_GROUP_INTERIOR_TINT)}
          />
        </g>
      );
    }
    return (
      <g key={g.id}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h}
          rx={C.nodeGroupCornerRadius} ry={C.nodeGroupCornerRadius}
          fill="none" stroke={g.color} strokeWidth={PLAIN_GROUP_STROKE} strokeDasharray={PLAIN_GROUP_DASH} />
        <rect x={label.x} y={label.y} width={label.w} height={label.h}
          rx={GROUP_PILL_RADIUS * g.labelScale} ry={GROUP_PILL_RADIUS * g.labelScale}
          fill={theme.canvas.bg} stroke={g.color} strokeWidth={GROUP_PILL_STROKE * g.labelScale} />
      </g>
    );
  };

  // Paint order follows the canvas: top-level plain groups at the bottom, then
  // per nesting depth the connections that belong at that depth followed by
  // that depth's shells, then the connections above every shell, then nodes.
  const layers = [];
  groupShapes.filter(g => !g.isNodeGroup && g.depth === 0).forEach(g => layers.push(renderGroup(g)));
  for (let depth = 0; depth < topSlot; depth++) {
    connections.filter(c => c.slot === depth).forEach(c => layers.push(renderConnection(c)));
    groupShapes.filter(g => g.depth === depth && (g.isNodeGroup || depth > 0)).forEach(g => layers.push(renderGroup(g)));
  }
  connections.filter(c => c.slot >= topSlot).forEach(c => layers.push(renderConnection(c)));

  // Image nodes keep a hairline frame: a fixed 1px on screen, whatever the zoom.
  const imageFrame = 1 / scale;

  return (
    <svg width="100%" height="100%" viewBox={viewBox} style={{ display: 'block' }}>
      <defs>
        {nodes.map(node => {
          if (!node.imageSrc || hiddenIds.has(node.id)) return null;
          const b = boxes.get(node.id);
          return (
            <clipPath key={node.id} id={`${clipPrefix}-clip-${node.id}`}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={PREVIEW_CORNER_RADIUS} ry={PREVIEW_CORNER_RADIUS} />
            </clipPath>
          );
        })}
      </defs>

      <g>{layers}</g>

      {/* Nodes — no labels: at list-thumbnail size text only ever read as noise. */}
      <g>
        {nodes.map(node => {
          if (hiddenIds.has(node.id)) return null;
          const b = boxes.get(node.id);
          const nodeColor = node.color || '#800000';

          const imageSrc = node.imageSrc ? (safeImageSrc(node.imageSrc) || safeImageSrc(node.thumbnailSrc)) : null;
          if (imageSrc) {
            return (
              <g key={node.id}>
                <image
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  href={imageSrc}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#${clipPrefix}-clip-${node.id})`}
                />
                <rect
                  x={b.x + imageFrame / 2}
                  y={b.y + imageFrame / 2}
                  width={Math.max(0, b.w - imageFrame)}
                  height={Math.max(0, b.h - imageFrame)}
                  fill="none"
                  stroke={nodeColor}
                  strokeWidth={imageFrame}
                  rx={Math.max(0, PREVIEW_CORNER_RADIUS - imageFrame / 2)}
                  ry={Math.max(0, PREVIEW_CORNER_RADIUS - imageFrame / 2)}
                />
              </g>
            );
          }

          return (
            <rect
              key={node.id}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill={nodeColor}
              rx={PREVIEW_CORNER_RADIUS}
              ry={PREVIEW_CORNER_RADIUS}
            />
          );
        })}
      </g>
    </svg>
  );
};

export default React.memo(GraphPreview);
