/**
 * Shared geometry for every layout in this codebase.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * These primitives were previously module-private in three different files:
 * the box helpers in patternLayouts.js, `densify` in lombardiLayout.js, and the
 * point-segment solve in graphLayoutService.js. The pattern layouts' versions
 * are the ones under test — they are what produces `countOverlaps === 0` on a
 * 200-node graph — so they are the ones that were kept. Nothing here is new
 * except `boxMTV` and `polylineBoxMTV` at the bottom.
 *
 * It imports nothing from services/, so it adds no import cycle and it partly
 * unwinds the existing graphLayoutService ↔ patternLayouts one: both of those
 * now get their geometry from here rather than from each other.
 *
 * THE NODE MODEL
 * ──────────────
 * A Redstring node is a BOX, and often a very anisotropic one — a node named
 * "congressional" is ~660×100. Any model that collapses that to a single
 * radius is wrong in both directions at once: it reserves ~7x too much space
 * vertically, and (when the radius is used as a clearance floor rather than a
 * true extent) too little horizontally. Every function here takes half-extents
 * `{ hw, hh }` and only collapses to a scalar where a direction genuinely isn't
 * available yet — see `circumRadius`.
 *
 * ALL POSITIONS HERE ARE CENTRES. Callers working in the store's top-left
 * convention must convert at the boundary.
 */

// Smallest box any node is treated as occupying, regardless of its own dims.
export const MIN_BOX = 60;

// Sub-pixel penetrations count as clear. Applying an exact minimum-translation
// vector in floating point lands a hair short of the boundary, and without this
// an iterating caller would treat that residue as a live violation forever.
export const SEPARATION_EPSILON = 1e-6;

// ============================================================================
// BOX BASICS
// ============================================================================

/** Full width/height of a node's box, floored at MIN_BOX. */
export const boxOf = (node) => ({
  w: Math.max(node?.width || 0, node?.labelWidth || 0, MIN_BOX),
  h: Math.max(node?.height || 0, MIN_BOX)
});

/**
 * Half-extents, optionally inflated by padding and an image allowance.
 *
 * This is the replacement for graphLayoutService's `getNodeRadius`, which
 * folded width, height and label width through a single `Math.max`. Here they
 * stay separate.
 */
export function nodeBox(node, cfg = {}) {
  const { w, h } = boxOf(node);
  const pad = cfg.boxPadding ?? 0;
  const imageBonus = Math.max(node?.imageHeight || 0, 0) * (cfg.imageRadiusMultiplier ?? 0.5);
  return { hw: w / 2 + pad, hh: h / 2 + pad + imageBonus };
}

/**
 * Half-extent of a node's box measured along direction (dx, dy) — i.e. how far
 * the node's edge-attachment point sits from its center for an edge leaving in
 * that direction. This is what makes spacing tight for edges leaving a wide
 * node vertically and generous for edges leaving it horizontally.
 */
export function halfExtentTowards(node, dx, dy) {
  const { w, h } = boxOf(node);
  const halfW = w / 2;
  const halfH = h / 2;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-6) return halfH;
  if (ay < 1e-6) return halfW;
  const len = Math.hypot(dx, dy);
  return Math.min(halfW / (ax / len), halfH / (ay / len));
}

/** Worst-case radius — the circumscribed circle. Used before directions exist. */
export const circumRadius = (node) => {
  const { w, h } = boxOf(node);
  return Math.hypot(w, h) / 2;
};

// ============================================================================
// EDGE LABELS
// ============================================================================

/**
 * Base font size NodeCanvas draws connection labels at, before user settings.
 * Every layout entry point should pass the RESOLVED size (see
 * `resolveEdgeLabelFontSize`) rather than relying on this default — reserving
 * space at 71.28 for labels the canvas draws at 32 is how a diagram ends up
 * three times wider than the text in it.
 */
export const EDGE_LABEL_BASE_FONT_SIZE = 71.28;

/**
 * The size connection labels are actually drawn at, from the two store settings
 * that scale them. Mirrors NodeCanvas's `connectionFontSize`.
 */
export const resolveEdgeLabelFontSize = (textSettings, connectionLabelSize) =>
  EDGE_LABEL_BASE_FONT_SIZE
  * (textSettings?.fontSize || 1)
  * (connectionLabelSize ?? 1);

// Per-character advance widths, in em, for the font edge labels are drawn in
// (EmOne-SemiBold). Taken from the font's own `hmtx` table and bucketed: the
// real advances cluster tightly enough that seven buckets track any real
// relation name to within 16%, where a single average character width cannot.
//
// A flat 0.7 em/char — what this used to assume — overestimates real relation
// names by 1.27x to 1.97x ("is a" measures 0.42 em/char, "compound modifier"
// 0.58). Since `requiredEdgeLength` below is the one constraint every layout in
// this codebase solves, that error set the scale of every diagram.
//
// These are deliberately rounded UP from the measured values: over-reserving
// stretches an edge slightly, while under-reserving lets the label overflow the
// edge it is drawn along. Verified against the font to never under-reserve.
const CHAR_EM = {
  space: 0.24,      // ' '                      measured 0.215
  narrow: 0.34,     // ' i ` j , . : ; | I ! l ( )   0.251 - 0.362
  semi: 0.46,       // J f " [ ] 1 { } r t * / \    0.388 - 0.497
  other: 0.64,      // lowercase and digits         0.434 - 0.683
  upper: 0.77,      // A-Z, $ & #                   0.580 - 0.789
  wideLower: 0.92,  // w m                          0.878 - 0.932
  wideUpper: 1.13   // M W % @                      0.963 - 1.129
};

const NARROW_CHARS = "'i`j,.:;|I!l()";
const SEMI_CHARS = 'Jf"[]1{}rt*/\\';

const charWidthEm = (ch) => {
  if (ch === ' ') return CHAR_EM.space;
  if (NARROW_CHARS.includes(ch)) return CHAR_EM.narrow;
  if (SEMI_CHARS.includes(ch)) return CHAR_EM.semi;
  if (ch === 'w' || ch === 'm') return CHAR_EM.wideLower;
  if ('MW%@'.includes(ch)) return CHAR_EM.wideUpper;
  if ((ch >= 'A' && ch <= 'Z') || '$&#'.includes(ch)) return CHAR_EM.upper;
  return CHAR_EM.other;
};

/**
 * Width of an edge label at a given font size. MUST track how NodeCanvas draws
 * them — the stroke outline adds visual width beyond the glyphs themselves.
 */
export function estimateEdgeLabelWidth(text, fontSize = EDGE_LABEL_BASE_FONT_SIZE) {
  if (!text) return 0;
  let em = 0;
  for (const ch of text) em += charWidthEm(ch);
  // stroke outline (strokeWidth = max(2, fontSize*0.25)) adds visual width
  const strokeBuffer = Math.max(2, fontSize * 0.25) * 2;
  return em * fontSize + strokeBuffer;
}

export const labelSpanOf = (edge, fontSize) => estimateEdgeLabelWidth(edge?.name || '', fontSize);

// Text this renderer must not take apart into per-glyph chunks.
//
// Placing glyphs individually means each one becomes its own text chunk, and a
// chunk boundary is exactly where the shaping engine stops being able to do its
// job. For plain Latin that costs kerning (recoverable — see
// `edgeLabelGlyphAdvances`, which pins the total back to the shaped width). For
// anything below it costs correctness, so those labels fall back to a straight
// label, where the browser shapes the whole run as one piece:
//
//   - combining marks: the mark and its base must stay one cluster or the accent
//     lands on its own somewhere down the arc
//   - ZWJ/ZWNJ and variation selectors: joiner sequences are one glyph, and
//     splitting them renders the parts
//   - RTL scripts and bidi controls: visual order ≠ logical order, and SVG
//     positioning lists index the logical string
//   - surrogates: SVG's x/y/rotate lists index UTF-16 code UNITS, so an astral
//     character consumes two list slots and desynchronises everything after it.
//     Excluding them here also keeps `Array.from` (code points) in agreement
//     with the list indices.
//   - leading/trailing/double spaces: xml:space collapses them in the rendered
//     text but not in our advances array, which is the same desync one step
//     removed.
const GLYPH_SPLIT_HAZARD = new RegExp(
  '[' +
  '\\u0300-\\u036F' +   // combining diacritical marks
  '\\u1AB0-\\u1AFF' +   // combining diacritical marks extended
  '\\u20D0-\\u20FF' +   // combining diacritical marks for symbols
  '\\uFE00-\\uFE0F' +   // variation selectors
  '\\u200C\\u200D' +    // ZWNJ, ZWJ
  '\\u200E\\u200F' +    // LTR/RTL marks
  '\\u202A-\\u202E' +   // bidi embedding/override controls
  '\\u0590-\\u08FF' +   // Hebrew through Arabic Extended-A (RTL scripts)
  '\\uD800-\\uDFFF' +   // surrogates (astral code points)
  ']'
);

/**
 * Per-character advance widths, in em, for a label the canvas will place glyph
 * by glyph along a curve. Same bucket table `estimateEdgeLabelWidth` uses.
 *
 * Returns null when the text must not be split (see GLYPH_SPLIT_HAZARD) — the
 * caller's fallback is a straight label. No stroke buffer: that term in
 * `estimateEdgeLabelWidth` reserves LAYOUT space around the label, and adding it
 * to a glyph advance would just space the letters out.
 *
 * @returns {number[]|null} one advance per code point, in em
 */
export function edgeLabelGlyphAdvancesEm(text) {
  if (!text || typeof text !== 'string') return null;
  if (GLYPH_SPLIT_HAZARD.test(text)) return null;
  if (/^\s|\s\s|\s$/.test(text)) return null;
  const chars = Array.from(text);
  if (chars.length === 0) return null;
  return chars.map(charWidthEm);
}

/**
 * The core constraint: minimum center-to-center distance for this edge.
 * `dx, dy` is the direction the edge will run; pass (1,0)/(0,1) when the axis
 * is known, or the actual delta during a refinement pass.
 */
export function requiredEdgeLength(a, b, edge, cfg, dx = 1, dy = 0) {
  const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
  const clearance = halfExtentTowards(a, dx, dy) + halfExtentTowards(b, dx, dy);
  return Math.max(cfg.minEdgeLength, clearance + label + (label > 0 ? cfg.labelPadding : cfg.nodeGap));
}

// ============================================================================
// SEGMENTS AND POLYLINES
// ============================================================================

/**
 * Distance from point P to segment AB.
 * @returns {{distSq: number, closestX: number, closestY: number, t: number}}
 *          `t` is the projection factor, clamped to [0, 1].
 */
export function getPointSegmentDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const diffX = px - ax;
    const diffY = py - ay;
    return { distSq: diffX * diffX + diffY * diffY, closestX: ax, closestY: ay, t: 0 };
  }

  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const closestX = ax + clampedT * dx;
  const closestY = ay + clampedT * dy;
  const diffX = px - closestX;
  const diffY = py - closestY;

  return { distSq: diffX * diffX + diffY * diffY, closestX, closestY, t: clampedT };
}

/** Resample a polyline so no two consecutive points are further than `step` apart. */
export function densify(points, step = 30) {
  if (!points || points.length < 2) return points || [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const cuts = Math.ceil(span / step);
    for (let k = 1; k <= cuts; k++) {
      const t = k / cuts;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

// ============================================================================
// SEPARATION — the two functions this file was created for
// ============================================================================

/**
 * Minimum translation vector separating two boxes, or null if already clear.
 *
 * The vector moves box B away from box A along whichever axis needs the LEAST
 * movement. That matters: resolving along the centre-to-centre direction
 * instead (which is what a circle model forces) pushes two wide, vertically
 * adjacent nodes sideways when nudging one of them down would have cost a
 * fraction as much.
 *
 * @param {{x:number,y:number}} pA centre of A
 * @param {{hw:number,hh:number}} boxA
 * @param {{x:number,y:number}} pB centre of B
 * @param {{hw:number,hh:number}} boxB
 * @param {number} gap required clear space between the two boxes
 * @returns {{dx:number, dy:number, depth:number}|null} applied to B
 */
export function boxMTV(pA, boxA, pB, boxB, gap = 0) {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const overlapX = (boxA.hw + boxB.hw + gap) - Math.abs(dx);
  const overlapY = (boxA.hh + boxB.hh + gap) - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return null;

  // Coincident centres have no meaningful axis; the caller decides.
  if (overlapX < overlapY) {
    const sign = dx === 0 ? 1 : Math.sign(dx);
    return { dx: sign * overlapX, dy: 0, depth: overlapX };
  }
  const sign = dy === 0 ? 1 : Math.sign(dy);
  return { dx: 0, dy: sign * overlapY, depth: overlapY };
}

/**
 * Minimum translation separating a BOX from one line SEGMENT, or null if clear.
 *
 * Uses the box's support function along the segment normal, which is what makes
 * this exact for a rectangle rather than a circle: a box's reach perpendicular
 * to a line is `hw·|n.x| + hh·|n.y|`, so a wide flat node blocks a horizontal
 * line by 50px and a vertical one by 300px, and the same formula gives both.
 *
 * The push is along the NORMAL, deliberately not along an axis. Axis-aligned
 * pushes look cheaper — you pick whichever of overX/overY is smaller — but for
 * a steep edge the cheap axis is nearly parallel to the line, so the node slides
 * along the edge instead of off it and the iteration never converges. Pushing
 * along the normal is both the true minimum translation and the only direction
 * guaranteed to make progress.
 *
 * @returns {{dx:number, dy:number, depth:number}|null} applied to the box
 */
export function segmentBoxMTV(ax, ay, bx, by, center, box, pad = 0) {
  const hw = box.hw + pad;
  const hh = box.hh + pad;

  let ux = bx - ax;
  let uy = by - ay;
  const len = Math.hypot(ux, uy);
  if (len < 1e-9) {
    // Degenerate segment — fall back to point-vs-box.
    const dx = ax - center.x;
    const dy = ay - center.y;
    const overX = hw - Math.abs(dx);
    const overY = hh - Math.abs(dy);
    if (overX <= 0 || overY <= 0) return null;
    if (overX < overY) return { dx: -Math.sign(dx || 1) * overX, dy: 0, depth: overX };
    return { dx: 0, dy: -Math.sign(dy || 1) * overY, depth: overY };
  }
  ux /= len;
  uy /= len;
  const nx = -uy;
  const ny = ux;

  const cx = center.x - ax;
  const cy = center.y - ay;

  // Perpendicular clearance. The epsilon matters: without it, applying the
  // returned vector leaves a residue of ~1e-13 that still reads as a
  // penetration, so an iterating caller never sees "clear" and burns every
  // pass it has on nothing.
  const s = nx * cx + ny * cy;
  const supportN = hw * Math.abs(nx) + hh * Math.abs(ny);
  const depth = supportN - Math.abs(s);
  if (depth <= SEPARATION_EPSILON) return null;

  // The segment is finite: the box must also overlap its extent along u.
  const t = ux * cx + uy * cy;
  const supportU = hw * Math.abs(ux) + hh * Math.abs(uy);
  if (t + supportU <= 0 || t - supportU >= len) return null;

  const sign = s === 0 ? 1 : Math.sign(s);
  return { dx: sign * nx * depth, dy: sign * ny * depth, depth };
}

/**
 * Deepest penetration of a polyline into a box, and the way out.
 *
 * This is the mechanism `clearArcsOfNodes` uses to keep Lombardi arcs off
 * nodes, lifted out so every routing style can use it. The returned vector
 * moves the NODE, not the path — moving a path's endpoint would change the
 * path being cleared and the two would chase each other.
 *
 * Tests whole SEGMENTS, not sampled points. Point sampling has to densify to
 * avoid a node slipping between two consecutive samples; segment testing is
 * exact and needs no densification.
 *
 * @param {Array<{x:number,y:number}>} points polyline vertices
 * @param {{x:number,y:number}} center node centre
 * @param {{hw:number,hh:number}} box node half-extents
 * @param {number} pad extra clearance required around the box
 * @returns {{dx:number, dy:number, depth:number}|null} applied to the node
 */
export function polylineBoxMTV(points, center, box, pad = 0) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) {
    return segmentBoxMTV(points[0].x, points[0].y, points[0].x, points[0].y, center, box, pad);
  }

  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const mtv = segmentBoxMTV(
      points[i].x, points[i].y, points[i + 1].x, points[i + 1].y,
      center, box, pad
    );
    if (mtv && (!best || mtv.depth > best.depth)) best = mtv;
  }
  return best;
}

// ============================================================================
// CLUSTER SPACING — how far apart two disconnected clusters stand
// ============================================================================

/**
 * Clear space between two clusters that share no edge, node box to node box,
 * as a multiple of the connection-label font size.
 *
 * Why it is a label measurement and not a node measurement: the thing crowded
 * when two clusters sit close is not the boxes, it is the TEXT. Edges near a
 * cluster's boundary carry labels drawn along them, and a foreign node parked
 * at the node-collision minimum lands on that text. So two clusters have to
 * stand further apart than two nodes inside one cluster do, and the amount is
 * set by how big labels are, not by how big nodes are.
 *
 * 6.5em reproduces the 460 that PATTERN_LAYOUT_DEFAULTS.componentGap has always
 * used at the base font — this is that number, expressed so it tracks the
 * connection-label setting and so both layout pipelines can quote it.
 */
export const CLUSTER_GAP_EM = 6.5;

export const clusterGapFor = (edgeLabelFontSize = EDGE_LABEL_BASE_FONT_SIZE) =>
  Math.max(0, edgeLabelFontSize) * CLUSTER_GAP_EM;

/** Axis-aligned bounds of a list of rects. */
export const boundsOfRects = (rects) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.minX < minX) minX = r.minX;
    if (r.minY < minY) minY = r.minY;
    if (r.maxX > maxX) maxX = r.maxX;
    if (r.maxY > maxY) maxY = r.maxY;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
};

/** Gap between two axis-aligned rects; 0 when they touch or overlap. */
const rectGap = (a, b) => {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
};

/**
 * Smallest gap between any rect of A and any rect of B, given each block's
 * current translation. Short-circuits on the bounding boxes: a block's bounds
 * contain its rects, so `boundsGap >= gap` already proves every pair is clear
 * and the quadratic scan can be skipped. That early-out is what keeps this
 * affordable — the full scan only runs for blocks that are actually near.
 */
const blockGap = (A, B, ceiling) => {
  const boundsDistance = rectGap(
    { minX: A.bounds.minX + A.dx, minY: A.bounds.minY + A.dy, maxX: A.bounds.maxX + A.dx, maxY: A.bounds.maxY + A.dy },
    { minX: B.bounds.minX + B.dx, minY: B.bounds.minY + B.dy, maxX: B.bounds.maxX + B.dx, maxY: B.bounds.maxY + B.dy }
  );
  if (boundsDistance >= ceiling) return boundsDistance;

  let min = Infinity;
  for (const a of A.rects) {
    const ax0 = a.minX + A.dx, ax1 = a.maxX + A.dx;
    const ay0 = a.minY + A.dy, ay1 = a.maxY + A.dy;
    for (const b of B.rects) {
      const dx = Math.max(0, ax0 - (b.maxX + B.dx), (b.minX + B.dx) - ax1);
      const dy = Math.max(0, ay0 - (b.maxY + B.dy), (b.minY + B.dy) - ay1);
      const d = Math.hypot(dx, dy);
      if (d < min) {
        min = d;
        if (min === 0) return 0;
      }
    }
  }
  return min;
};

/**
 * Draw rigidly laid-out clusters together without letting them crowd, and
 * return the translation each one needs.
 *
 * Only whole-block translation happens here, so every cluster's interior — and
 * therefore every edge, label and clearance its own solver established — comes
 * through untouched. Two passes alternate: PULL steps each block toward the
 * common centre, SEPARATE pushes apart any pair closer than `gap`. Separation
 * runs last and hardest, so the invariant it enforces is the one that holds.
 *
 * The reason this measures RECTANGLES rather than bounding boxes is that a
 * bounding box is a bad proxy for a cluster's visual mass, and how bad depends
 * on the routing style — which is exactly how the same nominal spacing came to
 * look wrong in two opposite directions. A Lombardi component is a ring or a
 * radial fan filling maybe a third of its box, so leaving a gap between boxes
 * leaves two sets of empty corners facing each other and reads as a canyon. A
 * force-solved cluster is a blob whose box swallows its neighbours' entirely,
 * so a box-blind condensation lets foreign nodes settle at the node-collision
 * minimum and reads as suffocation. Measured rect to rect, one number means the
 * same thing for both.
 *
 * `gap` may be a single number, or a function of the two block INDICES. The
 * per-pair form exists because one number for every pair is wrong in both
 * directions once the blocks are heterogeneous: a group shell and a loose node
 * do not need the same corridor as two group shells, and sizing every pair off
 * whichever pair needs the most casts the whole layout apart. Callers derive
 * each pair's floor from whatever constraint actually applies to it.
 *
 * @param {Array<{rects: Array, movable?: boolean}>} blocks
 * @param {number | ((i: number, j: number) => number)} gap required clear space
 *        between two blocks, uniform or per index pair
 * @param {{center?: {x,y}, iterations?: number, pullRate?: number}} options
 * @returns {Array<{dx: number, dy: number}>} translations, parallel to `blocks`
 */
export function condenseBlocks(blocks, gap, options = {}) {
  const state = blocks.map(block => {
    const rects = block.rects || [];
    const bounds = boundsOfRects(rects);
    return {
      rects,
      bounds,
      movable: block.movable !== false && rects.length > 0,
      cx: (bounds.minX + bounds.maxX) / 2,
      cy: (bounds.minY + bounds.maxY) / 2,
      dx: 0,
      dy: 0
    };
  });

  const result = () => state.map(({ dx, dy }) => ({ dx, dy }));
  if (state.length < 2) return result();

  const center = options.center || {
    x: state.reduce((sum, b) => sum + b.cx, 0) / state.length,
    y: state.reduce((sum, b) => sum + b.cy, 0) / state.length
  };
  const iterations = options.iterations ?? 24;
  const pullRate = options.pullRate ?? 0.12;
  const gapFor = typeof gap === 'function' ? gap : () => gap;

  // One separation sweep: push every too-close pair apart along the line
  // between their centres. Both blocks share the correction when both may
  // move, so a pair converges without either one doing all the travelling.
  const separate = () => {
    let worst = 0;
    for (let i = 0; i < state.length; i++) {
      for (let j = i + 1; j < state.length; j++) {
        const A = state[i];
        const B = state[j];
        if (!A.movable && !B.movable) continue;
        const pairGap = gapFor(i, j);
        const distance = blockGap(A, B, pairGap);
        const deficit = pairGap - distance;
        if (deficit <= SEPARATION_EPSILON) continue;
        worst = Math.max(worst, deficit);

        let ux = (B.cx + B.dx) - (A.cx + A.dx);
        let uy = (B.cy + B.dy) - (A.cy + A.dy);
        const length = Math.hypot(ux, uy);
        if (length < SEPARATION_EPSILON) {
          // Concentric blocks have no meaningful axis; pick a deterministic one
          // so the pair still comes apart instead of sitting on top of itself.
          ux = 1; uy = 0;
        } else {
          ux /= length; uy /= length;
        }

        const share = (A.movable && B.movable) ? 0.5 : 1;
        if (B.movable) { B.dx += ux * deficit * share; B.dy += uy * deficit * share; }
        if (A.movable) { A.dx -= ux * deficit * share; A.dy -= uy * deficit * share; }
      }
    }
    return worst;
  };

  for (let iter = 0; iter < iterations; iter++) {
    for (const block of state) {
      if (!block.movable) continue;
      block.dx += (center.x - (block.cx + block.dx)) * pullRate;
      block.dy += (center.y - (block.cy + block.dy)) * pullRate;
    }
    for (let pass = 0; pass < 3; pass++) {
      if (separate() <= SEPARATION_EPSILON) break;
    }
  }

  // The pull above is unconditional, so the last thing that touched the layout
  // has to be the constraint, not the objective.
  for (let pass = 0; pass < 12; pass++) {
    if (separate() <= SEPARATION_EPSILON) break;
  }

  return result();
}
