/**
 * Environment shims so the bench measures what the app draws.
 *
 * 1. jsdom has no canvas, so `getNodeDimensions` (node boxes) and
 *    `truncateEdgeLabel` (connection labels) can't measure text. The shim
 *    answers `measureText` from the per-glyph advance table layoutGeometry keeps
 *    for EmOne — the font's own hmtx widths, bucketed and rounded up — so node
 *    boxes and label widths come out at the size the canvas renders them.
 *
 * 2. A few force-path branches still roll `Math.random()`. A benchmark whose
 *    input can change between runs can't tell an improvement from the dice, so
 *    every layout call runs under a seeded generator (`withSeed`).
 */
import { edgeLabelGlyphAdvancesEm } from '../../src/services/layoutGeometry.js';

const measure = function measureText(text) {
  const px = parseFloat((String(this.font).match(/(\d+(?:\.\d+)?)px/) || [0, 16])[1]);
  const adv = edgeLabelGlyphAdvancesEm(String(text)) || Array.from(String(text)).map(() => 0.6);
  let em = 0;
  for (const a of adv) em += a;
  return { width: em * px, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.2 };
};

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return { font: '16px sans-serif', measureText: measure };
  };
}
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class {
    getContext() { return { font: '16px sans-serif', measureText: measure }; }
  };
}

/** mulberry32: tiny, fast, well-distributed 32-bit PRNG. */
export const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Run `fn` with Math.random replaced by a seeded generator. */
export function withSeed(seed, fn) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = original; }
}
