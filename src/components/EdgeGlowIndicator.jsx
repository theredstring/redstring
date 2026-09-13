import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useViewportBounds } from '../hooks/useViewportBounds';
import { getNodeDimensions } from '../utils';
import { NODE_HEIGHT } from '../constants';
import useGraphStore from '../store/graphStore.js';
import { resolveEdgeGlowQuality } from '../utils/colorUtils.js';

// Where the canvas coordinate system's origin sits inside the 100k x 100k sheet.
// NodeCanvas draws with offsetX/offsetY of -50000, so a node at canvas (0,0) is
// half the sheet in from the corner.
const CANVAS_ORIGIN = 50000;

// How many distinct flare appearances exist. Every off-screen node draws a
// gradient-filled flare whose geometry is derived from `intensity`; left
// continuous, that is a freshly-built style string per flare per frame.
// Quantised, the whole population collapses onto this many cached appearances,
// and a flare that only moved costs one transform write.
const GLOW_INTENSITY_STEPS = 8;

// Ceiling on how many flares are drawn at once.
//
// Flares live on a one-dimensional border, so past a few hundred they are
// stacked several deep on every pixel of it and the ones underneath are not
// telling anyone anything. This bounds the DOM the overlay can build when
// someone picks a fixed appearance on a web far larger than that appearance was
// meant for — 'adaptive' never gets near it. Overflow is dropped in node order,
// which is stable for as long as the web is.
const MAX_FLARES = 600;

// Pool growth granularity. The flare count moves by ones as you pan; rounding
// the pool up to a block means a gesture mounts DOM a handful of times instead
// of on most of its frames.
const POOL_CHUNK = 16;

// Cache of the inner flare's CSS text, keyed by everything it depends on.
// Assigning the SAME string is skipped outright by the paint below, so a flare
// that only moved never touches its appearance.
const glowStyleCache = new Map();

/**
 * The flare's own CSS, as one declaration block.
 *
 * A flare is a soft glow, and 'fancy' draws it as THREE soft glows stacked on
 * top of each other: a radial-gradient fading out to transparent, a blur()
 * filter over the top of it, and a blurred box-shadow around the border box
 * which the filter then blurs a second time. Each one costs a full repaint for
 * every flare on every frame it moves. Measured on the live app, 150 flares,
 * median / p90 frame time against an 8.3ms floor:
 *
 *   gradient + blur + shadow ....  9.3 / 30.4    55 of 126 frames over 16ms
 *   gradient + shadow ...........  8.4 / 15.8    14 of 142
 *   gradient + blur .............  8.8 / 17.2    51 of 135
 *   gradient alone ..............  8.3 /  9.3     3 of 142   <- at the floor
 *
 * A gradient that already runs to `transparent` IS a soft edge, so 'fast' drops
 * the other two and does the whole job with the gradient, grown by BLEED to
 * cover the area the blur used to reach into.
 *
 * That measurement is why the flares were cut back to 'fast' everywhere. What it
 * does not say is that nobody should ever get the deeper glow — on a web whose
 * flares number in the dozens, none of those p90s exist. Which one you get is
 * now the edgeGlowMode setting's business, not this function's.
 */
const getFlareCss = (color, intensity, isExclusiveMode, quality) => {
  const key = `${color}|${intensity}|${isExclusiveMode ? 1 : 0}|${quality}`;
  const hit = glowStyleCache.get(key);
  if (hit) return hit;

  const fancy = quality === 'fancy';
  // 'fast' has no blur to bleed past its box, so it grows to cover the same area.
  const BLEED = fancy ? 1 : 1.4;
  const flareLength = (isExclusiveMode ? 10 + intensity * 4 : 14 + intensity * 6) * BLEED;
  const flareThickness = (isExclusiveMode ? 20 + intensity * 6 : 28 + intensity * 8) * BLEED;
  const glowAlpha = Math.round(intensity * 255 * 0.6).toString(16).padStart(2, '0');

  let css = 'position:absolute;'
    + `left:${-flareLength / 2}px;top:${-flareThickness / 2}px;`
    + `width:${flareLength}px;height:${flareThickness}px;`
    + `border-radius:${flareThickness}px;`
    + `background:radial-gradient(ellipse, ${color}${glowAlpha} 0%, ${color}30 45%, transparent 100%);`;

  if (fancy) {
    css += `filter:blur(${(4 + intensity * 6).toFixed(1)}px);`
      + `box-shadow:0 0 ${(8 + intensity * 14).toFixed(1)}px ${color}${glowAlpha};`;
  }

  glowStyleCache.set(key, css);
  return css;
};

const roundUpToChunk = (n) => Math.min(MAX_FLARES, Math.ceil(n / POOL_CHUNK) * POOL_CHUNK);

const EdgeGlowIndicator = ({
  nodes,
  baseDimensionsById,
  panOffset,
  zoomLevel,
  panOffsetRef,
  zoomLevelRef,
  glowUpdateRef,
  leftPanelExpanded,
  rightPanelExpanded,
  previewingNodeId,
  containerRef,
  showViewportDebug = false,
  showDirectionLines = false,
  canvasViewportSize // Pass in the fixed canvas viewport size
}) => {
  const edgeGlowMode = useGraphStore(state => state.edgeGlowMode);
  const quality = resolveEdgeGlowQuality(edgeGlowMode, nodes?.length ?? 0);

  // Get TypeList visibility from store
  const typeListMode = useGraphStore(state => state.typeListMode);
  const typeListVisible = typeListMode !== 'closed';

  // Use the panel-based viewport bounds for positioning the overlay
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListVisible);

  // Use the fixed canvas viewport size for coordinate calculations
  const canvasSize = canvasViewportSize || { width: window.innerWidth, height: window.innerHeight };

  // The container's own rect, measured OUT of band.
  //
  // The paint below runs on every pan/zoom tick, and it used to call
  // getBoundingClientRect() once per node on that path. That read lands
  // immediately after the canvas has written its new SVG transform, so it forces
  // a synchronous layout of a subtree that was just dirtied — and the cost of
  // that flush is not symmetric between the two kinds of motion. A translate
  // leaves SVG text layout intact; a SCALE change invalidates it, so every
  // glyph, every rotation and every <textPath> arc-length parameterisation is
  // resolved again before the rect can be returned. Measured on the label
  // harness (median cost of the read alone):
  //
  //             labels     pan     zoom
  //   lines only   600     0.1      0.3
  //   rotated      600     0.1      1.3
  //   textPath     600     0.1      4.9     <- 49x
  //
  // Flat under pan at any complexity, linear in label count under zoom. That is
  // exactly the shape of the complaint: zooming a Lombardi graph with labels on,
  // and nothing else.
  //
  // None of it was needed. This rect belongs to the canvas CONTAINER, a fixed
  // viewport-sized element that pan and zoom never move — only a resize or a
  // panel toggle changes it. So measure it on those, and let the per-frame path
  // read a plain object.
  const [containerRect, setContainerRect] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = containerRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setContainerRect(prev =>
        (prev && prev.left === r.left && prev.top === r.top
          && prev.width === r.width && prev.height === r.height)
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height }
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // Panel/type-list toggles resize the container without firing `resize`.
  }, [containerRef, leftPanelExpanded, rightPanelExpanded, typeListVisible, viewportBounds]);

  // Per-node geometry that a moving view cannot change: the node's centre in
  // canvas coordinates, and its colour.
  //
  // This is the O(nodes) half of the work — it calls getNodeDimensions, reads
  // prototypes, and allocates — and none of it depends on pan or zoom, so it has
  // no business running per frame. Split out here it runs when the web changes,
  // and the paint below is left with flat arithmetic over typed arrays.
  //
  // Off-screen nodes are the whole point of this component, so this covers every
  // node in the web rather than the visible ones. Which is exactly why it had to
  // come off the per-frame path.
  const geometry = useMemo(() => {
    const list = nodes || [];
    const count = list.length;
    const cx = new Float64Array(count);
    const cy = new Float64Array(count);
    const colors = new Array(count);
    const ids = new Array(count);
    const labels = new Array(count);

    for (let i = 0; i < count; i++) {
      const node = list[i];
      const isNodePreviewing = previewingNodeId === node.id;
      const precomputedDims = baseDimensionsById instanceof Map
        ? baseDimensionsById.get(node.id)
        : baseDimensionsById?.[node.id];
      const dims = isNodePreviewing
        ? getNodeDimensions(node, true, null)
        : precomputedDims || getNodeDimensions(node, false, null);

      cx[i] = node.x + dims.currentWidth / 2;
      cy[i] = node.y + (isNodePreviewing ? NODE_HEIGHT / 2 : dims.currentHeight / 2);
      colors[i] = node.color || node.prototype?.color || '#8B0000';
      ids[i] = node.id;
      labels[i] = node.name || node.prototype?.name || node.id;
    }

    return { count, cx, cy, colors, ids, labels };
  }, [nodes, baseDimensionsById, previewingNodeId]);

  // Everything the paint reads, held in refs so it can run from a transform
  // callback without a stale closure and without re-subscribing per frame.
  const geometryRef = useRef(geometry);
  const viewportBoundsRef = useRef(viewportBounds);
  const containerRectRef = useRef(containerRect);
  const qualityRef = useRef(quality);
  const settledPanRef = useRef(panOffset);
  const settledZoomRef = useRef(zoomLevel);
  geometryRef.current = geometry;
  viewportBoundsRef.current = viewportBounds;
  containerRectRef.current = containerRect;
  qualityRef.current = quality;
  settledPanRef.current = panOffset;
  settledZoomRef.current = zoomLevel;

  // The flare pool. React owns how many slots exist; the paint owns what is in
  // them. Slots carry the last values written to them so an unchanged frame
  // costs zero DOM writes.
  const [poolSize, setPoolSize] = useState(0);
  const slotsRef = useRef([]);
  const lastUsedRef = useRef(0);

  // Ref callbacks, cached per index. A fresh closure per render would make React
  // detach and re-attach every slot on every commit, throwing away the
  // last-written transform and CSS that let an unchanged frame cost nothing.
  const slotRefCallbacks = useRef([]);
  const setSlotRef = useCallback((index) => {
    const cached = slotRefCallbacks.current[index];
    if (cached) return cached;
    const cb = (el) => {
      const slots = slotsRef.current;
      if (!el) {
        slots[index] = null;
        return;
      }
      slots[index] = {
        outer: el,
        inner: el.firstChild,
        transform: null,
        css: null,
        // Matches the `display: none` React mounts the slot with. Getting this
        // wrong leaves a written flare invisible, since the paint only clears
        // `display` when it believes the slot is hidden.
        hidden: true
      };
    };
    slotRefCallbacks.current[index] = cb;
    return cb;
  }, []);

  /**
   * Places every off-screen node's flare on the viewport border, writing DOM
   * directly.
   *
   * THIS RUNS DURING MOTION, which is the whole point of it. It used to be a
   * pair of setStates, which re-ran an O(nodes) memo and committed the entire
   * flare list through React on every frame of a gesture — so it was suppressed
   * for the duration of one and left to catch up on settle. That is what made
   * the flares look broken on a large web: they sat still through the pan and
   * jumped into place SETTLE_DELAY after it, which reads as "the glow stopped
   * working", and the bigger the web the longer the gesture and the more obvious
   * the jump.
   *
   * Going around React is what makes tracking affordable. There is nothing here
   * to reconcile: a frame is a transform string per visible flare and nothing
   * else, since the appearance only changes when a flare crosses an intensity
   * bucket. Mounting is bounded by the pool, which grows in blocks and only
   * shrinks once the view has settled, so the mount/unmount churn that made zoom
   * worse than pan — the off-screen set changes monotonically under a scale —
   * does not happen either.
   */
  const paint = useCallback(() => {
    const geo = geometryRef.current;
    const vb = viewportBoundsRef.current;
    const rect = containerRectRef.current;
    const q = qualityRef.current;
    const slots = slotsRef.current;
    if (!geo || !geo.count || !vb || !rect || q === 'off') {
      lastUsedRef.current = 0;
      return;
    }

    const pan = panOffsetRef?.current || settledPanRef.current;
    const zoom = zoomLevelRef?.current || settledZoomRef.current;
    if (!pan || !zoom) return;

    const { count, cx, cy, colors } = geo;
    const W = vb.width;
    const H = vb.height;
    const halfW = W / 2;
    const halfH = H / 2;
    const exclusive = vb.isExclusiveMode ? 1 : 0;

    // Canvas centre -> overlay coordinates collapses to one multiply-add per
    // axis once the constant part is lifted out of the loop.
    const originX = CANVAS_ORIGIN * zoom + pan.x + rect.left - vb.x;
    const originY = CANVAS_ORIGIN * zoom + pan.y + rect.top - vb.y;

    const poolLen = slots.length;
    let used = 0;

    for (let i = 0; i < count; i++) {
      const px = cx[i] * zoom + originX;
      const py = cy[i] * zoom + originY;
      if (px >= 0 && px <= W && py >= 0 && py <= H) continue; // on screen, no flare

      if (used >= MAX_FLARES) { used = MAX_FLARES; break; }
      const slot = used < poolLen ? slots[used] : null;
      used++;
      if (!slot) continue; // pool too small; grown below and repainted

      // Where the ray from the viewport centre to the node leaves the viewport.
      // The rectangle is centred on that ray's origin, so the exit is whichever
      // of the two axis crossings comes first — no candidate list needed.
      const dx = px - halfW;
      const dy = py - halfH;
      const tx = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
      const ty = dy !== 0 ? halfH / Math.abs(dy) : Infinity;

      let translateX;
      let translateY;
      let rotation;
      if (tx <= ty) {
        // Leaves through a vertical edge. Rides 3px further out for visibility.
        translateY = Math.round(halfH + tx * dy);
        if (dx < 0) { translateX = -3; rotation = 0; }
        else { translateX = Math.round(W) + 3; rotation = 180; }
      } else {
        translateX = Math.round(halfW + ty * dx);
        if (dy < 0) { translateY = -3; rotation = 90; }
        else { translateY = Math.round(H) + 3; rotation = -90; }
      }

      // Bucketed. Intensity feeds the flare's size, alpha, gradient stops and —
      // in 'fancy' — its blur radius and shadow, so a continuously-varying value
      // rebuilds the whole declaration block every frame. Nobody can see a 1%
      // change in a blur radius. See GLOW_INTENSITY_STEPS.
      const distance = Math.sqrt(dx * dx + dy * dy);
      const rawIntensity = Math.max(0.4, Math.min(1, 2000 / (distance + 200)));
      const intensity = Math.round(rawIntensity * GLOW_INTENSITY_STEPS) / GLOW_INTENSITY_STEPS;

      const outer = slot.outer;
      const inner = slot.inner;
      if (!outer || !inner) continue;

      if (slot.hidden) { outer.style.display = ''; slot.hidden = false; }

      const transform = `translate(${translateX}px, ${translateY}px) rotate(${rotation}deg)`;
      if (slot.transform !== transform) {
        outer.style.transform = transform;
        slot.transform = transform;
      }

      const css = getFlareCss(colors[i], intensity, exclusive, q);
      if (slot.css !== css) {
        inner.style.cssText = css;
        slot.css = css;
      }
    }

    for (let j = used; j < poolLen; j++) {
      const slot = slots[j];
      if (!slot || slot.hidden || !slot.outer) continue;
      slot.outer.style.display = 'none';
      slot.hidden = true;
    }

    lastUsedRef.current = used;
    // Grow only. Shrinking mid-gesture would unmount flares that the next frame
    // wants back; the settle below gives the pool back its slack.
    if (used > poolLen) setPoolSize(prev => Math.max(prev, roundUpToChunk(used)));
  }, [panOffsetRef, zoomLevelRef]);

  // Per-frame entry point. NodeCanvas's RAF-coalesced transform tick fires this
  // on every pan/zoom mutation; no free-running RAF, and nothing at all on idle.
  useEffect(() => {
    if (!glowUpdateRef) return;
    glowUpdateRef.current = paint;
    return () => {
      if (glowUpdateRef.current === paint) glowUpdateRef.current = null;
    };
  }, [glowUpdateRef, paint]);

  // Repaint whenever something other than the transform changed the answer —
  // including the pool having just resized, which is why poolSize is a
  // dependency.
  useLayoutEffect(() => {
    // React detaches the refs of slots it just unmounted, leaving holes past the
    // end of the pool. The paint indexes slots by flare number and would hand
    // one of those holes a flare it then never draws, so cut the array back to
    // what is actually mounted first.
    if (slotsRef.current.length > poolSize) slotsRef.current.length = poolSize;
    paint();
  }, [paint, poolSize, geometry, viewportBounds, containerRect, quality, canvasSize]);

  // The settle. `panOffset`/`zoomLevel` are NodeCanvas's settled state and change
  // once per gesture, SETTLE_DELAY ms after the last mutation — the moment at
  // which the pool can safely be handed back whatever slack the gesture claimed.
  useLayoutEffect(() => {
    paint();
    const want = roundUpToChunk(lastUsedRef.current);
    setPoolSize(prev => (prev === want ? prev : want));
  }, [paint, panOffset, zoomLevel]);

  // Debug overlays only. Deliberately driven by the SETTLED transform rather
  // than the live one: these are diagnostics, and putting an O(nodes) React memo
  // back on the per-frame path is the exact thing the paint above exists to
  // avoid.
  const debugNodes = useMemo(() => {
    if (!showViewportDebug && !showDirectionLines) return [];
    if (!viewportBounds || !containerRect || !geometry.count) return [];
    const originX = CANVAS_ORIGIN * zoomLevel + panOffset.x + containerRect.left - viewportBounds.x;
    const originY = CANVAS_ORIGIN * zoomLevel + panOffset.y + containerRect.top - viewportBounds.y;
    const out = [];
    for (let i = 0; i < geometry.count; i++) {
      const x = geometry.cx[i] * zoomLevel + originX;
      const y = geometry.cy[i] * zoomLevel + originY;
      out.push({
        id: geometry.ids[i],
        label: geometry.labels[i],
        nodeOverlayX: x,
        nodeOverlayY: y,
        isOutsideViewport: x < 0 || x > viewportBounds.width || y < 0 || y > viewportBounds.height
      });
    }
    return out;
  }, [showViewportDebug, showDirectionLines, geometry, viewportBounds, containerRect, panOffset, zoomLevel]);

  if (!viewportBounds || quality === 'off') return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: viewportBounds.x, // Remove Math.max constraint to allow off-screen positioning
        top: viewportBounds.y,
        width: viewportBounds.width,
        height: viewportBounds.height,
        pointerEvents: 'none',
        zIndex: 1000
      }}
    >
      {/* Debug viewport bounds visualization - positioned absolutely */}
      {showViewportDebug && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            border: '4px solid red',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            zIndex: 999999
          }}
        />
      )}

      {/* Debug direction lines */}
      {showDirectionLines && (
        <svg
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 999998
          }}
        >
          {debugNodes.map(nodeInfo => (
            <g key={`debug-${nodeInfo.id}`}>
              {/* Line from center to actual node position */}
              <line
                x1={viewportBounds.width / 2}
                y1={viewportBounds.height / 2}
                x2={nodeInfo.nodeOverlayX}
                y2={nodeInfo.nodeOverlayY}
                stroke="rgba(0, 255, 0, 0.8)"
                strokeWidth="2"
                strokeDasharray="5,5"
              />
              {/* Mark the actual node position */}
              <circle
                cx={nodeInfo.nodeOverlayX}
                cy={nodeInfo.nodeOverlayY}
                r="4"
                fill={nodeInfo.isOutsideViewport ? "rgba(0, 255, 0, 0.8)" : "rgba(0, 255, 0, 0.3)"}
                stroke="white"
                strokeWidth="1"
              />
            </g>
          ))}
        </svg>
      )}

      {/* Debug corner labels */}
      {showViewportDebug && (
        <div style={{ position: 'absolute', top: '5px', left: '5px', color: 'red', fontSize: '12px', fontWeight: 'bold', backgroundColor: 'yellow', padding: '4px', zIndex: 999999 }}>
          🔴 EDGE GLOW: mode={edgeGlowMode} quality={quality} | flares={lastUsedRef.current}/{poolSize}
          {' '}| viewport {Math.round(viewportBounds.x)},{Math.round(viewportBounds.y)} {Math.round(viewportBounds.width)}x{Math.round(viewportBounds.height)}
        </div>
      )}

      {/* The flare pool.
          Split deliberately in two: the OUTER div carries the only thing that
          genuinely changes as the view moves (a transform), and the INNER div
          carries the appearance, which only changes when a flare crosses an
          intensity bucket. React never renders either one's contents — see the
          paint above — so these are empty shells it mounts and then leaves
          alone. */}
      {Array.from({ length: poolSize }, (_, i) => (
        <div
          key={i}
          ref={setSlotRef(i)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            display: 'none',
            pointerEvents: 'none',
            transformOrigin: 'center',
            zIndex: 1
          }}
        >
          <div />
        </div>
      ))}
    </div>
  );
};

export default EdgeGlowIndicator;
