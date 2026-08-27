import { NODE_PADDING } from '../constants.js';

/**
 * Single source of truth for how a node's NAME is rendered.
 *
 * Every surface that draws a node has to reproduce the same label box, and each
 * one that hand-rolls it drifts: the AbstractionCarousel's copy sat at
 * `39 * lineSpacing * nodeScale` (no font-size factor) and `28px` of vertical
 * padding long after Node.jsx moved to `39 * fontSize * lineSpacing * scale`
 * and `34px`. Worse, it scaled the font by the GLOBAL node scale while
 * getNodeDimensions had already sized the box by the EFFECTIVE scale
 * (global x the instance's sizeMul) — so a shrunk instance got a small box with
 * a full-size font and wrapped a name the canvas kept on one line.
 *
 * The box geometry comes from getNodeDimensions; this is the matching render
 * side. Both must move together, so they live in one function.
 *
 * @param {Object} params
 * @param {Object} params.textSettings - Store textSettings ({ fontSize, lineSpacing, ... }).
 * @param {number} params.effNodeScale - EFFECTIVE node scale: global nodeScale x instance sizeMul.
 *   Must be the same scale getNodeDimensions used, or box and text desync.
 * @param {string} params.color - Resolved contrast text color for the node's fill.
 * @param {Object|null} params.unexpandedDims - getNodeDimensions(node, false, null) for this node.
 *   Pins the wrap width to the box the dimensions were measured against.
 * @param {number|null} params.scaledPadding - The node's scaled horizontal padding, if the
 *   caller already has it (NodeCanvas passes it down to Node as a prop).
 * @param {boolean} params.hasThumbnail - Image nodes get a tighter, top-biased vertical padding.
 */

// Base label metrics in unscaled px — multiplied by the user's font-size /
// line-spacing sliders and by the node's effective scale.
export const LABEL_FONT_SIZE_BASE = 45;
export const LABEL_LINE_HEIGHT_BASE = 39;

// Vertical padding inside the label's flex container, unscaled px. The text-only
// value is what getNodeDimensions budgets for (`textBlockHeight + 67 * nodeScale`,
// i.e. 34 top + 34 bottom); image nodes sit higher to leave room for the image.
const LABEL_PADDING_V = 34;
const LABEL_PADDING_TOP_WITH_IMAGE = 31;
const LABEL_PADDING_BOTTOM_WITH_IMAGE = 25;

export function getNodeLabelStyle({
  textSettings,
  effNodeScale = 1,
  color,
  unexpandedDims = null,
  scaledPadding = null,
  hasThumbnail = false,
}) {
  const fontScale = textSettings?.fontSize ?? 1;
  const lineSpacing = textSettings?.lineSpacing ?? 1;

  const fontSize = LABEL_FONT_SIZE_BASE * fontScale * effNodeScale;
  const lineHeight = LABEL_LINE_HEIGHT_BASE * fontScale * lineSpacing * effNodeScale;

  const sidePadding = scaledPadding ?? unexpandedDims?.scaledPadding ?? NODE_PADDING * effNodeScale;

  // Carve out the node's horizontal padding on both sides so the pinned text width
  // exactly matches the wrapping target getNodeDimensions used (currentWidth - 2 * sP).
  const wrapMaxWidth = unexpandedDims
    ? unexpandedDims.currentWidth - 2 * (unexpandedDims.scaledPadding ?? sidePadding)
    : null;

  const containerPadding = hasThumbnail
    ? `${LABEL_PADDING_TOP_WITH_IMAGE * effNodeScale}px ${sidePadding}px ${LABEL_PADDING_BOTTOM_WITH_IMAGE * effNodeScale}px`
    : `${LABEL_PADDING_V * effNodeScale}px ${sidePadding}px`;

  return {
    fontSize,
    lineHeight,
    sidePadding,
    containerPadding,
    wrapMaxWidth,
    typography: {
      fontFamily: "'EmOne', sans-serif",
      fontSize: `${fontSize}px`,
      fontWeight: 'bold',
      color,
      lineHeight: `${lineHeight}px`,
      textAlign: 'center',
      width: '100%',
      minWidth: 0,
      maxWidth: wrapMaxWidth ? `${wrapMaxWidth}px` : '100%',
      overflowWrap: 'break-word',
      wordBreak: 'break-word',
    },
  };
}
