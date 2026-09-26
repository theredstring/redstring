import { useId, useMemo } from 'react';
import {
    NODE_WIDTH,
    NODE_HEIGHT,
    NODE_PADDING,
    NAME_AREA_FACTOR,
    NODE_CORNER_RADIUS,
    NODE_DEFAULT_COLOR,
    CONNECTION_WIDTH_BASE_SCALE
} from './constants'; // Import necessary constants
import { getNodeDimensions } from './utils.js'; // Import from utils.js
import { getTextColor, blendColors } from './utils/colorUtils.js';
import { buildNodeFontString, wrapTextToLines, measureTextWidth } from './services/textMeasurement.js';
import { useTheme } from './hooks/useTheme.js';
import useGraphStore from "./store/graphStore.js";
import {
    GROUP_LAYOUT_CONSTANTS,
    computeGroupLayout,
    buildGroupsByMemberIdIndex,
    buildChildGroupIdsIndex,
    computeGroupDepths,
    buildEdgeZSlotIndex,
    edgeZSlotFor,
} from './services/groupLayout.js';
import { NODE_GROUP_INTERIOR_TINT } from './components/canvas/groups/groupElements.jsx';

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

// Where a ray from a box's center leaves the box (adapted from NodeCanvas).
const getBoxEdgeIntersection = (box, dirX, dirY) => {
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const halfWidth = box.w / 2;
  const halfHeight = box.h / 2;
  let best = null;
  const consider = (t, x, y) => { if (!best || t < best.t) best = { t, x, y }; };
  if (dirX > 0) { const t = halfWidth / dirX; if (Math.abs(dirY * t) <= halfHeight) consider(t, centerX + halfWidth, centerY + dirY * t); }
  if (dirX < 0) { const t = -halfWidth / dirX; if (Math.abs(dirY * t) <= halfHeight) consider(t, centerX - halfWidth, centerY + dirY * t); }
  if (dirY > 0) { const t = halfHeight / dirY; if (Math.abs(dirX * t) <= halfWidth) consider(t, centerX + dirX * t, centerY + halfHeight); }
  if (dirY < 0) { const t = -halfHeight / dirY; if (Math.abs(dirX * t) <= halfWidth) consider(t, centerX + dirX * t, centerY - halfHeight); }
  return best;
};

const toArrowSet = (arrowsToward) => (arrowsToward instanceof Set
  ? arrowsToward
  : new Set(Array.isArray(arrowsToward) ? arrowsToward : []));

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

  const layout = useMemo(() => {
    if (!nodes || nodes.length === 0 || !edges || width <= 0 || height <= 0) return null;

    // 1. Node boxes, in canvas coordinates.
    const dimsById = new Map();
    const boxes = new Map();
    const layoutNodes = new Map();
    for (const node of nodes) {
      const dims = getNodeDimensions(node, false, null);
      dimsById.set(node.id, dims);
      boxes.set(node.id, { x: node.x, y: node.y, w: dims.currentWidth, h: dims.currentHeight });
      layoutNodes.set(node.id, { id: node.id, x: node.x, y: node.y });
    }

    // 2. Groups, laid out as the canvas lays them out (groups/groupLayouts.js).
    const groupsById = groups instanceof Map ? groups : new Map(Object.entries(groups || {}));
    const groupLabelScale = nodeScaleGlobal;
    const groupFontSize = LABEL_FONT_BASE * (textSettings?.fontSize ?? 1.0) * groupLabelScale;
    const groupShapes = [];
    const anchorShapes = new Map(); // anchor instance id -> { label, shell }
    let edgeSlots = new Map();
    if (groupsById.size > 0) {
      const groupsByMemberId = buildGroupsByMemberIdIndex(groupsById);
      const childGroupIdsByGroupId = buildChildGroupIdsIndex(groupsById, groupsByMemberId);
      const depths = computeGroupDepths(groupsById, groupsByMemberId, childGroupIdsByGroupId);
      edgeSlots = buildEdgeZSlotIndex(groupsById, depths);
      const labelFont = `bold ${groupFontSize}px "EmOne", sans-serif`;
      // A Thing-group is named and coloured by its Thing; resolve the name into
      // the map every nested layout call reads, as the canvas does.
      const namedGroups = new Map();
      for (const [id, group] of groupsById) {
        const proto = group.linkedNodePrototypeId ? nodePrototypesMap.get(group.linkedNodePrototypeId) : null;
        const name = proto?.name || group.name || 'Group';
        namedGroups.set(id, name === group.name ? group : { ...group, name });
      }
      const context = {
        nodesById: layoutNodes,
        dimsById,
        groupsById: namedGroups,
        groupsByMemberId,
        childGroupIdsByGroupId,
        gridSize,
        measureLabelWidth: (text) => measureTextWidth(text || 'Group', labelFont),
        labelScale: groupLabelScale,
        labelFontSize: groupFontSize,
        _cache: new Map(),
      };
      for (const group of namedGroups.values()) {
        if (!group.memberInstanceIds?.length && !group.linkedNodePrototypeId) continue;
        const result = computeGroupLayout(group, context);
        if (!result.ok) continue;
        const proto = group.linkedNodePrototypeId ? nodePrototypesMap.get(group.linkedNodePrototypeId) : null;
        groupShapes.push({
          ...result,
          id: group.id,
          name: group.name,
          depth: depths.get(group.id) ?? 0,
          color: proto?.color || group.color || '#8B0000',
        });
        if (result.isNodeGroup && group.anchorInstanceId) {
          // On the canvas the anchor IS the title (it draws no node of its own),
          // and connections to it are cut at the shell's rim.
          anchorShapes.set(group.anchorInstanceId, {
            label: result.label,
            shell: { x: result.rect.x, y: result.nodeGroupRect.y, w: result.rect.w, h: result.nodeGroupRect.h },
          });
        }
      }
      // Shallowest first, so nested shells paint above their parents.
      groupShapes.sort((a, b) => a.depth - b.depth);
    }

    // 3. Bounds: every drawn node plus every group's whole shell.
    const hiddenIds = new Set(anchorShapes.keys());
    for (const node of nodes) if (node.isGroupAnchor) hiddenIds.add(node.id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y, w, h) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    };
    for (const [id, box] of boxes) if (!hiddenIds.has(id)) grow(box.x, box.y, box.w, box.h);
    for (const shape of groupShapes) grow(shape.visualBounds.x, shape.visualBounds.y, shape.visualBounds.w, shape.visualBounds.h);
    if (!isFinite(minX)) return null;

    // 4. Fit: scale the padded bounds into the box and centre them.
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

    // 5. Connections. An anchor connects at its title's centre but is cut at
    // its shell, the same split the canvas makes.
    const endpointFor = (id) => {
      const anchor = anchorShapes.get(id);
      if (anchor) {
        const l = anchor.label;
        return { cx: l.x + l.w / 2, cy: l.y + l.h / 2, clip: anchor.shell };
      }
      const box = boxes.get(id);
      return box ? { cx: box.x + box.w / 2, cy: box.y + box.h / 2, clip: box } : null;
    };
    const topSlot = groupShapes.reduce((m, g) => Math.max(m, g.depth), -1) + 1;
    const nodesById = new Map(nodes.map(n => [n.id, n]));
    const connections = [];
    edges.forEach((edge, idx) => {
      if (!edge?.sourceId || !edge?.destinationId || edge.sourceId === edge.destinationId) return;
      const s = endpointFor(edge.sourceId);
      const d = endpointFor(edge.destinationId);
      if (!s || !d) return;
      connections.push({
        edge, idx, s, d,
        destNode: nodesById.get(edge.destinationId),
        slot: groupShapes.length ? edgeZSlotFor(edge, edgeSlots, topSlot) : topSlot,
      });
    });

    return { dimsById, hiddenIds, groupShapes, groupFontSize, groupLabelScale, connections, topSlot, scale, translateX, translateY };
  }, [nodes, edges, groups, width, height, padding, nodePrototypesMap, textSettings, gridSize, nodeScaleGlobal]);

  if (!layout) {
    return null;
  }

  const { dimsById, hiddenIds, groupShapes, groupFontSize, groupLabelScale, connections, topSlot, scale, translateX, translateY } = layout;

  // Edges keep their true canvas weight (27 * connectionWidth in graph coordinates), so
  // they thin out with the rest of the drawing instead of staying a fixed screen width.
  // The `1 / scale` floor is only a don't-vanish backstop for extreme zoom-outs.
  const edgeStrokeWidth = Math.max(EDGE_STROKE_BASE * connectionWidth, 1 / scale);

  const renderConnection = ({ edge, idx, s, d, destNode }) => {
    const dx = d.cx - s.cx;
    const dy = d.cy - s.cy;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return null;

    const arrowsToward = toArrowSet(edge.directionality?.arrowsToward);
    const shouldShortenSource = arrowsToward.has(edge.sourceId);
    const shouldShortenDest = arrowsToward.has(edge.destinationId);
    const sourceIntersection = shouldShortenSource ? getBoxEdgeIntersection(s.clip, dx / length, dy / length) : null;
    const destIntersection = shouldShortenDest ? getBoxEdgeIntersection(d.clip, -dx / length, -dy / length) : null;

    // Same slope-aware pull-back NodeCanvas uses for straight edges, so arrowheads sit
    // off the node at the same distance they would on the real canvas.
    const angleDeg = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
    const normalizedAngle = angleDeg > 90 ? 180 - angleDeg : angleDeg;
    const isQuantizedSlope = normalizedAngle < 15 || normalizedAngle > 75;
    const arrowLength = (isQuantizedSlope ? ARROW_OFFSET_BASE * 0.6 : ARROW_OFFSET_BASE) * connectionWidth;
    const sourceArrowAngle = Math.atan2(-dy, -dx) * (180 / Math.PI);
    const destArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Get edge color based on type hierarchy
    const edgeColor = getEdgeColor(edge, destNode);
    const arrow = (x, y, angle) => (
      <g transform={`translate(${x}, ${y}) rotate(${angle + 90}) scale(${connectionWidth})`}>
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
    );

    return (
      <g key={`inner-conn-${edge.id || idx}`}>
        <line
          x1={sourceIntersection?.x ?? s.cx}
          y1={sourceIntersection?.y ?? s.cy}
          x2={destIntersection?.x ?? d.cx}
          y2={destIntersection?.y ?? d.cy}
          stroke={edgeColor}
          strokeWidth={edgeStrokeWidth}
        />
        {sourceIntersection && arrow(
          sourceIntersection.x + (dx / length) * arrowLength,
          sourceIntersection.y + (dy / length) * arrowLength,
          sourceArrowAngle
        )}
        {destIntersection && arrow(
          destIntersection.x - (dx / length) * arrowLength,
          destIntersection.y - (dy / length) * arrowLength,
          destArrowAngle
        )}
      </g>
    );
  };

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
    const hasThumbnail = Boolean(node.thumbnailSrc);
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
            href={node.thumbnailSrc}
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
