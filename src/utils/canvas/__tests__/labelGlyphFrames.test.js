/**
 * Curved connection labels are placed glyph by glyph rather than ridden along a
 * <textPath>. These pin the geometry that replaces the browser's arc-length
 * parameterisation: every glyph centre lands on the label's circle, the text
 * reads the same direction the path form chose, and the label occupies exactly
 * the span its advances add up to.
 *
 * The null cases matter as much as the placements — they are what falls back to
 * a straight label, and they have to agree with labelArcPath's guards exactly,
 * or a label could curve under one renderer and not the other.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  labelArcGlyphFrames,
  labelArcPath,
  labelCurveMinBow,
  curvedGlyphQuantum,
  solveLombardiArc,
  MAX_LABEL_SWEEP,
  MIN_VISIBLE_BOW,
  LABEL_CURVE_MIN_SCREEN_PX,
  CURVED_GLYPH_ANGLE_QUANTUM,
} from '../edgeRouting.js';

// A circle centred at the origin. Only the centre is ever read — the label rides
// a concentric circle through its anchor, not the edge's own arc.
const arcAt = (cx = 0, cy = 0) => ({ straight: false, cx, cy, radius: 200, a0: 0, sweep: 1, delta: 0.5 });

const evenAdvances = (n, w) => new Array(n).fill(w);
const sum = (a) => a.reduce((s, v) => s + v, 0);

// Undo the baseline-origin offset to recover the glyph centre the placement was
// built from. Uses the RETURNED rotation, so this stays valid when quantization
// has moved it.
const centreOf = (frames, advances, i) => ({
  x: frames.x[i] + (advances[i] / 2) * Math.cos((frames.rotate[i] * Math.PI) / 180),
  y: frames.y[i] + (advances[i] / 2) * Math.sin((frames.rotate[i] * Math.PI) / 180),
});

const radiusOf = (arc, pt) => Math.hypot(pt.x - arc.cx, pt.y - arc.cy);

describe('labelCurveMinBow', () => {
  afterEach(() => { delete window.__labelCurveMinPx; });

  it('sheds curves by what the viewer can SEE — the floor grows as you zoom out', () => {
    // The default was 0 ("never shed") while CURVED_LABEL_BUDGET was 40 and
    // large graphs curved nothing anyway. With the budget real, fit-the-graph
    // zoom on a big network put every label on screen as per-glyph paint items
    // for bends compressed below a pixel — the measured slowdown. The screen
    // threshold is the fix: 2px of on-screen bow buys a curve, less renders as
    // the straight label it visually is. Evaluated at SETTLED zoom, so a form
    // change can only land at gesture-settle, on a bend at the threshold.
    expect(LABEL_CURVE_MIN_SCREEN_PX).toBe(2);
    for (const zoom of [0.25, 0.5, 1, 2]) {
      const bow = labelCurveMinBow(zoom);
      if (bow > MIN_VISIBLE_BOW) expect(bow * zoom).toBeCloseTo(LABEL_CURVE_MIN_SCREEN_PX, 6);
    }
    expect(labelCurveMinBow(0.25)).toBeGreaterThan(labelCurveMinBow(1));
  });

  it('still converts SCREEN pixels to canvas units when a threshold is overridden', () => {
    // The override is the lever for shedding more (or fewer) curves — and it
    // should shed by what the viewer can see, not by canvas units.
    window.__labelCurveMinPx = 8;
    for (const zoom of [0.25, 0.5, 1, 2]) {
      const bow = labelCurveMinBow(zoom);
      if (bow > MIN_VISIBLE_BOW) expect(bow * zoom).toBeCloseTo(8, 6);
    }
    expect(labelCurveMinBow(0.5)).toBeGreaterThan(labelCurveMinBow(2));
  });

  it('bottoms out at MIN_VISIBLE_BOW, below which there is no arc to curve on', () => {
    window.__labelCurveMinPx = 8;
    expect(labelCurveMinBow(1000)).toBe(MIN_VISIBLE_BOW);
    expect(labelCurveMinBow(0.01)).toBeGreaterThan(MIN_VISIBLE_BOW);
  });

  it('is overridable at runtime, and 0 restores curve-everything', () => {
    window.__labelCurveMinPx = 40;
    expect(labelCurveMinBow(1)).toBe(40);

    window.__labelCurveMinPx = 0;
    expect(labelCurveMinBow(1)).toBe(MIN_VISIBLE_BOW);
  });

  it('ignores a nonsense override rather than changing the threshold', () => {
    // Falls back to the default screen threshold.
    window.__labelCurveMinPx = 'wide';
    expect(labelCurveMinBow(1)).toBe(LABEL_CURVE_MIN_SCREEN_PX);

    window.__labelCurveMinPx = -5;
    expect(labelCurveMinBow(1)).toBe(LABEL_CURVE_MIN_SCREEN_PX);
  });

  it('is the lever that sheds shallow curves — and 0 restores curve-everything', () => {
    // 200px of text on a 4000px-radius circle bows ~1.25px: under the default
    // 2px screen threshold at zoom 1 (straight), over it with the override at
    // 0 (curved), under again when the override raises the bar to 8.
    const arc = arcAt();
    const anchor = { x: 4000, y: 0 };
    const advances = evenAdvances(10, 20);

    expect(labelArcGlyphFrames(arc, anchor, advances, { minBow: labelCurveMinBow(1) })).toBeNull();

    window.__labelCurveMinPx = 0;
    expect(labelArcGlyphFrames(arc, anchor, advances, { minBow: labelCurveMinBow(1) })).not.toBeNull();

    window.__labelCurveMinPx = 8;
    expect(labelArcGlyphFrames(arc, anchor, advances, { minBow: labelCurveMinBow(1) })).toBeNull();
  });
});

describe('curvedGlyphQuantum', () => {
  afterEach(() => { delete window.__curvedGlyphQuantum; });

  it('buckets curved glyphs even when the canvas-wide quantum is off', () => {
    // The whole point: labelAngleQuantum is 0 at every edge count where curving
    // happens, so curved labels would otherwise carry exact per-character
    // angles — which is what made them expensive.
    expect(curvedGlyphQuantum(0)).toBe(CURVED_GLYPH_ANGLE_QUANTUM);
  });

  it('ignores the canvas-wide quantum — a dense canvas must not make curved text wobbly', () => {
    // It used to take max(base, canvasQuantum) for aesthetic consistency, but a
    // curved label at 9° is per-glyph wobble, not a clean tilt — the one thing
    // the coupling guaranteed on dense graphs. Curved atlas keys are bounded by
    // (characters × buckets) regardless of label count, so independence is safe.
    expect(curvedGlyphQuantum(9)).toBe(CURVED_GLYPH_ANGLE_QUANTUM);
    expect(curvedGlyphQuantum(2)).toBe(CURVED_GLYPH_ANGLE_QUANTUM);
  });

  it('is overridable, including back to exact angles', () => {
    window.__curvedGlyphQuantum = 9;
    expect(curvedGlyphQuantum(0)).toBe(9);

    window.__curvedGlyphQuantum = 0;
    expect(curvedGlyphQuantum(0)).toBe(0);
  });

  it('bounds the distinct rotations a whole CANVAS of labels emits', () => {
    // The saving is across labels, not within one. A single label spanning a
    // wide arc still puts its characters several degrees apart, so its own
    // glyphs may not share buckets at all — but forty labels scattered around
    // a graph can only ever land in 360/quantum of them between them, where
    // exact angles give a fresh matrix per character forever. That bound is
    // what the glyph cache is sensitive to.
    const arc = arcAt();
    const advances = evenAdvances(13, 26);
    const q = curvedGlyphQuantum(0);

    const exact = new Set();
    const bucketed = new Set();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const anchor = { x: 300 * Math.cos(a), y: 300 * Math.sin(a) };
      labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: 0 })
        ?.rotate.forEach((r) => exact.add(r));
      labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: q })
        ?.rotate.forEach((r) => bucketed.add(r));
    }

    expect(bucketed.size).toBeLessThanOrEqual(Math.ceil(360 / q) + 1);
    // The hard cap above is the invariant that matters. This ratio just checks
    // bucketing still collapses a real spread; at the finer 2° quantum the
    // collapse on this small sample is ~3x rather than the old 4x.
    expect(bucketed.size).toBeLessThan(exact.size / 2);
  });
});

describe('labelArcGlyphFrames — null guards', () => {
  const arc = arcAt();
  const anchor = { x: 300, y: 0 };

  it('rejects a missing arc, missing anchor, or empty text', () => {
    expect(labelArcGlyphFrames(null, anchor, evenAdvances(4, 20))).toBeNull();
    expect(labelArcGlyphFrames(arc, null, evenAdvances(4, 20))).toBeNull();
    expect(labelArcGlyphFrames(arc, anchor, [])).toBeNull();
    expect(labelArcGlyphFrames(arc, anchor, null)).toBeNull();
  });

  it('rejects an anchor sitting on the centre (no circle to ride)', () => {
    expect(labelArcGlyphFrames(arc, { x: 0, y: 0 }, evenAdvances(4, 20))).toBeNull();
    expect(labelArcGlyphFrames(arc, { x: 0.5, y: 0 }, evenAdvances(4, 20))).toBeNull();
  });

  it('rejects a label that would wrap most of the way round', () => {
    // span/radius must stay under MAX_LABEL_SWEEP; at radius 300 that is ~1696px.
    expect(labelArcGlyphFrames(arc, anchor, evenAdvances(100, 20))).toBeNull();
    const justUnder = (MAX_LABEL_SWEEP * 300 * 0.9) / 20;
    expect(labelArcGlyphFrames(arc, anchor, evenAdvances(Math.floor(justUnder), 20))).not.toBeNull();
  });

  it('rejects a bend too shallow to see, and honours a raised floor', () => {
    // Far from the centre the label's own baseline is nearly straight.
    const farAnchor = { x: 4_000_000, y: 0 };
    expect(labelArcGlyphFrames(arc, farAnchor, evenAdvances(6, 20))).toBeNull();

    const advances = evenAdvances(10, 24);
    expect(labelArcGlyphFrames(arc, anchor, advances)).not.toBeNull();
    expect(labelArcGlyphFrames(arc, anchor, advances, { minBow: 1e6 })).toBeNull();
  });

  it('rejects malformed advances rather than emitting NaN positions', () => {
    expect(labelArcGlyphFrames(arc, anchor, [20, NaN, 20])).toBeNull();
    expect(labelArcGlyphFrames(arc, anchor, [20, -5, 20])).toBeNull();
    expect(labelArcGlyphFrames(arc, anchor, [20, Infinity])).toBeNull();
  });

  it('agrees with labelArcPath on every guard, given the same span', () => {
    const cases = [];
    for (const anchorX of [0.5, 40, 300, 900, 250_000, 4_000_000]) {
      for (const count of [1, 4, 12, 40, 100]) {
        for (const minBow of [undefined, 0.4, 6, 60]) {
          cases.push({ anchor: { x: anchorX, y: 0 }, advances: evenAdvances(count, 22), minBow });
        }
      }
    }

    for (const c of cases) {
      const opts = c.minBow === undefined ? {} : { minBow: c.minBow };
      const glyphs = labelArcGlyphFrames(arc, c.anchor, c.advances, opts);
      // Explicit span bypasses labelArcPath's slack multiplier, so the two are
      // being asked about the same length of text.
      const path = labelArcPath(arc, c.anchor, 0, { ...opts, span: sum(c.advances) });
      expect(glyphs === null).toBe(path === null);
    }
  });
});

describe('labelArcGlyphFrames — placement', () => {
  const arc = arcAt();
  const anchor = { x: 300, y: 0 };

  it('puts every glyph centre on the label circle', () => {
    const advances = [30, 12, 44, 8, 26, 19, 33];
    const frames = labelArcGlyphFrames(arc, anchor, advances);
    const expected = radiusOf(arc, anchor);

    expect(frames.radius).toBeCloseTo(expected, 9);
    for (let i = 0; i < advances.length; i++) {
      expect(radiusOf(arc, centreOf(frames, advances, i))).toBeCloseTo(expected, 6);
    }
  });

  it('keeps glyph centres on the circle when rotations are quantized', () => {
    const advances = evenAdvances(9, 28);
    const frames = labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: 9 });
    const expected = radiusOf(arc, anchor);

    for (let i = 0; i < advances.length; i++) {
      expect(radiusOf(arc, centreOf(frames, advances, i))).toBeCloseTo(expected, 6);
    }
  });

  it('snaps rotations into buckets, and leaves them exact at quantum 0', () => {
    const advances = evenAdvances(12, 30);
    const snapped = labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: 9 });
    for (const deg of snapped.rotate) {
      expect(Math.abs(deg / 9 - Math.round(deg / 9))).toBeLessThan(1e-9);
    }

    const exact = labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: 0 });
    // A label sweeping this far cannot have every glyph already on a 9° bucket.
    expect(exact.rotate.some((deg) => Math.abs(deg / 9 - Math.round(deg / 9)) > 1e-6)).toBe(true);
  });

  it('rotates each glyph onto the tangent (perpendicular to its radius)', () => {
    const advances = evenAdvances(8, 26);
    const frames = labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: 0 });

    for (let i = 0; i < advances.length; i++) {
      const c = centreOf(frames, advances, i);
      const rad = (frames.rotate[i] * Math.PI) / 180;
      const dot = Math.cos(rad) * (c.x - arc.cx) + Math.sin(rad) * (c.y - arc.cy);
      expect(Math.abs(dot)).toBeLessThan(1e-6);
    }
  });

  it('spans exactly the sum of its advances', () => {
    const advances = [30, 12, 44, 8, 26];
    const frames = labelArcGlyphFrames(arc, anchor, advances);
    expect(frames.span).toBeCloseTo(sum(advances), 9);
    expect(frames.sweep).toBeCloseTo(sum(advances) / radiusOf(arc, anchor), 9);
  });

  it('separates adjacent glyphs by exactly their two half-advances', () => {
    const advances = [30, 12, 44, 8, 26];
    const frames = labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: 0 });
    const radius = radiusOf(arc, anchor);

    for (let i = 0; i < advances.length - 1; i++) {
      const a = centreOf(frames, advances, i);
      const b = centreOf(frames, advances, i + 1);
      const angA = Math.atan2(a.y - arc.cy, a.x - arc.cx);
      const angB = Math.atan2(b.y - arc.cy, b.x - arc.cx);
      const gap = Math.abs(angB - angA) * radius;
      expect(gap).toBeCloseTo((advances[i] + advances[i + 1]) / 2, 6);
    }
  });

  it('advances monotonically along the circle', () => {
    const advances = evenAdvances(10, 24);
    const frames = labelArcGlyphFrames(arc, anchor, advances, { rotationQuantum: 0 });
    const angles = advances.map((_, i) => {
      const c = centreOf(frames, advances, i);
      return Math.atan2(c.y - arc.cy, c.x - arc.cx);
    });

    const dir = Math.sign(angles[1] - angles[0]);
    for (let i = 0; i < angles.length - 1; i++) {
      expect(Math.sign(angles[i + 1] - angles[i])).toBe(dir);
    }
  });

  it('centres the label on its anchor, for odd and even glyph counts alike', () => {
    // From 2 up: a single short glyph has too shallow a bow to curve at all,
    // which is the guard's job and is covered separately below.
    for (const count of [2, 3, 5, 6]) {
      const advances = evenAdvances(count, 26);
      const frames = labelArcGlyphFrames(arc, anchor, advances);
      expect(frames).not.toBeNull();
      const first = centreOf(frames, advances, 0);
      const last = centreOf(frames, advances, count - 1);
      const midX = (first.x + last.x) / 2;
      const midY = (first.y + last.y) / 2;
      // The chord's midpoint sits inside the anchor's bearing, so compare
      // bearings rather than points.
      expect(Math.atan2(midY - arc.cy, midX - arc.cx)).toBeCloseTo(
        Math.atan2(anchor.y - arc.cy, anchor.x - arc.cx), 6
      );
    }
  });

  it('places a single glyph at the anchor itself', () => {
    const advances = [400];
    const frames = labelArcGlyphFrames(arc, anchor, advances);
    const c = centreOf(frames, advances, 0);
    expect(c.x).toBeCloseTo(anchor.x, 6);
    expect(c.y).toBeCloseTo(anchor.y, 6);
  });
});

describe('labelArcGlyphFrames — reading direction', () => {
  const advances = evenAdvances(8, 26);

  it('runs left-to-right on both sides of the circle', () => {
    const arc = arcAt();
    for (const anchor of [{ x: 0, y: 300 }, { x: 0, y: -300 }]) {
      const frames = labelArcGlyphFrames(arc, anchor, advances);
      const first = centreOf(frames, advances, 0);
      const last = centreOf(frames, advances, advances.length - 1);
      expect(last.x).toBeGreaterThan(first.x);
    }
  });

  it('runs downward when the label is near-vertical', () => {
    const arc = arcAt();
    // Anchor on the +x axis: the tangent there is vertical.
    const frames = labelArcGlyphFrames(arc, { x: 300, y: 0 }, advances);
    const first = centreOf(frames, advances, 0);
    const last = centreOf(frames, advances, advances.length - 1);
    expect(Math.abs(last.x - first.x)).toBeLessThan(1e-6);
    expect(last.y).toBeGreaterThan(first.y);
  });

  it('starts where the path form starts', () => {
    const arc = arcAt();
    for (const anchor of [{ x: 0, y: 300 }, { x: 0, y: -300 }, { x: 220, y: 220 }]) {
      const frames = labelArcGlyphFrames(arc, anchor, advances);
      const path = labelArcPath(arc, anchor, 0, { span: sum(advances) });
      const [, mx, my] = path.d.match(/^M ([-\d.e+]+),([-\d.e+]+)/).map(Number);

      const first = centreOf(frames, advances, 0);
      const last = centreOf(frames, advances, advances.length - 1);
      const dFirst = Math.hypot(first.x - mx, first.y - my);
      const dLast = Math.hypot(last.x - mx, last.y - my);
      expect(dFirst).toBeLessThan(dLast);
    }
  });
});

describe('labelArcGlyphFrames — with a real routed arc', () => {
  it('places glyphs on a circle concentric with the edge it labels', () => {
    const arc = solveLombardiArc({ x: 0, y: 0 }, { x: 600, y: 0 }, -0.6, Math.PI + 0.6, 1);
    expect(arc.straight).toBe(false);

    // Anchor pushed off the edge's own arc, as the placer does when dodging.
    const onArc = { x: arc.cx + arc.radius * Math.cos(arc.a0 + arc.sweep / 2), y: arc.cy + arc.radius * Math.sin(arc.a0 + arc.sweep / 2) };
    const toCentre = Math.atan2(onArc.y - arc.cy, onArc.x - arc.cx);
    const anchor = { x: arc.cx + (arc.radius + 40) * Math.cos(toCentre), y: arc.cy + (arc.radius + 40) * Math.sin(toCentre) };

    const advances = evenAdvances(9, 22);
    const frames = labelArcGlyphFrames(arc, anchor, advances);
    expect(frames).not.toBeNull();
    expect(frames.radius).toBeCloseTo(arc.radius + 40, 6);

    for (let i = 0; i < advances.length; i++) {
      expect(radiusOf(arc, centreOf(frames, advances, i))).toBeCloseTo(arc.radius + 40, 6);
    }
  });
});
