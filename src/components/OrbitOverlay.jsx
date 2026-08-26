import React, { useMemo, useEffect, useRef, useCallback } from 'react';

import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { getNodeDimensions } from '../utils.js';
import { NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR } from '../constants';
import { candidateToConcept } from '../services/candidates.js';
import useGraphStore from '../store/graphStore.js';
import { useTheme } from '../hooks/useTheme.js';
import { getTextColor, getLightHueText, getDarkHueText } from '../utils/colorUtils';
import { formatPredicate } from '../utils/predicateFormatter.js';
import { wrapTextToLines } from '../services/textMeasurement.js';
import { getNodeEdgeIntersection } from '../utils/canvas/nodeHitbox.js';
import { resolveEdgeLabelFontSize, estimateEdgeLabelWidth } from '../services/layoutGeometry.js';
import { POLY_TIP } from '../utils/canvas/edgeRouting.js';

const SPAWNABLE_NODE = 'spawnable_node';

const SOURCE_TO_RING_MARGIN = 200; // Minimum gap from source node edge to first orbit ring
const INTER_RING_MARGIN = 100;     // Minimum gap between successive orbit rings
const ORBIT_ANGULAR_SPEED_RAD_PER_SEC = 0.02; // Steady clockwise rotation
// Steady-state motion writes are throttled to this rate. The drift is around
// a pixel per write, but every write invalidates the canvas raster, and the
// A/B test (`__orbitFreeze`) proved the per-frame writes are what drives the
// GPU's "tile memory limits exceeded" black-tile flicker: frozen orbit, no
// warnings. Entrances keep the full frame rate (small areas, brief); settled
// content writes at this cadence. Runtime-tunable for calibration:
// `window.__orbitHz = 8` (or 4, 30, ...) in the console overrides it live.
const STEADY_WRITE_HZ_DEFAULT = 15;
const RADIAL_PERTURBATION_PX_BASE = 1; // very subtle radial wiggle
const ANGLE_JITTER_RAD_BASE = 0.004; // subtle angle wobble
const MIN_FREQ_HZ = 0.2;
const MAX_FREQ_HZ = 1.2;

// JS-driven rotation is ON. Its per-frame attribute writes do repaint the
// canvas surface, but at a FIXED scale that repaint is cheap — glyph and
// image rasters are cached and reused, which is the same reason panning never
// flickered. The expensive case is a CHANGING scale (zooming): every glyph
// and image resamples on every tick, costing more the further in you zoom.
// That case is handled by the canvas-gesture effect below, which freezes this
// loop and sheds the overlay's text/image detail for the duration of the
// gesture.
const ENABLE_ORBIT_ROTATION = true;

// A CSS sway stood in for rotation while the rotation loop was suspected of
// causing the zoom flicker. Rotation is back — the flicker was zoom-time
// re-raster cost, not the animation — so the sway is off; the machinery stays
// behind this flag.
const ENABLE_ORBIT_SWAY = false;
const ORBIT_SWAY_DEG = 0.9;        // ±sway about the focus center; ~±12px at ring 1
const ORBIT_SWAY_PERIOD_SEC = 26;  // one full there-and-back cycle

const ITEM_ALPHA = 0.85;

// One stylesheet for the overlay. The alpha rules are load-bearing for zoom
// performance: items and connections used to carry group opacity (0.85 on
// their root <g>), and group opacity forces the rasterizer to paint each
// group into its own offscreen isolation surface. Zooming mutates the canvas
// transform attribute, which repaints the whole SVG every tick — so ~2N
// surface allocations per tick, a raster-memory storm that flashed black
// tiles across the app. Inherited fill/stroke-opacity paints inline with no
// surfaces; only <image> needs element opacity (bounded to image items).
// Hover brightening toggles [data-hovered] instead of touching opacity.
const ORBIT_STYLE_SHEET = `
@keyframes orbit-sway {
  0%   { transform: rotate(0deg); }
  25%  { transform: rotate(${ORBIT_SWAY_DEG}deg); }
  75%  { transform: rotate(-${ORBIT_SWAY_DEG}deg); }
  100% { transform: rotate(0deg); }
}
.orbit-items > g, .orbit-connection {
  fill-opacity: ${ITEM_ALPHA};
  stroke-opacity: ${ITEM_ALPHA};
  transition: fill-opacity 0.2s ease, stroke-opacity 0.2s ease;
}
.orbit-items > g[data-hovered], .orbit-connection[data-hovered] {
  fill-opacity: 1;
  stroke-opacity: 1;
}
.orbit-items > g image {
  opacity: ${ITEM_ALPHA};
  transition: opacity 0.2s ease;
}
.orbit-items > g[data-hovered] image { opacity: 1; }
/* Level-of-detail during canvas pan/zoom ([data-canvas-gesture] is set by the
   gesture effect): text and images are the scale-dependent raster hogs — the
   glyphs and bitmaps resample on every zoom tick — so they sit out the
   gesture while rects, lines, and arrows keep the orbit present. */
.orbit-overlay[data-canvas-gesture] text,
.orbit-overlay[data-canvas-gesture] image {
  visibility: hidden;
}
`;

// Suspend CSS animations while the canvas transform is changing and resume
// shortly after it settles ('canvas-transform-change' fires synchronously
// from the pan/zoom mutators). An animating element keeps invalidating its
// raster mid-gesture, exactly when raster work is scarcest. Used by the
// loading dots; the main overlay handles gestures with the promote-and-freeze
// effect in the parent component instead.
const useSuspendAnimationDuringCanvasTransform = (getEls) => {
  useEffect(() => {
    let timer = null;
    const suspend = () => {
      for (const el of getEls()) {
        if (el && el.style.animationName !== 'none') el.style.animationName = 'none';
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        for (const el of getEls()) {
          if (el) el.style.animationName = '';
        }
      }, 250);
    };
    window.addEventListener('canvas-transform-change', suspend);
    return () => {
      window.removeEventListener('canvas-transform-change', suspend);
      if (timer) clearTimeout(timer);
    };
  }, [getEls]);
};

// Predicates that carry no meaning worth drawing. Module scope: this used to be
// rebuilt inside every connection render.
// Note: 'externalUrl' filtered earlier in orbitResolver.js dedupeAndPartitionOrbit()
const HIDDEN_PREDICATES = new Set(['relatedTo', 'related', 'related_to', 'related_via', 'broader', 'narrower', 'seeAlso', 'isPrimaryTopicOf', 'wikiPageWikiLink']);

const hasVisiblePredicate = (predicate) => Boolean(predicate) && !HIDDEN_PREDICATES.has(predicate);

// Deterministic pseudo-random in [0,1) from a string and optional salt
const hashToUnitFloat = (str, salt = '') => {
  let h = 2166136261;
  const s = String(str) + '|' + String(salt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  // Convert to [0,1)
  return (h & 0x7fffffff) / 0x80000000;
};

const ENTRANCE_DURATION_MS = 350;
// Max animation-time credited per painted frame during entrance. Guarantees the
// effect spans at least ~7 painted frames even when mount jank drops real time.
const ENTRANCE_MAX_FRAME_MS = 50;

// Orbit label typography (matches the old foreignObject: 45px bold EmOne, 39px
// line height, 42px side padding). Rendered as native SVG <text> rather than
// foreignObject — foreignObject is far more expensive to rasterize, and the orbit
// overlay repaints with the whole canvas on every zoom frame, so heavy labels
// blew the frame budget and flickered. SVG text repaints cheaply.
const ORBIT_LABEL_FONT_SIZE = 45;
const ORBIT_LABEL_LINE_HEIGHT = 39;
const ORBIT_LABEL_SIDE_PADDING = 42;
const ORBIT_LABEL_FONT_STRING = "bold 45px 'EmOne', sans-serif";

// Connection geometry, matching NodeCanvas edge rendering.
const EDGE_STROKE_BASE = 27;          // NodeCanvas: strokeWidth = 27 * connectionWidth
const ARROW_POLYGON = '-26,34 26,34 0,-34'; // NodeCanvas arrow, verbatim
const ARROW_TIP_EPS = 2;              // px of arrow tip tucked under the item border
const LABEL_HALO_REF_SIZE = 54;       // NodeCanvas: strokeWidth = 8 * (fontSize / 54)
const LABEL_PAD = 30;                 // clearance each side of a connection label

/**
 * Connection geometry from the focus node to one orbit item, matching how
 * NodeCanvas draws edges. Shared by the initial React render and the animation
 * loop so both agree on every frame.
 *
 * Unlike the canvas, the arrow tip stops AT the item border rather than
 * penetrating it: canvas nodes are opaque and hide the overlap, orbit items
 * render at 0.85 opacity and would let it show through.
 *
 * `innerFreeRadius` is where the label's half of the run begins — the focus
 * node's border for ring 1, the previous ring's outer edge beyond that, so
 * labels land in open annular gaps instead of on top of inner-ring items.
 */
function computeOrbitConnectionGeometry({
  sourceX, sourceY,
  focusWidth, focusHeight,
  targetCx, targetCy,
  targetW, targetH,
  connectionWidth,
  innerFreeRadius,
}) {
  const dx = targetCx - sourceX;
  const dy = targetCy - sourceY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // Border crossing on the target, ray cast from the item's center back toward
  // the source (NodeCanvas passes the reversed direction the same way).
  const hit = getNodeEdgeIntersection(
    targetCx - targetW / 2, targetCy - targetH / 2, targetW, targetH, -ux, -uy
  );
  const targetBorderDist = hit ? len - hit.distance : Math.max(0, len - Math.max(targetW, targetH) / 2);
  const borderX = hit ? hit.x : sourceX + ux * targetBorderDist;
  const borderY = hit ? hit.y : sourceY + uy * targetBorderDist;

  // NodeCanvas pulls the arrow back 12px from the border, 7.2px on near
  // axis-aligned slopes where the ray meets a flat side instead of a corner.
  const angleDeg = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  const normalizedAngle = angleDeg > 90 ? 180 - angleDeg : angleDeg;
  const isQuantizedSlope = normalizedAngle < 15 || normalizedAngle > 75;
  const canvasOffset = isQuantizedSlope ? 12 * 0.6 : 12;
  // Back the whole triangle out so its tip, POLY_TIP*cw ahead of the origin,
  // lands just inside the border.
  const pullback = Math.max(canvasOffset, POLY_TIP * connectionWidth - ARROW_TIP_EPS);

  const arrowX = borderX - ux * pullback;
  const arrowY = borderY - uy * pullback;
  const arrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);

  // Label sits at the midpoint of the open run: from the focus border (or the
  // previous ring's outer edge) to the target border.
  const sourceHit = getNodeEdgeIntersection(
    sourceX - focusWidth / 2, sourceY - focusHeight / 2, focusWidth, focusHeight, ux, uy
  );
  const innerR = innerFreeRadius != null
    ? innerFreeRadius
    : (sourceHit ? sourceHit.distance : Math.max(focusWidth, focusHeight) / 2);
  const labelDist = (innerR + targetBorderDist) / 2;

  let labelAngle = arrowAngle;
  if (labelAngle > 90 || labelAngle < -90) labelAngle += 180; // keep text upright

  return {
    x1: sourceX,
    y1: sourceY,
    x2: arrowX,
    y2: arrowY,
    arrowTransform: `translate(${arrowX}, ${arrowY}) rotate(${arrowAngle + 90}) scale(${connectionWidth})`,
    labelTransform: `translate(${sourceX + ux * labelDist}, ${sourceY + uy * labelDist}) rotate(${labelAngle})`,
  };
}

// Connection from the focus node to one orbit item. Renders once per data
// change; the animation loop moves it by writing attributes through the refs it
// hands back via `registerConn`.
const OrbitConnection = React.memo(function OrbitConnection({
  id,
  sourceX,
  sourceY,
  focusWidth,
  focusHeight,
  baseTargetCx,
  baseTargetCy,
  targetW,
  targetH,
  innerFreeRadius,
  predicate,
  color,
  connectionWidth,
  labelFontSize,
  darkMode,
  registerConn,
}) {
  const geom = computeOrbitConnectionGeometry({
    sourceX, sourceY, focusWidth, focusHeight,
    targetCx: baseTargetCx, targetCy: baseTargetCy,
    targetW, targetH, connectionWidth, innerFreeRadius,
  });

  const elsRef = useRef({});
  const setGroup = useCallback((el) => {
    elsRef.current.connG = el;
    if (el) registerConn(id, elsRef.current);
    else registerConn(id, null);
  }, [id, registerConn]);

  const fill = darkMode ? getDarkHueText(color) : getLightHueText(color);
  const halo = darkMode ? getLightHueText(color) : getDarkHueText(color);

  return (
    <g ref={setGroup} className="orbit-connection" style={{ pointerEvents: 'none' }}>
      <line
        ref={(el) => { elsRef.current.connLine = el; }}
        x1={geom.x1}
        y1={geom.y1}
        x2={geom.x2}
        y2={geom.y2}
        stroke={color}
        strokeWidth={EDGE_STROKE_BASE * connectionWidth}
        strokeLinecap="round"
      />

      <g ref={(el) => { elsRef.current.arrowG = el; }} transform={geom.arrowTransform}>
        <polygon
          points={ARROW_POLYGON}
          fill={color}
          stroke={color}
          strokeWidth="6"
          strokeLinejoin="round"
          strokeLinecap="round"
          paintOrder="stroke fill"
        />
      </g>

      <g ref={(el) => { elsRef.current.labelG = el; }} transform={geom.labelTransform}>
        <text
          x={0}
          y={0}
          fontSize={labelFontSize}
          fontFamily="'EmOne', sans-serif"
          fontWeight="bold"
          fill={fill}
          stroke={halo}
          strokeWidth={8 * (labelFontSize / LABEL_HALO_REF_SIZE)}
          strokeLinecap="round"
          strokeLinejoin="round"
          paintOrder="stroke fill"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ userSelect: 'none' }}
        >
          {formatPredicate(predicate)}
        </text>
      </g>
    </g>
  );
});

const DraggableOrbitItem = React.memo(function DraggableOrbitItem({
  candidate,
  x,
  y,
  dims,
  darkMode,
  onHoverChange,
  onClick,
  registerItemEl,
}) {
  const concept = useMemo(() => candidateToConcept(candidate), [candidate]);

  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: SPAWNABLE_NODE,
    item: {
      prototypeId: null,
      nodeId: null,
      nodeName: candidate.name,
      nodeColor: candidate.color || NODE_DEFAULT_COLOR,
      fromOrbitOverlay: true,
      conceptData: concept,
      needsMaterialization: true
    },
    collect: (monitor) => ({ isDragging: !!monitor.isDragging() }),
  }), [candidate, concept]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  const label = candidate.name || 'Untitled';
  const fill = candidate.color || NODE_DEFAULT_COLOR;
  const hasImage = Boolean(candidate.imageSrc);

  const { currentWidth, currentHeight, scaledCornerRadius } = dims;
  const effectiveCornerRadius = scaledCornerRadius || NODE_CORNER_RADIUS;

  const textColor = getTextColor(fill, darkMode);

  // Word-wrap the label into lines for SVG <text> rendering (no foreignObject).
  const nameLines = useMemo(
    () => (hasImage
      ? []
      : wrapTextToLines(label, Math.max(1, currentWidth - 2 * ORBIT_LABEL_SIDE_PADDING), ORBIT_LABEL_FONT_STRING)),
    [hasImage, label, currentWidth]
  );

  // react-dnd's drag connector and the animation registry both need this node.
  const setRef = useCallback((el) => {
    drag(el);
    registerItemEl(candidate.id, el);
  }, [drag, registerItemEl, candidate.id]);

  // Tap tracking: fire onClick on touchend (finger up), not touchstart, and only if movement
  // stayed within slop and react-dnd didn't claim this as a drag.
  const touchRef = useRef({ startX: 0, startY: 0, moved: false });
  const handleTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    touchRef.current = { startX: t.clientX, startY: t.clientY, moved: false };
  };
  const handleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t || touchRef.current.moved) return;
    const dx = t.clientX - touchRef.current.startX;
    const dy = t.clientY - touchRef.current.startY;
    if (dx * dx + dy * dy > 100) touchRef.current.moved = true; // >10px
  };
  const handleTouchEnd = (e) => {
    if (touchRef.current.moved || isDragging) return;
    if (e.cancelable) e.preventDefault(); // suppress the synthetic click that follows
    e.stopPropagation();
    onClick?.(candidate, x, y, { currentWidth, currentHeight });
  };

  return (
    <g
      ref={setRef}
      // No transform or opacity from React: the animation loop owns both, and a
      // re-render (drag start/end) would otherwise stomp the current frame.
      style={{
        ...(isDragging ? { opacity: 0.3 } : null),
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
      }}
      onClick={(e) => { e.stopPropagation(); onClick?.(candidate, x, y, { currentWidth, currentHeight }); }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => onHoverChange?.(candidate.id, true)}
      onMouseLeave={() => onHoverChange?.(candidate.id, false)}
    >
      {/* Clip path for image nodes */}
      {hasImage && (
        <defs>
          <clipPath id={`orbit-image-clip-${candidate.id}`}>
            <rect
              x={x}
              y={y}
              width={currentWidth}
              height={currentHeight}
              rx={effectiveCornerRadius}
              ry={effectiveCornerRadius}
            />
          </clipPath>
        </defs>
      )}

      {/* Image (if present) */}
      {hasImage && (
        <image
          x={x}
          y={y}
          width={currentWidth}
          height={currentHeight}
          href={candidate.imageSrc}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#orbit-image-clip-${candidate.id})`}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Node background - stroke for image nodes, fill for text nodes */}
      <rect
        x={x}
        y={y}
        width={currentWidth}
        height={currentHeight}
        rx={effectiveCornerRadius}
        ry={effectiveCornerRadius}
        fill={hasImage ? 'none' : fill}
        stroke={hasImage ? fill : 'none'}
        strokeWidth={hasImage ? 1.5 : 0}
        style={{ pointerEvents: 'none' }}
      />

      {/* Label as native SVG text (word-wrapped, block-centered) — only if no image */}
      {!hasImage && nameLines.length > 0 && (
        <text
          x={x + currentWidth / 2}
          y={y + currentHeight / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="'EmOne', sans-serif"
          fontWeight="bold"
          fontSize={ORBIT_LABEL_FONT_SIZE}
          fill={textColor}
          style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '-0.3px' }}
        >
          {nameLines.map((line, i) => (
            <tspan
              key={i}
              x={x + currentWidth / 2}
              dy={i === 0 ? -((nameLines.length - 1) * ORBIT_LABEL_LINE_HEIGHT) / 2 : ORBIT_LABEL_LINE_HEIGHT}
            >
              {line}
            </tspan>
          ))}
        </text>
      )}

      {/* Transparent hit target. The visible fills use pointerEvents:none, so this
          captures clicks / drag-start for the group (replaces the foreignObject's
          old hit area). */}
      <rect
        x={x}
        y={y}
        width={currentWidth}
        height={currentHeight}
        rx={effectiveCornerRadius}
        ry={effectiveCornerRadius}
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
      />
    </g>
  );
});

const computeRingRadius = (items, innerEdgeRadius, spacing, count) => {
  // innerEdgeRadius = the outer edge of the previous ring (or source node)
  if (items.length === 0 || count === 0) {
    return innerEdgeRadius + spacing;
  }

  const maxWidth = items.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0);

  // For a single item, no chord geometry needed
  if (count === 1) {
    return innerEdgeRadius + spacing + maxWidth / 2;
  }

  const chordNeeded = maxWidth + spacing;
  const dTheta = (Math.PI * 2) / count;
  const minR = chordNeeded / (2 * Math.sin(dTheta / 2));
  return Math.max(innerEdgeRadius + spacing + maxWidth / 2, minR);
};

// Nudge an angle away from blocked angular ranges (inner ring items' connection paths)
const COLLISION_PAD_RAD = 0.04; // extra angular padding after nudge (~2.3°)

function nudgeAngleAwayFromBlocked(angle, blockedRanges) {
  for (const { angle: blocked, halfWidth } of blockedRanges) {
    let diff = angle - blocked;
    // Normalize to [-π, π]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) < halfWidth) {
      // Nudge in whichever direction is closer to escaping the blocked range
      const nudgeDir = diff >= 0 ? 1 : -1;
      angle = blocked + nudgeDir * (halfWidth + COLLISION_PAD_RAD);
    }
  }
  return angle;
}

const measureCandidates = (candidates) => {
  return candidates.map((c) => {
    const tempNode = {
      id: `orbit-${c.id}`,
      x: 0,
      y: 0,
      scale: 1,
      prototypeId: null,
      name: c.name,
      color: c.color || NODE_DEFAULT_COLOR,
      definitionGraphIds: []
    };
    const dims = getNodeDimensions(tempNode, false, null);
    return { candidate: c, dims };
  });
};

// Radial room a ring's connection labels need, so the gap in front of the ring
// can hold them. Labels lie along the radius, so their width is what competes.
const ringLabelRoom = (measured, labelFontSize) => measured.reduce((m, { candidate }) => (
  hasVisiblePredicate(candidate.predicate)
    ? Math.max(m, estimateEdgeLabelWidth(formatPredicate(candidate.predicate), labelFontSize))
    : m
), 0);

// Loading animation: dots orbiting the node's rounded rectangle
const LOADING_DOT_COUNT = 8;
const LOADING_DOT_RADIUS = 6;
const LOADING_PAD = 40; // padding beyond node bounds
const LOADING_ORBIT_PERIOD_SEC = 3; // one full loop in seconds

function pointOnRoundedRect(t, cx, cy, w, h, cr) {
  // Parameterize the rounded rect perimeter clockwise from top-center
  // t ∈ [0, 1) maps to position on the perimeter
  const topStraight = w - 2 * cr;
  const rightStraight = h - 2 * cr;
  const bottomStraight = w - 2 * cr;
  const leftStraight = h - 2 * cr;
  const arcLen = (Math.PI / 2) * cr; // quarter circle
  const perimeter = topStraight + rightStraight + bottomStraight + leftStraight + 4 * arcLen;
  let d = ((t % 1) + 1) % 1 * perimeter; // distance along perimeter

  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;

  // Segment 1: top edge (left-to-right, after top-left corner)
  if (d < topStraight) {
    return { x: left + cr + d, y: top };
  }
  d -= topStraight;

  // Segment 2: top-right arc
  if (d < arcLen) {
    const a = -Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
    return { x: right - cr + cr * Math.cos(a), y: top + cr + cr * Math.sin(a) };
  }
  d -= arcLen;

  // Segment 3: right edge (top-to-bottom)
  if (d < rightStraight) {
    return { x: right, y: top + cr + d };
  }
  d -= rightStraight;

  // Segment 4: bottom-right arc
  if (d < arcLen) {
    const a = 0 + (d / arcLen) * (Math.PI / 2);
    return { x: right - cr + cr * Math.cos(a), y: bottom - cr + cr * Math.sin(a) };
  }
  d -= arcLen;

  // Segment 5: bottom edge (right-to-left)
  if (d < bottomStraight) {
    return { x: right - cr - d, y: bottom };
  }
  d -= bottomStraight;

  // Segment 6: bottom-left arc
  if (d < arcLen) {
    const a = Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
    return { x: left + cr + cr * Math.cos(a), y: bottom - cr + cr * Math.sin(a) };
  }
  d -= arcLen;

  // Segment 7: left edge (bottom-to-top)
  if (d < leftStraight) {
    return { x: left, y: bottom - cr - d };
  }
  d -= leftStraight;

  // Segment 8: top-left arc
  {
    const a = Math.PI + (d / arcLen) * (Math.PI / 2);
    return { x: left + cr + cr * Math.cos(a), y: top + cr + cr * Math.sin(a) };
  }
}

const LOADING_PULSE_KEYFRAMES = `
@keyframes orbit-dot-pulse {
  0%   { opacity: 0.85; }
  55%  { opacity: 0.18; }
  100% { opacity: 0.85; }
}`;

const OrbitLoadingDots = ({ centerX, centerY, focusWidth, focusHeight, textPrimary, nodeScale }) => {
  const groupRef = useRef(null);
  const getAnimatedEls = useCallback(
    () => (groupRef.current ? Array.from(groupRef.current.querySelectorAll('circle')) : []),
    []
  );
  useSuspendAnimationDuringCanvasTransform(getAnimatedEls);

  const w = focusWidth + 2 * LOADING_PAD;
  const h = focusHeight + 2 * LOADING_PAD;
  // Match the node's scaled corner radius (getNodeDimensions: NODE_CORNER_RADIUS * 1.4 * nodeScale)
  const cr = NODE_CORNER_RADIUS * 1.4 * nodeScale;

  // Dots hold still; a phase-staggered opacity pulse chases around the border
  // for the comet effect. CSS opacity animations run on the compositor, so
  // loading drives no main-thread frames and never repaints the canvas
  // surface (the old version rewrote cx/cy in a RAF loop, re-rastering the
  // whole SVG on every frame for the entire fetch).
  const dots = [];
  for (let i = 0; i < LOADING_DOT_COUNT; i++) {
    const t = i / LOADING_DOT_COUNT;
    const pos = pointOnRoundedRect(t, centerX, centerY, w, h, cr);
    dots.push(
      <circle
        key={i}
        cx={pos.x}
        cy={pos.y}
        r={LOADING_DOT_RADIUS}
        fill={textPrimary}
        opacity={0.85}
        style={{
          animation: `orbit-dot-pulse ${LOADING_ORBIT_PERIOD_SEC}s linear infinite`,
          animationDelay: `${(-t * LOADING_ORBIT_PERIOD_SEC).toFixed(3)}s`,
        }}
      />
    );
  }

  return (
    <g ref={groupRef} className="orbit-loading-dots">
      <style>{LOADING_PULSE_KEYFRAMES}</style>
      {dots}
    </g>
  );
};

export default function OrbitOverlay({
  centerX,
  centerY,
  focusWidth,
  focusHeight,
  ring1Candidates,
  ring2Candidates,
  ring3Candidates,
  ring4Candidates,
  onOrbitItemClick,
  isLoading = false
}) {
  // Store reads live in the parent only. Every child subscribing separately put
  // ~3N selectors on the store, all of them re-running on every write.
  const theme = useTheme();
  const darkMode = theme.darkMode;
  const connectionWidth = useGraphStore(state => state.textSettings?.connectionWidth ?? 1.0);
  const fontScale = useGraphStore(state => state.textSettings?.fontSize || 1);
  const connectionLabelSize = useGraphStore(state => state.connectionLabelSize ?? 1.0);
  const nodeScale = useGraphStore(state => state.textSettings?.nodeScale ?? 1.0);

  const labelFontSize = useMemo(
    () => resolveEdgeLabelFontSize({ fontSize: fontScale }, connectionLabelSize),
    [fontScale, connectionLabelSize]
  );

  const measuredRing1 = useMemo(() => measureCandidates(ring1Candidates || []), [ring1Candidates]);
  const measuredRing2 = useMemo(() => measureCandidates(ring2Candidates || []), [ring2Candidates]);
  const measuredRing3 = useMemo(() => measureCandidates(ring3Candidates || []), [ring3Candidates]);
  const measuredRing4 = useMemo(() => measureCandidates(ring4Candidates || []), [ring4Candidates]);

  const centerRadius = useMemo(() => {
    return Math.max(focusWidth, focusHeight) / 2;
  }, [focusWidth, focusHeight]);

  // Ring radii, chained outward. Each gap must clear the ring's own connection
  // labels — they lie along the radius, so a long predicate pushes its ring out.
  const rings = useMemo(() => {
    const measured = [measuredRing1, measuredRing2, measuredRing3, measuredRing4];
    const arrowRoom = 2 * POLY_TIP * connectionWidth;
    const radii = [];
    const innerFree = [];
    let innerEdge = centerRadius;

    for (let k = 0; k < 4; k++) {
      const items = measured[k];
      const minGap = k === 0 ? SOURCE_TO_RING_MARGIN : INTER_RING_MARGIN;
      const gap = Math.max(minGap, ringLabelRoom(items, labelFontSize) + arrowRoom + 2 * LABEL_PAD);
      const radius = computeRingRadius(items, innerEdge, gap, Math.max(1, items.length));
      radii.push(radius);
      // Ring 1 measures its label run from the focus node's own border.
      innerFree.push(k === 0 ? null : innerEdge);
      const maxWidth = items.length > 0
        ? items.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0)
        : 0;
      innerEdge = radius + maxWidth / 2;
    }

    return { radii, innerFree };
  }, [measuredRing1, measuredRing2, measuredRing3, measuredRing4, centerRadius, labelFontSize, connectionWidth]);

  // Collision-free base angles for all rings (recomputed only when ring
  // compositions or radii change, never per frame)
  const collisionFreeAngles = useMemo(() => {
    const [ring1Radius, ring2Radius, ring3Radius] = rings.radii;

    // Ring 1: evenly spaced, no collision avoidance needed (reference ring)
    const r1n = Math.max(1, measuredRing1.length);
    const ring1Angles = measuredRing1.map((_, i) => (2 * Math.PI * i) / r1n);

    // Build blocked ranges from ring1: angular width each item blocks at ring1's radius
    const ring1Blocked = ring1Angles.map((a, i) => ({
      angle: a,
      halfWidth: (measuredRing1[i]?.dims.currentWidth / 2 + 30) / ring1Radius,
    }));

    // Ring 2: half-step brick offset + nudge away from ring1 items
    const r2n = Math.max(1, measuredRing2.length);
    const r2Offset = Math.PI / Math.max(2, r2n);
    const ring2Angles = measuredRing2.map((_, i) => {
      const raw = (2 * Math.PI * i) / r2n + r2Offset;
      return nudgeAngleAwayFromBlocked(raw, ring1Blocked);
    });

    const ring2Blocked = ring2Angles.map((a, i) => ({
      angle: a,
      halfWidth: (measuredRing2[i]?.dims.currentWidth / 2 + 30) / ring2Radius,
    }));
    const blocked12 = [...ring1Blocked, ...ring2Blocked];

    // Ring 3: quarter-step offset + nudge away from ring1 & ring2 items
    const r3n = Math.max(1, measuredRing3.length);
    const r3Offset = Math.PI / (2 * Math.max(2, r3n));
    const ring3Angles = measuredRing3.map((_, i) => {
      const raw = (2 * Math.PI * i) / r3n + r3Offset;
      return nudgeAngleAwayFromBlocked(raw, blocked12);
    });

    const ring3Blocked = ring3Angles.map((a, i) => ({
      angle: a,
      halfWidth: (measuredRing3[i]?.dims.currentWidth / 2 + 30) / ring3Radius,
    }));
    const blocked123 = [...blocked12, ...ring3Blocked];

    // Ring 4: 3/4-step offset + nudge away from all inner items
    const r4n = Math.max(1, measuredRing4.length);
    const r4Offset = (3 * Math.PI) / (2 * Math.max(2, r4n));
    const ring4Angles = measuredRing4.map((_, i) => {
      const raw = (2 * Math.PI * i) / r4n + r4Offset;
      return nudgeAngleAwayFromBlocked(raw, blocked123);
    });

    return [ring1Angles, ring2Angles, ring3Angles, ring4Angles];
  }, [measuredRing1, measuredRing2, measuredRing3, measuredRing4, rings]);

  // Resting positions plus each item's animation seeds. No time dependency: the
  // animation loop derives every frame from these without React re-rendering.
  const placements = useMemo(() => {
    const measured = [measuredRing1, measuredRing2, measuredRing3, measuredRing4];
    const out = [];
    for (let k = 0; k < 4; k++) {
      const ringRadius = rings.radii[k];
      const innerFreeRadius = rings.innerFree[k];
      const baseAngles = collisionFreeAngles[k];
      const salt = `ring${k + 1}`;
      for (let i = 0; i < measured[k].length; i++) {
        const { candidate, dims } = measured[k][i];
        const baseAngle = baseAngles[i] ?? 0;
        const seed1 = hashToUnitFloat(candidate.id, `${salt}:radial`);
        const seed2 = hashToUnitFloat(candidate.id, `${salt}:angle`);
        const seed3 = hashToUnitFloat(candidate.id, `${salt}:freqR`);
        const seed4 = hashToUnitFloat(candidate.id, `${salt}:freqA`);
        out.push({
          key: `ring${k + 1}-${candidate.id}`,
          id: candidate.id,
          candidate,
          dims,
          ringRadius,
          innerFreeRadius,
          baseAngle,
          baseCx: centerX + ringRadius * Math.cos(baseAngle),
          baseCy: centerY + ringRadius * Math.sin(baseAngle),
          radialAmp: RADIAL_PERTURBATION_PX_BASE * (0.6 + 0.8 * seed1),
          angleJitterAmp: ANGLE_JITTER_RAD_BASE * (0.6 + 0.8 * seed2),
          radialFreq: MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed3,
          angleFreq: MIN_FREQ_HZ + (MAX_FREQ_HZ - MIN_FREQ_HZ) * seed4,
          radialPhase: seed1 * 10,
          anglePhase: seed2 * 10,
        });
      }
    }
    return out;
  }, [measuredRing1, measuredRing2, measuredRing3, measuredRing4, rings, collisionFreeAngles, centerX, centerY]);

  const placementsById = useMemo(() => {
    const m = new Map();
    for (const p of placements) m.set(p.id, p);
    return m;
  }, [placements]);

  // Everything the animation loop needs, refreshed each render so it always
  // animates against current geometry without being restarted.
  const paramsRef = useRef();
  paramsRef.current = {
    centerX, centerY, focusWidth, focusHeight, connectionWidth, byId: placementsById,
  };

  // id -> { itemG, conn: {connG, connLine, arrowG, labelG} | null, entElapsed, lastTs, entranceDone }
  const elsRef = useRef(new Map());
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const swayRef = useRef(null);
  const overlayRootRef = useRef(null);
  // Canvas pan/zoom gesture in flight: rotation frozen, overlay hidden.
  const transformPausedRef = useRef(false);
  const transformPauseBeganRef = useRef(0);
  const lastWriteTsRef = useRef(0);
  const clockRef = useRef({ startTs: null, pausedTotal: 0, pauseStart: null });

  const entryFor = useCallback((id) => {
    let entry = elsRef.current.get(id);
    if (!entry) {
      entry = { itemG: null, conn: null, entElapsed: 0, lastTs: null, entranceDone: false };
      elsRef.current.set(id, entry);
    }
    return entry;
  }, []);

  const ensureRafRunning = useCallback(() => {
    if (runningRef.current || transformPausedRef.current || elsRef.current.size === 0) return;
    runningRef.current = true;
    rafRef.current = requestAnimationFrame(function loop(ts) {
      if (transformPausedRef.current) {
        // A canvas gesture started after this frame was scheduled. Write
        // nothing — the compositor is reusing the overlay's cached raster —
        // and stand down; the gesture-end timer restarts the loop.
        runningRef.current = false;
        rafRef.current = null;
        return;
      }
      // Runtime A/B switch: `window.__orbitFreeze = true` in the console skips
      // every write while keeping the loop alive (`false` resumes instantly).
      // With this on, the orbit contributes zero raster invalidation — if the
      // tile-memory warnings continue anyway, the pressure is static content,
      // not this loop.
      if (typeof window !== 'undefined' && window.__orbitFreeze) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const { centerX: cx0, centerY: cy0, focusWidth: fw, focusHeight: fh, connectionWidth: cw, byId } = paramsRef.current;
      const clock = clockRef.current;

      if (clock.startTs === null) clock.startTs = ts;
      if (pausedRef.current) {
        if (clock.pauseStart === null) clock.pauseStart = ts;
      } else if (clock.pauseStart !== null) {
        clock.pausedTotal += ts - clock.pauseStart;
        clock.pauseStart = null;
      }
      // Count the in-progress pause too, so orbit time holds still on frames
      // that keep painting through a hover (an item still entering, say).
      const pausedSoFar = clock.pausedTotal + (clock.pauseStart !== null ? ts - clock.pauseStart : 0);
      const t = (ts - clock.startTs - pausedSoFar) / 1000;

      // Steady-state throttle (see STEADY_WRITE_HZ_DEFAULT / window.__orbitHz).
      // Entries mid-entrance write every frame; settled entries only on the
      // throttled passes. A hover-pause frame always writes so the frozen pose
      // lands before the loop stands down.
      const hzOverride = typeof window !== 'undefined' ? Number(window.__orbitHz) : NaN;
      const steadyIntervalMs = 1000 / (hzOverride > 0 ? hzOverride : STEADY_WRITE_HZ_DEFAULT);
      const writeSteady = pausedRef.current || ts - lastWriteTsRef.current >= steadyIntervalMs;
      if (writeSteady) lastWriteTsRef.current = ts;

      let entranceActive = false;

      for (const [id, els] of elsRef.current) {
        const p = byId.get(id);
        if (!p) continue;
        // Settled entries wait for a throttled pass; their sub-pixel drift is
        // not worth a raster invalidation every frame.
        if (els.entranceDone && !writeSteady) continue;

        // Entrance clock is per item and credited per painted frame with a
        // capped delta: mounting the orbit janks the main thread, and wall time
        // would burn the whole window before the first frame paints.
        let ease = 1;
        if (!els.entranceDone) {
          if (els.lastTs !== null) els.entElapsed += Math.min(ts - els.lastTs, ENTRANCE_MAX_FRAME_MS);
          const progress = Math.min(1, els.entElapsed / ENTRANCE_DURATION_MS);
          ease = 1 - Math.pow(1 - progress, 3);
          if (progress >= 1) {
            els.entranceDone = true;
            // Clear the entrance's group opacity: any value < 1 (even 0.999)
            // would keep the group painting through an isolation surface. The
            // steady-state translucency comes from the stylesheet's
            // fill/stroke-opacity, which needs no surface.
            if (els.itemG) els.itemG.style.opacity = '';
            if (els.conn?.connG) els.conn.connG.style.opacity = '';
          } else {
            entranceActive = true;
          }
        }
        els.lastTs = ts;

        const angle = p.baseAngle
          + (ENABLE_ORBIT_ROTATION ? ORBIT_ANGULAR_SPEED_RAD_PER_SEC * t : 0)
          + p.angleJitterAmp * Math.sin(2 * Math.PI * p.angleFreq * t + p.anglePhase);
        const radius = p.ringRadius + p.radialAmp * Math.sin(2 * Math.PI * p.radialFreq * t + p.radialPhase);
        const cx = cx0 + radius * Math.cos(angle);
        const cy = cy0 + radius * Math.sin(angle);

        if (els.itemG) {
          const drift = `translate(${cx - p.baseCx}, ${cy - p.baseCy})`;
          els.itemG.setAttribute(
            'transform',
            els.entranceDone ? drift : `${drift} translate(${cx}, ${cy}) scale(${ease}) translate(${-cx}, ${-cy})`
          );
          if (!els.entranceDone) els.itemG.style.opacity = String(ease);
        }

        const conn = els.conn;
        if (conn && conn.connG) {
          const g = computeOrbitConnectionGeometry({
            sourceX: cx0, sourceY: cy0,
            focusWidth: fw, focusHeight: fh,
            targetCx: cx, targetCy: cy,
            targetW: p.dims.currentWidth, targetH: p.dims.currentHeight,
            connectionWidth: cw,
            innerFreeRadius: p.innerFreeRadius,
          });
          if (conn.connLine) {
            conn.connLine.setAttribute('x1', g.x1);
            conn.connLine.setAttribute('y1', g.y1);
            conn.connLine.setAttribute('x2', g.x2);
            conn.connLine.setAttribute('y2', g.y2);
          }
          if (conn.arrowG) conn.arrowG.setAttribute('transform', g.arrowTransform);
          if (conn.labelG) conn.labelG.setAttribute('transform', g.labelTransform);
          if (!els.entranceDone) conn.connG.style.opacity = String(ease);
        }
      }

      // Idle out when there is nothing left to move: no rotation wanted, or
      // paused on hover and every entrance has finished.
      const keepGoing = entranceActive || (ENABLE_ORBIT_ROTATION && !pausedRef.current);
      if (keepGoing && elsRef.current.size > 0) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        runningRef.current = false;
        rafRef.current = null;
      }
    });
  }, []);

  // Detaching only clears the element pointer — the entry, and with it the
  // item's entrance progress, survives. React re-runs a ref callback whenever
  // its identity changes, which for these happens on any re-render that swaps
  // react-dnd's connector; dropping the entry there would replay the entrance
  // animation mid-life. Entries whose candidate actually went away are pruned
  // against the current placements instead.
  const registerItemEl = useCallback((id, el) => {
    if (el) {
      const entry = entryFor(id);
      if (entry.itemG !== el) {
        entry.itemG = el;
        el.style.opacity = entry.entranceDone ? '' : '0';
      }
      ensureRafRunning();
    } else {
      const entry = elsRef.current.get(id);
      if (entry) entry.itemG = null;
    }
  }, [entryFor, ensureRafRunning]);

  const registerConn = useCallback((id, els) => {
    if (els) {
      const entry = entryFor(id);
      // Hold the connection's own ref object, not a copy of its fields: its
      // inner ref callbacks re-run on every re-render and rewrite it in place.
      entry.conn = els;
      if (els.connG) {
        els.connG.style.opacity = entry.entranceDone ? '' : '0';
      }
      ensureRafRunning();
    } else {
      const entry = elsRef.current.get(id);
      if (entry) entry.conn = null;
    }
  }, [entryFor, ensureRafRunning]);

  // Hover highlights and pauses without any React state: touching state here
  // would re-render every item and connection on every mouse cross.
  const handleHoverChange = useCallback((id, hovered) => {
    const entry = elsRef.current.get(id);
    if (entry && entry.entranceDone) {
      // [data-hovered] flips the stylesheet's fill/stroke-opacity to 1 with a
      // CSS transition — never group opacity, which would need a surface.
      if (hovered) {
        if (entry.itemG) entry.itemG.setAttribute('data-hovered', '');
        if (entry.conn?.connG) entry.conn.connG.setAttribute('data-hovered', '');
      } else {
        if (entry.itemG) entry.itemG.removeAttribute('data-hovered');
        if (entry.conn?.connG) entry.conn.connG.removeAttribute('data-hovered');
      }
    }
    pausedRef.current = hovered;
    if (!hovered) ensureRafRunning();
  }, [ensureRafRunning]);

  // Drop registry entries for candidates that are gone, so the loop isn't kept
  // alive by entries nothing renders any more.
  useEffect(() => {
    for (const id of elsRef.current.keys()) {
      if (!placementsById.has(id)) elsRef.current.delete(id);
    }
  }, [placementsById]);

  useEffect(() => {
    ensureRafRunning();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      runningRef.current = false;
    };
  }, [ensureRafRunning]);

  // Canvas pan/zoom handling. A zoom re-rasters the whole canvas SVG on
  // every tick — a NodeCanvas design property the overlay cannot change; it
  // can only control how much of its own paint rides in those per-tick
  // passes. Modes, selectable live via `window.__orbitZoomMode`:
  //   'hide' (default) — the overlay sits gestures out entirely
  //                      (visibility:hidden). The only mode measured quiet
  //                      against the GPU tile budget on real hardware.
  //   'lod'            — rects/lines/arrows stay visible; text and images
  //                      (the scale-dependent raster hogs) are shed via the
  //                      stylesheet's [data-canvas-gesture] rules. Measured:
  //                      still exceeds the tile budget while zooming.
  //   'full'           — nothing shed.
  // In every mode the rotation loop freezes during the gesture (its writes
  // would add invalidations on top of the zoom's own). Everything restores
  // 250ms after the last transform event.
  useEffect(() => {
    let timer = null;
    const onCanvasTransform = () => {
      const root = overlayRootRef.current;
      const m = typeof window !== 'undefined' ? window.__orbitZoomMode : undefined;
      const mode = m === 'lod' || m === 'full' ? m : 'hide';
      if (root) {
        if (mode === 'hide' && root.style.visibility !== 'hidden') {
          root.style.visibility = 'hidden';
        } else if (mode === 'lod' && !root.hasAttribute('data-canvas-gesture')) {
          root.setAttribute('data-canvas-gesture', '');
        }
      }
      if (!transformPausedRef.current) {
        transformPausedRef.current = true;
        transformPauseBeganRef.current = performance.now();
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const rootEl = overlayRootRef.current;
        if (rootEl) {
          rootEl.style.visibility = '';
          rootEl.removeAttribute('data-canvas-gesture');
        }
        transformPausedRef.current = false;
        // Credit the gesture's span as paused time so rotation resumes from
        // its frozen pose instead of jumping ahead. When a hover pause was
        // already open across the span, its own frame accounting covers it.
        const clock = clockRef.current;
        if (clock.startTs !== null && clock.pauseStart === null) {
          clock.pausedTotal += performance.now() - transformPauseBeganRef.current;
        }
        ensureRafRunning();
      }, 250);
    };
    window.addEventListener('canvas-transform-change', onCanvasTransform);
    return () => {
      window.removeEventListener('canvas-transform-change', onCanvasTransform);
      if (timer) clearTimeout(timer);
      transformPausedRef.current = false;
      const root = overlayRootRef.current;
      if (root) {
        root.style.visibility = '';
        root.removeAttribute('data-canvas-gesture');
      }
    };
  }, [ensureRafRunning]);

  // Early return check after all hooks are called
  const allEmpty = (!ring1Candidates || ring1Candidates.length === 0) &&
    (!ring2Candidates || ring2Candidates.length === 0) &&
    (!ring3Candidates || ring3Candidates.length === 0) &&
    (!ring4Candidates || ring4Candidates.length === 0);

  if (allEmpty && !isLoading) return null;
  if (allEmpty && isLoading) {
    return (
      <OrbitLoadingDots
        centerX={centerX}
        centerY={centerY}
        focusWidth={focusWidth}
        focusHeight={focusHeight}
        textPrimary={theme.canvas.textPrimary}
        nodeScale={nodeScale}
      />
    );
  }

  return (
    <g className="orbit-overlay" ref={overlayRootRef}>
      <style>{ORBIT_STYLE_SHEET}</style>
      {/* Sandwich: translate the local origin to the focus center, then back,
          so an optional whole-orbit transform (the flag-gated CSS sway) pivots
          about the focus while children keep absolute canvas coordinates. */}
      <g transform={`translate(${centerX} ${centerY})`}>
      <g
        ref={swayRef}
        className="orbit-sway"
        style={ENABLE_ORBIT_SWAY ? {
          // No will-change: it would pin a permanently-promoted GPU texture the
          // size of the whole orbit. The running animation promotes a layer on
          // its own, only while it needs one.
          transformOrigin: '0 0',
          animation: `orbit-sway ${ORBIT_SWAY_PERIOD_SEC}s ease-in-out infinite`,
        } : undefined}
      >
      <g transform={`translate(${-centerX} ${-centerY})`}>
      {/* Render connections FIRST (behind orbit items) */}
      <g className="orbit-connections">
        {placements.filter(p => hasVisiblePredicate(p.candidate.predicate)).map(p => (
          <OrbitConnection
            key={`conn-${p.key}`}
            id={p.id}
            sourceX={centerX}
            sourceY={centerY}
            focusWidth={focusWidth}
            focusHeight={focusHeight}
            baseTargetCx={p.baseCx}
            baseTargetCy={p.baseCy}
            targetW={p.dims.currentWidth}
            targetH={p.dims.currentHeight}
            innerFreeRadius={p.innerFreeRadius}
            predicate={p.candidate.predicate}
            color={p.candidate.color}
            connectionWidth={connectionWidth}
            labelFontSize={labelFontSize}
            darkMode={darkMode}
            registerConn={registerConn}
          />
        ))}
      </g>

      {/* Render orbit items SECOND (on top of connections) */}
      <g className="orbit-items">
        {placements.map(p => (
          <DraggableOrbitItem
            key={p.key}
            candidate={p.candidate}
            x={p.baseCx - p.dims.currentWidth / 2}
            y={p.baseCy - p.dims.currentHeight / 2}
            dims={p.dims}
            darkMode={darkMode}
            onHoverChange={handleHoverChange}
            onClick={onOrbitItemClick}
            registerItemEl={registerItemEl}
          />
        ))}
      </g>
      </g>
      </g>
      </g>
    </g>
  );
}
