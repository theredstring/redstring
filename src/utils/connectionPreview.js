/**
 * Shared recipe for the "node preview" representations that render through
 * UniversalNodeRenderer outside the canvas: the connection control panel, the
 * hover vision aid, the right panel's Connections list, and the control panel's
 * node / node-group previews.
 *
 * All of them draw the same picture (a node, or subject —predicate→ object) and
 * must read as the same node the canvas draws. Before this module the recipe was
 * copy-pasted (the control panel's comments literally said "matching
 * HoverVisionAid" and "Use EXACT same logic as ConnectionBrowser") and the panel
 * list had drifted off it entirely.
 *
 * THE ONE RULE — text size is fixed, space pressure goes into truncation.
 *
 * Every preview used to build canvas-sized boxes and then let the renderer
 * fit-scale the whole drawing into whatever container it had been given, so the
 * font a name drew at was a by-product of how much room the row happened to
 * have: 32px in a wide desktop panel, 13px on a phone, and the connection label
 * shrinking with it. Big boxes, unreadable text. Now each preview picks a target
 * on-screen font (PREVIEW_TEXT), derives the renderer scale from it, and sizes
 * its container so the renderer lands on exactly that scale. When a row does not
 * fit, the gaps give first, then the longest names are truncated with an
 * ellipsis — the font never moves.
 */
import { getNodeDimensions } from '../utils.js';
import { NODE_HEIGHT } from '../constants.js';
import { measureTextWidth } from '../services/textMeasurement.js';
import { CONNECTION_LABEL_BASE_FONT_SIZE } from '../UniversalNodeRenderer.presets.js';

// Neutral text settings so previews render at a "standard" size regardless of
// the user's global font/node-size/connection sliders.
export const STANDARD_TEXT_SETTINGS = { fontSize: 1, lineSpacing: 1, nodeScale: 1, connectionWidth: 1 };

// getNodeDimensions inflates node geometry by 1.4× globally (utils.js, for the
// bigger canvas nodes). The previews want the pre-resizable (0.8.2) box size, so
// divide that factor back out before feeding boxes to the renderer.
export const LEGACY_DIM_SCALE = 1 / 1.4;

/**
 * The font UniversalNodeRenderer draws a (non-group) node name at in its 'full'
 * context when its fit scale is 1 — see baseFontSize there. The renderer
 * multiplies every measurement (font, padding, corner radius, stroke) by that one
 * scale, so choosing a scale is choosing the on-screen font, and vice versa.
 */
export const PREVIEW_NODE_BASE_FONT_PX = 32;
// The rest of the renderer's single-line text model at scale 1, from the same
// place: side padding either side of the name, and the average character width
// it uses to decide whether a multi-word name wraps. A truncated name has to be
// measured against THIS box, not the canvas's — getNodeDimensions pads a name
// at the canvas's 42px a side, so measuring a candidate through it declared a
// name too long for a box that in fact had room for two more letters.
const PREVIEW_NODE_SIDE_PADDING = 22;
const PREVIEW_NODE_AVG_CHAR_WIDTH = 16;
// Air between a measured name and the padding, so a glyph-advance difference
// between the measurer and the browser never turns into a wrapped tail.
const PREVIEW_NAME_SLACK = 4;
const previewNameFont = `bold ${PREVIEW_NODE_BASE_FONT_PX}px 'EmOne', sans-serif`;

/**
 * On-screen text targets, in CSS px, per platform. The whole point of this
 * module: these are the sizes a name and a connection label draw at in every
 * preview, full stop. A row that cannot fit at these sizes truncates.
 *
 * desktop/mobile: the bottom control panel and the right panel's Connections
 * list. Sized against the controls around them — the pie-menu bubbles are
 * 42–52px on desktop and 46px on mobile, and a node box at these targets comes
 * out at 47px / 42px tall, so the row reads as one strip of controls.
 *
 * hover: the hover vision aid, whose job is to make a zoomed-out canvas legible,
 * so it sits a step above the panels. Applied AFTER the aid's own CSS transform
 * (its size slider), i.e. these are what the user sees at the slider's 1×.
 */
export const PREVIEW_TEXT = {
  desktop: { nodeFontPx: 18, labelFontPx: 15 },
  mobile: { nodeFontPx: 16, labelFontPx: 14 },
  hover: { nodeFontPx: 22, labelFontPx: 18 }
};

/** The panel/list targets for the current platform. */
export const previewTextFor = (isMobile) => (isMobile ? PREVIEW_TEXT.mobile : PREVIEW_TEXT.desktop);

/** Renderer scale that draws node names at `text.nodeFontPx`. */
export const previewScaleFor = (text) => text.nodeFontPx / PREVIEW_NODE_BASE_FONT_PX;

/**
 * The renderer's `connectionFontScale` that draws labels at `text.labelFontPx`
 * once it is running at `scale` — it multiplies its base label font by the fit
 * scale first and this second, so divide the scale back out.
 */
export const labelFontScaleFor = (text, scale) =>
  text.labelFontPx / (CONNECTION_LABEL_BASE_FONT_SIZE * Math.max(scale, 0.01));

/**
 * Node-box floor, in natural (pre-scale) units. Without a floor,
 * getNodeDimensions returns compact boxes for short names → a lone "Cat" is a
 * stub — and a height under ~88px makes the corner radius cap at height/2 (a
 * full pill instead of a rounded rectangle).
 *
 * `height` is also the height of every single-line box, not only a floor: the
 * canvas box is 100 natural for one line of text, which at the preview scale
 * is a strip taller than the controls beside it. 84 holds a 32px line with the
 * renderer's padding and lands at 47px on desktop / 42px on mobile, level with
 * the pie-menu bubbles. A name that wraps (a single very long word) grows from
 * there by what the canvas would add.
 *
 * One floor for every preview. There used to be three, but they were
 * compensating for the different fit scales each consumer happened to land on;
 * with the scale fixed per platform the same floor draws the same box everywhere
 * (73×47 on desktop, 65×42 on mobile).
 *
 * cornerRadius is kept below height/2 so the boxes stay rounded rectangles
 * rather than collapsing into pills — at ~0.48 of the floor height, a touch
 * softer than the canvas node's own ratio, which reads better at these sizes.
 */
export const PREVIEW_FLOOR = { width: 130, height: 84, cornerRadius: 40 };

/**
 * A copy of `node` with every image-bearing field dropped.
 *
 * A preview exists to make a node's NAME legible, and an image is the one thing
 * that stops it doing that twice over: getNodeDimensions widens the box to the
 * expanded width and grows it by the image's own aspect, and
 * UniversalNodeRenderer replaces the label with the image outright. So a preview
 * of an image node came out as a bare picture, sized by the picture, saying
 * nothing the canvas was not already saying — and saying it at whatever height
 * a tall photograph asked for. Stripping the image makes the preview the text
 * box the node would be if it had never had one.
 *
 * Own enumerable properties only, which also sheds the getters on a `Node`
 * instance (getThumbnailSrc and friends) that getNodeDimensions prefers.
 */
export function withoutImage(node) {
  if (!node) return node;
  const {
    thumbnailSrc, imageSrc, imageAspectRatio, imageLoading, imageMissing, ...rest
  } = node;
  return rest;
}

/**
 * Box a name gets under the canvas recipe, at preview (pre-1.4×) scale. The
 * canvas gives one line of text a 100-high box; previews take the floor height
 * for that line and only grow past it by what the canvas would add for more.
 */
function previewBox(node, name, floors) {
  const dims = getNodeDimensions({ ...node, name }, false, null, 39, STANDARD_TEXT_SETTINGS);
  const naturalHeight = dims.currentHeight * LEGACY_DIM_SCALE;
  return {
    width: Math.max(dims.currentWidth * LEGACY_DIM_SCALE, floors.width),
    height: Math.max(floors.height, naturalHeight - (NODE_HEIGHT - floors.height))
  };
}

/**
 * Whether the renderer draws `name` on one line inside a box `width` wide: it
 * fits between the side padding by measurement, and — for a multi-word name —
 * by the character count the renderer's wrap heuristic uses.
 */
function nameFitsBox(name, width) {
  const room = width - 2 * PREVIEW_NODE_SIDE_PADDING;
  if (measureTextWidth(name, previewNameFont) + PREVIEW_NAME_SLACK > room) return false;
  const words = name.trim().split(/\s+/);
  return words.length <= 1 || name.length <= Math.floor(room / PREVIEW_NODE_AVG_CHAR_WIDTH);
}

/**
 * Longest prefix of `name` (plus an ellipsis) the renderer can draw on one line
 * in a box `maxWidth` wide.
 *
 * getNodeDimensions grows a text node's box up to 420px (preview scale) to fit
 * the name, so two long names alone can exceed a row's budget. Trimming the name
 * keeps the boxes inside that budget so nothing has to shrink.
 */
function truncateNameToWidth(name, maxWidth) {
  const ellipsis = '…';
  let lo = 0;
  let hi = name.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = name.slice(0, mid).trimEnd() + ellipsis;
    if (nameFitsBox(candidate, maxWidth)) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? name.slice(0, lo).trimEnd() + ellipsis : ellipsis;
}

/**
 * Size a set of preview nodes the way the canvas sizes them: measure the name at
 * the canvas font via getNodeDimensions, divide out the 1.4× inflation, then
 * floor.
 *
 * x/y are pinned to 0 so the renderer takes the explicit-box branch rather than
 * looking the id up in the active graph's instances (preview ids are often real
 * instance ids, and we never want live canvas geometry leaking into a preview).
 * Layout position is assigned by the renderer's horizontal-align pass anyway.
 *
 * @param {Array<object>} nodes - node-ish objects ({ id, name, color, ... })
 * @param {{width:number,height:number}} [floors] - defaults to PREVIEW_FLOOR
 * @param {{maxWidth?:number}} [options] - maxWidth (natural units) truncates
 *   names whose box would exceed it. A truncated name gets the widest box the
 *   cap allows, measured the way the renderer will draw it — a name the canvas
 *   recipe would pad wider than the cap can still fit the cap's box whole.
 * @returns {Array<object>} nodes with x/y/width/height set
 */
export function buildConnectionPreviewNodes(nodes, floors = PREVIEW_FLOOR, { maxWidth } = {}) {
  // The floor is the narrowest box the recipe can produce, so a cap below it is
  // unsatisfiable — clamp rather than truncate a name down to nothing.
  const cap = maxWidth != null ? Math.max(maxWidth, floors.width) : Infinity;
  return nodes.map((node) => {
    const natural = previewBox(node, node.name, floors);
    if (natural.width <= cap) {
      return { ...node, x: 0, y: 0, ...natural };
    }
    const name = nameFitsBox(node.name, cap) ? node.name : truncateNameToWidth(node.name, cap);
    return { ...node, name, x: 0, y: 0, width: cap, height: floors.height };
  });
}

/**
 * The UniversalNodeRenderer props every preview representation shares. Spread
 * this after a RENDERER_PRESETS entry and before any per-consumer overrides.
 *
 * @param {{cornerRadius:number}} [floors] - defaults to PREVIEW_FLOOR
 */
export function connectionPreviewRendererProps(floors = PREVIEW_FLOOR) {
  return {
    renderContext: 'full',
    ignoreGlobalScale: true,
    cornerRadiusMultiplier: floors.cornerRadius
  };
}

/**
 * Lay out one or more node chips (no connections) at the fixed preview scale —
 * the control panel's node / node-group preview and the hover aid's node.
 *
 * Chips are packed greedily into rows no wider than `maxRowWidth`, each row
 * centred, and the container is sized to the result so the renderer's fit
 * lands on exactly the target scale. A chip wider than `maxChipWidth` (or the
 * row) has its name truncated rather than the row scaled. Only when the rows
 * stack taller than `maxHeight` — a very large multi-select — does the scale
 * give, because at that point the alternative is a panel taller than the
 * screen.
 *
 * @param {object} params
 * @param {Array<object>} params.nodes - node-ish objects, in order
 * @param {{nodeFontPx:number}} params.text - a PREVIEW_TEXT entry
 * @param {number} params.maxRowWidth - on-screen px a row may take, container edge to edge
 * @param {number} [params.maxHeight] - on-screen px the container may take
 * @param {number} [params.padding] - renderer padding prop
 * @param {number} [params.columnGap] - on-screen px between chips in a row
 * @param {number} [params.rowGap] - on-screen px between rows
 * @param {number} [params.maxChipWidth] - on-screen px a single chip may take
 * @param {{width:number,height:number}} [params.floors]
 * @returns {{nodes:Array<object>, containerWidth:number, containerHeight:number, scale:number}}
 *   nodes positioned in natural units for the renderer's explicit-box branch
 */
export function layoutNodeChips({
  nodes,
  text,
  maxRowWidth,
  maxHeight = Infinity,
  padding = 8,
  columnGap = 12,
  rowGap = 10,
  maxChipWidth = Infinity,
  floors = PREVIEW_FLOOR
}) {
  const scale = previewScaleFor(text);
  const available = Math.max(floors.width * scale, maxRowWidth - padding * 2);
  const chipCap = Math.min(available, maxChipWidth);
  const sized = buildConnectionPreviewNodes(nodes, floors, { maxWidth: chipCap / scale });

  // Pack in natural units; the gaps are on-screen sizes, so convert them.
  const gapN = columnGap / scale;
  const rowGapN = rowGap / scale;
  const rows = [];
  let row = [];
  let rowWidth = 0;
  sized.forEach((node) => {
    const nextWidth = row.length ? rowWidth + gapN + node.width : node.width;
    if (row.length && nextWidth * scale > available) {
      rows.push({ nodes: row, width: rowWidth });
      row = [node];
      rowWidth = node.width;
    } else {
      row.push(node);
      rowWidth = nextWidth;
    }
  });
  if (row.length) rows.push({ nodes: row, width: rowWidth });

  const boundingWidth = Math.max(1, ...rows.map(r => r.width));
  const positioned = [];
  let y = 0;
  rows.forEach((r, rowIndex) => {
    const rowHeight = Math.max(...r.nodes.map(n => n.height));
    let x = (boundingWidth - r.width) / 2;
    r.nodes.forEach((node) => {
      positioned.push({ ...node, x, y: y + (rowHeight - node.height) / 2 });
      x += node.width + gapN;
    });
    y += rowHeight + (rowIndex < rows.length - 1 ? rowGapN : 0);
  });
  const boundingHeight = Math.max(1, y);

  // The renderer's plain fit is min(width ratio, height ratio), so a container
  // that is exactly the bounding box at the target scale pins it there. The
  // height clamp is the one place the scale is allowed to drop.
  const containerWidth = Math.ceil(boundingWidth * scale + padding * 2);
  const naturalHeight = Math.ceil(boundingHeight * scale + padding * 2);
  const containerHeight = Math.min(naturalHeight, maxHeight);
  const effectiveScale = containerHeight < naturalHeight
    ? (containerHeight - padding * 2) / boundingHeight
    : scale;

  return { nodes: positioned, containerWidth, containerHeight, scale: effectiveScale };
}
