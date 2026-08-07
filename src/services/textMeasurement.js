/**
 * Text measurement service powered by @chenglou/pretext.
 *
 * Replaces DOM-based hidden-element measurement (offsetWidth/offsetHeight)
 * and canvas measureText() calls with Pretext's DOM-free layout engine,
 * eliminating synchronous layout reflows.
 */
import { prepare, prepareWithSegments, layout, layoutWithLines, measureNaturalWidth, clearCache } from '@chenglou/pretext';
import { edgeLabelGlyphAdvancesEm } from './layoutGeometry.js';

// --- Prepared-text cache (keyed by text + fontString) ---
const preparedCache = new Map();
const preparedSegmentsCache = new Map();
const MAX_CACHE = 2000;
const EVICT_COUNT = Math.floor(MAX_CACHE * 0.2);

function evictOldest(cache) {
  let count = 0;
  for (const key of cache.keys()) {
    if (count++ >= EVICT_COUNT) break;
    cache.delete(key);
  }
}

function getCacheKey(text, fontString) {
  return text + '\0' + fontString;
}

function getPrepared(text, fontString) {
  const key = getCacheKey(text, fontString);
  let cached = preparedCache.get(key);
  if (!cached) {
    cached = prepare(text, fontString);
    preparedCache.set(key, cached);
    if (preparedCache.size > MAX_CACHE) evictOldest(preparedCache);
  }
  return cached;
}

function getPreparedWithSegments(text, fontString) {
  const key = getCacheKey(text, fontString);
  let cached = preparedSegmentsCache.get(key);
  if (!cached) {
    cached = prepareWithSegments(text, fontString);
    preparedSegmentsCache.set(key, cached);
    if (preparedSegmentsCache.size > MAX_CACHE) evictOldest(preparedSegmentsCache);
  }
  return cached;
}

// --- Font string builders ---

/**
 * Build the canvas font string for node name text.
 * Matches Node.jsx: bold, 45*fontSize px, 'EmOne' + sans-serif fallback.
 */
export function buildNodeFontString(textSettings) {
  const size = 45 * (textSettings?.fontSize || 1.0);
  return `bold ${size}px 'EmOne', sans-serif`;
}

/**
 * Build a canvas font string from explicit parameters.
 */
export function buildFontString(fontSize, fontFamily, weight = '') {
  const w = weight ? weight + ' ' : '';
  return `${w}${fontSize}px ${fontFamily}`;
}

// --- Public API ---

/**
 * Measure the height of a text block when wrapped to maxWidth.
 * Drop-in replacement for DOM offsetHeight measurement and calculateTextAreaHeight heuristic.
 *
 * @param {string} text
 * @param {number} maxWidth - available width in px
 * @param {object} textSettings - { fontSize, lineSpacing }
 * @param {number} [lineHeightBase=28] - base line height before lineSpacing multiplier
 * @returns {number} total height in px
 */
export function measureTextBlockHeight(text, maxWidth, textSettings, lineHeightBase = 28) {
  if (!text) return (lineHeightBase || 28) * (textSettings?.lineSpacing || 1);
  const fontString = buildNodeFontString(textSettings);
  const lineHeight = (lineHeightBase || 28) * (textSettings?.lineSpacing || 1);
  const prepared = getPrepared(text, fontString);
  const result = layout(prepared, maxWidth, lineHeight);
  return result.height;
}

/**
 * Measure the natural (unwrapped, single-line) width of text.
 * Drop-in replacement for measurementSpan.offsetWidth and canvas measureText().width.
 *
 * @param {string} text
 * @param {string} fontString - canvas font shorthand (e.g. "bold 28px 'EmOne', sans-serif")
 * @returns {number} width in px
 */
export function measureTextWidth(text, fontString) {
  if (!text) return 0;
  const prepared = getPreparedWithSegments(text, fontString);
  return measureNaturalWidth(prepared);
}

/**
 * Wrap text into lines that fit within maxWidth, for rendering as SVG <tspan>s.
 * Returns the array of line strings (word-wrapped, same engine as node layout).
 *
 * @param {string} text
 * @param {number} maxWidth - available width in px
 * @param {string} fontString - canvas font shorthand (e.g. "bold 45px 'EmOne', sans-serif")
 * @returns {string[]} wrapped line strings
 */
export function wrapTextToLines(text, maxWidth, fontString) {
  if (!text) return [];
  const prepared = getPreparedWithSegments(text, fontString);
  // lineHeight only affects the returned `height`, which we don't use here.
  const result = layoutWithLines(prepared, maxWidth, 1);
  return result.lines.map((l) => l.text);
}

/** The exact font connection labels are drawn with — see NodeCanvas's label JSX. */
export const edgeLabelFontString = (fontSize) => buildFontString(fontSize, "'EmOne', sans-serif", 'bold');

/**
 * Is EmOne itself actually available to measure against yet?
 *
 * Deliberately checks the custom family ALONE, with no `sans-serif` fallback in
 * the string: `check()` answers "can you render this spec", and a spec ending in
 * a fallback is always satisfiable, so including one would return true while
 * EmOne was still in flight — the exact case this exists to catch.
 */
export function edgeLabelFontLoaded(fontSize) {
  if (typeof document === 'undefined' || !document.fonts?.check) return false;
  try {
    return document.fonts.check(buildFontString(fontSize, "'EmOne'", 'bold'));
  } catch (_) {
    return false;
  }
}

/**
 * Per-glyph advances, in px, for a connection label placed glyph by glyph along
 * a curve. Null when the text must not be split — see
 * `edgeLabelGlyphAdvancesEm`, whose fallback rules this inherits.
 *
 * The em buckets alone are not accurate enough to place glyphs with. They are
 * deliberately rounded UP (they exist to reserve layout space, where
 * under-reserving is the harmful direction), so using them raw tracks the text
 * 5-16% wide — visible as letters drifting apart along the arc. They also can't
 * know that the app asks for `bold` from a family that ships only a 600 weight,
 * so every glyph the browser draws is synthetically emboldened and slightly
 * wider than its own hmtx entry.
 *
 * Both are corrected the same way: measure the whole string ONCE through the
 * same engine and the same font string the SVG renders with, and scale the
 * buckets to that total. The buckets then only have to get the RATIOS between
 * characters right, which is what they are good at. What's left is per-pair kern
 * deltas, which the measured total absorbs across the label rather than letting
 * them accumulate.
 *
 * One function, used by both the renderer and the drag updater, so a label can
 * never be measured one way at rest and another mid-drag.
 *
 * @returns {number[]|null} one advance per code point, in px
 */
export function edgeLabelGlyphAdvances(text, fontSize) {
  if (!(fontSize > 0)) return null;
  const em = edgeLabelGlyphAdvancesEm(text);
  if (!em) return null;

  const raw = em.map((e) => e * fontSize);
  const rawTotal = raw.reduce((sum, w) => sum + w, 0);
  if (!(rawTotal > 0)) return null;

  // Only normalize against a measurement that means anything.
  //
  // Before EmOne loads, measuring resolves to whatever fallback the system
  // hands back, and normalizing to THAT total is far worse than not
  // normalizing at all: it scales every advance by a ratio between two
  // unrelated fonts. The buckets then stop describing EmOne, the cumulative
  // positions drift, and since each glyph's angle is derived from its position
  // along the arc, the label doesn't just space badly — it rotates its
  // characters to angles that belong to a label of a different length, and
  // comes out visibly scrambled.
  //
  // The raw buckets are the safe answer here. They're font-specific to EmOne by
  // construction and independent of anything the browser has finished loading,
  // so they're a few percent wide and nothing worse. NodeCanvas re-renders once
  // the font arrives (see the fonts-ready effect) and this starts normalizing.
  if (!edgeLabelFontLoaded(fontSize)) return raw;

  // The engine needs a canvas and throws rather than declining without one,
  // which is a poor reason for a connection label to take the canvas down.
  let measured = 0;
  try {
    measured = measureTextWidth(text, edgeLabelFontString(fontSize));
  } catch (_) {
    return raw;
  }
  if (!(measured > 0)) return raw;

  const scale = measured / rawTotal;
  return raw.map((w) => w * scale);
}

/**
 * Initialize the text measurement system.
 * Call once at app startup. Sets up font-load listener to clear caches
 * when the custom font (EmOne) finishes loading.
 */
export function initTextMeasurement() {
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.ready.then(() => {
      preparedCache.clear();
      preparedSegmentsCache.clear();
      clearCache();
    });
  }
}
