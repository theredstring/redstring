/**
 * The connections crossing a box's edge while the box morphs (boxMorph.js):
 * one end outside the box, the other on the Thing itself or on something inside
 * it.
 *
 * Each is drawn afresh every frame from its resting geometry
 * (utils/canvas/settledConnection.js, which the canvas's own renderer is held
 * equal to), with its outside end where it is and its moving end wherever the
 * stand-in has got to:
 *
 *   - A connection to the Thing ends on the stand-in's outline, aimed at its
 *     title: the node when closed, the box's band and tab when open. A node
 *     showing its preview is still aimed at as the node it is closed (the canvas
 *     draws its connections to that, under the card), so that is where they start.
 *   - A connection to something inside rides the outline too, then slides in
 *     onto that node as the box finishes opening (and back out as it starts to
 *     fold), which is where it is drawn when the box is open and closed.
 *
 * At either end of the morph these are the geometries the canvas draws, so the
 * real connections take over without a jump. Their labels travel with them:
 * each label as drawn before and after is carried along its connection's
 * middle, turning with it, the one crossfading into the other.
 *
 * An outside end that isn't drawn (culled off screen) is sized from the store,
 * as the canvas would size it; a connection that still can't be drawn is left
 * showing as it is rather than hidden.
 */
import {
  ARROW_POLYGON_POINTS, CONNECTION_STROKE_BASE, buildConnectionScene, connectionColor,
  connectionRoutingSettings, settledConnectionGeometry,
} from '../../../utils/canvas/settledConnection.js';
import { buildShellCutoutPath } from '../../../services/groupLayout.js';
import useGraphStore from '../../../store/graphStore.js';
import useImageCache from '../../../services/imageCache.js';
import { getNodeDimensions } from '../../../utils.js';
import { projectGraphView, viewEdges } from '../../../core/openDefinitions.js';
import { blendColors } from '../../../utils/colorUtils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Node.jsx insets a node's painted background this far inside its box.
const NODE_BG_INSET = 6;
// How much room the cutout clip leaves around the connections it cuts.
const CLIP_MARGIN = 4000;

const esc = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));
const num = (el, name) => parseFloat(el?.getAttribute(name)) || 0;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOutCubic = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');

export const lerpRect = (a, b, t) => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), r: lerp(a.r || 0, b.r || 0, t),
});

/** A pose `{ x, y, s }` (translate, then scale) applied to a rect. */
const posed = (p, r) => ({ x: p.x + r.x * p.s, y: p.y + r.y * p.s, w: r.w * p.s, h: r.h * p.s, r: (r.r || 0) * p.s });
/** The rect a pose would map onto `r`. */
const unposed = (p, r) => ({ x: (r.x - p.x) / p.s, y: (r.y - p.y) / p.s, w: r.w / p.s, h: r.h / p.s, r: (r.r || 0) / p.s });

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

// ─── Which connections ────────────────────────────────────────────────────────

/**
 * The view's connections touching a box, split into those wholly inside it
 * (`internal`, carried with its content) and those crossing its edge.
 *
 * @param {string[]} insideIds - The box's members and its Thing's instance.
 * @param {string|null} thingId - The Thing's instance (the box's anchor).
 */
export function splitBoxConnections(state, viewGraphId, insideIds, thingId) {
  const inside = new Set(insideIds);
  const view = projectGraphView(state, viewGraphId);
  const edges = viewEdges(state, viewGraphId);
  const colorOf = (instanceId) => state.nodePrototypes.get(view?.instances?.get(instanceId)?.prototypeId)?.color;
  const internal = [];
  const crossing = [];
  for (const id of view?.edgeIds || []) {
    const edge = edges?.get(id);
    if (!edge) continue;
    const fromInside = inside.has(edge.sourceId);
    const toInside = inside.has(edge.destinationId);
    if (fromInside && toInside) { internal.push(id); continue; }
    if (!fromInside && !toInside) continue;
    const innerId = fromInside ? edge.sourceId : edge.destinationId;
    const outerId = fromInside ? edge.destinationId : edge.sourceId;
    const arrows = edge.directionality?.arrowsToward;
    const toward = arrows instanceof Set ? arrows : new Set(Array.isArray(arrows) ? arrows : []);
    const outerGroup = view.instances.get(outerId)?.isGroupAnchor
      ? [...view.groups.values()].find(g => g.anchorInstanceId === outerId && g.linkedNodePrototypeId) : null;
    // Its colour at each end of the morph: an untyped connection takes its destination's.
    const destColor = (innerEnd) => ({ color: fromInside ? colorOf(outerId) : colorOf(innerEnd) });
    crossing.push({
      id, innerId, outerId,
      innerIsSource: fromInside,
      arrowAtInner: toward.has(innerId),
      arrowAtOuter: toward.has(outerId),
      typeNodeId: edge.typeNodeId,
      definitionNodeIds: edge.definitionNodeIds,
      onThing: innerId === thingId,
      outerGroupId: outerGroup?.id || null,
      colorBox: connectionColor(edge, destColor(innerId), state.nodePrototypes, state.edgePrototypes),
      colorNode: connectionColor(edge, destColor(thingId), state.nodePrototypes, state.edgePrototypes),
    });
  }
  return { internal, crossing };
}

// ─── Where their ends are ─────────────────────────────────────────────────────

/** A node's box as the connection geometry sees it (its painted background, outset). */
export function nodeRectIn(root, instanceId) {
  const bg = root?.querySelector(`g.node[data-instance-id="${esc(instanceId)}"] .node-background`);
  if (!bg) return null;
  return {
    x: num(bg, 'x') - NODE_BG_INSET, y: num(bg, 'y') - NODE_BG_INSET,
    w: num(bg, 'width') + 2 * NODE_BG_INSET, h: num(bg, 'height') + 2 * NODE_BG_INSET,
    r: num(bg, 'rx') + NODE_BG_INSET,
  };
}

/**
 * A node that isn't drawn, sized as the canvas would size it (canvasNodes.js
 * hydrates it the same way, with the image cache's thumbnail when the node has
 * none of its own).
 */
export function storeNodeRect(viewGraphId, instanceId) {
  const state = useGraphStore.getState();
  const instance = projectGraphView(state, viewGraphId)?.instances?.get(instanceId);
  const prototype = instance ? state.nodePrototypes.get(instance.prototypeId) : null;
  if (!prototype) return null;
  const cached = !prototype.thumbnailSrc ? useImageCache.getState().images?.[instance.prototypeId] : null;
  const node = {
    ...prototype,
    ...(cached ? { thumbnailSrc: cached.thumbnailSrc, imageAspectRatio: cached.imageAspectRatio } : {}),
    ...instance,
    name: prototype.name,
  };
  const dims = getNodeDimensions(node, false, null);
  return { x: instance.x ?? 0, y: instance.y ?? 0, w: dims.currentWidth, h: dims.currentHeight, r: dims.scaledCornerRadius ?? 0 };
}

/** A thing group's anchor as the connection geometry sees it: its title tab, inside its shell. */
function anchorEndIn(root, groupId) {
  const band = root?.querySelector(`.node-group-bg[data-group-id="${esc(groupId)}"] > rect`);
  const tab = root?.querySelector(`.node-group-title[data-group-id="${esc(groupId)}"] .group-label > rect`);
  if (!band || !tab) return null;
  const rect = (el) => ({ x: num(el, 'x'), y: num(el, 'y'), w: num(el, 'width'), h: num(el, 'height'), r: num(el, 'rx') });
  return { kind: 'anchor', pill: rect(tab), outer: rect(band) };
}

/** The world rects of the nodes inside the box that crossing connections end on. */
export function readInnerRects(root, crossing) {
  const rects = new Map();
  for (const c of crossing) {
    if (c.onThing || rects.has(c.innerId)) continue;
    const rect = nodeRectIn(root, c.innerId);
    if (rect) rects.set(c.innerId, rect);
  }
  return rects;
}

function cameraZoom(from) {
  for (let el = from; el && el.tagName !== 'svg'; el = el.parentNode) {
    const match = /scale\(\s*([-\d.e+]+)/.exec(el.getAttribute?.('transform') || '');
    if (match) return +match[1] || 1;
  }
  return 1;
}

/**
 * Everything the frames need, read once the morph starts: each crossing
 * connection's outside end (a node, or another thing group's tab), the rect it
 * ends on inside the box in content coordinates (`contentPose` maps them to the
 * world when the box is open), its labels as drawn at the node and at the box,
 * and a group to draw it into. `dropped` lists the connections it can't draw.
 *
 * @param {Map} innerRects - innerId → world rect with the box open (readInnerRects).
 * @param {Map} nodeLabels - edge id → its label as drawn with the Thing closed (copyLabels).
 * @param {Map} boxLabels - edge id → its label as drawn with the box open.
 */
export function prepareConnections({
  root, host, layer, labelLayer, viewGraphId, crossing, innerRects, contentPose, tag, nodeLabels, boxLabels,
}) {
  const items = [];
  const dropped = [];
  crossing.forEach((c, i) => {
    let outer = null;
    if (c.outerGroupId) outer = anchorEndIn(root, c.outerGroupId);
    else {
      const rect = nodeRectIn(root, c.outerId) || storeNodeRect(viewGraphId, c.outerId);
      if (rect) outer = { kind: 'node', rect };
    }
    if (!outer) { dropped.push(c.id); return; }
    const world = innerRects.get(c.innerId);
    const g = svg('g');
    layer.appendChild(g);
    const mount = (label) => {
      if (!label) return null;
      const holder = svg('g', { opacity: 0 });
      holder.appendChild(label);
      labelLayer.appendChild(holder);
      return holder;
    };
    items.push({
      ...c, outer, g, clipId: `${tag}-c${i}`,
      innerRect: world && contentPose ? unposed(contentPose, world) : null,
      nodeLabel: mount(nodeLabels?.get(c.id)),
      boxLabel: mount(boxLabels?.get(c.id)),
    });
  });
  return { items, dropped, settings: connectionRoutingSettings(useGraphStore.getState()), zoom: cameraZoom(host) };
}

/**
 * Where each connection's middle is at the node (t = 0) and at the box (t = 1),
 * which its two labels were drawn against. Draws both ends once to measure them.
 *
 * @param {(t: number) => object} frameAt - The frame drawConnections takes at `t`.
 */
export function measureLabelAnchors(conn, frameAt) {
  if (!conn?.items.length) return;
  drawConnections(conn, frameAt(0));
  conn.items.forEach(item => { item.midAtNode = item.mid; });
  drawConnections(conn, frameAt(1));
  conn.items.forEach(item => { item.midAtBox = item.mid; });
  conn.labelsPlaced = true;
}

// ─── Drawing them ─────────────────────────────────────────────────────────────

const anchorInfo = (pill, outer) => ({
  x: pill.x, y: pill.y, width: pill.w, height: pill.h,
  outerBounds: { x: outer.x, y: outer.y, width: outer.w, height: outer.h },
  shellRect: { x: outer.x, y: outer.y, w: outer.w, h: outer.h, r: outer.r || 0 },
});

/**
 * Draws every crossing connection for one frame.
 *
 * @param {object} frame
 * @param {object} frame.thingPill - Where the Thing's title is (its node, or its tab).
 * @param {object} frame.thingOuter - The Thing's outline (its node, or its band).
 * @param {object|null} frame.pose - The content's pose this frame.
 * @param {number} frame.t - 0 at the node, 1 at the box.
 */
export function drawConnections(conn, { thingPill, thingOuter, pose, t }) {
  if (!conn?.items.length) return;
  // Onto the node inside over the second part of the opening (off it over the
  // first part of the fold); until then, riding the outline.
  const w = easeInOutCubic(clamp01((t - 0.35) / 0.65));
  const nodes = new Map();
  const dimsById = new Map();
  const anchors = new Map();
  const edges = [];
  const rects = [];
  const put = (id, end) => {
    if (nodes.has(id)) return;
    if (end.kind === 'node') {
      nodes.set(id, { id, x: end.rect.x, y: end.rect.y });
      dimsById.set(id, { currentWidth: end.rect.w, currentHeight: end.rect.h });
      rects.push(end.rect);
    } else {
      nodes.set(id, { id, x: end.pill.x, y: end.pill.y, isGroupAnchor: true });
      dimsById.set(id, { currentWidth: end.pill.w, currentHeight: end.pill.h });
      anchors.set(id, anchorInfo(end.pill, end.outer));
      rects.push(end.outer);
    }
  };

  for (const item of conn.items) {
    const outerKey = `o:${item.outerId}`;
    const movingKey = `m:${item.innerId}`;
    put(outerKey, item.outer);
    let moving = { kind: 'anchor', pill: thingPill, outer: thingOuter };
    if (!item.onThing && item.innerRect && pose) {
      const inner = posed(pose, item.innerRect);
      moving = w >= 1
        ? { kind: 'node', rect: inner }
        : { kind: 'anchor', pill: lerpRect(thingPill, inner, w), outer: lerpRect(thingOuter, inner, w) };
    }
    put(movingKey, moving);
    const arrowsToward = new Set();
    if (item.arrowAtInner) arrowsToward.add(movingKey);
    if (item.arrowAtOuter) arrowsToward.add(outerKey);
    item.synthetic = {
      id: item.id,
      sourceId: item.innerIsSource ? movingKey : outerKey,
      destinationId: item.innerIsSource ? outerKey : movingKey,
      typeNodeId: item.typeNodeId,
      definitionNodeIds: item.definitionNodeIds,
      directionality: { arrowsToward },
    };
    edges.push(item.synthetic);
  }

  const scene = buildConnectionScene({
    nodes: [...nodes.values()], edges, dimsById, anchors, settings: conn.settings, zoom: conn.zoom,
  });
  const region = regionAround(rects);
  const { connectionWidth } = conn.settings;
  for (const item of conn.items) {
    const geometry = settledConnectionGeometry(item.synthetic, scene);
    if (!geometry) { item.g.replaceChildren(); continue; }
    // Nodes paint over connections on the canvas, hiding an arrow-less end that
    // runs to a node's middle. The stand-in paints above them, so cut it instead.
    const clipShells = item.outer.kind === 'node' && !item.arrowAtOuter
      ? [...geometry.clipShells, item.outer.rect] : geometry.clipShells;
    const shift = item.onThing ? t : w;
    const color = isHex(item.colorNode) && isHex(item.colorBox)
      ? blendColors(item.colorNode, item.colorBox, shift)
      : (shift < 0.5 ? item.colorNode : item.colorBox);
    paintConnection(item.g, { ...geometry, clipShells }, {
      color, strokeWidth: CONNECTION_STROKE_BASE * connectionWidth, arrowScale: connectionWidth, region, clipId: item.clipId,
    });
    item.mid = strokeMiddle(item.g) || item.mid;
    if (conn.labelsPlaced) placeLabels(item, t);
  }
}

/** The middle of a painted connection's stroke, and the stroke's direction there (degrees). */
function strokeMiddle(g) {
  const stroke = g.querySelector('[data-stroke]');
  if (!stroke) return null;
  if (stroke.tagName === 'line') {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => num(stroke, a));
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2, angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI };
  }
  try {
    const length = stroke.getTotalLength();
    const at = (d) => stroke.getPointAtLength(Math.max(0, Math.min(length, d)));
    const mid = at(length / 2);
    const before = at(length / 2 - 2);
    const after = at(length / 2 + 2);
    return { x: mid.x, y: mid.y, angle: Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI };
  } catch {
    return null;
  }
}

// A turn that keeps a label upright: text reads the same flipped end to end, so
// never turn it past a quarter.
const uprightTurn = (degrees) => {
  let d = ((degrees + 180) % 360 + 360) % 360 - 180;
  if (d > 90) d -= 180;
  if (d < -90) d += 180;
  return d;
};

/**
 * Carries a connection's labels along its middle: each held where it was drawn
 * relative to the middle it was drawn against, turned by as much as the
 * connection has turned since. The node's label gives way to the box's.
 */
function placeLabels(item, t) {
  const cur = item.mid;
  if (!cur) return;
  const u = easeInOutCubic(t);
  const place = (holder, ref, opacity) => {
    if (!holder || !ref) return;
    holder.setAttribute('transform', `translate(${cur.x} ${cur.y}) rotate(${uprightTurn(cur.angle - ref.angle)}) translate(${-ref.x} ${-ref.y})`);
    holder.setAttribute('opacity', opacity);
  };
  place(item.nodeLabel, item.midAtNode, 1 - u);
  place(item.boxLabel, item.midAtBox, u);
}

function regionAround(rects) {
  const minX = Math.min(...rects.map(r => r.x)) - CLIP_MARGIN;
  const minY = Math.min(...rects.map(r => r.y)) - CLIP_MARGIN;
  const maxX = Math.max(...rects.map(r => r.x + r.w)) + CLIP_MARGIN;
  const maxY = Math.max(...rects.map(r => r.y + r.h)) + CLIP_MARGIN;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** One connection's marks, as PreviewConnection draws them. */
function paintConnection(g, geometry, { color, strokeWidth, arrowScale, region, clipId }) {
  const { kind, stubs, arrows, clipShells } = geometry;
  const cap = geometry.roundCap ? 'round' : null;
  const parts = [];
  const strokes = svg('g');
  if (clipShells.length > 0) {
    const defs = svg('defs');
    const clip = svg('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
    clip.appendChild(svg('path', { d: buildShellCutoutPath(region, clipShells), 'clip-rule': 'evenodd' }));
    defs.appendChild(clip);
    parts.push(defs);
    strokes.setAttribute('clip-path', `url(#${clipId})`);
  }
  parts.push(strokes);
  stubs.forEach(s => strokes.appendChild(svg('line', {
    x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke: color, 'stroke-width': strokeWidth, 'stroke-linecap': 'round',
  })));
  const stroke = kind === 'line'
    ? svg('line', { 'data-stroke': '', x1: geometry.x1, y1: geometry.y1, x2: geometry.x2, y2: geometry.y2, stroke: color, 'stroke-width': strokeWidth })
    : svg('path', { 'data-stroke': '', d: geometry.d, fill: 'none', stroke: color, 'stroke-width': strokeWidth });
  if (cap) stroke.setAttribute('stroke-linecap', cap);
  strokes.appendChild(stroke);
  arrows.forEach(a => {
    const head = svg('g', { transform: `translate(${a.x}, ${a.y}) rotate(${a.angle + 90}) scale(${arrowScale})` });
    head.appendChild(svg('polygon', {
      points: ARROW_POLYGON_POINTS, fill: color, stroke: color, 'stroke-width': 6,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'paint-order': 'stroke fill',
    }));
    parts.push(head);
  });
  g.replaceChildren(...parts);
}

// ─── Their labels ─────────────────────────────────────────────────────────────

/** Copies of these connections' labels as drawn now: edge id → one group holding its label(s). */
export function copyLabels(root, edgeIds, detach) {
  const labels = new Map();
  for (const id of edgeIds) {
    const found = root?.querySelectorAll(`[data-edge-id="${esc(id)}"] [data-edge-label]`) || [];
    if (found.length === 0) continue;
    const group = svg('g');
    found.forEach(label => group.appendChild(detach(label.cloneNode(true))));
    labels.set(id, group);
  }
  return labels;
}
