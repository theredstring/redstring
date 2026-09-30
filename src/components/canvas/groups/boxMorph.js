/**
 * Box morphs: a Thing opening into its box (its thing group), and a box folding
 * back into its Thing.
 *
 * Done in the DOM, like the connection transitions (edges/edgeTransitions.js):
 * the store changes at once, in one undo step, and a stand-in drawn into
 * BoxMorphLayer's group carries the eye from the old shape to the new one while
 * the real elements wait hidden underneath. Neither the data model nor the
 * layers know about it.
 *
 * Both ends are read from the DOM, never recomputed: the start just before the
 * store write, the end once React has committed it. The two shapes have the
 * same parts, which is what makes the morph one interpolation:
 *
 *   the node (decomposition preview)      the box (thing-group shell)
 *   the card's background             →   the coloured band
 *   the preview's inner canvas        →   the interior
 *   the title                         →   the title tab (same font size)
 *   the definition, drawn to fit      →   the definition, drawn 1:1
 *
 * The preview draws the definition as the canvas does, under one
 * `translate() scale()` (InnerNetwork; NodeCanvas.previewParity.test.jsx keeps
 * the two equal), so the content moves as a single matrix. A node with no
 * preview open has no interior: its content grows out of the node's middle.
 *
 * Folding runs the same morph the other way, onto the node that closing leaves
 * behind (for a box opened in place, where its title tab was).
 *
 * Connections crossing the box's edge, to the Thing or to something inside it,
 * stay attached throughout: boxMorphConnections.js redraws them each frame.
 */
import useGraphStore from '../../../store/graphStore.js';
import { projectGraphView, viewEdges } from '../../../core/openDefinitions.js';
import { blendColors } from '../../../utils/colorUtils.js';
import { wrapTextToLines } from '../../../services/textMeasurement.js';
import { prefersReducedMotion } from '../edges/edgeTransitions.js';
import {
  copyLabels, drawConnections, measureLabelAnchors, prepareConnections, readInnerRects, splitBoxConnections, storeNodeRect,
} from './boxMorphConnections.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OPEN_MS = 380;
const CLOSE_MS = 320;
const REVEAL_MS = 140;
// The title takes the wrapping of the shape it is going to over this first part
// of the morph (of its time, not its eased progress), then rides the rest of the
// way already fitted: a long name folding into a node wraps to the node's width
// straight away instead of hanging off its edges until the very end.
const TITLE_REWRAP = 0.15;
// A plain node's content starts (or ends) this small, at the node's middle.
const SEED_SCALE = 0.04;
// Frames to wait for the far shape to reach the DOM. The shell lands in the
// commit that opens the box; its members can follow a frame or two later (the
// visible set is culled separately). Past this, an open box starts without
// them, and a fold whose node never arrived is dropped.
const MAX_WAIT_FRAMES = 12;
// Node.jsx insets a node's painted background this far inside its box.
const NODE_BG_INSET = 6;

const easeInOutCubic = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// ─── The layer's group ────────────────────────────────────────────────────────

let host = null;

/** BoxMorphLayer's group; null while it isn't mounted, and then nothing morphs. */
export function setBoxMorphHost(el) {
  host = el;
  // Scopes the hide rules to this canvas: other views (panels, previews) tag
  // their elements with the same data attributes.
  el?.parentNode?.setAttribute('data-box-morph-scene', '');
}

// Thing instance id → the morph running on it.
const morphs = new Map();

// The layer re-renders when a morph is queued, so its layout effect runs in the
// commit that brings the far shape into the DOM.
let version = 0;
const listeners = new Set();
export const subscribeBoxMorphs = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const boxMorphVersion = () => version;
const bump = () => { version++; listeners.forEach(fn => fn()); };

const canMorph = () => !!host?.isConnected && typeof document !== 'undefined' && !prefersReducedMotion();

// ─── Reading the DOM ──────────────────────────────────────────────────────────

const esc = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));
const scene = () => host?.parentNode || null;
const num = (el, name) => parseFloat(el?.getAttribute(name)) || 0;
const rectOf = (el) => (el ? { x: num(el, 'x'), y: num(el, 'y'), w: num(el, 'width'), h: num(el, 'height'), r: num(el, 'rx') } : null);
const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const nodeElement = (instanceId) => scene()?.querySelector(`g.node[data-instance-id="${esc(instanceId)}"]`) || null;

/**
 * A node as a shape: its painted background, its title's middle and font size,
 * and its interior: the preview's inner canvas, or a point at the middle of a
 * plain node, where the interior closes over in the node's own colour.
 */
function nodeShape(el) {
  const background = el?.querySelector('.node-background');
  const band = rectOf(background);
  if (!band) return null;
  const canvas = el.querySelector('[data-preview-canvas]');
  const titleBox = rectOf(el.querySelector('[data-node-title]'));
  return {
    band,
    // The node's own box, which its connections end on (its background is inset).
    outer: { x: band.x - NODE_BG_INSET, y: band.y - NODE_BG_INSET, w: band.w + 2 * NODE_BG_INSET, h: band.h + 2 * NODE_BG_INSET, r: band.r + NODE_BG_INSET },
    bandFill: background.getAttribute('fill'),
    interior: canvas ? rectOf(canvas) : { ...centerOf(band), w: 0, h: 0, r: 0 },
    interiorFill: canvas?.getAttribute('fill') || null,
    title: centerOf(titleBox || band),
    titleFont: parseFloat(el.querySelector('.node-name-text')?.style.fontSize) || null,
    titleLayout: nodeTitleLayout(el, titleBox),
  };
}

/**
 * A node's title as it wraps on the node: its lines, font size, line height and
 * colour. The label is HTML that the browser wraps at the width Node.jsx pins
 * (nodeLabelStyle.js wrapMaxWidth); the lines come from the same measurement
 * getNodeDimensions sized the node with.
 */
function nodeTitleLayout(el, titleBox) {
  const label = el.querySelector('.node-name-text');
  const text = label?.textContent?.trim();
  const fontSize = parseFloat(label?.style.fontSize);
  if (!text || !fontSize) return null;
  const container = el.querySelector('.node-name-container');
  const sidePadding = parseFloat(container?.style.paddingLeft) || parseFloat(getComputedStyle(container || label).paddingLeft) || 0;
  const maxWidth = parseFloat(label.style.maxWidth) || (titleBox ? titleBox.w - 2 * sidePadding : 0);
  let lines = [text];
  try {
    if (maxWidth > 0) lines = wrapTextToLines(text, maxWidth, `bold ${fontSize}px 'EmOne', sans-serif`);
  } catch { /* the text measurer isn't ready: one line */ }
  return {
    lines: lines.length ? lines : [text],
    fontSize,
    lineHeight: parseFloat(label.style.lineHeight) || fontSize,
    color: getComputedStyle(label).color,
  };
}

/** A thing group's shell as a shape. Its title and grid are copied, since folding unmounts them. */
function boxShape(groupId) {
  const root = scene();
  const shell = root?.querySelector(`.node-group-bg[data-group-id="${esc(groupId)}"]`);
  const bandEl = shell?.querySelector(':scope > rect');
  const interiorEl = shell?.querySelector('.node-group-interior');
  if (!bandEl || !interiorEl) return null;
  const titleGroup = root.querySelector(`.node-group-title[data-group-id="${esc(groupId)}"]`);
  const tab = rectOf(titleGroup?.querySelector('.group-label > rect'));
  const text = titleGroup?.querySelector('text');
  const band = rectOf(bandEl);
  const grid = shell.querySelector('.node-group-grid');
  return {
    band,
    bandFill: bandEl.getAttribute('fill'),
    interior: rectOf(interiorEl),
    interiorFill: interiorEl.getAttribute('fill'),
    gridFill: grid?.getAttribute('fill') || null,
    tab,
    title: tab ? centerOf(tab) : { x: band.x + band.w / 2, y: band.y },
    titleFont: parseFloat(text?.getAttribute('font-size')) || null,
    titleNode: text ? text.cloneNode(true) : null,
  };
}

/**
 * What a box shows in the view: its members, the groups inside it, the
 * connections wholly inside it, and those crossing its edge (drawn to the box's
 * node when it is closed).
 */
function boxContents(viewGraphId, groupId) {
  const state = useGraphStore.getState();
  const view = projectGraphView(state, viewGraphId);
  const group = view?.groups?.get(groupId);
  if (!group) return null;
  const anchorId = group.anchorInstanceId || null;
  const members = new Set(group.memberInstanceIds || []);
  const innerGroupIds = [];
  view.groups.forEach((other, id) => {
    if (id === groupId) return;
    const ids = other.memberInstanceIds || [];
    if (anchorId && ids.includes(anchorId)) return; // around the box, not inside it
    const inside = (other.anchorInstanceId && members.has(other.anchorInstanceId))
      || (ids.length > 0 && ids.every(id => members.has(id)));
    if (inside) innerGroupIds.push(id);
  });
  const { internal, crossing } = splitBoxConnections(state, viewGraphId, anchorId ? [...members, anchorId] : [...members], anchorId);
  return {
    anchorId,
    memberIds: [...members],
    innerGroupIds,
    internalEdgeIds: internal,
    crossing,
    edgeIds: [...internal, ...crossing.map(c => c.id)],
    offset: view.openView?.boxes?.get(anchorId)?.offset || null,
  };
}

function edgesTouching(state, viewGraphId, instanceIds) {
  const touching = new Set(instanceIds);
  const edges = viewEdges(state, viewGraphId);
  const view = projectGraphView(state, viewGraphId);
  return (view?.edgeIds || []).filter(id => {
    const edge = edges?.get(id);
    return !!edge && (touching.has(edge.sourceId) || touching.has(edge.destinationId));
  });
}

const selectorsFor = ({ instanceIds = [], groupIds = [], edgeIds = [] }) => [
  ...instanceIds.map(id => `[data-instance-id="${esc(id)}"]`),
  ...groupIds.map(id => `[data-group-id="${esc(id)}"]`),
  ...edgeIds.map(id => `[data-edge-id="${esc(id)}"]`),
];

// The box's inside, as drawn: what the stand-in carries. Its frame, title and
// crossing connections are drawn fresh.
const insideSelectors = (contents) => selectorsFor({
  instanceIds: contents.memberIds, groupIds: contents.innerGroupIds, edgeIds: contents.internalEdgeIds,
});

const ruleText = (selectors) => `${selectors.map(s => `[data-box-morph-scene] ${s}`).join(',\n')} { visibility: hidden !important; }`;

/** Hides the real elements until the stand-in hands over to them. */
function hideRule(selectors) {
  if (selectors.length === 0) return null;
  const style = document.createElement('style');
  style.setAttribute('data-box-morph', '');
  style.textContent = ruleText(selectors);
  document.head.appendChild(style);
  return style;
}

/**
 * Narrows a morph's hide rule, once it starts, to the connections its stand-in
 * actually draws: one it can't draw stays showing rather than vanishing.
 */
function hideOnly(morph, selectors) {
  if (!morph.hide) return;
  if (selectors.length === 0) { morph.hide.remove(); morph.hide = null; return; }
  morph.hide.textContent = ruleText(selectors);
}

// ─── Copies ───────────────────────────────────────────────────────────────────

const DATA_HOOKS = ['data-instance-id', 'data-edge-id', 'data-group-id', 'data-edge-main', 'data-preview-network', 'data-preview-canvas', 'data-node-title'];
const URL_ATTRS = ['clip-path', 'mask', 'fill', 'stroke', 'filter', 'marker-start', 'marker-mid', 'marker-end'];
let copyCount = 0;

/**
 * Makes a copy nothing else can find: the hide rules and the connection
 * transitions look elements up by their data attributes, and its clip paths and
 * masks get their own ids so it survives the original unmounting.
 */
function detach(copy) {
  copy.querySelectorAll('[data-edge-hit]').forEach(n => n.remove());
  const all = [copy, ...copy.querySelectorAll('*')];
  all.forEach(el => DATA_HOOKS.forEach(name => el.removeAttribute(name)));
  const tag = `bm${++copyCount}`;
  const renamed = new Map();
  copy.querySelectorAll('[id]').forEach(el => {
    renamed.set(el.id, `${el.id}-${tag}`);
    el.id = `${el.id}-${tag}`;
  });
  if (renamed.size > 0) {
    all.forEach(el => URL_ATTRS.forEach(name => {
      const match = /^url\(#(.+)\)$/.exec(el.getAttribute(name)?.trim() || '');
      if (match && renamed.has(match[1])) el.setAttribute(name, `url(#${renamed.get(match[1])})`);
    }));
  }
  return copy;
}

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

/** The real elements matching `selectors`, copied in paint order into one group. */
function copyElements(selectors) {
  const group = svg('g');
  const root = scene();
  if (!root || selectors.length === 0) return group;
  const selector = selectors.join(',');
  root.querySelectorAll(selector).forEach(el => {
    if (host.contains(el) || el.parentElement?.closest(selector)) return;
    group.appendChild(detach(el.cloneNode(true)));
  });
  return group;
}

const TRANSLATE = /translate\(\s*(-?[\d.e+-]+)[\s,]+(-?[\d.e+-]+)\s*\)/;
const SCALE = /scale\(\s*(-?[\d.e+-]+)/;

/**
 * The preview's drawing of the definition, and where it sits: a pose
 * `{ x, y, s }` meaning `translate(x, y) scale(s)` from definition coordinates.
 */
function copyPreviewNetwork(nodeEl) {
  const wrap = nodeEl.querySelector('[data-preview-network]');
  const drawing = wrap?.firstElementChild;
  const outer = TRANSLATE.exec(wrap?.getAttribute('transform') || '');
  const innerTransform = drawing?.getAttribute('transform') || '';
  const inner = TRANSLATE.exec(innerTransform);
  const scale = SCALE.exec(innerTransform);
  if (!outer || !inner || !scale) return null;
  const copy = detach(drawing.cloneNode(true));
  copy.removeAttribute('transform');
  const group = svg('g');
  group.appendChild(copy);
  return { node: group, pose: { x: +outer[1] + +inner[1], y: +outer[2] + +inner[2], s: +scale[1] } };
}

// ─── The stand-in ─────────────────────────────────────────────────────────────

const IDENTITY = Object.freeze({ x: 0, y: 0, s: 1 });

/** Content scaled down to nothing in the middle of the node, from where it fills the box. */
const seedPose = (boxInterior, nodeBand) => {
  const from = centerOf(boxInterior);
  const to = centerOf(nodeBand);
  return { x: to.x - from.x * SEED_SCALE, y: to.y - from.y * SEED_SCALE, s: SEED_SCALE };
};

const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
const mixFill = (a, b, t) => (isHex(a) && isHex(b) ? blendColors(a, b, t) : (t < 0.5 && a ? a : b));

function setRect(el, r) {
  el.setAttribute('x', r.x);
  el.setAttribute('y', r.y);
  el.setAttribute('width', Math.max(0, r.w));
  el.setAttribute('height', Math.max(0, r.h));
  el.setAttribute('rx', Math.max(0, r.r));
  el.setAttribute('ry', Math.max(0, r.r));
}

const lerpRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), r: lerp(a.r, b.r, t) });

/**
 * Builds the stand-in's parts, bottom to top: band, interior, grid, crossing
 * connections and their labels, content, title. Connections paint over
 * the band, as they do over a thing group's shell; nodes paint over them.
 */
function buildStandIn(morph) {
  const root = svg('g', { 'pointer-events': 'none' });
  const band = svg('rect');
  const interior = svg('rect');
  const edges = svg('g', { 'data-morph-part': 'connections' });
  const labels = svg('g', { 'data-morph-part': 'labels' });
  root.append(band, interior, edges, labels);
  morph.parts = { root, band, interior, edges, labels, grid: null, content: null, title: null };
  if (morph.content) setContent(morph, morph.content);
  host.appendChild(root);
}

/** The copy the stand-in carries: the preview's drawing, or the box's inside. */
function setContent(morph, content) {
  content.setAttribute('data-morph-part', 'content');
  morph.parts.content = content;
  morph.parts.root.appendChild(content);
}

/** The grid and the title, which only the box has: added once the box is known. */
function finishStandIn(morph) {
  const { box, parts } = morph;
  if (parts.finished) return;
  parts.finished = true;
  if (box.gridFill && box.gridFill !== 'none') {
    parts.grid = svg('rect', { fill: box.gridFill });
    parts.root.insertBefore(parts.grid, parts.edges);
  }
  if (box.titleNode) {
    box.titleNode.removeAttribute('transform');
    parts.title = svg('g');
    parts.title.appendChild(detach(box.titleNode));
    parts.root.appendChild(parts.title);
  }
}

/** The node's title, wrapped as the node wraps it, centred on (0, 0). */
function addNodeTitle(morph) {
  const layout = morph.node?.titleLayout;
  if (!layout || morph.parts.nodeTitle) return;
  const text = svg('text', {
    'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': 'EmOne, sans-serif',
    'font-weight': 'bold', 'font-size': layout.fontSize, fill: layout.color,
  });
  layout.lines.forEach((line, i) => {
    const tspan = svg('tspan', { x: 0, dy: i === 0 ? -((layout.lines.length - 1) / 2) * layout.lineHeight : layout.lineHeight });
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  const holder = svg('g', { opacity: 0 });
  holder.appendChild(text);
  morph.parts.nodeTitle = holder;
  morph.parts.root.appendChild(holder);
}

/**
 * How much the node's wrapping of the title shows, `q` of the way through the
 * morph's time: all of it at the start of an opening and the end of a fold, and
 * handed over within TITLE_REWRAP of either.
 */
function nodeTitleShare(morph, q) {
  const handed = easeInOutCubic(Math.max(0, Math.min(1, q / TITLE_REWRAP)));
  return morph.direction === 'open' ? 1 - handed : handed;
}

/**
 * Draws the stand-in `t` of the way from shape `a` (the node's side) to shape
 * `b` (the box's side), its content `t` of the way from pose `pa` to `pb`.
 * `nodeTitle` is how much the title shows as the node wraps it rather than as
 * the tab does.
 */
function paint(parts, a, b, t, pa, pb, nodeTitle = 0) {
  setRect(parts.band, lerpRect(a.band, b.band, t));
  parts.band.setAttribute('fill', mixFill(a.bandFill, b.bandFill, t));
  const interior = lerpRect(a.interior, b.interior, t);
  setRect(parts.interior, interior);
  parts.interior.setAttribute('fill', mixFill(a.interiorFill || a.bandFill, b.interiorFill || a.bandFill, t));
  if (parts.grid) {
    setRect(parts.grid, interior);
    parts.grid.setAttribute('opacity', t);
  }
  if (parts.content && pa && pb) {
    const p = poseAt(pa, pb, t);
    parts.content.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${p.s})`);
  }
  // The title, carried from the node's title to the tab and sized between them,
  // in whichever wrapping it has taken.
  const cx = lerp(a.title.x, b.title.x, t);
  const cy = lerp(a.title.y, b.title.y, t);
  const font = lerp(a.titleFont || b.titleFont || 1, b.titleFont || a.titleFont || 1, t);
  if (parts.title) {
    parts.title.setAttribute('transform', `translate(${cx} ${cy}) scale(${font / (b.titleFont || font)}) translate(${-b.title.x} ${-b.title.y})`);
    parts.title.setAttribute('opacity', parts.nodeTitle ? 1 - nodeTitle : 1);
  }
  if (parts.nodeTitle) {
    const own = a.titleLayout?.fontSize || font;
    parts.nodeTitle.setAttribute('transform', `translate(${cx} ${cy}) scale(${font / own})`);
    parts.nodeTitle.setAttribute('opacity', nodeTitle);
  }
}

const poseAt = (pa, pb, t) => ({ x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t), s: lerp(pa.s, pb.s, t) });

/** Where the crossing connections' moving ends are, `t` of the way from node to box. */
function connectionFrame(morph, t) {
  const { thingRect, box, pose } = morph;
  return {
    thingOuter: lerpRect(thingRect, box.band, t),
    thingPill: lerpRect(thingRect, box.tab || box.band, t),
    pose: pose.node && pose.box ? poseAt(pose.node, pose.box, t) : null,
    t,
  };
}

/** Draws a morph `t` of the way from its node (0) to its box (1), `q` of the way through its time. */
function draw(morph, t, q) {
  paint(morph.parts, morph.node, morph.box, t, morph.pose.node, morph.pose.box, nodeTitleShare(morph, q));
  if (morph.connections) drawConnections(morph.connections, connectionFrame(morph, t));
}

// ─── Running ──────────────────────────────────────────────────────────────────

function finish(morph) {
  if (morph.done) return;
  morph.done = true;
  cancelAnimationFrame(morph.raf);
  morph.hide?.remove();
  morph.parts?.root.remove();
  if (morphs.get(morph.key) === morph) morphs.delete(morph.key);
}

function cancel(key) {
  const running = morphs.get(key);
  if (running) finish(running);
}

/** Runs `frame(eased, q)` for `ms`, q being the plain share of the time elapsed. */
function run(morph, ms, frame, done) {
  const start = performance.now();
  frame(easeInOutCubic(0), 0);
  const tick = (now) => {
    if (morph.done) return;
    const q = Math.min(1, (now - start) / ms);
    frame(easeInOutCubic(q), q);
    if (q < 1) morph.raf = requestAnimationFrame(tick);
    else done();
  };
  morph.raf = requestAnimationFrame(tick);
}

/**
 * Hands over to the real elements. The stand-in fades out when it can; one
 * holding copies of real nodes (their titles are HTML in a foreignObject) is
 * just removed, since fading a group with a foreignObject inside misplaces it
 * on iOS WebKit, and at this point it matches what it covers.
 */
function reveal(morph) {
  morph.hide?.remove();
  morph.hide = null;
  // The stand-in's connections and labels now match the real ones underneath.
  const root = morph.parts.root;
  if (!root.querySelector('foreignObject') && root.animate) {
    const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REVEAL_MS, easing: 'ease-out', fill: 'forwards' });
    fade.onfinish = () => finish(morph);
  } else {
    finish(morph);
  }
}

/** Starts a queued morph once its far shape is in the DOM. */
function tryStart(morph, lastChance) {
  if (morph.direction === 'open') {
    const membersDrawn = morph.memberIds.length === 0 || morph.memberIds.some(id => nodeElement(id));
    if (!membersDrawn && !lastChance) return false;
    morph.box = boxShape(morph.groupId);
    if (!morph.box) return false;
    if (!morph.parts.content) {
      // No preview to carry in: the box's real inside, grown out of the node.
      setContent(morph, copyElements(morph.insideSelectors));
      morph.pose = { node: seedPose(morph.box.interior, morph.node.band), box: IDENTITY };
    }
  } else {
    morph.node = nodeShape(nodeElement(morph.survivorId));
    if (!morph.node) return false;
    morph.pose.node = seedPose(morph.box.interior, morph.node.band);
  }
  finishStandIn(morph);
  // The labels on the side just arrived at are drawn now, hidden, on the real
  // connections; the other side's were copied before the change.
  const arrivedLabels = copyLabels(scene(), (morph.crossing || []).map(c => c.id), detach);
  // The Thing as its connections see it when closed: the node's own box, which a
  // previewing node's card only covers (taken before opening, since its instance
  // moves under the box's title once open). A folded node is drawn as just that.
  morph.thingRect = morph.thingRect || morph.node.outer;
  morph.connections = prepareConnections({
    root: scene(), host, layer: morph.parts.edges, labelLayer: morph.parts.labels,
    viewGraphId: morph.viewGraphId, crossing: morph.crossing || [],
    innerRects: morph.innerRects || readInnerRects(scene(), morph.crossing || []),
    contentPose: morph.pose.box, tag: morph.tag,
    nodeLabels: morph.direction === 'open' ? morph.departedLabels : arrivedLabels,
    boxLabels: morph.direction === 'open' ? arrivedLabels : morph.departedLabels,
  });
  measureLabelAnchors(morph.connections, t => connectionFrame(morph, t));
  const drawnIds = morph.connections.items.map(item => item.id);
  hideOnly(morph, [...morph.hideBase, ...selectorsFor({ edgeIds: drawnIds })]);
  morph.playing = true;
  const [from, to, ms] = morph.direction === 'open' ? [0, 1, OPEN_MS] : [1, 0, CLOSE_MS];
  addNodeTitle(morph);
  run(morph, ms, (eased, q) => draw(morph, lerp(from, to, eased), q), () => reveal(morph));
  return true;
}

let retryScheduled = false;

/** Called by BoxMorphLayer after each of its commits, before paint. */
export function flushBoxMorphs() {
  let waiting = false;
  for (const morph of [...morphs.values()]) {
    if (morph.playing || morph.done) continue;
    if (tryStart(morph, morph.waited >= MAX_WAIT_FRAMES)) continue;
    if (++morph.waited > MAX_WAIT_FRAMES) finish(morph);
    else waiting = true;
  }
  if (waiting && !retryScheduled) {
    retryScheduled = true;
    requestAnimationFrame(() => { retryScheduled = false; flushBoxMorphs(); });
  }
}

// ─── Opening and folding ──────────────────────────────────────────────────────

/**
 * Opens a node into its box with a morph. `write` makes the store change and
 * returns the box's group id (or null); the morph starts from the node as it
 * was drawn just before.
 */
export function withBoxOpenMorph({ viewGraphId, instanceId }, write) {
  let start = null;
  if (canMorph()) {
    const viewed = projectGraphView(useGraphStore.getState(), viewGraphId)?.instances?.get(instanceId);
    const el = viewed && !viewed.isGroupAnchor ? nodeElement(instanceId) : null; // already open: nothing to morph
    const node = el ? nodeShape(el) : null;
    if (node) {
      // Its connections' labels as drawn now, to carry into the box.
      const labels = copyLabels(scene(), edgesTouching(useGraphStore.getState(), viewGraphId, [instanceId]), detach);
      start = { node, labels, thingRect: storeNodeRect(viewGraphId, instanceId), preview: copyPreviewNetwork(el) };
    }
  }
  const groupId = write();
  if (start && groupId) {
    try { queueOpen(start, viewGraphId, instanceId, groupId); } catch (err) { console.warn('[boxMorph] open skipped:', err); }
  }
  return groupId;
}

function queueOpen(start, viewGraphId, instanceId, groupId) {
  const contents = boxContents(viewGraphId, groupId);
  if (!contents) return;
  cancel(instanceId);
  const inside = insideSelectors(contents);
  const hideBase = [...inside, ...selectorsFor({ instanceIds: [contents.anchorId || instanceId], groupIds: [groupId] })];
  const morph = {
    key: instanceId, direction: 'open', viewGraphId, groupId, node: start.node, box: null, tag: `bm${++copyCount}`,
    crossing: contents.crossing, departedLabels: start.labels, thingRect: start.thingRect,
    memberIds: contents.memberIds, insideSelectors: inside, waited: 0, pose: { node: null, box: null }, content: null,
    hideBase,
    hide: hideRule([...hideBase, ...selectorsFor({ edgeIds: contents.crossing.map(c => c.id) })]),
  };
  // The preview's drawing of the definition, carried from its fitted pose to 1:1.
  // A copy-style group has no box offset; it grows its copies out of the node instead.
  if (start.preview && contents.offset) {
    morph.content = start.preview.node;
    morph.pose = { node: start.preview.pose, box: { ...contents.offset, s: 1 } };
  }
  // Until the box is in the DOM, the stand-in holds the node as it was.
  buildStandIn(morph);
  paint(morph.parts, morph.node, morph.node, 0, morph.pose.node, morph.pose.node);
  morphs.set(morph.key, morph);
  bump();
}

/**
 * Folds a box back into its node with a morph. `write` makes the store change
 * and returns the node's instance id (or null).
 */
export function withBoxCloseMorph({ viewGraphId, groupId }, write) {
  let start = null;
  if (canMorph()) {
    const contents = boxContents(viewGraphId, groupId);
    const box = contents ? boxShape(groupId) : null;
    if (box) {
      start = {
        contents, box,
        content: copyElements(insideSelectors(contents)),
        innerRects: readInnerRects(scene(), contents.crossing),
        labels: copyLabels(scene(), contents.crossing.map(c => c.id), detach),
      };
    }
  }
  const survivorId = write();
  if (start && survivorId) {
    try { queueClose(start, viewGraphId, survivorId); } catch (err) { console.warn('[boxMorph] close skipped:', err); }
  }
  return survivorId;
}

function queueClose(start, viewGraphId, survivorId) {
  const { contents, box, content, innerRects, labels } = start;
  cancel(contents.anchorId || survivorId);
  cancel(survivorId);
  const hideBase = selectorsFor({ instanceIds: [survivorId] });
  const morph = {
    key: survivorId, direction: 'close', viewGraphId, survivorId, box, node: null, tag: `bm${++copyCount}`,
    crossing: contents.crossing, innerRects, departedLabels: labels,
    waited: 0, content, pose: { node: null, box: IDENTITY },
    hideBase,
    hide: hideRule([...hideBase, ...selectorsFor({ edgeIds: edgesTouching(useGraphStore.getState(), viewGraphId, [survivorId]) })]),
  };
  // Until the node is in the DOM, the stand-in holds the box as it was.
  buildStandIn(morph);
  finishStandIn(morph);
  paint(morph.parts, box, box, 1, IDENTITY, IDENTITY);
  morphs.set(morph.key, morph);
  bump();
}
