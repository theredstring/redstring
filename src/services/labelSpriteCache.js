/**
 * Pre-rasterized connection-label sprites.
 *
 * WHY THIS EXISTS
 *
 * A connection label is the most expensive thing on a moving canvas, and the
 * reason is narrow: a ROTATED <text> cannot use the browser's cached per-glyph
 * alpha masks, so it rasterises from glyph outlines, and a STROKED rotated text
 * is the worst form of that. Redstring draws each label stroked twice — SVG
 * paints one stroke per element, so the connection-colored ring is a second
 * <text> underneath the real one carrying a stroke 2.1x wider than the halo's.
 * Stroke cost scales with covered area, so ring plus halo is roughly three
 * times the outlined-pixel area of a halo alone. Per label. Per frame.
 *
 * It is also why manhattan feels instant next to straight and lombardi:
 * manhattan labels sit at 0/90 degrees, which is the axis-aligned fast path.
 * Nothing else is.
 *
 * This module does not make that cheaper. It makes it happen ONCE. Each
 * distinct label is rendered to an offscreen canvas — ring, halo and fill all
 * baked in — and every edge that wants it draws the result as an <image>. An
 * <image> is a textured quad: rotating it is a transform, not glyph work, and
 * scaling it is sampling. The double stroke stops being a per-frame cost and
 * becomes a one-time one.
 *
 * WHY IT PAYS HERE SPECIFICALLY
 *
 * Label text comes from an edge's TYPE PROTOTYPE, not from the edge, so a graph
 * with two hundred edges typically holds a handful of distinct strings. The
 * cache key is the rendered appearance rather than the edge, so those two
 * hundred labels collapse onto that handful of bitmaps.
 *
 * RESOLUTION
 *
 * A bitmap has one resolution and the canvas does not. Sprites are rasterised
 * at a power-of-two scale bucket at or above the current zoom, so a label is
 * never sampled up by more than a factor of two, and the bucket only changes
 * when the zoom crosses a doubling. That matters because re-rasterising means
 * re-encoding: it must be rare, not merely cheap.
 *
 * It also composes with the label fade. Labels are already hidden while the
 * view moves and fade in on settle, so a bucket change lands during the one
 * moment they are not on screen, and the fade covers the work.
 */

import { measureTextWidth, edgeLabelFontString, edgeLabelFontLoaded } from './textMeasurement.js';
import { loadPersistedSprites, persistSprite, purgePersistedSprites } from './labelSpriteStore.js';

/**
 * Padding around the ink, as a multiple of the widest stroke's half-width.
 *
 * The ring is centred on the glyph outline, so it reaches half its width beyond
 * the ink in every direction; anything less than that clips it. The surplus
 * absorbs round joins and caps, which push a corner slightly past the nominal
 * half-width, and leaves a transparent margin so sampling at the sprite edge
 * never picks up whatever is outside it.
 */
const SPRITE_PAD_FACTOR = 0.75;

/** Absolute floor on that padding, in canvas units, for very light strokes. */
const SPRITE_PAD_MIN = 4;

/**
 * Scale buckets are powers of two, clamped to this range.
 *
 * The floor keeps a label legible when the whole graph is fitted on screen; the
 * ceiling stops a deep zoom from asking for a bitmap that costs more to encode
 * than the text would have cost to draw. At the top of the range a label is
 * being sampled DOWN, which is the harmless direction.
 */
const MIN_SPRITE_SCALE = 0.5;
const MAX_SPRITE_SCALE = 8;

/**
 * Hard ceiling on a sprite's rasterised area, in device pixels.
 *
 * A long label at a high bucket can ask for a bitmap larger than it could ever
 * be worth. Rather than refuse, drop the scale until it fits — a slightly soft
 * label is better than falling back to the stroked-text path for the one label
 * that is longest and therefore most expensive to draw that way.
 */
const MAX_SPRITE_PIXELS = 4096 * 1024;

/**
 * How many distinct sprites to keep.
 *
 * The two kinds share this budget and pull on it very differently. Whole-label
 * sprites are few — a handful of connection types across a few colors, at one
 * or two live scale buckets. Per-GLYPH sprites are bounded by the alphabet
 * instead, times three layers, which is a couple of hundred per appearance on
 * its own. Sized so a curved graph's atlas and a straight graph's labels can
 * both be resident without evicting each other. Entries are small and evicting
 * one only costs a re-render, so this errs generous.
 */
const MAX_SPRITES = 1400;

/** text|fontSize|fill|halo|ring|ringWidth|haloWidth|scale */
const cache = new Map();

/**
 * WHAT A KEY MISMATCH COSTS
 *
 * Both key builders below are the ONLY ones. That is not tidiness: a writer and
 * a reader that disagree do not merely fail to share a cache, they build a
 * permanent loop, and this module ran inside one.
 *
 * The bake stored whole-label sprites under a key written out a second time at
 * the call site, differing from this one in the separator alone. So every bake
 * succeeded, every peek missed, and every render therefore asked again for a
 * sprite that already existed. The queue drained the request (cheaply — the
 * baker's own lookup used the same spelling as the store, so it returned the
 * cached bitmap), counted it as baked, and announced a landed batch, which cost
 * a full canvas render, which asked again. Forever, for as long as one straight
 * label was on screen.
 *
 * That is the whole of "rasterisation makes the canvas slow": not the encoding,
 * which happened once and worked, but a self-feeding re-render at whatever rate
 * the notifier allowed. Nothing else in here can see such a thing — a mismatched
 * key looks exactly like a cold cache from every angle except this one.
 */
const labelKey = (spec) => (
  `${spec.text} ${spec.fontSize} ${spec.fill} ${spec.halo || ''} ${spec.haloWidth || 0} `
  + `${spec.ring || ''} ${spec.ringWidth || 0} ${spec.scale}`
);

/** The colour and stroke this layer draws with, or null if it draws nothing. */
const glyphLayerPaint = (spec) => {
  const { layer } = spec;
  const color = layer === 'ring' ? spec.ring : layer === 'halo' ? spec.halo : spec.fill;
  if (!color) return null;
  const strokeWidth = layer === 'ring' ? spec.ringWidth : layer === 'halo' ? spec.haloWidth : 0;
  if (layer !== 'fill' && !(strokeWidth > 0)) return null;
  // Padding comes from the widest stroke in the whole LABEL, not this layer's,
  // so every layer of a glyph comes back the same size and one set of frames
  // places all three.
  const widest = Math.max(spec.ring ? spec.ringWidth : 0, spec.halo ? spec.haloWidth : 0);
  return { color, strokeWidth, widest };
};

const glyphKey = (spec, paint) => (
  `g|${spec.ch}|${spec.layer}|${spec.fontSize}|${paint.color}|${paint.strokeWidth}|${paint.widest}|${spec.scale}`
);

let canvas = null;
let ctx = null;

/**
 * Vertical extent of the FONT, not of the string being drawn.
 *
 * This distinction is the whole reason curved labels came out bouncing. A
 * sprite is placed by its centre, so the box it is drawn in defines where its
 * baseline ends up. Size each glyph's box to that glyph's own ink and every
 * character gets a different baseline offset: 'o' has no descender and 'p'
 * does, so centring each on its own ink puts them at different heights and the
 * text visibly walks up and down along the arc. A whole-label sprite never
 * showed this because all of its glyphs share one box.
 *
 * Font-wide metrics give every glyph of a given size the same box and therefore
 * the same baseline, which is what a line of text actually is.
 *
 * `fontBoundingBox*` is font-wide by definition. Where it is missing, a
 * reference string carrying a tall ascender and a deep descender stands in —
 * still one answer for the whole font, which is the property that matters.
 */
const metricsCache = new Map();

function fontVerticalMetrics(c, font, fontSize) {
  const hit = metricsCache.get(font);
  if (hit) return hit;

  c.font = font;
  let ascent = 0;
  let descent = 0;
  try {
    const m = c.measureText('Hxdp');
    if (m.fontBoundingBoxAscent > 0 && m.fontBoundingBoxDescent > 0) {
      ascent = m.fontBoundingBoxAscent;
      descent = m.fontBoundingBoxDescent;
    } else if (m.actualBoundingBoxAscent > 0) {
      ascent = m.actualBoundingBoxAscent;
      descent = Math.max(m.actualBoundingBoxDescent, fontSize * 0.2);
    }
  } catch (_) { /* fall through to the nominal estimate */ }

  if (!(ascent > 0)) ascent = fontSize * 0.8;
  if (!(descent > 0)) descent = fontSize * 0.25;

  // x-height, for matching SVG's `dominant-baseline: middle` — see
  // spriteCenterOffsetY.
  let xHeight = 0;
  try {
    const mx = c.measureText('x');
    if (mx.actualBoundingBoxAscent > 0) xHeight = mx.actualBoundingBoxAscent;
  } catch (_) { /* estimated below */ }
  if (!(xHeight > 0)) xHeight = fontSize * 0.52;

  const out = { ascent, descent, xHeight };
  metricsCache.set(font, out);
  return out;
}

/**
 * How far a sprite's centre sits from the point the <text> it replaces anchors to.
 *
 * A sprite is placed by its box centre; a <text> is placed by a BASELINE, and
 * `dominant-baseline: middle` puts that baseline half an x-height below the
 * anchor. Those two are not the same point, so a sprite centred naively on the
 * anchor sits a few units off from the text it stands in for — invisible while
 * sprites were all-or-nothing, and a visible jolt the moment a label renders as
 * text first and swaps to a sprite afterwards.
 *
 * Derive it rather than nudge it. Placing the bitmap's top at Y puts its
 * baseline at Y + pad + ascent, and matching that to the text's y + xHeight/2
 * gives a centre offset of (xHeight - ascent + descent) / 2. The padding falls
 * out, so this is a property of the font alone.
 *
 * Applied in the label's own rotated frame — offsetting the <image> before the
 * rotation is what carries it perpendicular to the text rather than down the
 * screen.
 */
const spriteCenterOffsetY = ({ ascent, descent, xHeight }) => (
  (xHeight - ascent + descent) / 2
);

function getContext() {
  if (ctx) return ctx;
  if (typeof document === 'undefined') return null;
  canvas = document.createElement('canvas');
  ctx = canvas.getContext('2d', { willReadFrequently: false });
  return ctx;
}

/**
 * The box a sprite occupies and the resolution it rasterises at.
 *
 * Shared by both bakers and by the queue's cost estimate, which is the point:
 * the estimate decides whether a bake is affordable right now, so it has to be
 * the SAME arithmetic the bake will perform. Two copies of it would drift, and
 * a cost model that disagrees with the cost is worse than none.
 *
 * `boxW`/`boxH` are canvas units and carry no trace of `scale` — which is what
 * makes one bucket's bitmap a drop-in for another's (see peekNearbyLabelSprite).
 */
function spriteRaster(metrics, inkWidth, widestStroke, scale) {
  const pad = Math.max(SPRITE_PAD_MIN, widestStroke * SPRITE_PAD_FACTOR);
  const boxW = inkWidth + pad * 2;
  const boxH = metrics.ascent + metrics.descent + pad * 2;

  // Back the scale off rather than refusing — see MAX_SPRITE_PIXELS.
  let s = scale;
  while (s > MIN_SPRITE_SCALE && boxW * s * boxH * s > MAX_SPRITE_PIXELS) s /= 2;

  return {
    pad,
    boxW,
    boxH,
    s,
    pxW: Math.max(1, Math.ceil(boxW * s)),
    pxH: Math.max(1, Math.ceil(boxH * s)),
  };
}

/**
 * The power-of-two bucket at or above `zoom`, clamped.
 *
 * At or ABOVE deliberately: a sprite sampled up looks soft, one sampled down
 * looks fine, so the rounding error is spent in the direction that does not
 * show.
 */
export function spriteScaleForZoom(zoom) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const bucket = Math.pow(2, Math.ceil(Math.log2(z)));
  return Math.min(MAX_SPRITE_SCALE, Math.max(MIN_SPRITE_SCALE, bucket));
}

/** Eviction passes since load, for `window.__spritePerf` — see drainBakeQueue. */
let evictions = 0;

function evictOldest() {
  // Map iterates in insertion order, so the first key is the least recently
  // ADDED. Entries are re-inserted on read (see getLabelSprite), which turns
  // that into least-recently-USED.
  evictions++;
  const drop = Math.max(1, Math.floor(MAX_SPRITES * 0.2));
  let n = 0;
  for (const key of cache.keys()) {
    if (n++ >= drop) break;
    cache.delete(key);
  }
}

/**
 * Rasterise one label and return it as a data URL plus the size to draw it at.
 *
 * Returns null when a sprite must not be used — no DOM, a degenerate request,
 * or, importantly, a font that has not arrived yet. Baking a fallback face into
 * a bitmap would freeze the wrong glyphs in place until the entry was evicted,
 * where the <text> path merely renders one frame in the wrong font and fixes
 * itself. The caller falls back to <text> and gets a sprite on a later render.
 *
 * @param {object}  spec
 * @param {string}  spec.text        already truncated — the string as drawn
 * @param {number}  spec.fontSize    canvas units
 * @param {string}  spec.fill        glyph fill
 * @param {string}  spec.halo        inner stroke, or falsy for none
 * @param {number}  spec.haloWidth   inner stroke width, canvas units
 * @param {string}  spec.ring        outer stroke, or falsy for none
 * @param {number}  spec.ringWidth   outer stroke width, canvas units
 * @param {number}  spec.scale       device px per canvas unit (see spriteScaleForZoom)
 * @returns {{href:string,width:number,height:number}|null} size in CANVAS units
 */
export function getLabelSprite(spec) {
  const { text, fontSize, fill, halo, haloWidth, ring, ringWidth, scale } = spec;
  if (!text || !(fontSize > 0) || !(scale > 0)) return null;
  if (!edgeLabelFontLoaded(fontSize)) return null;

  // THE key builder, never a second copy of it. This line held its own
  // separately-written version until it was found to disagree with labelKey
  // on the separator alone, which is all it takes: the bake stored every
  // sprite under a key no reader could form, so a label was baked, cached,
  // and then missed on every render for the life of the session. See
  // WHAT A KEY MISMATCH COSTS above labelKey.
  const key = labelKey(spec);
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Re-insert so insertion order tracks USE, which is what the eviction pass
    // above assumes.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const c = getContext();
  if (!c) return null;

  const font = edgeLabelFontString(fontSize);

  let inkWidth;
  try {
    inkWidth = measureTextWidth(text, font);
  } catch (_) {
    return null;
  }
  if (!(inkWidth > 0)) return null;

  const widestStroke = Math.max(ring ? ringWidth : 0, halo ? haloWidth : 0);

  // Vertical extent from the font itself rather than from the nominal size:
  // ascenders and descenders overrun the em box, and a sprite that clips them
  // is worse than one that carries a few transparent rows.
  // Font-wide, not string-wide, so a straight label and a curved one made of
  // the same text sit at the same height. See fontVerticalMetrics.
  const metrics = fontVerticalMetrics(c, font, fontSize);
  const { ascent } = metrics;

  const { pad, boxW, boxH, s, pxW, pxH } = spriteRaster(metrics, inkWidth, widestStroke, scale);

  canvas.width = pxW;
  canvas.height = pxH;

  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, pxW, pxH);
  c.scale(s, s);

  c.font = font;
  c.textAlign = 'center';
  // Centre the INK box rather than a baseline: the sprite is placed by its
  // centre, so what has to land on the connection is the middle of the marks,
  // and deriving it here keeps every label consistent regardless of which
  // ascenders and descenders its particular string happens to contain.
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  c.lineCap = 'round';

  const originX = boxW / 2;
  const originY = pad + ascent;

  // Outermost first, then the halo over it, then the fill: the same order the
  // two <text> elements achieve by stacking, and the same order `paint-order:
  // stroke fill` achieves within the second of them.
  if (ring && ringWidth > 0) {
    c.strokeStyle = ring;
    c.lineWidth = ringWidth;
    c.strokeText(text, originX, originY);
  }
  if (halo && haloWidth > 0) {
    c.strokeStyle = halo;
    c.lineWidth = haloWidth;
    c.strokeText(text, originX, originY);
  }
  c.fillStyle = fill;
  c.fillText(text, originX, originY);

  let href;
  try {
    href = canvas.toDataURL('image/png');
  } catch (_) {
    return null;
  }

  const sprite = { href, width: boxW, height: boxH, centerOffsetY: spriteCenterOffsetY(metrics) };
  cache.set(key, sprite);
  persistSprite(key, sprite);
  if (cache.size > MAX_SPRITES) evictOldest();
  return sprite;
}

/**
 * The same trick one level down, for labels that ride an arc.
 *
 * A curved label cannot be one bitmap — it has no single baseline — but nothing
 * about a curve resists bitmaps. Each GLYPH becomes its own quad, placed and
 * rotated by exactly the frames `labelArcGlyphFrames` already computes. The
 * cache key is the character rather than the string, so the atlas is bounded by
 * the alphabet (~70 entries per appearance) instead of by how many distinct
 * labels exist, and every curved label on the canvas shares it.
 *
 * The trade against the per-label sprite is draw count, not cache size: a
 * curved label costs one quad per character where a straight one costs one
 * quad total. That is still the same categorical win — a textured quad instead
 * of a stroked rotated glyph outline — it just doesn't also collapse the draws.
 *
 * WHY THE LAYERS COME BACK SEPARATELY
 *
 * The obvious version — bake ring, halo and fill into each glyph and draw
 * complete glyphs left to right — is wrong, and visibly so. The ring is about
 * 22 units wide on a ~39-unit advance, so neighbouring glyphs' rings overlap;
 * drawing finished glyphs in order paints each one's ring over the previous
 * one's FILL, notching every letter on its trailing side. Stroked <text> never
 * had this problem because SVG strokes the whole run before filling any of it.
 *
 * So the caller gets three passes to draw — every ring, then every halo, then
 * every fill — which reproduces that order. Hence a layer in the key, and hence
 * three <image> runs per curved label rather than one.
 *
 * @param {object} spec as getLabelSprite, minus `text`, plus:
 * @param {string} spec.ch    a single character
 * @param {'ring'|'halo'|'fill'} spec.layer which pass this quad belongs to
 * @returns {{href:string,width:number,height:number}|null} size in CANVAS units
 */
export function getGlyphSprite(spec) {
  const { ch, layer, fontSize, scale } = spec;
  if (!ch || !(fontSize > 0) || !(scale > 0)) return null;
  if (!edgeLabelFontLoaded(fontSize)) return null;

  const paint = glyphLayerPaint(spec);
  if (!paint) return null;
  const { color, strokeWidth, widest } = paint;
  const key = glyphKey(spec, paint);
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const c = getContext();
  if (!c) return null;

  const font = edgeLabelFontString(fontSize);
  // Width is per-glyph — that is the advance the caller places by. Height is
  // font-wide and identical for every character, which is what keeps all the
  // baselines on one line. See fontVerticalMetrics.
  const metrics = fontVerticalMetrics(c, font, fontSize);
  const { ascent } = metrics;
  c.font = font;
  const m = c.measureText(ch);
  const inkWidth = Number.isFinite(m.width) && m.width > 0 ? m.width : fontSize * 0.5;

  const { pad, boxW, boxH, s, pxW, pxH } = spriteRaster(metrics, inkWidth, widest, scale);
  canvas.width = pxW;
  canvas.height = pxH;

  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, pxW, pxH);
  c.scale(s, s);
  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  c.lineCap = 'round';

  const originX = boxW / 2;
  const originY = pad + ascent;
  if (layer === 'fill') {
    c.fillStyle = color;
    c.fillText(ch, originX, originY);
  } else {
    c.strokeStyle = color;
    c.lineWidth = strokeWidth;
    c.strokeText(ch, originX, originY);
  }

  let href;
  try {
    href = canvas.toDataURL('image/png');
  } catch (_) {
    return null;
  }

  // `advance` is what the caller places by. Drawn with textAlign 'center', the
  // glyph's ADVANCE box is centred in the sprite, so putting the sprite centre
  // half an advance along the reading direction from a frame origin lands the
  // glyph exactly where a `text-anchor: start` <text> would have put it.
  const sprite = { href, width: boxW, height: boxH, advance: inkWidth, centerOffsetY: spriteCenterOffsetY(metrics) };
  cache.set(key, sprite);
  persistSprite(key, sprite);
  if (cache.size > MAX_SPRITES) evictOldest();
  return sprite;
}

/**
 * DEFERRED BAKING
 *
 * Baking is not cheap and there can be a lot of it at once. A lombardi graph's
 * first render asks for the whole alphabet across three layer passes — a couple
 * of hundred bakes — and each one ends in a PNG encode. Done inline, that is
 * hundreds of milliseconds of synchronous work inside a React render, which is
 * exactly the stall that showed up as the network being slow to appear: the
 * graph could not paint until every label had been rasterised.
 *
 * So the render phase never bakes. It PEEKS, and asks for anything missing;
 * the queue drains later in idle time, a slice at a time, and tells its
 * subscribers when a batch has landed so the canvas can re-render into the
 * cache it now has. The network paints first and the labels arrive behind it.
 *
 * THE SECOND COST
 *
 * Deferring the bakes is only half of it. Telling the canvas a batch has landed
 * is itself expensive — the subscriber re-renders, and the sprite generation is
 * part of the edge element cache key, so every edge is re-solved. Announcing
 * each drained slice spends a full edge pass per slice, and an idle callback
 * that fires on its TIMEOUT reports no time remaining, so each of those slices
 * held a single bake. That pairing is self-sustaining: the re-render keeps the
 * thread busy, which makes the next callback time out too, and the canvas
 * appears to lock up for as long as there are labels left. Both halves are
 * fixed below — READY_NOTIFY_MIN_MS coalesces the signal, and a timed-out
 * deadline spends BAKE_SLICE_MS rather than nothing.
 *
 * A worker was the other option and is deliberately not what this is. It would
 * move the encode off-thread entirely, which is strictly better on paper — but
 * an OffscreenCanvas in a worker has its own font set, so EmOne would have to
 * be loaded a second time there and kept in step with the main thread's copy,
 * and a label baked against a fallback face is exactly the failure this module
 * already goes out of its way to avoid. Chunking buys most of the win for a
 * fraction of the risk. If idle slices turn out not to be enough, a worker is
 * the next step and this queue is the seam it would slot into.
 */

/** Time budget per slice when there is no idle deadline to consult. */
const BAKE_SLICE_MS = 6;

/** How long a pending bake may wait before it stops being deferred. */
const BAKE_IDLE_TIMEOUT_MS = 300;

/**
 * Minimum gap between "a batch landed" signals.
 *
 * The signal is not free to send. Its subscriber re-renders the canvas, and the
 * sprite generation is part of the edge element cache key, so EVERY edge is
 * re-solved — placement, crossings, routing, the lot. That is the work sprites
 * exist to avoid, and sending the signal once per drained slice spends it over
 * and over while the queue empties: on a large web the notifications cost far
 * more than the baking they are announcing.
 *
 * Nothing is lost by batching them. A label with no sprite yet renders as
 * <text>, not as nothing, so a later signal costs a slightly longer wait before
 * the bitmap swaps in — and the signal carries no payload, so one fire always
 * picks up everything baked since the last.
 */
const READY_NOTIFY_MIN_MS = 500;

/**
 * A bake this size or larger waits for the canvas to be properly still.
 *
 * Set against a frame rather than against a queue: at the rates a browser
 * encodes PNG, this is roughly one frame's worth of work, so anything under it
 * fits inside an idle slice and anything over it does not, however the slice is
 * budgeted. The slice budget alone cannot help — it is checked AFTER a bake
 * returns, so it bounds how many bakes a slice starts and never how long one
 * takes.
 *
 * Deferred, not refused. Backing the resolution off instead would trade a stall
 * for permanent softness, and the whole point of the bucket is that a label
 * zoomed into is drawn sharp. A big bake is worth its cost; it just has to be
 * spent when nothing else wants the thread.
 */
const BIG_BAKE_PIXELS = 600 * 1024;

/** How long the canvas must have been quiet before a big bake is allowed. */
const STILL_MS = 400;

/** key -> {glyph:boolean, spec} */
const pending = new Map();
const readyListeners = new Set();
let bakeScheduled = false;
let lastNotifyAt = 0;
let notifyTimer = null;

/**
 * True while the labels are hidden — a view gesture or a node drag is in
 * flight. See setBakingPaused.
 */
let bakingPaused = false;
/** When the canvas last became still. Big bakes wait STILL_MS past this. */
let stillSince = 0;
/** A landed batch that was not announced because the view was moving. */
let notifyHeld = false;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function emitReady() {
  notifyTimer = null;
  notifyHeld = false;
  lastNotifyAt = nowMs();
  readyListeners.forEach((fn) => { try { fn(); } catch (_) { /* a listener must not stall the queue */ } });
}

/** Tell subscribers a batch has landed, at most every READY_NOTIFY_MIN_MS. */
function notifyReady() {
  // Not while the view is moving. The signal costs a full canvas render — 143ms
  // on a real universe, which is the measurement that made label suppression a
  // bare classList write rather than React state (see LABEL SUPPRESSION in
  // useCanvasTransform). Spending that mid-gesture would buy nothing even if it
  // were free: the labels it is announcing are hidden until the view settles.
  if (bakingPaused) { notifyHeld = true; return; }
  if (notifyTimer !== null) return;
  const wait = READY_NOTIFY_MIN_MS - (nowMs() - lastNotifyAt);
  if (wait <= 0) {
    emitReady();
    return;
  }
  notifyTimer = setTimeout(emitReady, wait);
}

/**
 * Stop and start the bakery with the labels themselves.
 *
 * Every gram of this module's cost — the encode, and the canvas render each
 * landed batch provokes — is spent on something the user cannot see while a
 * gesture or a drag is in flight, because labels are hidden for the duration of
 * one. Worse, it is spent against the frame budget of the very gesture it is
 * invisible to, and the encode is not interruptible once started.
 *
 * So the bakery follows the labels exactly: hidden means paused, visible means
 * go. Wired from `applyLabelsHidden`, which is the one place that already ORs
 * the gesture and drag reasons together and already runs without a React
 * render — see useCanvasTransform.
 *
 * Resuming also restarts the stillness clock, which is what holds the big bakes
 * back until the view has actually stopped rather than merely paused between
 * two flicks of a wheel.
 */
export function setBakingPaused(paused) {
  const next = !!paused;
  if (next === bakingPaused) return;
  bakingPaused = next;
  if (next) return;

  stillSince = nowMs();
  if (notifyHeld) notifyReady();
  scheduleBake();
}

/**
 * Set once a bake has failed for a reason that will not fix itself — no canvas
 * backend, or an encode the browser refused. After that, peeks report "no
 * sprite, and there never will be" so callers stop holding a label back waiting
 * for one and fall through to <text> permanently.
 */
let bakingBroken = false;

/** Is the sprite path worth waiting for at all? */
export function spritesUsable() {
  return !bakingBroken;
}

/**
 * Called when baked sprites have landed, coalesced to READY_NOTIFY_MIN_MS.
 * Returns an unsubscribe.
 */
export function onSpritesReady(fn) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

/**
 * What this bake will rasterise, in device pixels, without performing it.
 *
 * Built on the same spriteRaster the baker uses, so the estimate cannot
 * disagree with the cost. Measurement is cached (see textMeasurement and
 * fontVerticalMetrics), so asking is cheap even for a job that is then put
 * back.
 */
function bakePixels(job) {
  const c = getContext();
  if (!c) return 0;
  const { spec } = job;
  const font = edgeLabelFontString(spec.fontSize);
  const metrics = fontVerticalMetrics(c, font, spec.fontSize);

  if (job.glyph) {
    const paint = glyphLayerPaint(spec);
    if (!paint) return 0;
    c.font = font;
    const m = c.measureText(spec.ch);
    const ink = Number.isFinite(m.width) && m.width > 0 ? m.width : spec.fontSize * 0.5;
    const r = spriteRaster(metrics, ink, paint.widest, spec.scale);
    return r.pxW * r.pxH;
  }

  let ink = 0;
  try {
    ink = measureTextWidth(spec.text, font);
  } catch (_) {
    return 0;
  }
  const widest = Math.max(spec.ring ? spec.ringWidth : 0, spec.halo ? spec.haloWidth : 0);
  const r = spriteRaster(metrics, ink, widest, spec.scale);
  return r.pxW * r.pxH;
}

function drainBakeQueue(deadline) {
  bakeScheduled = false;
  // The gesture that paused us started after this callback was queued. Drop it;
  // setBakingPaused schedules a fresh one when the labels come back.
  if (bakingPaused) return;

  const started = nowMs();
  const perf = typeof window !== 'undefined' && window.__spritePerf;
  const still = started - stillSince >= STILL_MS;
  let baked = 0;
  let worstBakeMs = 0;
  let held = 0;

  for (const [key, job] of pending) {
    // A big bake is not interruptible once begun, so the decision to start one
    // is the only control there is. Leave it queued until the canvas has been
    // still long enough that a frame lost to it costs nobody anything.
    if (!still && bakePixels(job) >= BIG_BAKE_PIXELS) {
      held++;
      continue;
    }
    pending.delete(key);

    // A THROW is latched the same way a null is, and for a sharper reason than
    // tidiness. Callers hold a label back while its sprite bakes, so a baker
    // that reliably throws does not merely fail to speed anything up — it makes
    // the labels invisible and keeps retrying forever. Latching turns that into
    // "render as <text>", which is the direction a failure should fall.
    let made = null;
    const bakeStarted = perf ? nowMs() : 0;
    try {
      made = job.glyph ? getGlyphSprite(job.spec) : getLabelSprite(job.spec);
      if (perf) worstBakeMs = Math.max(worstBakeMs, nowMs() - bakeStarted);
    } catch (err) {
      bakingBroken = true;
      pending.clear();
      console.warn('[labelSprites] baking disabled; labels fall back to text', err);
      break;
    }

    // A bake that produced nothing while the font is available means the canvas
    // itself is unusable; nothing is gained by grinding through the rest.
    if (!made && edgeLabelFontLoaded(job.spec.fontSize)) {
      bakingBroken = true;
      pending.clear();
      break;
    }
    baked++;

    // How much longer this slice may run.
    //
    // An idle callback that fired because its TIMEOUT expired reports zero time
    // remaining: the thread is busy. Taken at face value that stops the slice
    // after a single bake — and the canvas re-render each batch provokes is
    // itself what keeps the thread busy, so every subsequent callback times out
    // too. The queue then drains one sprite per full edge re-solve, which is
    // the worst ratio available and reads as the canvas locking up for as long
    // as there are labels left to bake.
    //
    // A timed-out deadline means "no idle time is coming", not "do nothing", so
    // spend our own slice instead and let the budget below bound it.
    const elapsed = nowMs() - started;
    const left = (deadline && !deadline.didTimeout && deadline.timeRemaining)
      ? deadline.timeRemaining()
      : BAKE_SLICE_MS - elapsed;
    if (left <= 1) break;
  }

  // `window.__spritePerf = true` in the console, then open a universe with
  // labels on. Each slice reports what it actually cost and how much is left,
  // which is what separates "the bakes are slow" from "the queue is drained in
  // useless slivers" — the two have opposite fixes. Pair it with
  // `window.__edgePerf` to see the re-render each landed batch provokes.
  if (perf && (baked > 0 || held > 0)) {
    console.log('[spritePerf] slice', {
      baked,
      sliceMs: Number((nowMs() - started).toFixed(2)),
      worstBakeMs: Number(worstBakeMs.toFixed(2)),
      queued: pending.size,
      timedOut: !!deadline?.didTimeout,
      // Big bakes left queued because the canvas was not still enough yet.
      held,
      // A queue that never empties on a settled canvas means the working set
      // is bigger than MAX_SPRITES and the cache is evicting entries it is
      // about to be asked for again — curved labels key per COLOUR as well as
      // per character and layer, so a web of many connection colours can reach
      // that. Rising evictions with a queue that keeps refilling is the tell.
      evictions,
    });
  }

  if (baked > 0 || bakingBroken) notifyReady();
  if (pending.size === 0) return;

  // Nothing left but bakes too big for a canvas this busy. Re-arming an idle
  // callback would just re-ask the same question a few milliseconds later, over
  // and over; wait for the stillness window to open instead.
  if (held > 0 && baked === 0) {
    scheduleBake(Math.max(1, STILL_MS - (nowMs() - stillSince)));
    return;
  }
  scheduleBake();
}

function scheduleBake(delayMs = 0) {
  if (bakeScheduled || pending.size === 0 || bakingPaused) return;
  bakeScheduled = true;
  if (delayMs > 0) {
    setTimeout(() => drainBakeQueue(null), delayMs);
  } else if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(drainBakeQueue, { timeout: BAKE_IDLE_TIMEOUT_MS });
  } else {
    setTimeout(() => drainBakeQueue(null), 0);
  }
}

/**
 * Read last session's sprites back in.
 *
 * Fire-and-forget, and never awaited by anything: a label renders as <text>
 * until its bitmap exists, so an empty or slow store costs nothing but the
 * usual first-paint path. What it saves is the baking itself — a returning user
 * opens the same universe with the same types, colours and text size, and the
 * whole set is already made.
 *
 * Hydration never overwrites. Anything baked in the meantime is by definition
 * current, and a persisted row can only be older.
 */
let hydrated = false;

export function hydrateLabelSprites() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  loadPersistedSprites().then((rows) => {
    let added = 0;
    for (const [key, sprite] of rows) {
      if (cache.has(key)) continue;
      cache.set(key, sprite);
      added++;
      if (cache.size > MAX_SPRITES) evictOldest();
    }
    if (added > 0) {
      // Same signal a finished bake sends, so the canvas re-renders into the
      // cache it just gained without needing to know where the sprites came
      // from — and coalesced with those, since hydration typically lands while
      // the first bakes are already draining.
      notifyReady();
    }
  }).catch(() => { /* best effort */ });
}

/**
 * Cache lookup only — never bakes, safe to call from a render.
 *
 * Returns the sprite, or null. A null means "not yet"; ask `spritesUsable()`
 * whether it will ever be anything else.
 */
export function peekLabelSprite(spec) {
  if (!spec?.text || !(spec.fontSize > 0) || !(spec.scale > 0)) return null;
  const key = labelKey(spec);
  const hit = cache.get(key);
  if (hit === undefined) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/** As peekLabelSprite, for one layer of one glyph. */
export function peekGlyphSprite(spec) {
  if (!spec?.ch || !(spec.fontSize > 0) || !(spec.scale > 0)) return null;
  const paint = glyphLayerPaint(spec);
  if (!paint) return null;
  const key = glyphKey(spec, paint);
  const hit = cache.get(key);
  if (hit === undefined) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/**
 * THE BUCKET A ZOOM JUST LEFT
 *
 * Scale is part of the key, so crossing a doubling misses EVERY label at once.
 * Falling through to <text> at that moment is the worst available answer: it is
 * a visible change of form on every label on screen, it arrives just as the
 * view settles and the labels fade back in, and it is immediately undone a
 * second later when the new bucket finishes baking. Two replacements where the
 * user asked for none.
 *
 * The bitmap from the bucket either side is a perfectly good stand-in. Nothing
 * in a sprite's geometry knows its scale — `width`, `height`, `advance` and
 * `centerOffsetY` are all canvas units (see spriteRaster) — so a neighbour
 * draws at exactly the same size and place, differing only in sharpness. This
 * module already accepts being sampled up by a factor of two as its normal
 * operating point, which is precisely one bucket.
 *
 * So: ask for the right one, draw the nearest one meanwhile. Sharper before
 * softer, since sampling DOWN is the direction that doesn't show.
 *
 * Only called on a miss, so the exact-hit path pays nothing for this.
 */
const SCALE_BUCKETS = [8, 4, 2, 1, 0.5];

function nearbyScales(scale) {
  return SCALE_BUCKETS
    .filter((s) => s !== scale)
    .sort((a, b) => {
      const da = Math.abs(Math.log2(a / scale));
      const db = Math.abs(Math.log2(b / scale));
      // Equidistant buckets straddle the wanted one; take the sharper.
      return da === db ? b - a : da - db;
    });
}

/**
 * Fetch and mark as used. A substitute is on screen for as long as the new
 * bucket takes to bake, so it has to count as live against eviction — dropping
 * one mid-substitution is the flash to <text> this whole path exists to avoid.
 */
function useSprite(key) {
  const hit = cache.get(key);
  if (hit === undefined) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/** The nearest OTHER bucket's bitmap for this label, or null. */
export function peekNearbyLabelSprite(spec) {
  if (!spec?.text || !(spec.fontSize > 0) || !(spec.scale > 0)) return null;
  for (const scale of nearbyScales(spec.scale)) {
    const hit = useSprite(labelKey({ ...spec, scale }));
    if (hit) return hit;
  }
  return null;
}

/** As peekNearbyLabelSprite, for one layer of one glyph. */
export function peekNearbyGlyphSprite(spec) {
  if (!spec?.ch || !(spec.fontSize > 0) || !(spec.scale > 0)) return null;
  const paint = glyphLayerPaint(spec);
  if (!paint) return null;
  for (const scale of nearbyScales(spec.scale)) {
    const hit = useSprite(glyphKey({ ...spec, scale }, paint));
    if (hit) return hit;
  }
  return null;
}

/**
 * Ask for a sprite to exist soon. Cheap, idempotent, and safe from a render —
 * it only ever writes a map entry.
 */
export function requestLabelSprite(spec) {
  if (bakingBroken || !spec?.text || !(spec.fontSize > 0) || !(spec.scale > 0)) return;
  const key = labelKey(spec);
  if (cache.has(key) || pending.has(key)) return;
  pending.set(key, { glyph: false, spec });
  scheduleBake();
}

/** As requestLabelSprite, for one layer of one glyph. */
export function requestGlyphSprite(spec) {
  if (bakingBroken || !spec?.ch || !(spec.fontSize > 0) || !(spec.scale > 0)) return;
  const paint = glyphLayerPaint(spec);
  if (!paint) return;
  const key = glyphKey(spec, paint);
  if (cache.has(key) || pending.has(key)) return;
  pending.set(key, { glyph: true, spec });
  scheduleBake();
}

/**
 * Drop every sprite. For a font arriving after some were baked, and for tests.
 *
 * Nothing else needs to call this: a change of text, size, color or scale is
 * part of the key and simply misses, so the cache self-invalidates on all of
 * them. A font swap is the one change the key cannot see.
 */
export function clearLabelSprites({ persisted = false } = {}) {
  cache.clear();
  metricsCache.clear();
  pending.clear();
  // A queued "a batch landed" is about sprites that no longer exist, and the
  // caller clearing the cache is re-rendering anyway — a font swap bumps the
  // font version. Dropping it also means the coalescing window cannot carry
  // across a clear and swallow the next real signal.
  if (notifyTimer !== null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  lastNotifyAt = 0;
  notifyHeld = false;
  stillSince = 0;
  // The callback a cleared queue no longer needs will still run and find
  // nothing; releasing the flag here means the next request schedules its own
  // rather than waiting on that one.
  bakeScheduled = false;
  // A font swap is a fresh start, including for a canvas that looked broken.
  bakingBroken = false;
  // Off by default. Clearing memory is cheap and self-healing; clearing the
  // store throws away work that is almost certainly still valid, so it takes an
  // explicit ask.
  if (persisted) purgePersistedSprites();
}

/**
 * Where one glyph's quad goes, from the frame labelArcGlyphFrames produced.
 *
 * Those frames are baseline ORIGINS — each walked back half an advance so the
 * glyph's centre lands on the circle — because that is what a <text> with
 * `text-anchor: start` wants. An <image> is placed by its box, so walk half an
 * advance forward again to recover the centre.
 *
 * The advance MUST be the one the glyph is actually drawn at — the sprite's own
 * `advance`, measured from the font — and NOT the value at the same index of
 * the array that produced the frames. Those are bucketed em widths normalised
 * so the whole string comes out the right length; they space the ORIGINS
 * correctly, which is all labelArcGlyphFrames needs them for, but they are a
 * few percent off per character. Using them to centre each glyph in its own
 * slot offsets every letter by half its own error, which reads as erratic
 * kerning that gets worse along the label. The <text> path never had this
 * because it hands the browser an origin and lets the glyph take its natural
 * width from there; this restores the same behaviour.
 *
 * Shared by the settled render and the drag updater so a curved label cannot be
 * placed one way at rest and another mid-drag.
 *
 * @returns {{cx:number,cy:number,rot:number}|null}
 */
export function glyphQuadAt(glyphs, i, advance) {
  if (!glyphs?.x || !(i >= 0) || i >= glyphs.x.length) return null;
  const rot = glyphs.rotate[i];
  if (!Number.isFinite(rot)) return null;
  const r = rot * (Math.PI / 180);
  const half = (Number.isFinite(advance) ? advance : 0) / 2;
  return {
    cx: glyphs.x[i] + half * Math.cos(r),
    cy: glyphs.y[i] + half * Math.sin(r),
    rot,
  };
}

/** The order curved glyph layers must be drawn in — see getGlyphSprite. */
export const GLYPH_SPRITE_LAYERS = ['ring', 'halo', 'fill'];

/** Entry count, for diagnostics — `window.__labelSpriteCount()` in NodeCanvas. */
export function labelSpriteCount() {
  return cache.size;
}
