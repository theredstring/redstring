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

  const out = { ascent, descent };
  metricsCache.set(font, out);
  return out;
}

function getContext() {
  if (ctx) return ctx;
  if (typeof document === 'undefined') return null;
  canvas = document.createElement('canvas');
  ctx = canvas.getContext('2d', { willReadFrequently: false });
  return ctx;
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

function evictOldest() {
  // Map iterates in insertion order, so the first key is the least recently
  // ADDED. Entries are re-inserted on read (see getLabelSprite), which turns
  // that into least-recently-USED.
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

  const key = `${text} ${fontSize} ${fill} ${halo || ''} ${haloWidth || 0} ${ring || ''} ${ringWidth || 0} ${scale}`;
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
  const pad = Math.max(SPRITE_PAD_MIN, widestStroke * SPRITE_PAD_FACTOR);

  // Vertical extent from the font itself rather than from the nominal size:
  // ascenders and descenders overrun the em box, and a sprite that clips them
  // is worse than one that carries a few transparent rows.
  // Font-wide, not string-wide, so a straight label and a curved one made of
  // the same text sit at the same height. See fontVerticalMetrics.
  const { ascent, descent } = fontVerticalMetrics(c, font, fontSize);

  const boxW = inkWidth + pad * 2;
  const boxH = ascent + descent + pad * 2;

  // Back the scale off rather than refusing — see MAX_SPRITE_PIXELS.
  let s = scale;
  while (s > MIN_SPRITE_SCALE && boxW * s * boxH * s > MAX_SPRITE_PIXELS) s /= 2;

  const pxW = Math.max(1, Math.ceil(boxW * s));
  const pxH = Math.max(1, Math.ceil(boxH * s));

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

  const sprite = { href, width: boxW, height: boxH };
  cache.set(key, sprite);
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
  const { ascent, descent } = fontVerticalMetrics(c, font, fontSize);
  c.font = font;
  const m = c.measureText(ch);
  const inkWidth = Number.isFinite(m.width) && m.width > 0 ? m.width : fontSize * 0.5;

  const pad = Math.max(SPRITE_PAD_MIN, widest * SPRITE_PAD_FACTOR);
  const boxW = inkWidth + pad * 2;
  const boxH = ascent + descent + pad * 2;

  let s = scale;
  while (s > MIN_SPRITE_SCALE && boxW * s * boxH * s > MAX_SPRITE_PIXELS) s /= 2;

  const pxW = Math.max(1, Math.ceil(boxW * s));
  const pxH = Math.max(1, Math.ceil(boxH * s));
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
  const sprite = { href, width: boxW, height: boxH, advance: inkWidth };
  cache.set(key, sprite);
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

/** key -> {glyph:boolean, spec} */
const pending = new Map();
const readyListeners = new Set();
let bakeScheduled = false;

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

/** Called after each drained batch. Returns an unsubscribe. */
export function onSpritesReady(fn) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

function drainBakeQueue(deadline) {
  bakeScheduled = false;
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let baked = 0;

  for (const [key, job] of pending) {
    pending.delete(key);

    // A THROW is latched the same way a null is, and for a sharper reason than
    // tidiness. Callers hold a label back while its sprite bakes, so a baker
    // that reliably throws does not merely fail to speed anything up — it makes
    // the labels invisible and keeps retrying forever. Latching turns that into
    // "render as <text>", which is the direction a failure should fall.
    let made = null;
    try {
      made = job.glyph ? getGlyphSprite(job.spec) : getLabelSprite(job.spec);
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
    const left = deadline?.timeRemaining
      ? deadline.timeRemaining()
      : BAKE_SLICE_MS - ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    if (left <= 1) break;
  }

  if (baked > 0 || bakingBroken) readyListeners.forEach((fn) => { try { fn(); } catch (_) { /* a listener must not stall the queue */ } });
  if (pending.size) scheduleBake();
}

function scheduleBake() {
  if (bakeScheduled || pending.size === 0) return;
  bakeScheduled = true;
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(drainBakeQueue, { timeout: BAKE_IDLE_TIMEOUT_MS });
  } else {
    setTimeout(() => drainBakeQueue(null), 0);
  }
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
export function clearLabelSprites() {
  cache.clear();
  metricsCache.clear();
  pending.clear();
  // A font swap is a fresh start, including for a canvas that looked broken.
  bakingBroken = false;
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
