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
 */
import useGraphStore from '../../../store/graphStore.js';
import { projectGraphView, viewEdges } from '../../../core/openDefinitions.js';
import { blendColors } from '../../../utils/colorUtils.js';
import { prefersReducedMotion } from '../edges/edgeTransitions.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OPEN_MS = 380;
const CLOSE_MS = 320;
const REVEAL_MS = 140;
// A plain node's content starts (or ends) this small, at the node's middle.
const SEED_SCALE = 0.04;
// Frames to wait for the far shape to reach the DOM. The shell lands in the
// commit that opens the box; its members can follow a frame or two later (the
// visible set is culled separately). Past this, an open box starts without
// them, and a fold whose node never arrived is dropped.
const MAX_WAIT_FRAMES = 12;

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
    bandFill: background.getAttribute('fill'),
    interior: canvas ? rectOf(canvas) : { ...centerOf(band), w: 0, h: 0, r: 0 },
    interiorFill: canvas?.getAttribute('fill') || null,
    title: centerOf(titleBox || band),
    titleFont: parseFloat(el.querySelector('.node-name-text')?.style.fontSize) || null,
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
    title: tab ? centerOf(tab) : { x: band.x + band.w / 2, y: band.y },
    titleFont: parseFloat(text?.getAttribute('font-size')) || null,
    titleNode: text ? text.cloneNode(true) : null,
  };
}

/**
 * What a box shows in the view: its members, the groups inside it, and every
 * connection touching either (drawn to the box's node when it is closed).
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
  return {
    anchorId,
    memberIds: [...members],
    innerGroupIds,
    edgeIds: edgesTouching(state, viewGraphId, anchorId ? [...members, anchorId] : [...members]),
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

// The box's inside, as drawn: what the stand-in carries (its frame and title are drawn fresh).
const insideSelectors = (contents) => selectorsFor({
  instanceIds: contents.memberIds, groupIds: contents.innerGroupIds, edgeIds: contents.edgeIds,
});

/** Hides the real elements until the stand-in hands over to them. */
function hideRule(selectors) {
  if (selectors.length === 0) return null;
  const style = document.createElement('style');
  style.setAttribute('data-box-morph', '');
  style.textContent = `${selectors.map(s => `[data-box-morph-scene] ${s}`).join(',\n')} { visibility: hidden !important; }`;
  document.head.appendChild(style);
  return style;
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

/** Builds the stand-in's parts: band, interior, grid, content, title, bottom to top. */
function buildStandIn(morph) {
  const root = svg('g', { 'pointer-events': 'none' });
  const band = svg('rect');
  const interior = svg('rect');
  root.append(band, interior);
  morph.parts = { root, band, interior, grid: null, content: null, title: null };
  if (morph.content) {
    morph.parts.content = morph.content;
    root.appendChild(morph.content);
  }
  host.appendChild(root);
}

/** The grid and the title, which only the box has: added once the box is known. */
function finishStandIn(morph) {
  const { box, parts } = morph;
  if (parts.finished) return;
  parts.finished = true;
  if (box.gridFill && box.gridFill !== 'none') {
    parts.grid = svg('rect', { fill: box.gridFill });
    parts.root.insertBefore(parts.grid, parts.content || null);
  }
  if (box.titleNode) {
    box.titleNode.removeAttribute('transform');
    parts.title = svg('g');
    parts.title.appendChild(detach(box.titleNode));
    parts.root.appendChild(parts.title);
  }
}

/**
 * Draws the stand-in `t` of the way from shape `a` (the node's side) to shape
 * `b` (the box's side), its content `t` of the way from pose `pa` to `pb`.
 */
function paint(parts, a, b, t, pa, pb) {
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
    const x = lerp(pa.x, pb.x, t), y = lerp(pa.y, pb.y, t), s = lerp(pa.s, pb.s, t);
    parts.content.setAttribute('transform', `translate(${x} ${y}) scale(${s})`);
  }
  if (parts.title) {
    // The tab's text, carried from the node's title to the tab and grown to the tab's size.
    const k = lerp(a.titleFont && b.titleFont ? a.titleFont / b.titleFont : 1, 1, t);
    const cx = lerp(a.title.x, b.title.x, t);
    const cy = lerp(a.title.y, b.title.y, t);
    parts.title.setAttribute('transform', `translate(${cx} ${cy}) scale(${k}) translate(${-b.title.x} ${-b.title.y})`);
  }
}

/** Draws a morph `t` of the way from its node (0) to its box (1). */
const draw = (morph, t) => paint(morph.parts, morph.node, morph.box, t, morph.pose.node, morph.pose.box);

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

function run(morph, ms, frame, done) {
  const start = performance.now();
  frame(easeInOutCubic(0));
  const tick = (now) => {
    if (morph.done) return;
    const q = Math.min(1, (now - start) / ms);
    frame(easeInOutCubic(q));
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
      morph.parts.content = copyElements(morph.insideSelectors);
      morph.parts.root.appendChild(morph.parts.content);
      morph.pose = { node: seedPose(morph.box.interior, morph.node.band), box: IDENTITY };
    }
  } else {
    morph.node = nodeShape(nodeElement(morph.survivorId));
    if (!morph.node) return false;
    morph.pose.node = seedPose(morph.box.interior, morph.node.band);
  }
  finishStandIn(morph);
  morph.playing = true;
  const [from, to, ms] = morph.direction === 'open' ? [0, 1, OPEN_MS] : [1, 0, CLOSE_MS];
  run(morph, ms, q => draw(morph, lerp(from, to, q)), () => reveal(morph));
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
    if (node) start = { node, preview: copyPreviewNetwork(el) };
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
  const morph = {
    key: instanceId, direction: 'open', groupId, node: start.node, box: null,
    memberIds: contents.memberIds, insideSelectors: inside, waited: 0, pose: { node: null, box: null }, content: null,
    hide: hideRule([...inside, ...selectorsFor({ instanceIds: [contents.anchorId || instanceId], groupIds: [groupId] })]),
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
    if (box) start = { contents, box, content: copyElements(insideSelectors(contents)) };
  }
  const survivorId = write();
  if (start && survivorId) {
    try { queueClose(start, viewGraphId, survivorId); } catch (err) { console.warn('[boxMorph] close skipped:', err); }
  }
  return survivorId;
}

function queueClose(start, viewGraphId, survivorId) {
  const { contents, box, content } = start;
  cancel(contents.anchorId || survivorId);
  cancel(survivorId);
  const morph = {
    key: survivorId, direction: 'close', survivorId, box, node: null,
    waited: 0, content, pose: { node: null, box: IDENTITY },
    hide: hideRule(selectorsFor({
      instanceIds: [survivorId],
      edgeIds: edgesTouching(useGraphStore.getState(), viewGraphId, [survivorId]),
    })),
  };
  // Until the node is in the DOM, the stand-in holds the box as it was.
  buildStandIn(morph);
  finishStandIn(morph);
  paint(morph.parts, box, box, 1, IDENTITY, IDENTITY);
  morphs.set(morph.key, morph);
  bump();
}
