/**
 * Framing helpers (moved verbatim from NodeCanvas): the space the canvas can
 * frame into once panels and the bottom control panel are accounted for, and
 * bringing a node or an edge pie menu into view. NodeCanvas wraps each in a
 * useCallback with its original dependencies.
 */
import { lineModeBounds } from '../../../utils/pieMenuLayout.js';
import { MAX_ZOOM } from '../../../constants';
import { clampPan } from '../../../utils/canvas/viewportMath.js';
import { getNodeDimensions } from '../../../utils.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { getFixedOverlayOrigin } from '../../../utils/appViewport.js';
import { getAppViewportSize } from '../../../utils/appViewport.js';
import { resolveEdgeLabelFontSize } from '../../../services/layoutGeometry.js';
import { labelBoundsFor, estimateTextWidth } from '../../../utils/canvas/edgeLabelPlacement.js';
import { CAROUSEL_SLOT_FRACTION } from '../../../utils/pieMenuLayout.js';

// How much canvas an open overlay panel has to leave behind before framing
// bothers aiming at the gap rather than at the whole region — see
// getFramingRegion. Below this a phone-sized window with a near-full-width
// panel would zoom out to nothing chasing a sliver.
const FRAMING_MIN_REGION_PX = 320;
const FRAMING_MIN_REGION_FRACTION = 0.45;
// Same idea on the vertical axis, for the bottom control panel. No px floor to go with
// it: a landscape phone's whole region is shorter than the one above, so a px floor
// would switch the reserve off in the layout that needs it most. And unlike the width
// rule this one clamps rather than gives up — an unusually tall panel still gets what
// room there is, instead of being ignored outright.
const FRAMING_MIN_HEIGHT_FRACTION = 0.5;

// When a node is selected (single click), gently frame it on the canvas so the
// PieMenu buttons and page chevrons have room — the same animated zoom used by the
// abstraction carousel / decompose views, but for ordinary selection. Frames
// against the usable region (panels/header/typelist excluded) — the same bounds
// the edge glow uses — and sizes the zoom off the pie-menu button cluster so the
// buttons and chevrons stay on-screen. Flip FOCUS_ON_SELECT_ENABLED to disable.
export const FOCUS_ON_SELECT_ENABLED = true;
// How much of the usable region's half-extent the pie-menu cluster is fitted to.
// Past 1.0 on purpose: clusterHalfReach below is a deliberately generous bound
// (3 button rings), while the menu actually draws a single ring at bPad + bSize
// from the node edge — roughly a third of that. Fitting to the conservative
// reach at 0.96 therefore landed noticeably further out than the menu needs,
// so selection reads as zoomed-out. These overfill it to close that gap; the
// real buttons and chevrons still sit well inside the region.
const FOCUS_FILL_WIDE = 1.1;   // desktop
const FOCUS_FILL_NARROW = 1.1; // mobile
const FOCUS_WIDTH_WIDE = 1200;  // px: at/above this usable width, use WIDE
const FOCUS_WIDTH_NARROW = 480; // px: at/below this usable width, use NARROW
// There is deliberately no vertical bias here. A 10% lift used to stand in for the
// bottom control panel — the node was nudged up so the panel had somewhere to be —
// and that proxy is now measured for real (see getBottomPanelReserve), so the region
// this centres in already ends where the panel begins. Keeping the nudge as well put
// the node visibly high in the far more common case where NO panel is up and nothing
// fills the space it was making. Centre of the visible gap, nothing else.
//
// Vertical fill for the tall-node bound below. Deliberately NOT the 1.1 overfill:
// that exists to claw back the slack in the 3-ring WIDTH bound, and the vertical
// bound has no slack to claw back — PieMenu draws its north/south bubbles exactly
// where that bound says they are.
const FOCUS_TALL_FILL = 0.95;
// Skip the animation when the node is already essentially framed, so we don't yank
// the view on every click — only re-frame when the menu would otherwise be clipped
// or the node is small/off to the side.
const FOCUS_SKIP_ZOOM_RATIO = 0.12; // within 12% of target zoom → close enough
const FOCUS_SKIP_PAN_PX = 48;       // within 48px of target pan → close enough

// Connection (edge) menu framing. Deliberately gentler than the node numbers above:
// the edge menu's box is a short wide strip, so filling the region with it magnifies
// far harder than the node's roughly-square cluster does at the same fill fraction.
const FOCUS_EDGE_FILL_WIDE = 0.62;   // desktop: box fills ~62% of the usable region
const FOCUS_EDGE_FILL_NARROW = 0.78; // mobile: closer to the full width, space is scarce
const FOCUS_EDGE_PADDING_RATIO = 1.0; // extra margin around the box, in bubble diameters
const FOCUS_EDGE_MAX_ZOOM = 0.85;     // hard ceiling: framing a connection never magnifies
const FOCUS_EDGE_LABEL_MAX_GROWTH = 1.6; // stop honoring the label past 1.6x box growth

/** Frame an edge pie menu (its buttons and the connection label) when it wouldn't fit. */
export function focusEdgePieMenuInViewWith(ctx, anchor, buttonCount, labelRect = null) {
  const {
    runFramingAfterCommit, textSettings, getFramingRegion, focusOnSelectZoomAmount, MIN_ZOOM, canvasSize,
    viewportSize, zoomLevelRef, panOffsetRef, animateCanvasView,
  } = ctx;
  if (!FOCUS_ON_SELECT_ENABLED || !anchor || !buttonCount) return;
  runFramingAfterCommit(() => {

  // Framed against the layout PieMenu actually draws (utils/pieMenuLayout.js),
  // rather than a second copy of the geometry here — the row wraps now, and two
  // hand-kept copies of where it wraps would only agree until one of them moved.
  // BUBBLE_SIZE / BUBBLE_PADDING, scaled by the same node + pie menu settings.
  const pieScale = (textSettings?.nodeScale ?? 1.0) * (textSettings?.pieMenuScale ?? 1.0);
  const bSize = 120 * pieScale;
  const bPad = 32 * pieScale;

  // Includes the anchor itself, so the connection the menu belongs to stays
  // framed alongside its buttons.
  const bounds = lineModeBounds(anchor.x, anchor.y, bSize / 2, {
    count: buttonCount,
    angle: anchor.angle ?? 0,
    step: bSize + bPad,
    perpOffset: bSize + bPad * 2,
    rowGap: bSize + bPad,
  });
  let { minX, maxX, minY, maxY } = bounds;

  // Fold in the label if it doesn't blow the frame out. A very long connection
  // name would otherwise dominate the box and zoom the buttons down to nothing,
  // so past the growth cap we keep the menu framing and let the label overflow.
  if (labelRect && Number.isFinite(labelRect.minX)) {
    const grownW = Math.max(maxX, labelRect.maxX) - Math.min(minX, labelRect.minX);
    const grownH = Math.max(maxY, labelRect.maxY) - Math.min(minY, labelRect.minY);
    const growth = Math.max(grownW / Math.max(1, maxX - minX), grownH / Math.max(1, maxY - minY));
    if (growth <= FOCUS_EDGE_LABEL_MAX_GROWTH) {
      minX = Math.min(minX, labelRect.minX);
      maxX = Math.max(maxX, labelRect.maxX);
      minY = Math.min(minY, labelRect.minY);
      maxY = Math.max(maxY, labelRect.maxY);
    }
  }

  // Breathing room so the outermost bubbles don't sit flush against the edges
  // of the usable region.
  const boundsPad = bSize * FOCUS_EDGE_PADDING_RATIO;
  const boundsW = Math.max(1, maxX - minX + boundsPad * 2);
  const boundsH = Math.max(1, maxY - minY + boundsPad * 2);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Selecting a single connection puts up the connection control panel as well as
  // this menu (showConnectionControlPanel, on by default), and the panel is wide and
  // tall enough to swallow a button row framed into the full region — so aim at the
  // gap above it when it's there.
  const vb = getFramingRegion({ reserveBottomPanel: true });
  const regionCenterX = vb.x + vb.width / 2;
  const regionCenterY = vb.y + vb.height / 2;
  const narrowness = Math.max(0, Math.min(1,
    (FOCUS_WIDTH_WIDE - vb.width) / (FOCUS_WIDTH_WIDE - FOCUS_WIDTH_NARROW)
  ));
  const fillFrac = FOCUS_EDGE_FILL_WIDE + (FOCUS_EDGE_FILL_NARROW - FOCUS_EDGE_FILL_WIDE) * narrowness;
  const referenceZoom = Math.min(
    (vb.width * fillFrac) / boundsW,
    (vb.height * fillFrac) / boundsH
  ) * focusOnSelectZoomAmount;
  // A connection menu is a short, wide box — fitting it edge-to-edge lands at
  // ~1.8x, which reads as being thrown at the connection. Cap the zoom-IN side:
  // framing should never magnify past near-native scale, only pull back when the
  // row genuinely doesn't fit.
  // The ceiling moves with the setting too — otherwise asking for tighter
  // framing would silently do nothing on connections, which is where the cap
  // binds most often.
  const tz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, FOCUS_EDGE_MAX_ZOOM * focusOnSelectZoomAmount, referenceZoom));

  // No vertical bias here — unlike a node's radial menu, the row already sits to
  // one side of the anchor, so its bounds centered in the region is the right frame.
  const targetPanX = regionCenterX - (centerX - canvasSize.offsetX) * tz;
  const targetPanY = regionCenterY - (centerY - canvasSize.offsetY) * tz;
  const finalPan = clampPan({ x: targetPanX, y: targetPanY }, tz, viewportSize, canvasSize);

  // Already essentially framed? Leave the view alone rather than yanking it.
  const curZoom = zoomLevelRef.current;
  const curPan = panOffsetRef.current;
  const zoomClose = Math.abs(tz - curZoom) <= curZoom * FOCUS_SKIP_ZOOM_RATIO;
  const panClose = Math.abs(finalPan.x - curPan.x) <= FOCUS_SKIP_PAN_PX
    && Math.abs(finalPan.y - curPan.y) <= FOCUS_SKIP_PAN_PX;
  if (zoomClose && panClose) return;

  animateCanvasView(finalPan, tz);
  });
}

/** Bring a node (and room for its pie menu) into view. */
export function focusNodeInViewWith(ctx, nodeId) {
  const {
    nodes, runFramingAfterCommit, getFramingRegion, textSettings, focusOnSelectZoomAmount, MIN_ZOOM,
    canvasSize, viewportSize, zoomLevelRef, panOffsetRef, animateCanvasView,
  } = ctx;
  if (!FOCUS_ON_SELECT_ENABLED || !nodeId) return;
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;
  runFramingAfterCommit(() => {
  const dims = getNodeDimensions(node, false, null);
  const centerX = node.x + dims.currentWidth / 2;
  const centerY = node.y + dims.currentHeight / 2;

  // Aim at the gap above the node control panel when one is up — it sits directly
  // under the node it belongs to, and the pie menu's south bubbles are what lands
  // behind it. Nothing is reserved when the panel is off, which is the default.
  const vb = getFramingRegion({ reserveBottomPanel: true });
  const regionCenterX = vb.x + vb.width / 2;
  const regionCenterY = vb.y + vb.height / 2;

  // 0 on wide regions → 1 on narrow regions, interpolated by usable width.
  const narrowness = Math.max(0, Math.min(1,
    (FOCUS_WIDTH_WIDE - vb.width) / (FOCUS_WIDTH_WIDE - FOCUS_WIDTH_NARROW)
  ));

  // Half horizontal reach of the pie-menu cluster (node half-width + outer button
  // ring) in canvas units — same derivation as the carousel framing, so it tracks
  // BUBBLE_SIZE/BUBBLE_PADDING and the node/pie scale settings automatically:
  // halfW + 3·bSize + 3·bPad.
  const pieScale = (textSettings?.nodeScale ?? 1.0) * (textSettings?.pieMenuScale ?? 1.0);
  const bSize = 120 * pieScale; // BUBBLE_SIZE
  const bPad = 32 * pieScale;   // BUBBLE_PADDING
  const clusterHalfReach = dims.currentWidth / 2 + 3 * bSize + 3 * bPad;
  const fillFrac = FOCUS_FILL_WIDE + (FOCUS_FILL_NARROW - FOCUS_FILL_WIDE) * narrowness;
  // The pie menu is radial — its buttons extend up/down as far as left/right — so
  // fit the cluster to BOTH the region width and its (typelist-reduced) height,
  // taking the tighter of the two. Otherwise the bottom row of buttons spills into
  // the TypeList bar when it's open, since vb.height already excludes it.
  const referenceZoomH = (vb.width * 0.5 * fillFrac) / clusterHalfReach;
  const referenceZoomV = (vb.height * 0.5 * fillFrac) / clusterHalfReach;
  // ...but clusterHalfReach is derived from the node's WIDTH, and using it on the
  // vertical axis too quietly assumes every node is wider than it is tall. An image
  // node isn't: its height is the text area plus an image slot of up to
  // IMAGE_MAX_ASPECT times the expanded width (see getNodeDimensions), so a portrait
  // node runs ~2x taller than it is wide and the fit above came out ~1.4x too loose —
  // zooming in until the node's name, which on an image node sits at the TOP, was
  // above the region entirely. So bound the vertical axis by the node's own extent as
  // well: PieMenu hugs the node's box, putting the north/south bubble centres at
  // halfH + bPad + bSize/2 and their outer edges half a bubble past that. Exact, so
  // it takes FOCUS_TALL_FILL rather than the width bound's overfill. For a node that
  // is wider than it is tall this lands far outside the two fits above and never
  // binds, which is why ordinary selection framing is unchanged.
  const menuHalfHeight = dims.currentHeight / 2 + bSize + bPad;
  const tallZoomV = (vb.height * 0.5 * FOCUS_TALL_FILL) / menuHalfHeight;
  // The user's framing-tightness setting scales the fit rather than any of the
  // constants above, so all three bounds keep meaning what they say and 1.0 is
  // byte-for-byte the tuned behaviour.
  const referenceZoom = Math.min(referenceZoomH, referenceZoomV, tallZoomV) * focusOnSelectZoomAmount;
  const tz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, referenceZoom));

  const targetPanX = regionCenterX - (centerX - canvasSize.offsetX) * tz;
  const targetPanY = regionCenterY - (centerY - canvasSize.offsetY) * tz;
  const finalPan = clampPan({ x: targetPanX, y: targetPanY }, tz, viewportSize, canvasSize);

  // Already essentially framed? Leave the view where it is.
  const curZoom = zoomLevelRef.current;
  const curPan = panOffsetRef.current;
  const zoomClose = Math.abs(tz - curZoom) <= curZoom * FOCUS_SKIP_ZOOM_RATIO;
  const panClose = Math.abs(finalPan.x - curPan.x) <= FOCUS_SKIP_PAN_PX
    && Math.abs(finalPan.y - curPan.y) <= FOCUS_SKIP_PAN_PX;
  if (zoomClose && panClose) return;

  animateCanvasView(finalPan, tz);
  });
}

/** The screen region framing aims into, optionally reserving the bottom panel. */
export function getFramingRegionWith(ctx, { reserveBottomPanel = false } = {}) {
  const { viewportBounds, getBottomPanelReserve, leftPanelExpanded, rightPanelExpanded, containerRef } = ctx;
  const vb = viewportBounds;
  let x = vb.x;
  let width = vb.width;
  let height = vb.height;
  let reservedBottom = 0;

  if (reserveBottomPanel) {
    const reserve = getBottomPanelReserve();
    if (reserve > 0) {
      reservedBottom = Math.min(reserve, height * (1 - FRAMING_MIN_HEIGHT_FRACTION));
      height -= reservedBottom;
    }
  }

  if (vb.isExclusiveMode) {
    const { leftPanelWidth, rightPanelWidth } = useCanvasUIStore.getState(); // committed widths (P2.12)
    const openLeft = leftPanelExpanded ? leftPanelWidth : 0;
    const openRight = rightPanelExpanded ? rightPanelWidth : 0;
    if (openLeft || openRight) {
      const remaining = width - openLeft - openRight;
      const floor = Math.max(FRAMING_MIN_REGION_PX, width * FRAMING_MIN_REGION_FRACTION);
      if (remaining >= floor) {
        x += openLeft;
        width = remaining;
      }
    }
  }

  const rect = containerRef.current?.getBoundingClientRect();
  const origin = getFixedOverlayOrigin();
  const containerX = rect ? rect.left - origin.x : 0;
  const containerY = rect ? rect.top - origin.y : vb.y;

  return { ...vb, x: x - containerX, y: vb.y - containerY, width, height, reservedBottom };
}

/** How much of the bottom of the viewport the control panel covers. */
export function getBottomPanelReserveWith(ctx) {
  const { viewportBounds } = ctx;
  if (typeof document === 'undefined') return 0;
  let band = 0;
  document.querySelectorAll('.unified-bottom-panel').forEach((el) => {
    // Mid-exit it is about to stop occluding anything, so it doesn't get to hold space
    // — otherwise deselecting one Thing and picking another reserves for a panel that
    // is already flying out.
    if (el.classList.contains('exiting')) return;
    const height = el.offsetHeight;
    if (!height) return;
    const bottom = parseFloat(window.getComputedStyle(el).bottom) || 0;
    band = Math.max(band, bottom + height);
  });
  if (band <= 0) return 0;
  // `band` runs up from the bottom of the app box, and the region already stops short
  // of that by the TypeList bar, so only the remainder actually eats into it.
  const belowRegion = Math.max(0, getAppViewportSize().height - (viewportBounds.y + viewportBounds.height));
  return Math.max(0, band - belowRegion);
}

/** When a node starts previewing its definition (decompose), frame the expanded node. */
export function frameDecomposedNode(ctx) {
  const {
    prevPreviewingNodeIdRef, previewingNodeId, nodes, getFramingRegion, DECOMPOSE_WIDTH_WIDE,
    DECOMPOSE_WIDTH_NARROW, DECOMPOSE_ZOOM_FACTOR_WIDE, DECOMPOSE_ZOOM_FACTOR_NARROW, DECOMPOSE_BIAS_WIDE,
    DECOMPOSE_BIAS_NARROW, DECOMPOSE_VIEW_PADDING, MIN_ZOOM, canvasSize, viewportSize, animateCanvasView,
  } = ctx;
  const was = prevPreviewingNodeIdRef.current;
  prevPreviewingNodeIdRef.current = previewingNodeId;

  // Only animate on spawn (null -> a node), not on un-decompose or node switches.
  if (was || !previewingNodeId) return;
  const node = nodes.find(n => n.id === previewingNodeId);
  if (!node) return;

  const dims = getNodeDimensions(node, true, null); // preview (expanded) dimensions
  const centerX = node.x + dims.currentWidth / 2;
  const centerY = node.y + dims.currentHeight / 2;

  // Fit against the usable canvas region (panels/header/typelist excluded), in
  // container coordinates — so the expanded node fits and centers within what's
  // actually visible rather than the full window when panels are open.
  const vb = getFramingRegion();
  const regionCenterX = vb.x + vb.width / 2;
  const regionCenterY = vb.y + vb.height / 2;

  // 0 on wide regions → 1 on narrow regions, interpolated by usable width.
  const narrowness = Math.max(0, Math.min(1,
    (DECOMPOSE_WIDTH_WIDE - vb.width) / (DECOMPOSE_WIDTH_WIDE - DECOMPOSE_WIDTH_NARROW)
  ));
  const lerp = (a, b, t) => a + (b - a) * t;
  const zoomFactor = lerp(DECOMPOSE_ZOOM_FACTOR_WIDE, DECOMPOSE_ZOOM_FACTOR_NARROW, narrowness);
  const biasFraction = lerp(DECOMPOSE_BIAS_WIDE, DECOMPOSE_BIAS_NARROW, narrowness);

  // Zoom to fit the expanded node within the usable region, then pull back per the
  // width-scaled factor. Clamp to zoom bounds.
  const fitX = vb.width / (dims.currentWidth + DECOMPOSE_VIEW_PADDING * 2);
  const fitY = vb.height / (dims.currentHeight + DECOMPOSE_VIEW_PADDING * 2);
  const tz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(fitX, fitY) * zoomFactor));

  // Nudge the node above the region center so the control panel below has room.
  const verticalBias = vb.height * biasFraction;
  const targetPanX = regionCenterX - (centerX - canvasSize.offsetX) * tz;
  const targetPanY = (regionCenterY - verticalBias) - (centerY - canvasSize.offsetY) * tz;
  const finalPan = clampPan({ x: targetPanX, y: targetPanY }, tz, viewportSize, canvasSize);
  animateCanvasView(finalPan, tz);
}

/** When the edge pie opens on a connection, frame it (label included). */
export function frameEdgePieOnOpen(ctx) {
  const {
    prevFocusPieEdgeIdRef, edgePieMenuVisible, selectedEdgeId, focusOnSelectEnabled,
    abstractionCarouselVisible, draggingNodeInfoRef, selectedEdgeMidpoint, edgePieMenuButtons,
    showConnectionNames, placedLabelsRef, edgesMap, nodePrototypesMap, edgePrototypesMap, textSettings,
    connectionLabelSize, focusEdgePieMenuInView,
  } = ctx;
  const was = prevFocusPieEdgeIdRef.current;
  const id = edgePieMenuVisible ? selectedEdgeId : null;
  prevFocusPieEdgeIdRef.current = id;

  if (!FOCUS_ON_SELECT_ENABLED || !focusOnSelectEnabled) return;
  if (!id || id === was) return;
  if (abstractionCarouselVisible || draggingNodeInfoRef.current) return;
  if (!selectedEdgeMidpoint || edgePieMenuButtons.length === 0) return;

  // The connection's own name label, so framing shows what the connection SAYS and
  // not just its buttons. Prefer the rect the render actually registered (routed
  // styles solve label placement and can slide it along the route); fall back to
  // the box the label would occupy at the anchor, which is where straight/curved
  // labels are drawn.
  let labelRect = null;
  if (showConnectionNames) {
    const placed = placedLabelsRef.current.get(selectedEdgeId);
    if (placed?.rect) {
      labelRect = placed.rect;
    } else {
      const edge = edgesMap.get(selectedEdgeId);
      const name = edge && (
        (edge.definitionNodeIds?.length > 0 && nodePrototypesMap.get(edge.definitionNodeIds[0])?.name)
        || (edge.typeNodeId && edgePrototypesMap.get(edge.typeNodeId)?.name)
        || edge.connectionName
      );
      if (name) {
        const fs = resolveEdgeLabelFontSize(textSettings, connectionLabelSize);
        labelRect = labelBoundsFor(
          selectedEdgeMidpoint.x, selectedEdgeMidpoint.y,
          estimateTextWidth(name, fs), fs * 1.1,
          (selectedEdgeMidpoint.angle ?? 0) * (180 / Math.PI)
        );
      }
    }
  }

  focusEdgePieMenuInView(selectedEdgeMidpoint, edgePieMenuButtons.length, labelRect);
}

/** When the abstraction carousel opens, frame its node; the framing becomes the resting view. */
export function frameCarouselOnOpen(ctx) {
  const {
    prevCarouselVisibleRef, abstractionCarouselVisible, abstractionCarouselNode, runFramingAfterCommit,
    getFramingRegion, CAROUSEL_ZOOM_WIDTH_WIDE, CAROUSEL_ZOOM_WIDTH_NARROW, textSettings,
    carouselFocusedNodeScale, CAROUSEL_FILL_WIDE, CAROUSEL_FILL_NARROW, CAROUSEL_HINT_BAND, MIN_ZOOM,
    canvasSize, viewportSize, animateCanvasView,
  } = ctx;
  const was = prevCarouselVisibleRef.current;
  prevCarouselVisibleRef.current = abstractionCarouselVisible;

  if (!was && abstractionCarouselVisible) {
    // Opening: frame the node.
    const node = abstractionCarouselNode;
    if (!node) return;
    runFramingAfterCommit(() => {
    const dims = getNodeDimensions(node, false, null);
    const centerX = node.x + dims.currentWidth / 2;
    const centerY = node.y + dims.currentHeight / 2;
    // Frame against the usable canvas region (panels/header/typelist excluded),
    // in container coordinates — so the node centers in what's actually visible
    // rather than the full window when panels/typelist are open. The abstraction
    // control panel comes up with the carousel (showAbstractionControlPanel, on by
    // default) and sits right under the stack, so it's excluded too when present.
    const vb = getFramingRegion({ reserveBottomPanel: true });
    const regionCenterX = vb.x + vb.width / 2;
    const regionCenterY = vb.y + vb.height / 2;
    // 0 on wide regions → 1 on narrow regions, interpolated by usable width.
    const narrowness = Math.max(0, Math.min(1,
      (CAROUSEL_ZOOM_WIDTH_WIDE - vb.width) / (CAROUSEL_ZOOM_WIDTH_WIDE - CAROUSEL_ZOOM_WIDTH_NARROW)
    ));
    // Max horizontal reach of the pie-menu button cluster from the focused-node
    // centre, in canvas units: the focused-node half-width plus the outermost
    // button and its radius. Buttons are BUBBLE_SIZE/BUBBLE_PADDING (see
    // PieMenu.jsx) scaled by nodeScale·pieMenuScale, so this tracks any size
    // change automatically. The furthest slot stage 1 fills is 'right-third'
    // (Delete), at halfW + padding + 2·slotStep, where padding = bPad + bSize/2
    // and slotStep = CAROUSEL_SLOT_FRACTION·(bSize + bPad), plus bSize/2 for the
    // bubble's own radius. Row 1 reaches slot 1 plus its stagger — 1.5 steps —
    // so it stays inside row 0's reach and doesn't enter this.
    const pieScale = (textSettings?.nodeScale ?? 1.0) * (textSettings?.pieMenuScale ?? 1.0);
    const bSize = 120 * pieScale; // BUBBLE_SIZE
    const bPad = 32 * pieScale;   // BUBBLE_PADDING
    const slotStep = (bSize + bPad) * CAROUSEL_SLOT_FRACTION;
    const focusScale = carouselFocusedNodeScale || 1.2;
    const clusterHalfReach = (dims.currentWidth * focusScale) / 2 + bSize + bPad + 2 * slotStep;
    // Fraction of the usable region half-width the cluster should occupy (fuller on narrow).
    const fillFrac = CAROUSEL_FILL_WIDE + (CAROUSEL_FILL_NARROW - CAROUSEL_FILL_WIDE) * narrowness;
    const referenceZoom = (vb.width * 0.5 * fillFrac) / clusterHalfReach;
    // Vertical fit. The derivation above knows only the node's WIDTH, and an image
    // node grows in height ALONE — getNodeDimensions gives it a fixed
    // EXPANDED_NODE_WIDTH and then adds imageWidth * aspect (up to
    // IMAGE_MAX_ASPECT = 2.0) to its height, so a portrait image node is ~8.5x the
    // height of a text node at the same width-derived zoom. Framed horizontally it
    // overflowed the region vertically and took the More/Less Specific hints
    // off-screen with it.
    //
    // Sized to the focused node alone, not its neighbours: a chain of portrait
    // image nodes puts ~1150 canvas units between adjacent centres, so demanding a
    // neighbour fit would drive the zoom to ~0.09 and render the focused node
    // barely 100px tall. The stack is built to overlap and fade (LEVEL_SPACING is
    // negative), so neighbours peeking in is the intended read.
    //
    // Stage 1's two button rows straddle the node's centre line, half a slot step
    // either side of it, so on a short node they — not the node — set the vertical
    // extent. Fit whichever reaches further.
    const availableHalfHeight = Math.max(1, vb.height * 0.5 - CAROUSEL_HINT_BAND);
    const nodeHalfHeight = Math.max(1, (dims.currentHeight * focusScale) / 2, slotStep / 2 + bSize / 2);
    const verticalZoom = availableHalfHeight / nodeHalfHeight;
    const tz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(referenceZoom, verticalZoom)));
    const targetPanX = regionCenterX - (centerX - canvasSize.offsetX) * tz;
    const targetPanY = regionCenterY - (centerY - canvasSize.offsetY) * tz;
    const finalPan = clampPan({ x: targetPanX, y: targetPanY }, tz, viewportSize, canvasSize);
    animateCanvasView(finalPan, tz);
    });
  }
}

/** Ease the camera to a pan and zoom over `durationMs` (the framing animations). */
export function animateCanvasViewWith(ctx, targetPan, targetZoom, durationMs = 320) {
  const { carouselViewAnimRef, panOffsetRef, zoomLevelRef, isAnimatingZoomRef, setPanAndZoom } = ctx;
  if (carouselViewAnimRef.current) cancelAnimationFrame(carouselViewAnimRef.current);
  const startPan = { ...panOffsetRef.current };
  const startZoom = zoomLevelRef.current;
  const startTime = performance.now();
  isAnimatingZoomRef.current = true;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - startTime) / durationMs);
    const e = ease(t);
    const pan = {
      x: startPan.x + (targetPan.x - startPan.x) * e,
      y: startPan.y + (targetPan.y - startPan.y) * e,
    };
    const zoom = startZoom + (targetZoom - startZoom) * e;
    setPanAndZoom(pan, zoom);
    if (t < 1) {
      carouselViewAnimRef.current = requestAnimationFrame(step);
    } else {
      carouselViewAnimRef.current = null;
      isAnimatingZoomRef.current = false;
    }
  };
  carouselViewAnimRef.current = requestAnimationFrame(step);
}
