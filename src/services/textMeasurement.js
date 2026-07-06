/**
 * Text measurement service powered by @chenglou/pretext.
 *
 * Replaces DOM-based hidden-element measurement (offsetWidth/offsetHeight)
 * and canvas measureText() calls with Pretext's DOM-free layout engine,
 * eliminating synchronous layout reflows.
 */
import { prepare, prepareWithSegments, layout, layoutWithLines, measureNaturalWidth, clearCache } from '@chenglou/pretext';

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
