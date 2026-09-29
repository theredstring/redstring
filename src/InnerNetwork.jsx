import { useId, useMemo } from 'react';
import {
    NODE_WIDTH,
    NODE_HEIGHT,
    NODE_PADDING,
    NAME_AREA_FACTOR,
    NODE_CORNER_RADIUS,
    NODE_DEFAULT_COLOR,
} from './constants'; // Import necessary constants
import { getTextColor, blendColors } from './utils/colorUtils.js';
import { buildNodeFontString, wrapTextToLines, measureTextWidth } from './services/textMeasurement.js';
import { useTheme } from './hooks/useTheme.js';
import useGraphStore from "./store/graphStore.js";
import { GROUP_LAYOUT_CONSTANTS } from './services/groupLayout.js';
import { connectionColor, connectionRoutingSettings, CONNECTION_STROKE_BASE } from './utils/canvas/settledConnection.js';
import { layoutWebPreview, layoutPreviewConnections } from './components/webPreview/webPreviewLayout.js';
import PreviewConnection from './components/webPreview/PreviewConnection.jsx';
import { safeImageSrc } from './utils/safeUrl.js';
import { NODE_GROUP_INTERIOR_TINT } from './components/canvas/groups/groupElements.jsx';

// --- Canvas parity constants ---
// The decomposition preview is a *scaled-down canvas*, not its own visual language:
// every value below is the number NodeCanvas/Node.jsx already use, so a mini-node
// is the real node under a `scale()` rather than a separately-tuned lookalike.
const LABEL_FONT_BASE = 45;         // Node.jsx: 45 * fontSize * effNodeScale
const LABEL_LINE_HEIGHT_BASE = 39;  // Node.jsx: 39 * fontSize * lineSpacing * effNodeScale
const LABEL_V_PADDING_BASE = 34;    // Node.jsx: .node-name-container vertical padding
const BG_INSET = 6;                 // Node.jsx: background rect inset (and its rx reduction)
// groupElements.jsx: a plain group's dashed outline and its title pill.
const PLAIN_GROUP_STROKE = 12;
const PLAIN_GROUP_DASH = '16 12';
const GROUP_PILL_STROKE = 6;
const GROUP_PILL_RADIUS = 20;

// Legibility cutoff. Once the proportional label projects below this many pixels in
// the preview's own space it stops being text and starts being a smudge — drop it and
// let the node read as a colored block. (Previously the label was *boosted* to stay
// readable, which is what made mini-nodes look like tiny text floating in fat padding:
// a 28px cap against a box sized for 45px text.)
const MIN_LABEL_PX = 7;

// Padding around the drawn content, in canvas units, before fitting.
const BOUNDING_BOX_PADDING = 20;

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
// A Web drawn small: its nodes, connections, groups and Thing-groups, fitted into
// `width` x `height`. Groups are laid out by the same solver the canvas uses
// (services/groupLayout.js) and painted in the canvas's order, so a Thing-group's
// shell covers what the canvas covers and its title sits above its members.
const InnerNetwork = ({ nodes, edges, groups = null, width, height, padding }) => {
  // Access store for prototype data to determine edge colors
  const theme = useTheme();
  // useId's colons are not valid inside url(#...) references.
  const clipPrefix = useId().replace(/:/g, '');
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore(state => state.edgePrototypes);
  const textSettings = useGraphStore(state => state.textSettings);
  const gridSize = useGraphStore(state => state.gridSettings?.size || 200);
  const autoLayoutSettings = useGraphStore(state => state.autoLayoutSettings);
  const nodeScaleGlobal = textSettings?.nodeScale ?? 1.0;

  const layout = useMemo(() => {
    if (!nodes || nodes.length === 0 || !edges || width <= 0 || height <= 0) return null;

    // Nodes, groups and anchors as the canvas lays them out.
    const web = layoutWebPreview({ nodes, groups, nodePrototypes: nodePrototypesMap, textSettings, gridSize });
    if (!web) return null;
    const { minX, minY, maxX, maxY } = web.bounds;

    // Fit: scale the padded bounds into the box and centre them.
    const baseNetworkWidth = Math.max(maxX - minX, NODE_WIDTH * nodeScaleGlobal);
    const baseNetworkHeight = Math.max(maxY - minY, NODE_HEIGHT * nodeScaleGlobal);
    const networkWidth = baseNetworkWidth + 2 * BOUNDING_BOX_PADDING;
    const networkHeight = baseNetworkHeight + 2 * BOUNDING_BOX_PADDING;
    const availableWidth = width - 2 * padding;
    const availableHeight = height - 2 * padding;
    if (availableWidth <= 0 || availableHeight <= 0) return null;
    const scale = Math.min(availableWidth / networkWidth, availableHeight / networkHeight);
    const translateX = padding + (availableWidth - networkWidth * scale) / 2 - ((minX - BOUNDING_BOX_PADDING) * scale);
    const translateY = padding + (availableHeight - networkHeight * scale) / 2 - ((minY - BOUNDING_BOX_PADDING) * scale);

    // Connections in the user's connection style, exactly as the canvas draws them.
    const settings = connectionRoutingSettings({ autoLayoutSettings, textSettings });
    const connections = layoutPreviewConnections(web, nodes, edges, settings, scale);
    const clipRegion = {
      x: minX - networkWidth, y: minY - networkHeight,
      w: networkWidth * 3, h: networkHeight * 3,
    };

    return { ...web, connections, clipRegion, connectionWidth: settings.connectionWidth, scale, translateX, translateY };
  }, [nodes, edges, groups, width, height, padding, nodePrototypesMap, textSettings, autoLayoutSettings, gridSize, nodeScaleGlobal]);

  if (!layout) {
    return null;
  }

  const { dimsById, hiddenIds, groupShapes, groupFontSize, groupLabelScale, connections, clipRegion, connectionWidth, topSlot, scale, translateX, translateY } = layout;
  const nodesById = new Map(nodes.map(n => [n.id, n]));

  // Edges keep their true canvas weight (27 * connectionWidth in graph coordinates), so
  // they thin out with the rest of the drawing instead of staying a fixed screen width.
  // The `1 / scale` floor is only a don't-vanish backstop for extreme zoom-outs.
  const edgeStrokeWidth = Math.max(CONNECTION_STROKE_BASE * connectionWidth, 1 / scale);

  const renderConnection = ({ edge, geometry }, idx) => (
    <PreviewConnection
      key={`inner-conn-${edge.id || idx}`}
      geometry={geometry}
      color={connectionColor(edge, nodesById.get(edge.destinationId), nodePrototypesMap, edgePrototypesMap)}
      strokeWidth={edgeStrokeWidth}
      arrowScale={connectionWidth}
      clipRegion={clipRegion}
      clipId={`${clipPrefix}-inner-conn-clip-${edge.id || idx}`}
    />
  );

  // A group's title, wrapped as the layout wrapped it (label.lines) and centred on
  // its tab, like groupElements.jsx. Dropped below the same legibility cutoff as
  // node labels.
  const renderGroupTitle = (shape, fill) => {
    if (groupFontSize * scale < MIN_LABEL_PX) return null;
    const { label } = shape;
    const lines = label.lines?.length ? label.lines : [shape.name];
    const lineHeight = groupFontSize * GROUP_LAYOUT_CONSTANTS.titleLineSpacingFactor;
    const cx = label.x + label.w / 2;
    return (
      <text
        x={cx}
        y={label.y + label.h / 2}
        fontFamily="EmOne, sans-serif"
        fontSize={groupFontSize}
        fontWeight="bold"
        fill={fill}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={cx} dy={i === 0 ? -((lines.length - 1) / 2) * lineHeight : lineHeight}>{line}</tspan>
        ))}
      </text>
    );
  };

  const renderGroupShell = (shape) => {
    const C = GROUP_LAYOUT_CONSTANTS;
    const { rect, label } = shape;
    if (shape.isNodeGroup) {
      return (
        <g key={`inner-group-${shape.id}`}>
          <rect x={rect.x} y={shape.nodeGroupRect.y} width={rect.w} height={shape.nodeGroupRect.h}
            rx={C.nodeGroupCornerRadius} ry={C.nodeGroupCornerRadius} fill={shape.color} />
          <rect
            x={rect.x + C.innerCanvasBorder}
            y={shape.innerCanvasY}
            width={rect.w - C.innerCanvasBorder * 2}
            height={(rect.y + rect.h) - shape.innerCanvasY - C.innerCanvasBorder}
            rx={C.innerCanvasCornerRadius} ry={C.innerCanvasCornerRadius}
            fill={blendColors(theme.canvas.bg, shape.color, NODE_GROUP_INTERIOR_TINT)}
          />
        </g>
      );
    }
    return (
      <g key={`inner-group-${shape.id}`}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h}
          rx={C.nodeGroupCornerRadius} ry={C.nodeGroupCornerRadius}
          fill="none" stroke={shape.color} strokeWidth={PLAIN_GROUP_STROKE} strokeDasharray={PLAIN_GROUP_DASH} />
        <rect x={label.x} y={label.y} width={label.w} height={label.h}
          rx={GROUP_PILL_RADIUS * groupLabelScale} ry={GROUP_PILL_RADIUS * groupLabelScale}
          fill={theme.canvas.bg} stroke={shape.color} strokeWidth={GROUP_PILL_STROKE * groupLabelScale} />
        {renderGroupTitle(shape, getTextColor(theme.canvas.bg, theme.darkMode))}
      </g>
    );
  };

  const renderNode = (node) => {
    // Get original dimensions
    const dimensions = dimsById.get(node.id);
    const titleHeight = dimensions.textAreaHeight || NODE_HEIGHT * NAME_AREA_FACTOR;
    const thumbnailSrc = safeImageSrc(node.thumbnailSrc);
    const hasThumbnail = Boolean(thumbnailSrc);
    const clipId = `${clipPrefix}-inner-node-clip-${node.id}`;

    return (
      <g key={`inner-node-${node.id}`}>
        {hasThumbnail && (
          <defs>
            <clipPath id={clipId}>
              <rect
                x={node.x + (dimensions.scaledPadding ?? NODE_PADDING)}
                y={node.y + dimensions.textAreaHeight}
                width={dimensions.imageWidth}
                height={dimensions.calculatedImageHeight}
                rx={dimensions.scaledCornerRadius ?? NODE_CORNER_RADIUS}
                ry={dimensions.scaledCornerRadius ?? NODE_CORNER_RADIUS}
              />
            </clipPath>
          </defs>
        )}
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
            href={thumbnailSrc}
            x={node.x + (dimensions.scaledPadding ?? NODE_PADDING)}
            y={node.y + dimensions.textAreaHeight}
            width={dimensions.imageWidth}
            height={dimensions.calculatedImageHeight}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
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
  };

  // Paint order follows the canvas: top-level plain groups at the bottom, then per
  // nesting depth the connections that belong at that depth followed by that
  // depth's shells, then the connections above every shell, then the nodes, and
  // Thing-group titles last (the canvas draws them above their members).
  const layers = [];
  groupShapes.filter(g => !g.isNodeGroup && g.depth === 0).forEach(g => layers.push(renderGroupShell(g)));
  for (let depth = 0; depth < topSlot; depth++) {
    connections.filter(c => c.slot === depth).forEach(c => layers.push(renderConnection(c)));
    groupShapes.filter(g => g.depth === depth && (g.isNodeGroup || depth > 0)).forEach(g => layers.push(renderGroupShell(g)));
  }
  connections.filter(c => c.slot >= topSlot).forEach(c => layers.push(renderConnection(c)));

  return (
    // Apply calculated transform to the parent group
    <g transform={`translate(${translateX}, ${translateY}) scale(${scale})`} pointerEvents="none">
      {layers}
      {nodes.filter(node => !hiddenIds.has(node.id)).map(renderNode)}
      {groupShapes.filter(g => g.isNodeGroup).map(g => (
        <g key={`inner-group-title-${g.id}`}>
          {renderGroupTitle(g, getTextColor(g.color, theme.darkMode))}
        </g>
      ))}
    </g>
  );
};

export default InnerNetwork;
