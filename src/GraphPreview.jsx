import React, { useId, useMemo } from 'react';
import { getNodeDimensions } from './utils.js';
import { NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR, CONNECTION_WIDTH_BASE_SCALE } from './constants';
import useGraphStore from "./store/graphStore.js";
import { blendColors } from './utils/colorUtils.js';
import { useTheme } from './hooks/useTheme.js';
import { measureTextWidth } from './services/textMeasurement.js';
import {
  GROUP_LAYOUT_CONSTANTS,
  computeGroupLayout,
  buildGroupsByMemberIdIndex,
  buildChildGroupIdsIndex,
  computeGroupDepths,
  buildEdgeZSlotIndex,
  edgeZSlotFor,
} from './services/groupLayout.js';

// Canvas nodes round at NODE_CORNER_RADIUS * 1.4 (see getNodeDimensions)
const PREVIEW_CORNER_RADIUS = NODE_CORNER_RADIUS * 1.4;

// Canvas geometry, in world units (see renderConnectionEdge / NodeCanvas).
// The preview draws in world coordinates and lets the viewBox do the fitting,
// so every one of these keeps the proportion it has on the canvas: a sprawling
// web shown small gets thin connections, a two-node web shown large gets thick
// ones — exactly as zooming the canvas would.
const CONNECTION_STROKE = 27;
const ARROW_HALF_WIDTH = 26;
const ARROW_HALF_HEIGHT = 34;
const PLAIN_GROUP_STROKE = 12;
const PLAIN_GROUP_DASH = '16 12';
const GROUP_PILL_STROKE = 6;
const GROUP_PILL_RADIUS = 20;
const NODE_GROUP_INTERIOR_TINT = 0.07; // matches NodeCanvas
const BOUNDING_BOX_PADDING = 20;
// Below this on screen a connection disappears into antialiasing, so a very
// large web gets a floor rather than a strictly proportional line.
const MIN_CONNECTION_PX = 0.75;

// Where a ray from a box's center leaves the box.
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

const GraphPreview = ({ nodes = [], edges = [], groups = null, width, height }) => {
  const theme = useTheme();
  // useId's colons are not valid inside url(#...) references.
  const clipPrefix = useId().replace(/:/g, '');
  // Access store for prototype data to determine edge and group colors
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const edgePrototypesMap = useGraphStore(state => state.edgePrototypes);
  const textSettings = useGraphStore(state => state.textSettings);
  const gridSize = useGraphStore(state => state.gridSettings?.size || 200);

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
    if (!nodes.length || !width || !height) return null;

    // 1. Node boxes in world coordinates.
    const boxes = new Map();
    const dimsById = new Map();
    const nodesById = new Map();
    for (const n of nodes) {
      const dims = getNodeDimensions(n, false, null);
      dimsById.set(n.id, dims);
      nodesById.set(n.id, { id: n.id, x: n.x, y: n.y });
      boxes.set(n.id, { x: n.x, y: n.y, w: dims.currentWidth, h: dims.currentHeight });
    }

    // 2. Groups, laid out by the same pure solver the canvas uses.
    const groupsById = groups instanceof Map
      ? groups
      : new Map(Object.entries(groups || {}));
    const groupShapes = [];
    const anchorShapes = new Map(); // anchor instance id -> { label, shell }
    let depths = new Map();
    let edgeSlots = new Map();
    if (groupsById.size > 0) {
      const groupsByMemberId = buildGroupsByMemberIdIndex(groupsById);
      const childGroupIdsByGroupId = buildChildGroupIdsIndex(groupsById, groupsByMemberId);
      depths = computeGroupDepths(groupsById, groupsByMemberId, childGroupIdsByGroupId);
      edgeSlots = buildEdgeZSlotIndex(groupsById, depths);

      const labelScale = textSettings?.nodeScale ?? 1.0;
      const labelFontSize = 45 * (textSettings?.fontSize ?? 1.0) * labelScale;
      const labelFont = `bold ${labelFontSize}px "EmOne", sans-serif`;
      // A node-group's name is its linked Thing's — resolve it once, into the
      // map every nested layout call reads, as NodeCanvas does.
      const namedGroups = new Map();
      for (const [id, g] of groupsById) {
        const proto = g.linkedNodePrototypeId ? nodePrototypesMap.get(g.linkedNodePrototypeId) : null;
        const name = proto?.name || g.name || 'Group';
        namedGroups.set(id, name === g.name ? g : { ...g, name });
      }
      const context = {
        nodesById,
        dimsById,
        groupsById: namedGroups,
        groupsByMemberId,
        childGroupIdsByGroupId,
        gridSize,
        measureLabelWidth: (text) => measureTextWidth(text || 'Group', labelFont),
        labelScale,
        labelFontSize,
        _cache: new Map(),
      };

      for (const group of namedGroups.values()) {
        if (!group.memberInstanceIds?.length && !group.linkedNodePrototypeId) continue;
        const result = computeGroupLayout(group, context);
        if (!result.ok) continue;
        const proto = group.linkedNodePrototypeId ? nodePrototypesMap.get(group.linkedNodePrototypeId) : null;
        const shape = {
          id: group.id,
          depth: depths.get(group.id) ?? 0,
          color: proto?.color || group.color || '#8B0000',
          labelScale,
          ...result,
        };
        groupShapes.push(shape);
        if (result.isNodeGroup && group.anchorInstanceId) {
          // On the canvas the anchor IS the title (drawn without a node of its
          // own), and connections to it are cut at the shell rim.
          anchorShapes.set(group.anchorInstanceId, {
            label: result.label,
            shell: { x: result.rect.x, y: result.nodeGroupRect.y, w: result.rect.w, h: result.nodeGroupRect.h },
          });
        }
      }
    }

    // 3. Bounds: every drawn node plus every group's full shell.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y, w, h) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    };
    // A group anchor is never drawn as a node — the canvas skips it too.
    const hiddenIds = new Set(anchorShapes.keys());
    for (const n of nodes) if (n.isGroupAnchor) hiddenIds.add(n.id);
    for (const [id, b] of boxes) if (!hiddenIds.has(id)) grow(b.x, b.y, b.w, b.h);
    for (const g of groupShapes) grow(g.visualBounds.x, g.visualBounds.y, g.visualBounds.w, g.visualBounds.h);
    if (!isFinite(minX)) return null;

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

    // 4. Connections. Anchors connect at their title's center but clip against
    // the whole shell, the same split the canvas makes.
    const endpointFor = (id) => {
      const anchor = anchorShapes.get(id);
      if (anchor) {
        const l = anchor.label;
        return { cx: l.x + l.w / 2, cy: l.y + l.h / 2, clip: anchor.shell };
      }
      const b = boxes.get(id);
      return b ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2, clip: b } : null;
    };
    const topSlot = groupShapes.reduce((m, g) => Math.max(m, g.depth), -1) + 1;
    const connections = [];
    for (const edge of edges) {
      const s = endpointFor(edge.sourceId);
      const d = endpointFor(edge.destinationId);
      if (!s || !d) continue;
      const dx = d.cx - s.cx;
      const dy = d.cy - s.cy;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      connections.push({
        edge,
        s, d,
        ux: dx / length,
        uy: dy / length,
        slot: groupShapes.length ? edgeZSlotFor(edge, edgeSlots, topSlot) : topSlot,
      });
    }

    return { boxes, hiddenIds, groupShapes, connections, topSlot, viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`, scale };
  }, [nodes, edges, groups, width, height, nodePrototypesMap, textSettings, gridSize]);

  if (!layout) {
    return <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ display: 'block' }} />;
  }

  const { boxes, hiddenIds, groupShapes, connections, topSlot, viewBox, scale } = layout;
  const nodesById = new Map(nodes.map(n => [n.id, n]));

  // Proportional to the canvas, with a legibility floor for huge webs. The
  // arrowheads ride the same factor so they stay in proportion to the line.
  const naturalStroke = CONNECTION_STROKE * connectionWidth;
  const floorBoost = Math.max(1, MIN_CONNECTION_PX / (naturalStroke * scale));
  const lineStroke = naturalStroke * floorBoost;
  const arrowScale = connectionWidth * floorBoost;

  const renderConnection = ({ edge, s, d, ux, uy }) => {
    const arrowsToward = toArrowSet(edge.directionality?.arrowsToward);
    const edgeColor = getEdgeColor(edge, nodesById.get(edge.destinationId));
    const arrowAtSource = arrowsToward.has(edge.sourceId);
    const arrowAtDest = arrowsToward.has(edge.destinationId);
    const sourceHit = arrowAtSource ? getBoxEdgeIntersection(s.clip, ux, uy) : null;
    const destHit = arrowAtDest ? getBoxEdgeIntersection(d.clip, -ux, -uy) : null;

    // The arrow's tip sits on the border, so its center is one half-height back.
    const tipBack = ARROW_HALF_HEIGHT * arrowScale;
    const arrow = (hit, dirX, dirY) => (
      <g transform={`translate(${hit.x + dirX * tipBack}, ${hit.y + dirY * tipBack}) rotate(${Math.atan2(-dirY, -dirX) * 180 / Math.PI + 90}) scale(${arrowScale})`}>
        <polygon
          points={`${-ARROW_HALF_WIDTH},${ARROW_HALF_HEIGHT} ${ARROW_HALF_WIDTH},${ARROW_HALF_HEIGHT} 0,${-ARROW_HALF_HEIGHT}`}
          fill={edgeColor}
          stroke={edgeColor}
          strokeWidth={6}
          strokeLinejoin="round"
          paintOrder="stroke fill"
        />
      </g>
    );

    return (
      <g key={edge.id}>
        <line
          x1={sourceHit?.x ?? s.cx}
          y1={sourceHit?.y ?? s.cy}
          x2={destHit?.x ?? d.cx}
          y2={destHit?.y ?? d.cy}
          stroke={edgeColor}
          strokeWidth={lineStroke}
          strokeLinecap="round"
        />
        {sourceHit && arrow(sourceHit, ux, uy)}
        {destHit && arrow(destHit, -ux, -uy)}
      </g>
    );
  };

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

          if (node.imageSrc) {
            return (
              <g key={node.id}>
                <image
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  href={node.imageSrc}
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
