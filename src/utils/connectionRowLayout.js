/**
 * Width budgeting for a row of connection-preview nodes — the canvas bottom
 * control panel and the right panel's Connections list.
 *
 * Both draw the same picture (node —label→ node, sometimes a longer chain) and
 * both have the same failure mode when the split between boxes and gaps is left
 * to the renderer's defaults. getNodeDimensions grows a text node's box to as
 * much as 420px (preview scale) to fit its name, so two ordinary names can
 * consume the row and leave the label a sliver; and when the boxes do overflow,
 * the renderer's answer is to fit-scale the whole drawing down, which drags the
 * label's font down with it. Either way the connection loses — which is
 * backwards, because the connection is the thing these views exist to show.
 *
 * So the gap budget is reserved first, the node boxes are capped against what's
 * left (truncating names too long for the cap), and only then is the label
 * measured against the span it actually got. The renderer takes the result
 * verbatim via its `horizontalSpacing` prop rather than re-negotiating it.
 */
import {
  CONNECTION_PREVIEW_FLOORS,
  buildConnectionPreviewNodes
} from './connectionPreview.js';
import {
  CONNECTION_LABEL_BASE_FONT_SIZE,
  wrapConnectionLabel
} from '../UniversalNodeRenderer.presets.js';
import { measureTextWidth } from '../services/textMeasurement.js';

// Same sizing recipe as the canvas connection control panel and the hover aid, at
// the smaller floor a ~280px-wide panel column can actually fit.
export const PANEL_FLOORS = CONNECTION_PREVIEW_FLOORS.panelList;
export const PANEL_RENDERER_PADDING = 10;

// Share of the row that goes to the gaps, in total across however many there
// are: the connection never gets less than `min`, nor more than `max`.
//
// The canvas control panel sizes its container to the content, so leftover width
// naturally lands in the gaps and a loose floor is enough. The right panel's
// column is 2–3× narrower, and there the same ratios read wrong: two node boxes
// can't drop below ~120px each (getNodeDimensions' own minimum), so "whatever is
// left over" leaves the boxes dominating a column that never had room for them
// at full size. That row asks for half the width up front and scales the boxes
// down to fit, which is what keeps the proportions reading like the wide one.
const CONTROL_PANEL_SPAN = { min: 0.3, max: 0.52 };
const PANEL_LIST_SPAN = { min: 0.5, max: 0.62 };
const MIN_SPAN_PX = 72;
// How far past the floor a box may grow before its name is truncated. This is a
// guard against the pathological box (getNodeDimensions will go to 420px for one
// name, and two of those drag the whole drawing's text down with them) — not the
// thing that sets the row's proportions, which the span reservation above
// already handles. So it sits high enough to let an ordinary two-word name
// through whole and only clip the genuinely long ones. The panel's is the larger
// multiple because its floor is the smaller box (110 vs 130).
const CONTROL_PANEL_NODE_BOX_RATIO = 2.2;
const PANEL_LIST_NODE_BOX_RATIO = 2.8;
// Below this the label stops being worth reading, so clip the text instead of
// shrinking it further.
const MIN_LABEL_FONT_PX = 13;
// The renderer stacks a wrapped label's lines at max(fontSize * 1.1, 26 * scale)
// — see ConnectionText in UniversalNodeRenderer.jsx. The first term wins at
// every size the base font produces, so line height is 1.1× the drawn font.
const LABEL_LINE_HEIGHT_RATIO = 1.1;
// Arrowhead length at full scale, plus a little air, so the label never collides
// with the arrow it sits between.
const ARROW_TIP_LENGTH = 24;
const LABEL_END_CLEARANCE = 6;

const labelFont = (px) => `bold ${px}px 'EmOne', sans-serif`;

/** Widest line the renderer's wrap produces for this label at this font. */
export const widestLabelLine = (text, fontString) =>
  wrapConnectionLabel(text).reduce(
    (max, line) => Math.max(max, measureTextWidth(line, fontString)),
    0
  );

/**
 * Widest line any of these labels wraps to at the renderer's base font size —
 * what a container has to make room for, as opposed to the width of the
 * unwrapped strings, which over-reserves for anything long.
 */
export const widestWrappedLabel = (labels) =>
  labels.reduce(
    (max, text) => Math.max(max, widestLabelLine(text, labelFont(CONNECTION_LABEL_BASE_FONT_SIZE))),
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
 * Divide a row's width between its node boxes and the gaps between them.
 *
 * @param {object} params
 * @param {Array<{id:string,name:string,color:string}>} params.nodes - in row order
 * @param {string[]} params.labels - connection names competing for the gaps
 * @param {number} params.containerWidth - width handed to UniversalNodeRenderer
 * @param {number} params.containerHeight - height handed to UniversalNodeRenderer
 * @param {number} params.padding - the renderer's padding prop
 * @param {{width:number,height:number}} params.floors - CONNECTION_PREVIEW_FLOORS entry
 * @param {string[]} [params.duplicateNodeIds] - nodes the renderer will draw a
 *   second copy of, which is how it lays out a self-loop
 * @param {boolean} [params.hasArrows] - whether either end draws an arrowhead
 * @param {{min:number,max:number}} [params.spanRatio] - share of the row the gaps take
 * @param {number} [params.nodeBoxRatio] - how far past the floor a box may grow
 *   before its name is truncated
 * @param {boolean} [params.labelKeepsBaseFont] - draw the connection label at the
 *   base font size instead of at the row's fit scale. For rows that had to scale
 *   down to fit a fixed-width column (the right panel's Connections list), which
 *   would otherwise shrink the label along with the boxes.
 * @returns {{nodes:Array<object>, spacing:number, labelFontScale:number,
 *   labels:string[]}} — node names and labels already truncated to their budgets,
 *   spacing for the renderer's `horizontalSpacing`, and the label font scale for
 *   its `connectionFontScale`.
 */
export function layoutConnectionRow({
  nodes: sourceNodes,
  labels,
  containerWidth,
  containerHeight,
  padding,
  floors,
  duplicateNodeIds = [],
  hasArrows = true,
  spanRatio = CONTROL_PANEL_SPAN,
  nodeBoxRatio = CONTROL_PANEL_NODE_BOX_RATIO,
  labelKeepsBaseFont = false
}) {
  const availableWidth = Math.max(1, containerWidth - padding * 2);
  const boxCount = Math.max(1, sourceNodes.length + duplicateNodeIds.length);
  const gaps = Math.max(1, boxCount - 1);

  const minTotalGap = Math.max(MIN_SPAN_PX * gaps, availableWidth * spanRatio.min);
  const maxTotalGap = Math.max(minTotalGap, availableWidth * spanRatio.max);

  // Cap each box at its share of what the gap floor leaves behind, or at the
  // long-name threshold, whichever is more generous — a wide row can afford full
  // names, and a narrow one shouldn't truncate every name down to the floor.
  const nodes = buildConnectionPreviewNodes(sourceNodes, floors, {
    maxWidth: Math.max(
      floors.width * nodeBoxRatio,
      (availableWidth - minTotalGap) / boxCount
    )
  });

  // Whatever the boxes don't need belongs to the connections, between the two
  // bounds. This is what makes the span grow with the container instead of
  // holding a fixed gap while the row around it gets wider.
  const widthById = new Map(nodes.map(n => [n.id, n.width]));
  const boxesWidth = nodes.reduce((sum, n) => sum + n.width, 0)
    + duplicateNodeIds.reduce((sum, id) => sum + (widthById.get(id) ?? floors.width), 0);
  const totalGap = Math.min(maxTotalGap, Math.max(minTotalGap, availableWidth - boxesWidth));
  const spacing = Math.round(totalGap / gaps);

  // The fit scale the renderer will land on, recomputed here because the label's
  // font size rides on it and the label has to be measured at the size it will
  // actually render at.
  const availableHeight = containerHeight - padding * 2;
  const nodeScale = Math.min(
    1,
    (availableWidth - spacing * gaps) / Math.max(1, boxesWidth),
    availableHeight / Math.max(1, ...nodes.map(n => n.height))
  );

  // The label's font normally rides the row's fit scale, because that is what the
  // renderer derives it from. In a row that had to scale down to fit its column
  // that drags the label along with the boxes — the failure this module exists to
  // prevent, just applied to the label instead. labelKeepsBaseFont holds the label
  // at the base size so it reads the same as the wider representations' do; the
  // budget below still bounds it, so nothing overflows.
  const labelFitScale = labelKeepsBaseFont ? 1 : nodeScale;
  const naturalFontSize = Math.max(8, CONNECTION_LABEL_BASE_FONT_SIZE * labelFitScale);
  const budget = Math.max(
    0,
    spacing - 2 * ((hasArrows ? ARROW_TIP_LENGTH * nodeScale : 0) + LABEL_END_CLEARANCE)
  );

  const naturalWidth = labels.reduce(
    (max, text) => Math.max(max, widestLabelLine(text, labelFont(naturalFontSize))),
    0
  );
  const widthShrink = naturalWidth > budget
    ? Math.min(1, budget / Math.max(1, naturalWidth))
    : 1;

  // A label that wraps into several short lines clears the width budget untouched,
  // so its height is a constraint of its own: the block is centred on the
  // connection, and whatever runs past the row's half-height the SVG viewport
  // simply clips away.
  const lineCount = labels.reduce((max, text) => Math.max(max, wrapConnectionLabel(text).length), 1);
  const heightShrink = Math.min(
    1,
    availableHeight / ((lineCount - 1) * LABEL_LINE_HEIGHT_RATIO + 1) / naturalFontSize
  );

  // Shrink the labels toward the legibility floor before clipping them — a 13px
  // label that reads in full beats a 24px one cut down to two words.
  const labelShrink = Math.max(
    Math.min(1, MIN_LABEL_FONT_PX / naturalFontSize),
    Math.min(widthShrink, heightShrink)
  );

  // Mirror the renderer's own 8px floor, or a label would be measured smaller
  // than it draws and clipped too late to help.
  const renderedFontSize = Math.max(8, naturalFontSize * labelShrink);

  return {
    nodes,
    spacing,
    // The renderer multiplies the base font by its own fit scale before applying
    // this, so divide that scale back out — otherwise holding the label at the
    // base size above would just be undone there.
    labelFontScale: labelShrink * (labelFitScale / Math.max(nodeScale, 0.01)),
    labels: labels.map(text => fitLabelToSpan(text, labelFont(renderedFontSize), budget))
  };
}

/**
 * The right panel's Connections list: a fixed two-node row in a column whose
 * width is the panel's, not the content's.
 */
export function layoutPanelConnection({ nodes, predicate, containerWidth, hasArrows, isUltraSlim = false }) {
  // Height derives from the node floor rather than a magic number, so the box can
  // never clip the node and force a vertical downscale (which is what shrank the
  // text and collapsed the corners into pills).
  const height = PANEL_FLOORS.height + PANEL_RENDERER_PADDING * 2 + (isUltraSlim ? 8 : 20);
  const row = layoutConnectionRow({
    nodes,
    labels: [predicate],
    containerWidth,
    containerHeight: height,
    padding: PANEL_RENDERER_PADDING,
    floors: PANEL_FLOORS,
    hasArrows,
    spanRatio: PANEL_LIST_SPAN,
    nodeBoxRatio: PANEL_LIST_NODE_BOX_RATIO,
    // This row is fit-scaled down to ~0.6–0.85× so two node boxes fit a panel
    // column. The label doesn't have to pay for that: the connection is what the
    // list is there to show, so it reads at the same size as it does in the
    // canvas control panel and hover aid.
    labelKeepsBaseFont: true
  });
  return {
    nodes: row.nodes,
    span: row.spacing,
    height,
    labelFontScale: row.labelFontScale,
    predicate: row.labels[0]
  };
}
