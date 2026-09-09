import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  spriteScaleForZoom,
  getLabelSprite,
  glyphQuadAt,
  clearLabelSprites,
  labelSpriteCount,
} from '../../src/services/labelSpriteCache.js';

describe('spriteScaleForZoom', () => {
  it('never samples a sprite up by more than a factor of two', () => {
    // The whole contract. A bucket below the zoom would mean magnifying a
    // bitmap, which is the direction that shows; at or above only ever shrinks.
    for (let z = 0.05; z <= 6; z *= 1.07) {
      const s = spriteScaleForZoom(z);
      if (z >= 0.5 && z <= 8) expect(s).toBeGreaterThanOrEqual(z);
      expect(s / Math.min(Math.max(z, 0.5), 8)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('is a power of two, so ordinary zooming reuses what it already baked', () => {
    for (let z = 0.05; z <= 6; z *= 1.13) {
      const s = spriteScaleForZoom(z);
      expect(Math.log2(s)).toBeCloseTo(Math.round(Math.log2(s)), 9);
    }
  });

  it('holds one bucket across a whole doubling of zoom', () => {
    // What makes a bucket change rare: re-encoding every label on screen is the
    // one expensive thing here, so it must not track the zoom continuously.
    expect(spriteScaleForZoom(1.05)).toBe(spriteScaleForZoom(1.9));
    expect(spriteScaleForZoom(2.1)).toBe(spriteScaleForZoom(3.9));
    expect(spriteScaleForZoom(2.1)).not.toBe(spriteScaleForZoom(1.9));
  });

  it('clamps at both ends and survives nonsense', () => {
    expect(spriteScaleForZoom(0.001)).toBe(0.5);
    expect(spriteScaleForZoom(1000)).toBe(8);
    for (const bad of [0, -1, NaN, undefined, null]) {
      const s = spriteScaleForZoom(bad);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
  });
});

describe('getLabelSprite', () => {
  const spec = {
    text: 'is composed of',
    fontSize: 71.28,
    fill: '#EFE8E5',
    halo: '#260000',
    haloWidth: 10.56,
    ring: '#800000',
    ringWidth: 22.18,
    scale: 2,
  };

  // jsdom ships no FontFaceSet, and getLabelSprite deliberately asks one
  // whether the label font is loadable before baking anything. Stub the whole
  // object rather than spying on a member of something that isn't there.
  const setFontLoaded = (loaded) => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { check: () => loaded, ready: Promise.resolve() },
    });
  };

  beforeEach(() => {
    clearLabelSprites();
    vi.restoreAllMocks();
    setFontLoaded(true);
  });

  it('declines to bake before the label font is available', () => {
    // A bitmap cannot fix itself once the font arrives — it would hold the
    // fallback face until evicted, where <text> re-renders correctly. Declining
    // sends the caller back to <text> for a frame, which is the cheap mistake.
    setFontLoaded(false);
    expect(getLabelSprite(spec)).toBeNull();
    expect(labelSpriteCount()).toBe(0);
  });

  it('declines on a degenerate request rather than baking something unusable', () => {
    expect(getLabelSprite({ ...spec, text: '' })).toBeNull();
    expect(getLabelSprite({ ...spec, fontSize: 0 })).toBeNull();
    expect(getLabelSprite({ ...spec, scale: 0 })).toBeNull();
  });

  it('treats every part of the appearance as part of the key', () => {
    // The point of the cache is that many edges share one bitmap, which is only
    // safe if anything that changes how a label LOOKS misses. The font is the
    // one input the key cannot see — hence clearLabelSprites on fonts.ready.
    const base = getLabelSprite(spec);
    if (!base) return; // no canvas backend in this environment

    expect(getLabelSprite(spec)).toBe(base);
    expect(labelSpriteCount()).toBe(1);

    const variants = [
      { text: 'contains' },
      { fontSize: 48 },
      { fill: '#000000' },
      { halo: '#111111' },
      { haloWidth: 4 },
      { ring: '#123456' },
      { ringWidth: 30 },
      { scale: 4 },
    ];
    for (const v of variants) {
      expect(getLabelSprite({ ...spec, ...v })).not.toBe(base);
    }
    expect(labelSpriteCount()).toBe(1 + variants.length);
  });

  it('reports a size in canvas units that leaves room for the widest stroke', () => {
    const sprite = getLabelSprite(spec);
    if (!sprite) return;

    // Canvas units, not device pixels — the scale must not leak into the size
    // the caller draws at, or a bucket change would resize every label.
    const doubled = getLabelSprite({ ...spec, scale: 4 });
    expect(doubled.width).toBeCloseTo(sprite.width, 6);
    expect(doubled.height).toBeCloseTo(sprite.height, 6);

    // The ring is centred on the glyph outline, so it reaches half its width
    // past the ink on every side; anything tighter clips it.
    expect(sprite.height).toBeGreaterThan(spec.ringWidth);
  });

  it('clears on demand, for the font swap the key cannot see', () => {
    if (!getLabelSprite(spec)) return;
    expect(labelSpriteCount()).toBeGreaterThan(0);
    clearLabelSprites();
    expect(labelSpriteCount()).toBe(0);
  });
});

describe('glyphQuadAt', () => {
  // labelArcGlyphFrames hands out baseline ORIGINS, each already walked back
  // half an advance so the glyph's centre lands on the circle. Placing an
  // <image> means undoing exactly that walk.
  const frames = (rot) => ({ x: [100], y: [200], rotate: [rot] });

  it('walks half an advance forward along the glyph rotation', () => {
    expect(glyphQuadAt(frames(0), 0, 40)).toEqual({ cx: 120, cy: 200, rot: 0 });

    const q = glyphQuadAt(frames(90), 0, 40);
    expect(q.cx).toBeCloseTo(100, 9);
    expect(q.cy).toBeCloseTo(220, 9);
  });

  it('inverts the half-advance walk labelArcGlyphFrames applied', () => {
    // The round trip is the actual contract: whatever offset the frame solver
    // subtracted, this adds back, at any angle.
    for (const rot of [-170, -90, -33.3, 0, 12.5, 90, 179]) {
      const advance = 37.4;
      const r = rot * (Math.PI / 180);
      const centre = { x: 480, y: -260 };
      // What labelArcGlyphFrames stores, given that centre.
      const origin = {
        x: centre.x - (advance / 2) * Math.cos(r),
        y: centre.y - (advance / 2) * Math.sin(r),
      };
      const q = glyphQuadAt({ x: [origin.x], y: [origin.y], rotate: [rot] }, 0, advance);
      expect(q.cx).toBeCloseTo(centre.x, 9);
      expect(q.cy).toBeCloseTo(centre.y, 9);
    }
  });

  it('is driven by the advance it is given, which is why kerning depends on it', () => {
    // The bug this pins: feeding it the bucketed em widths that SPACED the
    // origins, rather than the advance each glyph is actually drawn at, offsets
    // every letter by half its own error. Different advance, different centre.
    const a = glyphQuadAt(frames(0), 0, 40);
    const b = glyphQuadAt(frames(0), 0, 46);
    expect(b.cx - a.cx).toBeCloseTo(3, 9);
  });

  it('declines an index or rotation it cannot place', () => {
    expect(glyphQuadAt(null, 0, 10)).toBeNull();
    expect(glyphQuadAt(frames(0), 1, 10)).toBeNull();
    expect(glyphQuadAt(frames(0), -1, 10)).toBeNull();
    expect(glyphQuadAt({ x: [1], y: [1], rotate: [NaN] }, 0, 10)).toBeNull();
  });

  it('treats a missing advance as zero rather than poisoning the placement', () => {
    // The drag reads this off a DOM attribute, so a parse failure must degrade
    // to "centre on the origin", not NaN the label off screen.
    const q = glyphQuadAt(frames(0), 0, NaN);
    expect(q).toEqual({ cx: 100, cy: 200, rot: 0 });
  });
});
