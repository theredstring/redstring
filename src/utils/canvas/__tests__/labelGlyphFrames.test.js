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

import { describe, it, expect } from 'vitest';
import {
  labelArcGlyphFrames,
  labelArcPath,
  solveLombardiArc,
  MAX_LABEL_SWEEP,
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
