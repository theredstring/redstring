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
// Side-to-side clearance between neighbouring items on the same ring. Separate
// from the radial gap on purpose — see computeRingRadius.
const RING_TANGENTIAL_PAD = 60;
// How much of a ring's label width the gap outside ring 1 has to reserve.
//
// Zero, now that labels are centred on the whole focus-border-to-item run
// (see computeOrbitConnectionGeometry): an outer ring's run spans every band
// inside it, so its labels have far more room than any gap in front of the ring
// could give them, and reserving that room again only pushed the ring out. Ring
// 1 still reserves in full — its run is the short one, between the focus node
// and the first ring, and it is the ring worth keeping perfectly circular.
// Anything that still does not fit extends per item instead (labelOverflowExtension).
const OUTER_RING_LABEL_FRACTION = 0;
// How far an outer ring may encroach into the radial footprint of the ring
// inside it, as a fraction of that ring's half-width. Chaining full item widths
// outward is what makes ring 4 so distant, and it assumes an outer item could
// end up directly behind an inner one — which the stagger and the collision
// nudge specifically prevent. Since neighbours are angularly offset, their boxes
// can share some radial band without ever touching.
const RING_STAGGER_OVERLAP = 0.5;
const ORBIT_ANGULAR_SPEED_RAD_PER_SEC = 0.02; // Steady clockwise rotation
// Steady-state motion write rate. This was throttled to 15Hz while the orbit
// dim rect was still in play: that rect laid ~9 viewport areas of 70% black
// over the graph, so every write here had to blend the whole stack beneath it,
// and cutting the write rate was the only lever the overlay had. With the rect
// gone (ENABLE_ORBIT_DIM in NodeCanvas) the writes are ordinary invalidations
// again, and 60Hz measured no worse than 15 — so the animation gets to be
// smooth. Runtime-tunable if it ever needs re-testing:
// `window.__orbitHz = 15` (or 8, 30, ...) in the console overrides it live.
const STEADY_WRITE_HZ_DEFAULT = 60;
// How long after the last canvas transform event the orbit animation resumes.
// Panning is continuous, so a short delay tracks the end of the drag closely.
// Zooming is not: wheel detents and trackpad increments leave gaps that are
// routinely longer than the pan delay, and resuming inside one of those gaps
// reads as the orbit stuttering back to life in the middle of a zoom.
const PAN_RESUME_MS = 250;
const ZOOM_RESUME_MS = 600;

// Whether the rotation loop stands down while the canvas is being panned or
// zoomed.
//
// This was necessary when orbit mode laid a translucent scrim INSIDE the canvas
// content group: every write here had to be blended through it, so the overlay
// had to hold still through a gesture. The scrim is now a separate compositor
// layer above the <svg>, so the overlay's writes are ordinary invalidations and
// the animation can keep running while you move the canvas.
//
// Flip to true (or `window.__orbitGesturePause = true` in the console, which
// wins over this) to bring the pause back.
const PAUSE_DURING_CANVAS_GESTURES = false;
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
// What every OTHER triplet fades to while one is hovered, so the hovered
// subject-predicate-object reads on its own. The focus node is not ours to
// dim — NodeCanvas renders it, above this layer — which is right anyway: it is
// the subject of every triplet here, so it belongs to the hovered one too.
const DIMMED_ALPHA = 0.1;

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
/* Everything that is not the hovered triplet. Listed before [data-hovered] so
   that if the two ever land on one element at once — they shouldn't — being
   hovered wins. */
.orbit-items > g[data-dimmed], .orbit-connection[data-dimmed] {
  fill-opacity: ${DIMMED_ALPHA};
  stroke-opacity: ${DIMMED_ALPHA};
}
.orbit-items > g[data-hovered], .orbit-connection[data-hovered] {
  fill-opacity: 1;
  stroke-opacity: 1;
}
.orbit-items > g image {
  opacity: ${ITEM_ALPHA};
  transition: opacity 0.2s ease;
}
.orbit-items > g[data-dimmed] image { opacity: ${DIMMED_ALPHA}; }
.orbit-items > g[data-hovered] image { opacity: 1; }
/* Entrances write alpha every frame, so the steady-state easing above must not
   also be interpolating it — the two would fight and smear the fade. */
.orbit-items > g[data-entering],
.orbit-items > g[data-entering] image,
.orbit-connection[data-entering] {
  transition: none;
}
/* Level-of-detail during canvas pan/zoom ([data-canvas-gesture] is set by the
   gesture effect): text and images are the scale-dependent raster hogs — the
   glyphs and bitmaps resample on every zoom tick — so they sit out the
   gesture while rects, lines, and arrows keep the orbit present. */
.orbit-overlay[data-canvas-gesture] text,
.orbit-overlay[data-canvas-gesture] image {
  visibility: hidden;
}
`;

/**
 * Fade one entering item/connection WITHOUT group opacity.
 *
 * `element.style.opacity` on a multi-child <g> is the trap the stylesheet note
 * above describes: any value between 0 and 1 makes the rasterizer allocate an
 * offscreen isolation surface for that group. During an entrance that was
 * happening to every item and every connection, every frame — up to ~80 surfaces
 * allocated and torn down at frame rate, which is what pushed the compositor's
 * tile budget over in bursts (and entrances re-fire as candidates stream in).
 *
 * Inherited fill/stroke-opacity paints inline with no surface at all. <image>
 * ignores them, but it is a leaf, and element opacity on a leaf is just paint
 * alpha — no surface either.
 *
 * @param {number} alpha 0..1 entrance progress, already eased
 */
function applyEntranceAlpha(els, alpha) {
  const a = String(ITEM_ALPHA * alpha);
  const itemG = els.itemG;
  if (itemG) {
    itemG.style.fillOpacity = a;
    itemG.style.strokeOpacity = a;
    if (els.itemImage === undefined) els.itemImage = itemG.querySelector('image') || null;
    if (els.itemImage) els.itemImage.style.opacity = a;
  }
  const connG = els.conn?.connG;
  if (connG) {
    connG.style.fillOpacity = a;
    connG.style.strokeOpacity = a;
  }
}

/**
 * Push one triplet into or out of the background while another is hovered.
 *
 * An attribute flip, for the same reason hover brightening is one: the
 * stylesheet's inherited fill/stroke-opacity needs no isolation surface, and
 * its 0.2s transition does the fade for free in both directions.
 *
 * Entering elements are skipped. Their alpha is being written inline every
 * frame by applyEntranceAlpha, which outranks the stylesheet — so they would
 * ignore this. They pick the dim up when their entrance hands alpha back, which
 * matters: candidates stream in, so entrances do finish mid-hover.
 */
function setTripletDimmed(entry, dim) {
  if (!entry || !entry.entranceDone) return;
  for (const el of [entry.itemG, entry.conn?.connG]) {
    if (!el) continue;
    if (dim) el.setAttribute('data-dimmed', '');
    else el.removeAttribute('data-dimmed');
  }
}

/** Hand the element back to the stylesheet's steady-state alpha. */
function clearEntranceAlpha(el) {
  if (!el) return;
  el.style.opacity = '';
  el.style.fillOpacity = '';
  el.style.strokeOpacity = '';
  el.removeAttribute('data-entering');
}

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
 */
function computeOrbitConnectionGeometry({
  sourceX, sourceY,
  focusWidth, focusHeight,
  targetCx, targetCy,
  targetW, targetH,
  connectionWidth,
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

  // Label sits at the midpoint of the VISIBLE run — focus border to item
  // border — which is exactly how NodeCanvas centres an edge label (it builds a
  // separate border-to-border `labelPlacementPath` for the purpose rather than
  // using the drawn path). Outer rings used to start this run at the previous
  // ring's outer edge instead, to keep labels out of the inner bands; that shoved
  // every outer label hard up against its own item and read as badly off-centre.
  // It was also unnecessary: the collision nudge already offsets each outer item
  // angularly from every inner one, so an item's radial run is clear all the way
  // back to the focus node and the label threads between the inner rings.
  const sourceHit = getNodeEdgeIntersection(
    sourceX - focusWidth / 2, sourceY - focusHeight / 2, focusWidth, focusHeight, ux, uy
  );
  const sourceBorderDist = sourceHit ? sourceHit.distance : Math.max(focusWidth, focusHeight) / 2;
  const labelDist = (sourceBorderDist + targetBorderDist) / 2;

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
    targetW, targetH, connectionWidth,
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

/**
 * Radius for one ring.
 *
 * Two independent constraints, and keeping them separate is the whole point:
 *
 *  - RADIAL (`radialGap`): room between this ring and the one inside it, for
 *    the connection line and its arrow — plus, for ring 1 only, its labels.
 *    Labels lie ALONG the radius, so a long predicate widens ring 1's gap.
 *  - TANGENTIAL (`tangentialPad`): side-to-side clearance between neighbouring
 *    items ON this ring. Pushing the ring outward is the only way to buy
 *    angular room, so this term divides by sin(dθ/2) and grows fast.
 *
 * These used to be the same number. Feeding the label-sized radial gap into the
 * chord term meant a ~430px predicate demanded ~430px of *sideways* clearance
 * between items too, which at ten items to a ring inflated the radius by more
 * than a thousand pixels — and each ring chained onto the last, so the outer
 * rings ended up absurdly far out. Labels never needed that: they run radially,
 * and the rings are staggered so a label threads between the outer ring's items
 * rather than colliding with them.
 *
 * Beyond ring 1 the radial gap no longer carries labels at all: an outer label
 * is centred on the run all the way back to the focus node, which is longer than
 * any inter-ring gap, and the rare overflow moves its own item out on its own
 * (labelOverflowExtension) rather than moving the ring.
 */
const computeRingRadius = (items, innerEdgeRadius, radialGap, tangentialPad, count) => {
  // innerEdgeRadius = the outer edge of the previous ring (or source node)
  if (items.length === 0 || count === 0) {
    return innerEdgeRadius + radialGap;
  }

  const maxWidth = items.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0);
  const radialMin = innerEdgeRadius + radialGap + maxWidth / 2;

  // For a single item, no chord geometry needed
  if (count === 1) return radialMin;

  const chordNeeded = maxWidth + tangentialPad;
  const dTheta = (Math.PI * 2) / count;
  const minR = chordNeeded / (2 * Math.sin(dTheta / 2));
  return Math.max(radialMin, minR);
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

// Distance from a box's centre to its border along a unit direction — the same
// ray/AABB cast the connection geometry uses, hoisted so layout can ask the
// question before anything is drawn.
const halfExtentAlong = (w, h, ux, uy) => {
  const hit = getNodeEdgeIntersection(-w / 2, -h / 2, w, h, ux, uy);
  return hit ? hit.distance : Math.max(w, h) / 2;
};

/**
 * How much further out ONE item has to sit for its own label to fit.
 *
 * The label is centred on the run between the focus node's border and the
 * item's, so that run has to be at least as long as the label plus its
 * clearance. When it isn't, the item moves outward by the shortfall — its
 * connection line and arrowhead follow, since both derive from the item's
 * centre — rather than the whole ring moving out to accommodate one long
 * predicate. Ring radii are set by the widest label on the ring, so under the
 * old scheme a single verbose relation pushed its ring out and every ring
 * beyond it chained onto that. This localises the cost to the item that caused it.
 */
const labelOverflowExtension = ({
  ringRadius, angle, focusWidth, focusHeight, dims, predicate, labelFontSize,
}) => {
  if (!hasVisiblePredicate(predicate)) return 0;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const sourceBorder = halfExtentAlong(focusWidth, focusHeight, ux, uy);
  // Cast back toward the focus node, the direction the connection arrives from.
  const targetBorder = ringRadius - halfExtentAlong(dims.currentWidth, dims.currentHeight, -ux, -uy);
  const available = targetBorder - sourceBorder;
  const needed = estimateEdgeLabelWidth(formatPredicate(predicate), labelFontSize) + 2 * LABEL_PAD;
  // Moving the item out by d lengthens the run by exactly d (the direction, and
  // so both border crossings, are unchanged), so one pass closes the gap.
  return Math.max(0, needed - available);
};

// Loading animation: dots orbiting the node's rounded rectangle
const LOADING_DOT_COUNT = 8;
const LOADING_DOT_RADIUS = 6;
const LOADING_PAD = 40; // padding beyond node bounds
const LOADING_ORBIT_PERIOD_SEC = 3; // one full loop in seconds
// Fixed light colour, deliberately NOT theme.canvas.textPrimary. These dots sit
// on the orbit scrim, which is the same dark overlay in either theme — so the
// light-mode text colour (#260000, near black) vanished against it. Matches the
// dark theme's primary text, which is what the scrim effectively makes this.
const LOADING_DOT_COLOR = '#DEDADA';

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

const OrbitLoadingDots = ({ centerX, centerY, focusWidth, focusHeight, nodeScale }) => {
  const dotsRef = useRef([]);

  const w = focusWidth + 2 * LOADING_PAD;
  const h = focusHeight + 2 * LOADING_PAD;
  // Match the node's scaled corner radius (getNodeDimensions: NODE_CORNER_RADIUS * 1.4 * nodeScale)
  const cr = NODE_CORNER_RADIUS * 1.4 * nodeScale;

  // Geometry the loop reads each frame. In a ref so a prop change repositions
  // the dots without tearing down and restarting the animation mid-loop.
  const geomRef = useRef(null);
  geomRef.current = { centerX, centerY, w, h, cr };

  // The dots travel around the node's border. They were parked in place at one
  // point — only a staggered opacity pulse moving between them — because every
  // cx/cy write repainted the canvas, and orbit mode then laid a translucent
  // scrim over the whole graph that every one of those repaints had to blend
  // through. That scrim is a separate compositor layer now, so eight attribute
  // writes a frame are ordinary and the dots can actually travel again. The
  // pulse stays on top of the motion — together they give the comet trail.
  useEffect(() => {
    let raf = 0;
    let startTs = null;
    const loop = (ts) => {
      if (startTs === null) startTs = ts;
      const phase = ((ts - startTs) / 1000 / LOADING_ORBIT_PERIOD_SEC) % 1;
      const g = geomRef.current;
      for (let i = 0; i < dotsRef.current.length; i++) {
        const el = dotsRef.current[i];
        if (!el) continue;
        const t = (i / LOADING_DOT_COUNT + phase) % 1;
        const pos = pointOnRoundedRect(t, g.centerX, g.centerY, g.w, g.h, g.cr);
        el.setAttribute('cx', pos.x);
        el.setAttribute('cy', pos.y);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dots = [];
  for (let i = 0; i < LOADING_DOT_COUNT; i++) {
    const t = i / LOADING_DOT_COUNT;
    const pos = pointOnRoundedRect(t, centerX, centerY, w, h, cr);
    dots.push(
      <circle
        key={i}
        ref={(el) => { dotsRef.current[i] = el; }}
        cx={pos.x}
        cy={pos.y}
        r={LOADING_DOT_RADIUS}
        fill={LOADING_DOT_COLOR}
        opacity={0.85}
        style={{
          animation: `orbit-dot-pulse ${LOADING_ORBIT_PERIOD_SEC}s linear infinite`,
          animationDelay: `${(-t * LOADING_ORBIT_PERIOD_SEC).toFixed(3)}s`,
        }}
      />
    );
  }

  return (
    <g className="orbit-loading-dots">
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
  onExtentChange,
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
    let innerEdge = centerRadius;

    // Live tuning: `window.__orbitRings = { tangentialPad, outerLabelFraction,
    // staggerOverlap, sourceMargin, interRingMargin }` overrides any of these.
    const dial = (typeof window !== 'undefined' && window.__orbitRings) || null;
    const tangentialPad = dial?.tangentialPad ?? RING_TANGENTIAL_PAD;
    const outerLabelFraction = dial?.outerLabelFraction ?? OUTER_RING_LABEL_FRACTION;
    const staggerOverlap = Math.min(0.8, Math.max(0, dial?.staggerOverlap ?? RING_STAGGER_OVERLAP));
    const sourceMargin = dial?.sourceMargin ?? SOURCE_TO_RING_MARGIN;
    const interMargin = dial?.interRingMargin ?? INTER_RING_MARGIN;

    for (let k = 0; k < 4; k++) {
      const items = measured[k];
      const minGap = k === 0 ? sourceMargin : interMargin;
      const labelShare = k === 0 ? 1 : outerLabelFraction;
      const radialGap = Math.max(
        minGap,
        ringLabelRoom(items, labelFontSize) * labelShare + arrowRoom + 2 * LABEL_PAD
      );
      const radius = computeRingRadius(items, innerEdge, radialGap, tangentialPad, Math.max(1, items.length));
      radii.push(radius);
      const maxWidth = items.length > 0
        ? items.reduce((m, it) => Math.max(m, it.dims.currentWidth), 0)
        : 0;
      // The next ring starts inside this one's outer edge: its items sit in the
      // angular gaps between these, so the two bands may overlap without the
      // boxes meeting. See RING_STAGGER_OVERLAP.
      innerEdge = radius + (maxWidth / 2) * (1 - staggerOverlap);
    }

    return { radii };
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
      const nominalRadius = rings.radii[k];
      const baseAngles = collisionFreeAngles[k];
      const salt = `ring${k + 1}`;
      for (let i = 0; i < measured[k].length; i++) {
        const { candidate, dims } = measured[k][i];
        const baseAngle = baseAngles[i] ?? 0;
        // Each item rides its own ring's radius unless its label needs more run
        // than that leaves — then this one item steps outward, ring intact.
        const ringRadius = nominalRadius + labelOverflowExtension({
          ringRadius: nominalRadius,
          angle: baseAngle,
          focusWidth,
          focusHeight,
          dims,
          predicate: candidate.predicate,
          labelFontSize,
        });
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
  }, [measuredRing1, measuredRing2, measuredRing3, measuredRing4, rings, collisionFreeAngles,
      centerX, centerY, focusWidth, focusHeight, labelFontSize]);

  const placementsById = useMemo(() => {
    const m = new Map();
    for (const p of placements) m.set(p.id, p);
    return m;
  }, [placements]);

  /**
   * The circle the orbit occupies, reported up so the canvas can frame it.
   *
   * Reported rather than recomputed there: ring radii come out of this
   * component's layout, per-item label extensions included, and a second
   * derivation of "where the orbit ends" would drift from this one.
   *
   * Null until something is actually placed. Candidates arrive asynchronously,
   * and framing the bare focus node in the gap would zoom hard in and then back
   * out as the first results land.
   */
  const extent = useMemo(() => {
    if (placements.length === 0) return null;
    let radius = Math.max(focusWidth, focusHeight) / 2;
    for (const p of placements) {
      // Circumscribed radius of the item's box — its corners reach further than
      // its half-width, and at the outermost ring that is what has to fit.
      radius = Math.max(radius, p.ringRadius + Math.hypot(p.dims.currentWidth, p.dims.currentHeight) / 2);
    }
    return radius;
  }, [placements, focusWidth, focusHeight]);

  // Held in a ref so the report below depends only on the geometry, not on
  // whether the parent happened to hand us a new callback identity.
  const onExtentChangeRef = useRef(onExtentChange);
  onExtentChangeRef.current = onExtentChange;

  useEffect(() => {
    onExtentChangeRef.current?.(extent === null ? null : { centerX, centerY, radius: extent });
  }, [centerX, centerY, extent]);

  // Report the orbit gone on the way out, so a canvas that frames on this does
  // not frame the departed orbit's extent when the next one opens.
  useEffect(() => () => { onExtentChangeRef.current?.(null); }, []);

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
  // Which triplet the pointer is on, or null. A ref, like everything else hover
  // touches: routing it through state would re-render every item and connection
  // on every mouse cross.
  const hoveredIdRef = useRef(null);
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
            // Hand alpha back to the stylesheet.
            clearEntranceAlpha(els.itemG);
            if (els.itemImage) els.itemImage.style.opacity = '';
            clearEntranceAlpha(els.conn?.connG);
            // Arriving while another triplet is hovered means arriving dimmed.
            setTripletDimmed(els, hoveredIdRef.current !== null && hoveredIdRef.current !== id);
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
        }
        // Alpha for both item and connection, via inherited fill/stroke-opacity
        // rather than group opacity — see applyEntranceAlpha.
        if (!els.entranceDone) applyEntranceAlpha(els, ease);

        const conn = els.conn;
        if (conn && conn.connG) {
          const g = computeOrbitConnectionGeometry({
            sourceX: cx0, sourceY: cy0,
            focusWidth: fw, focusHeight: fh,
            targetCx: cx, targetCy: cy,
            targetW: p.dims.currentWidth, targetH: p.dims.currentHeight,
            connectionWidth: cw,
          });
          if (conn.connLine) {
            conn.connLine.setAttribute('x1', g.x1);
            conn.connLine.setAttribute('y1', g.y1);
            conn.connLine.setAttribute('x2', g.x2);
            conn.connLine.setAttribute('y2', g.y2);
          }
          if (conn.arrowG) conn.arrowG.setAttribute('transform', g.arrowTransform);
          if (conn.labelG) conn.labelG.setAttribute('transform', g.labelTransform);
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
        entry.itemImage = undefined; // re-resolve against the new element
        if (entry.entranceDone) {
          clearEntranceAlpha(el);
          setTripletDimmed(entry, hoveredIdRef.current !== null && hoveredIdRef.current !== id);
        } else {
          el.setAttribute('data-entering', '');
          applyEntranceAlpha(entry, 0);
        }
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
        if (entry.entranceDone) {
          clearEntranceAlpha(els.connG);
          setTripletDimmed(entry, hoveredIdRef.current !== null && hoveredIdRef.current !== id);
        } else {
          els.connG.setAttribute('data-entering', '');
          applyEntranceAlpha(entry, 0);
        }
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
    // Crossing straight from one item to the next fires the old item's leave
    // and the new item's enter in whichever order the browser chooses, so a
    // leave only clears the hover if this item is still the one holding it.
    if (hovered) hoveredIdRef.current = id;
    else if (hoveredIdRef.current === id) hoveredIdRef.current = null;
    const hoveredId = hoveredIdRef.current;

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

    // Push the rest of the orbit back so the hovered triplet stands alone, and
    // bring it all forward again on the way out.
    for (const [otherId, other] of elsRef.current) {
      setTripletDimmed(other, hoveredId !== null && hoveredId !== otherId);
    }

    pausedRef.current = hoveredId !== null;
    if (!pausedRef.current) ensureRafRunning();
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

  // Canvas pan/zoom handling. The overlay used to disappear during a zoom
  // because every tick re-rastered the canvas and it could only control how
  // much of its own paint rode along. The real cost was the orbit dim rect
  // blending ~9 viewports of content beneath it; with that sized down the
  // overlay can stay fully visible through a gesture.
  //
  // Modes, selectable live via `window.__orbitZoomMode`:
  //   'full' (default) — nothing shed. Correct while compositor zoom is on.
  //   'lod'            — rects/lines/arrows stay visible; text and images
  //                      (the scale-dependent raster hogs) are shed via the
  //                      stylesheet's [data-canvas-gesture] rules.
  //   'hide'           — the overlay sits gestures out entirely
  //                      (visibility:hidden). A fallback from when orbit mode
  //                      laid a ~9-viewport translucent scrim over the graph
  //                      and every gesture tick had to blend through it.
  //
  // Whether the rotation loop also stands down for the gesture is controlled by
  // PAUSE_DURING_CANVAS_GESTURES (default off). Anything shed or paused is
  // restored after the last transform event — sooner for a pan than a zoom.
  useEffect(() => {
    let timer = null;
    let lastZoom = null;
    const onCanvasTransform = (e) => {
      // Zoom arrives in discrete steps — wheel detents, trackpad increments —
      // and the gaps between them are routinely longer than the pan resume
      // delay. Resuming in those gaps makes the orbit visibly stutter back to
      // life mid-zoom, so a zoom holds the animation for longer and stays still
      // across the whole interaction.
      const z = e?.detail?.zoom;
      const zoomed = typeof z === 'number' && lastZoom !== null && z !== lastZoom;
      if (typeof z === 'number') lastZoom = z;
      const resumeMs = zoomed ? ZOOM_RESUME_MS : PAN_RESUME_MS;

      const root = overlayRootRef.current;
      const m = typeof window !== 'undefined' ? window.__orbitZoomMode : undefined;
      const mode = m === 'lod' || m === 'hide' ? m : 'full';
      const dial = typeof window !== 'undefined' ? window.__orbitGesturePause : undefined;
      const pauseEnabled = dial === undefined ? PAUSE_DURING_CANVAS_GESTURES : !!dial;

      // Default config (nothing shed, nothing paused) has nothing to undo, so
      // don't churn a timer on every tick of every gesture.
      if (mode === 'full' && !pauseEnabled) return;

      if (root) {
        if (mode === 'hide' && root.style.visibility !== 'hidden') {
          root.style.visibility = 'hidden';
        } else if (mode === 'lod' && !root.hasAttribute('data-canvas-gesture')) {
          root.setAttribute('data-canvas-gesture', '');
        }
      }
      if (pauseEnabled && !transformPausedRef.current) {
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
        if (transformPausedRef.current) {
          transformPausedRef.current = false;
          // Credit the gesture's span as paused time so rotation resumes from
          // its frozen pose instead of jumping ahead. When a hover pause was
          // already open across the span, its own frame accounting covers it.
          const clock = clockRef.current;
          if (clock.startTs !== null && clock.pauseStart === null) {
            clock.pausedTotal += performance.now() - transformPauseBeganRef.current;
          }
          ensureRafRunning();
        }
      }, resumeMs);
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
