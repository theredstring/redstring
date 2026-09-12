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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  onSpritesReady,
  peekGlyphSprite,
  peekLabelSprite,
  peekNearbyGlyphSprite,
  peekNearbyLabelSprite,
  requestLabelSprite,
  setBakingPaused,
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

/**
 * How the queue SPENDS the main thread, which is a different question from
 * whether a bake draws the right thing.
 *
 * Both behaviours here exist because the canvas pays twice for a sprite: once
 * to encode it, and again to re-render every edge when it lands. Get the ratio
 * between those wrong and the sprite path costs more than the stroked <text> it
 * replaced — which is what "rasterisation makes the canvas slow" turned out to
 * mean.
 *
 * A stub clock drives it, because the real thing depends on how fast this
 * machine encodes a PNG. `bakeCost` is what one bake is charged; the queue's
 * own slice budget is 6ms.
 */
describe('bake queue scheduling', () => {
  let clock;
  let bakeCost;

  beforeEach(() => {
    vi.restoreAllMocks();
    installCanvasStub();
    clock = 0;
    bakeCost = 5;
    // Fake timers first: they replace performance.now themselves, so a stub
    // installed before this one would be the one thrown away.
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // Charge the encode, which is where a bake's time actually goes.
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => {
      clock += bakeCost;
      return 'data:image/png;base64,AAAA';
    });
    setBakingPaused(false);
    clearLabelSprites();
  });

  afterEach(() => {
    setBakingPaused(false);
    vi.useRealTimers();
    delete globalThis.requestIdleCallback;
    clearLabelSprites();
  });

  const enqueue = (n) => {
    for (let i = 0; i < n; i++) requestLabelSprite({ ...spec, text: `label ${i}` });
  };

  it('coalesces the landed signal instead of firing once per slice', () => {
    // Each signal re-renders every edge on the canvas. At one bake per slice —
    // which is what a 5ms encode against a 6ms budget gives — firing per slice
    // means a full re-solve per PNG.
    let signals = 0;
    const off = onSpritesReady(() => { signals += 1; });

    enqueue(6);
    vi.advanceTimersByTime(50);
    expect(labelSpriteCount()).toBe(6);
    expect(signals).toBe(0); // all six baked, nothing announced yet

    vi.advanceTimersByTime(600);
    expect(signals).toBe(1);
    off();
  });

  it('spends its own slice when the idle deadline is a timeout', () => {
    // requestIdleCallback fires on its timeout when the thread is busy, and
    // reports zero time remaining. Believed, that bakes one sprite per callback
    // — and the re-render each batch provokes is what keeps the thread busy, so
    // the queue never gets a real idle slice again.
    const callbacks = [];
    globalThis.requestIdleCallback = (fn) => { callbacks.push(fn); return callbacks.length; };
    bakeCost = 2;

    enqueue(5);
    expect(callbacks).toHaveLength(1);
    callbacks[0]({ didTimeout: true, timeRemaining: () => 0 });

    // 6ms of budget at 2ms an encode: three, not one.
    expect(labelSpriteCount()).toBe(3);
  });

  it('still yields to a real idle deadline that says it is out of time', () => {
    // The other direction: genuine idle time is the browser's to give, and a
    // deadline that has run out must end the slice however cheap the bakes are.
    const callbacks = [];
    globalThis.requestIdleCallback = (fn) => { callbacks.push(fn); return callbacks.length; };
    bakeCost = 0;

    enqueue(5);
    callbacks[0]({ didTimeout: false, timeRemaining: () => 0 });
    expect(labelSpriteCount()).toBe(1);
  });

  it('stops asking for a label it has already baked', () => {
    // The loop this module spent its life in. The bake wrote its own spelling
    // of the cache key and every reader wrote another, so a label was baked,
    // stored, and then missed by the very next render — which asked again, and
    // got a landed batch announced at it, and re-rendered the whole canvas, and
    // asked again. Forever, for as long as one straight label was on screen.
    //
    // It is invisible from every other angle: the bake succeeds, the sprite is
    // real, the cache fills, and a miss looks exactly like a cold start. Only
    // the round trip catches it, so the round trip is the test.
    let signals = 0;
    const off = onSpritesReady(() => { signals += 1; });
    const job = { ...spec, text: 'once only' };

    expect(getLabelSprite(job)).not.toBeNull();
    const encodes = HTMLCanvasElement.prototype.toDataURL.mock.calls.length;

    expect(peekLabelSprite(job)).not.toBeNull(); // the reader finds the writer
    requestLabelSprite(job);                     // what a render does on a miss
    vi.advanceTimersByTime(2000);

    expect(HTMLCanvasElement.prototype.toDataURL.mock.calls.length).toBe(encodes);
    expect(signals).toBe(0); // nothing landed, so nothing re-rendered
    off();
  });

  it('bakes nothing and announces nothing while the labels are down', () => {
    // A gesture hides the labels, so every millisecond spent here is spent on
    // something off screen — against the frame budget of that same gesture.
    let signals = 0;
    const off = onSpritesReady(() => { signals += 1; });

    setBakingPaused(true);
    enqueue(3);
    vi.advanceTimersByTime(2000);
    expect(labelSpriteCount()).toBe(0);
    expect(signals).toBe(0);

    setBakingPaused(false);
    vi.advanceTimersByTime(2000);
    expect(labelSpriteCount()).toBe(3);
    expect(signals).toBe(1); // the held signal, once, not once per slice
    off();
  });

  it('holds a big bake back until the canvas has been still for a while', () => {
    // A PNG encode cannot be interrupted once begun, so the decision to start
    // one is the only control there is — the slice budget is checked after.
    setBakingPaused(true);
    setBakingPaused(false); // the stillness clock starts here

    // At bucket 8 this label rasterises well past BIG_BAKE_PIXELS; at bucket 1
    // it is a rounding error.
    requestLabelSprite({ ...spec, text: 'ten charsX', scale: 8 });
    requestLabelSprite({ ...spec, text: 'ten charsX', scale: 1 });

    vi.advanceTimersByTime(50);
    expect(labelSpriteCount()).toBe(1); // the cheap one only

    clock += 500; // the view has now been quiet past STILL_MS
    vi.advanceTimersByTime(500);
    expect(labelSpriteCount()).toBe(2); // deferred, never refused
  });

  it('draws the bucket a zoom just left rather than dropping to text', () => {
    // Crossing a doubling misses EVERY label at once. Falling through to <text>
    // there is a visible change of form across the whole canvas that undoes
    // itself a second later.
    const text = 'is composed of';
    const at2 = getLabelSprite({ ...spec, text, scale: 2 });
    expect(at2).not.toBeNull();

    expect(peekLabelSprite({ ...spec, text, scale: 4 })).toBeNull();
    const stand = peekNearbyLabelSprite({ ...spec, text, scale: 4 });
    expect(stand).toBe(at2);
    // Seamless because nothing in the geometry knows its scale.
    expect(stand.width).toBe(at2.width);
    expect(stand.height).toBe(at2.height);
    expect(stand.centerOffsetY).toBe(at2.centerOffsetY);
  });

  it('prefers the sharper neighbour, since sampling down is what does not show', () => {
    const text = 'ab';
    getLabelSprite({ ...spec, text, scale: 2 });
    const at8 = getLabelSprite({ ...spec, text, scale: 8 });
    // 2 and 8 are equidistant from 4 in bucket terms; 8 is the one to take.
    expect(peekNearbyLabelSprite({ ...spec, text, scale: 4 })).toBe(at8);
  });

  it('substitutes per glyph too, so a curved label never half-swaps', () => {
    const at2 = getGlyphSprite({ ...spec, ch: 'a', layer: 'fill', scale: 2 });
    expect(peekGlyphSprite({ ...spec, ch: 'a', layer: 'fill', scale: 4 })).toBeNull();
    expect(peekNearbyGlyphSprite({ ...spec, ch: 'a', layer: 'fill', scale: 4 })).toBe(at2);
  });
});
