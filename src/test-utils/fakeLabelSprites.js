/**
 * Stand-in bitmaps for services/labelSpriteCache.js, so jsdom can render the
 * SPRITE forms of a connection label.
 *
 * Sprites never bake in jsdom (no OffscreenCanvas, no font, no IndexedDB), so
 * without this a test only ever sees the <text> fallback, and the whole sprite
 * half of the drag contract (`g[data-label-sprite]`, `g[data-glyph-layer]`,
 * `image[data-gi|data-advance|data-oy|data-gframe]`, and the
 * `data-label-text`/`data-label-font-size` a curved sprite carries) goes
 * untested.
 *
 * This module imports nothing on purpose: it is loaded from inside a
 * `vi.mock` factory, and pulling the canvas in from there would recurse into
 * the module being mocked. Use it as
 *
 *   vi.mock('./services/labelSpriteCache.js', async (importOriginal) => {
 *     const { withFakeLabelSprites } = await import('./test-utils/fakeLabelSprites.js');
 *     return withFakeLabelSprites(await importOriginal());
 *   });
 *
 * and switch it per test with `setFakeLabelSprites(true | false)`. While off,
 * every export passes straight through to the real module.
 */

const FLAG = '__fakeLabelSpritesOn';

export const setFakeLabelSprites = (on) => { globalThis[FLAG] = !!on; };
const on = () => globalThis[FLAG] === true;

// Mirrors glyphLayerPaint in labelSpriteCache.js: a layer whose paint the
// appearance does not call for has no sprite. The renderer counts layers and
// falls back to <text> if it gets more or fewer than it wanted.
const layerWanted = (spec) => {
  const color = spec.layer === 'ring' ? spec.ring : spec.layer === 'halo' ? spec.halo : spec.fill;
  if (!color) return false;
  if (spec.layer === 'fill') return true;
  const strokeWidth = spec.layer === 'ring' ? spec.ringWidth : spec.haloWidth;
  return strokeWidth > 0;
};

const fakeLabelSprite = (spec) => {
  if (!spec?.text || !(spec.fontSize > 0)) return null;
  return {
    href: 'data:image/png;base64,',
    width: spec.text.length * spec.fontSize * 0.6,
    height: spec.fontSize * 1.4,
    centerOffsetY: 0.5,
  };
};

const fakeGlyphSprite = (spec) => {
  if (!spec?.ch || !(spec.fontSize > 0) || !layerWanted(spec)) return null;
  return {
    href: 'data:image/png;base64,',
    width: spec.fontSize * 0.8,
    height: spec.fontSize * 1.4,
    centerOffsetY: 0.5,
    advance: spec.fontSize * 0.55,
  };
};

export const withFakeLabelSprites = (actual) => ({
  ...actual,
  spritesUsable: () => (on() ? true : actual.spritesUsable()),
  peekLabelSprite: (spec) => (on() ? fakeLabelSprite(spec) : actual.peekLabelSprite(spec)),
  peekNearbyLabelSprite: (spec) => (on() ? fakeLabelSprite(spec) : actual.peekNearbyLabelSprite(spec)),
  peekGlyphSprite: (spec) => (on() ? fakeGlyphSprite(spec) : actual.peekGlyphSprite(spec)),
  peekNearbyGlyphSprite: (spec) => (on() ? fakeGlyphSprite(spec) : actual.peekNearbyGlyphSprite(spec)),
  // Nothing to bake: the peeks above always hit.
  requestLabelSprite: (spec) => (on() ? undefined : actual.requestLabelSprite(spec)),
  requestGlyphSprite: (spec) => (on() ? undefined : actual.requestGlyphSprite(spec)),
});
