/**
 * Width budgeting for a row of connection-preview nodes — the canvas bottom
 * control panel, the hover vision aid, and the right panel's Connections list.
 *
 * All three draw the same picture (node —label→ node, sometimes a longer chain)
 * at the fixed text sizes in connectionPreview.js's PREVIEW_TEXT, and this is
 * where that promise is kept. The renderer is handed a container it cannot
 * scale below the target, and the row is made to fit that container in a fixed
 * order of concessions:
 *
 *   1. The gaps between boxes grow to hold the label with air around it, up to
 *      GAP_MAX_PX. A wide row spends its slack on the connection, since that is
 *      what these views exist to show.
 *   2. Under pressure the air goes first: the gaps shrink to exactly what the
 *      label's widest line needs between the arrowheads.
 *   3. Then the widest boxes are capped (water-filling, so a short name keeps
 *      its whole box while a long one is truncated with an ellipsis) — down to
 *      the floor box, with the label still whole. A predicate is the subject
 *      of the row and is nearly always the shortest thing in it; a name can
 *      lose its tail and still be recognised.
 *   4. Only then does the gap give below the label, down to a floor that still
 *      clears the arrowheads and shows some of the label, which is clipped to
 *      the span it actually got.
 *   5. Only if the floor boxes and floor gaps still do not fit — many nodes on a
 *      phone — does the scale itself drop, as a last resort.
 *
 * The renderer takes the result verbatim via `horizontalSpacing` and
 * `maxNodeScale` rather than re-negotiating it.
 */
import {
  PREVIEW_FLOOR,
  PREVIEW_TEXT,
  buildConnectionPreviewNodes,
  previewScaleFor,
  labelFontScaleFor
} from './connectionPreview.js';
import { wrapConnectionLabel, RENDERER_PRESETS } from '../UniversalNodeRenderer.presets.js';
import { measureTextWidth } from '../services/textMeasurement.js';
import { CONNECTION_WIDTH_BASE_SCALE } from '../constants.js';

export const PANEL_RENDERER_PADDING = 10;

// How far an arrowhead reaches into the gap, in on-screen px. The renderer
// draws it as a polygon 26·arrowScale long past the node edge, where arrowScale
// follows the stroke width and the stroke width follows the average box size
// (see adaptiveStrokeWidth and arrowScale in UniversalNodeRenderer) — so it is
// derived here from the same boxes rather than guessed, or the label lands on
// the arrow. Plus a little air on each side of the label.
const ARROWHEAD_REACH_PER_SCALE = 26;
const LABEL_END_CLEARANCE = 6;
const arrowheadReach = (boxes) => {
  if (!boxes.length) return 0;
  const avgNodeSize = boxes.reduce((sum, b) => sum + (b.width + b.height) / 2, 0) / boxes.length;
  const strokeMultiplier = Math.max(0.02, Math.min(0.08, avgNodeSize / 1000));
  const strokeScale = RENDERER_PRESETS.CONNECTION_PANEL.connectionStrokeScale * CONNECTION_WIDTH_BASE_SCALE;
  const strokeWidth = Math.max(1.5, avgNodeSize * strokeMultiplier * strokeScale);
  const arrowScale = Math.min(4, Math.max(0.5, strokeWidth / 6));
  return ARROWHEAD_REACH_PER_SCALE * arrowScale;
};
// The least label room a gap may shrink to (on screen, between the arrowheads)
// before the boxes start giving instead — enough for a word or a clipped one.
const GAP_MIN_LABEL_PX = 56;
// Air around the label when the row has room to give it, in total across both
// sides. This is what makes the connection read as a length of line with a
// label on it rather than a label wedged between two boxes; the label alone
// (GAP_MIN_LABEL_PX) is the floor, not the look.
const GAP_LABEL_AIR_PX = 40;
// A gap never grows past this however wide the row is: beyond it the two nodes
// stop reading as connected.
const GAP_MAX_PX = 280;
// The renderer stacks a wrapped label's lines at max(fontSize * 1.1, 26 * scale)
// — see ConnectionText in UniversalNodeRenderer.jsx. At the label sizes in
// PREVIEW_TEXT the first term wins, so line height is 1.1× the drawn font.
const LABEL_LINE_HEIGHT_RATIO = 1.1;
// Last-resort floor for the scale (step 5 above).
const MIN_SCALE = 0.3;

const labelFont = (px) => `bold ${px}px 'EmOne', sans-serif`;

/** Widest line the renderer's wrap produces for this label at this font. */
export const widestLabelLine = (text, fontString) =>
  wrapConnectionLabel(text).reduce(
    (max, line) => Math.max(max, measureTextWidth(line, fontString)),
    0
  );

const clipToWidth = (text, fontString, maxWidth) => {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureTextWidth(text.slice(0, mid) + '…', fontString) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '…';
};

/**
 * Trim a label until every line the renderer wraps it into fits the span.
 *
 * The renderer wraps on a character count, not on width, so it will happily pack
 * two clipped words onto one over-wide line — every candidate has to be measured
 * back through the same wrap rather than reasoned about.
 */
const fitLabelToSpan = (text, fontString, maxWidth) => {
  if (maxWidth <= 0 || widestLabelLine(text, fontString) <= maxWidth) return text;

  // Clip any single word that alone overruns the span...
  const words = String(text).split(/\s+/).filter(Boolean)
    .map(word => measureTextWidth(word, fontString) > maxWidth
      ? clipToWidth(word, fontString, maxWidth)
      : word);
  if (words.length === 0) return text;

  const withEllipsis = (ws) => [
    ...ws.slice(0, -1),
    ws[ws.length - 1].replace(/…$/, '') + '…'
  ].join(' ');

  // ...then drop words from the end until the wrapped block fits.
  let candidate = withEllipsis(words);
  while (words.length > 1 && widestLabelLine(candidate, fontString) > maxWidth) {
    words.pop();
    candidate = withEllipsis(words);
  }
  return candidate;
};

/**
 * Uniform cap `c` such that Σ min(w, c) fits `budget`. Boxes narrower than the
 * cap keep their width and donate the difference to the wider ones.
 */
const waterFillCap = (widths, budget) => {
  const sorted = [...widths].sort((a, b) => a - b);
  let remaining = budget;
  for (let i = 0; i < sorted.length; i += 1) {
    const share = remaining / (sorted.length - i);
    if (sorted[i] > share) return share;
    remaining -= sorted[i];
  }
  return Infinity;
};

/**
 * Divide a row between its node boxes and the gaps between them, at the fixed
 * preview scale for `text`.
 *
 * @param {object} params
 * @param {Array<{id:string,name:string,color:string}>} params.nodes - in row order
 * @param {string[]} params.labels - connection names competing for the gaps
 * @param {number} params.maxWidth - on-screen px the container may take, edge to edge
 * @param {{nodeFontPx:number,labelFontPx:number}} params.text - a PREVIEW_TEXT entry
 * @param {number} [params.padding] - the renderer's padding prop
 * @param {{width:number,height:number}} [params.floors]
 * @param {string[]} [params.duplicateNodeIds] - nodes the renderer will draw a
 *   second copy of, which is how it lays out a self-loop
 * @param {boolean} [params.hasArrows] - whether either end draws an arrowhead
 * @returns {{
 *   nodes: Array<object>, labels: string[], spacing: number, scale: number,
 *   labelFontScale: number, containerWidth: number, containerHeight: number
 * }} nodes in natural units with names already truncated; spacing (on screen)
 *   for the renderer's `horizontalSpacing`; scale for its `maxNodeScale`; the
 *   label font scale for `connectionFontScale`; and the container that pins the
 *   renderer to that scale (containerWidth ≤ maxWidth).
 */
export function layoutConnectionRow({
  nodes: sourceNodes,
  labels,
  maxWidth,
  text = PREVIEW_TEXT.desktop,
  padding = 6,
  floors = PREVIEW_FLOOR,
  duplicateNodeIds = [],
  hasArrows = true
}) {
  const boxCount = Math.max(1, sourceNodes.length + duplicateNodeIds.length);
  const gaps = Math.max(0, boxCount - 1);
  const available = Math.max(1, maxWidth - padding * 2);

  // Everything below is in on-screen px unless it says "natural".
  // The arrowhead is sized from the boxes the row will draw. The uncapped boxes
  // at the target scale are the widest the row can end up with, and a wider box
  // means a thicker stroke and a bigger arrowhead, so this errs on the roomy
  // side once names are truncated.
  const targetScale = previewScaleFor(text);
  const naturalNodes = buildConnectionPreviewNodes(sourceNodes, floors);
  const naturalById = new Map(naturalNodes.map(n => [n.id, n]));
  const boxesForArrow = [
    ...naturalNodes,
    ...duplicateNodeIds.map(id => naturalById.get(id) ?? { width: floors.width, height: floors.height })
  ].map(n => ({ width: n.width * targetScale, height: n.height * targetScale }));
  const arrowReach = hasArrows ? arrowheadReach(boxesForArrow) : 0;
  const tipRoom = (scale) => arrowReach * (scale / targetScale) + LABEL_END_CLEARANCE;
  const gapMin = (scale) => 2 * tipRoom(scale) + GAP_MIN_LABEL_PX;

  // Step 5 first, because it decides the scale everything else is measured at:
  // if even floor-width boxes with floor gaps overrun the row, the target
  // cannot be honoured and the scale drops just far enough.
  let scale = targetScale;
  const floorsWidth = boxCount * floors.width;
  if (floorsWidth * scale + gaps * gapMin(scale) > available) {
    // gapMin depends on scale through the arrowheads; solve the linear form.
    const fixed = gaps * (2 * LABEL_END_CLEARANCE + GAP_MIN_LABEL_PX);
    const perScale = floorsWidth + gaps * 2 * (arrowReach / targetScale);
    scale = Math.max(MIN_SCALE, Math.min(scale, (available - fixed) / Math.max(1, perScale)));
  }
  const labelFontScale = labelFontScaleFor(text, scale);
  const labelFontPx = text.labelFontPx;
  const gapFloor = gapMin(scale);

  // Step 1: the gap the label would like, and (step 2) the gap it needs — the
  // same span minus the air.
  const widestLabel = labels.reduce(
    (max, label) => Math.max(max, widestLabelLine(label, labelFont(labelFontPx))),
    0
  );
  const gapKeep = Math.min(GAP_MAX_PX, Math.max(gapFloor, Math.ceil(widestLabel + 2 * tipRoom(scale))));
  const gapWanted = Math.min(GAP_MAX_PX, gapKeep + GAP_LABEL_AIR_PX);

  // Natural boxes, then their on-screen widths — duplicates draw at the width of
  // the node they copy.
  const measure = (list) => {
    const byId = new Map(list.map(n => [n.id, n.width]));
    return [
      ...list.map(n => n.width * scale),
      ...duplicateNodeIds.map(id => (byId.get(id) ?? floors.width) * scale)
    ];
  };
  let nodes = naturalNodes;
  let widths = measure(nodes);
  let boxesWidth = widths.reduce((sum, w) => sum + w, 0);
  const capBoxes = (capPx) => {
    nodes = buildConnectionPreviewNodes(sourceNodes, floors, { maxWidth: capPx / scale });
    widths = measure(nodes);
    boxesWidth = widths.reduce((sum, w) => sum + w, 0);
  };
  const floorBoxes = floorsWidth * scale;

  // Steps 1–4, in that order of concession.
  let spacing;
  if (gaps === 0) {
    spacing = 0;
  } else if (boxesWidth + gaps * gapWanted <= available) {
    spacing = gapWanted;
  } else if (boxesWidth + gaps * gapKeep <= available) {
    spacing = Math.floor((available - boxesWidth) / gaps);
  } else if (floorBoxes + gaps * gapKeep <= available) {
    spacing = gapKeep;
    capBoxes(waterFillCap(widths, available - gaps * gapKeep));
  } else {
    capBoxes(floors.width * scale);
    spacing = Math.max(gapFloor, Math.floor((available - boxesWidth) / gaps));
  }

  // Step 4: the label gets the span between the arrowheads.
  const labelBudget = Math.max(0, spacing - 2 * tipRoom(scale));
  const fittedLabels = labels.map(label => fitLabelToSpan(label, labelFont(labelFontPx), labelBudget));

  // The container is the content, so the renderer's fit cannot land below the
  // target: its width ratio is (available − gaps·spacing) / Σ natural widths,
  // which is exactly `scale` once the ceil rounds up rather than down.
  const contentWidth = boxesWidth + gaps * spacing;
  const containerWidth = Math.min(maxWidth, Math.ceil(contentWidth + padding * 2));

  // A wrapped label is centred on the connection line, so it needs half its
  // block above and below the row's midline — usually inside the box height,
  // but not for three lines at the mobile size.
  const lineCount = fittedLabels.reduce((max, label) => Math.max(max, wrapConnectionLabel(label).length), 1);
  const labelBlock = lineCount * labelFontPx * LABEL_LINE_HEIGHT_RATIO + 4;
  const boxHeight = Math.max(...nodes.map(n => n.height), floors.height) * scale;
  const containerHeight = Math.ceil(Math.max(boxHeight, labelBlock) + padding * 2);

  return {
    nodes,
    labels: fittedLabels,
    spacing,
    scale,
    labelFontScale,
    containerWidth,
    containerHeight
  };
}

/**
 * The right panel's Connections list: a two-node row in a column whose width is
 * the panel's, not the content's. The renderer is still handed the full column
 * so the row centres in it.
 */
export function layoutPanelConnection({ nodes, predicate, containerWidth, hasArrows, text }) {
  const row = layoutConnectionRow({
    nodes,
    labels: [predicate],
    maxWidth: containerWidth,
    text,
    padding: PANEL_RENDERER_PADDING,
    hasArrows
  });
  return {
    nodes: row.nodes,
    span: row.spacing,
    scale: row.scale,
    height: row.containerHeight,
    labelFontScale: row.labelFontScale,
    predicate: row.labels[0]
  };
}
