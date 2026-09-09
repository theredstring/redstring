/**
 * End-to-end coverage of the RASTERISING path.
 *
 * Separate from labelSpriteCache.test.js on purpose. That file tests the pure
 * parts — scale buckets, quad geometry, keying, the deferred queue — and runs
 * against a jsdom with no canvas backend, so `getContext` returns null and both
 * bakers bail out before touching the drawing code at all.
 *
 * Which is how a plain `ReferenceError: layer is not defined` reached the app:
 * every test passed while the body of getGlyphSprite had never once executed.
 * A stub context is enough to run it for real, and a bake that throws is a
 * failing test rather than a broken canvas.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The real measurer wraps an engine that needs a canvas and throws without one,
// which would send getLabelSprite down its catch and skip the drawing again.
vi.mock('../../src/services/textMeasurement.js', () => ({
  measureTextWidth: (text) => text.length * 20,
  edgeLabelFontString: (fontSize) => `bold ${fontSize}px 'EmOne', sans-serif`,
  edgeLabelFontLoaded: () => true,
}));

import {
  getLabelSprite,
  getGlyphSprite,
  clearLabelSprites,
  labelSpriteCount,
  GLYPH_SPRITE_LAYERS,
} from '../../src/services/labelSpriteCache.js';

/** Records what was drawn so the layer order can be asserted, not assumed. */
let drawn;

function installCanvasStub() {
  drawn = [];
  const ctx = {
    font: '',
    textAlign: '',
    textBaseline: '',
    lineJoin: '',
    lineCap: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    setTransform: () => {},
    clearRect: () => {},
    scale: () => {},
    measureText: (t) => ({
      width: String(t).length * 20,
      actualBoundingBoxAscent: 50,
      actualBoundingBoxDescent: 14,
      fontBoundingBoxAscent: 56,
      fontBoundingBoxDescent: 18,
    }),
    fillText(t) { drawn.push({ op: 'fill', t, color: this.fillStyle }); },
    strokeText(t) { drawn.push({ op: 'stroke', t, color: this.strokeStyle, width: this.lineWidth }); },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
}

const spec = {
  fontSize: 71.28,
  fill: '#EFE8E5',
  halo: '#260000',
  haloWidth: 10.56,
  ring: '#800000',
  ringWidth: 22.18,
  scale: 2,
};

describe('getLabelSprite (drawing)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installCanvasStub();
    clearLabelSprites();
  });

  it('bakes without throwing and returns something drawable', () => {
    const sprite = getLabelSprite({ ...spec, text: 'is composed of' });
    expect(sprite).not.toBeNull();
    expect(sprite.href).toMatch(/^data:image\/png/);
    expect(sprite.width).toBeGreaterThan(0);
    expect(sprite.height).toBeGreaterThan(0);
  });

  it('paints ring, then halo, then fill', () => {
    // Outermost first. Reversed, the ring would bury the text it surrounds.
    getLabelSprite({ ...spec, text: 'ab' });
    expect(drawn.map((d) => d.color)).toEqual([spec.ring, spec.halo, spec.fill]);
    expect(drawn.map((d) => d.op)).toEqual(['stroke', 'stroke', 'fill']);
  });

  it('draws only the layers the appearance asks for', () => {
    getLabelSprite({ ...spec, text: 'ab', ring: null });
    expect(drawn.map((d) => d.color)).toEqual([spec.halo, spec.fill]);

    drawn.length = 0;
    getLabelSprite({ ...spec, text: 'ab', ring: null, halo: null });
    expect(drawn.map((d) => d.color)).toEqual([spec.fill]);
  });
});

describe('getGlyphSprite (drawing)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installCanvasStub();
    clearLabelSprites();
  });

  it('bakes every layer without throwing', () => {
    // The regression this file exists for: getGlyphSprite referenced `layer`
    // after a refactor dropped it from the destructure, and nothing executed
    // the body to notice.
    for (const layer of GLYPH_SPRITE_LAYERS) {
      const sprite = getGlyphSprite({ ...spec, ch: 'a', layer });
      expect(sprite, `layer ${layer}`).not.toBeNull();
      expect(sprite.href).toMatch(/^data:image\/png/);
    }
    expect(labelSpriteCount()).toBe(GLYPH_SPRITE_LAYERS.length);
  });

  it('draws each layer with its own paint and nothing else', () => {
    getGlyphSprite({ ...spec, ch: 'a', layer: 'ring' });
    expect(drawn).toEqual([{ op: 'stroke', t: 'a', color: spec.ring, width: spec.ringWidth }]);

    drawn.length = 0;
    getGlyphSprite({ ...spec, ch: 'a', layer: 'halo' });
    expect(drawn).toEqual([{ op: 'stroke', t: 'a', color: spec.halo, width: spec.haloWidth }]);

    drawn.length = 0;
    getGlyphSprite({ ...spec, ch: 'a', layer: 'fill' });
    expect(drawn).toEqual([{ op: 'fill', t: 'a', color: spec.fill }]);
  });

  it('gives every glyph the same height, so the baselines line up', () => {
    // The bug that made curved labels bounce: sizing each glyph's box to its own
    // ink puts a descender at a different baseline from a letter without one.
    const heights = ['o', 'p', 'H', 'x', 'g', ','].map(
      (ch) => getGlyphSprite({ ...spec, ch, layer: 'fill' }).height
    );
    expect(new Set(heights).size).toBe(1);
  });

  it('corrects its centre onto the baseline the <text> form anchors to', () => {
    // Seamlessness of the text-then-sprite swap rests entirely on this. A
    // sprite is placed by its box centre; a <text> by a baseline that
    // `dominant-baseline: middle` puts half an x-height below the anchor.
    // Offset = (xHeight - ascent + descent) / 2, from the stub's metrics:
    // x-height comes back as actualBoundingBoxAscent (50), ascent/descent from
    // fontBoundingBox (56/18).
    const sprite = getGlyphSprite({ ...spec, ch: 'a', layer: 'fill' });
    expect(sprite.centerOffsetY).toBeCloseTo((50 - 56 + 18) / 2, 9);

    // Both forms carry the same correction, or a straight label and a curved
    // one would sit at different heights.
    const label = getLabelSprite({ ...spec, text: 'ab' });
    expect(label.centerOffsetY).toBeCloseTo(sprite.centerOffsetY, 9);
  });

  it('varies width per glyph, because that is what the placement uses', () => {
    const narrow = getGlyphSprite({ ...spec, ch: 'a', layer: 'fill' });
    const wide = getGlyphSprite({ ...spec, ch: 'mmm', layer: 'fill' });
    expect(wide.advance).toBeGreaterThan(narrow.advance);
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('declines a layer this appearance does not wear', () => {
    expect(getGlyphSprite({ ...spec, ch: 'a', layer: 'ring', ring: null })).toBeNull();
    expect(getGlyphSprite({ ...spec, ch: 'a', layer: 'halo', halo: null })).toBeNull();
    expect(getGlyphSprite({ ...spec, ch: 'a', layer: 'ring', ringWidth: 0 })).toBeNull();
  });

  it('sizes every layer of a glyph identically, so one frame places all three', () => {
    const sizes = GLYPH_SPRITE_LAYERS.map((layer) => {
      const s = getGlyphSprite({ ...spec, ch: 'a', layer });
      return `${s.width}x${s.height}@${s.advance}`;
    });
    expect(new Set(sizes).size).toBe(1);
  });
});
