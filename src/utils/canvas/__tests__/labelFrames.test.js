/**
 * Two things that keep a connection label attached to its connection.
 *
 * LABEL FRAMES is the handoff between React and the drag updater. Both write the
 * same five attributes on the same <text>, and React's update is a diff against
 * its OWN last render — so the drag has to hand the DOM back matching that, or
 * React skips the writes it thinks are redundant and the label keeps half of the
 * drag's last frame. The round-trip below is the contract that prevents it.
 *
 * ARC PLACEMENT is where a Lombardi label is allowed to go: along its curve, and
 * nowhere else.
 */

import { describe, it, expect } from 'vitest';
import {
  labelFrameToken,
  applyLabelFrame,
  straightLabelTransform,
  chooseArcLabelPlacement,
  buildEdgeSegmentIndex,
} from '../edgeLabelPlacement.js';

// A minimal stand-in for an SVG element: records attributes the way the DOM
// does, including the string coercion that setAttribute performs.
const fakeText = (initial = {}) => {
  const attrs = new Map(Object.entries(initial));
  return {
    attrs,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
  };
};

describe('label frame round-trip', () => {
  const curved = {
    x: '10.00 30.00 50.00',
    y: '5.00 6.00 7.00',
    rotate: '0.00 4.00 8.00',
  };

  it('restores a curved label to exactly the attributes React rendered', () => {
    const el = fakeText();
    expect(applyLabelFrame(el, labelFrameToken(curved, 0, 0, 0))).toBe(true);

    expect(el.getAttribute('x')).toBe(curved.x);
    expect(el.getAttribute('y')).toBe(curved.y);
    expect(el.getAttribute('rotate')).toBe(curved.rotate);
    expect(el.getAttribute('text-anchor')).toBe('start');
    // Curved labels carry no transform — a leftover one spins the whole label
    // about its first glyph.
    expect(el.getAttribute('transform')).toBeNull();
  });

  it('restores a straight label, transform included', () => {
    const el = fakeText();
    expect(applyLabelFrame(el, labelFrameToken(null, 120, 340, -12))).toBe(true);

    expect(el.getAttribute('x')).toBe('120');
    expect(el.getAttribute('y')).toBe('340');
    expect(el.getAttribute('text-anchor')).toBe('middle');
    expect(el.getAttribute('transform')).toBe(straightLabelTransform(-12, 120, 340));
    // And no rotate list, which would scatter its glyphs.
    expect(el.getAttribute('rotate')).toBeNull();
  });

  it('clears the other form when a drag left the label in it', () => {
    // The case that produced visibly jumbled labels: the drag ends with the
    // label curved, React's last render had it straight (or vice versa), and
    // whatever the drag wrote has to be gone, not merely overwritten.
    const leftCurved = fakeText({
      x: curved.x, y: curved.y, rotate: curved.rotate, 'text-anchor': 'start',
    });
    applyLabelFrame(leftCurved, labelFrameToken(null, 5, 6, 90));
    expect(leftCurved.getAttribute('rotate')).toBeNull();

    const leftStraight = fakeText({
      x: '5', y: '6', transform: 'rotate(90, 5, 6)', 'text-anchor': 'middle',
    });
    applyLabelFrame(leftStraight, labelFrameToken(curved, 0, 0, 0));
    expect(leftStraight.getAttribute('transform')).toBeNull();
  });

  it('declines a missing or malformed token instead of writing junk', () => {
    // A label with no data-label-frame is one React never rendered through the
    // connection-label branch. Better to leave it alone than to half-write it.
    for (const token of [null, undefined, '', 'g|only|three', 'x|a|b|c', 42]) {
      const el = fakeText({ x: 'untouched' });
      expect(applyLabelFrame(el, token)).toBe(false);
      expect(el.getAttribute('x')).toBe('untouched');
    }
    expect(applyLabelFrame(null, labelFrameToken(curved, 0, 0, 0))).toBe(false);
  });

  it('separates the fields unambiguously', () => {
    // The lists are space-separated numbers, so `|` can only ever be the field
    // separator — worth pinning, since a token that split wrong would restore a
    // label to a pose made of two different renders.
    const token = labelFrameToken(curved, 0, 0, 0);
    expect(token.split('|')).toHaveLength(4);
    expect(labelFrameToken(null, 1, 2, 3).split('|')).toHaveLength(4);
  });
});

describe('chooseArcLabelPlacement stays on the arc', () => {
  // A half-circle of radius 400 centred at the origin, running through (400, 0).
  const arc = { cx: 0, cy: 0, radius: 400, a0: -Math.PI / 2, sweep: Math.PI, delta: 1 };
  const onArc = (p) => Math.abs(Math.hypot(p.x - arc.cx, p.y - arc.cy) - arc.radius);

  const place = (obstacles) => chooseArcLabelPlacement(
    arc, 'is a kind of', [], new Set(), new Map(), new Map(), 40, 'e1', new Set(),
    { obstacles }
  );

  it('places a clear label on the arc', () => {
    const result = place([]);
    expect(onArc(result)).toBeLessThan(1e-6);
    expect(result.anchor.offset).toBe(0);
  });

  it('stays on the arc when nothing anywhere is clear', () => {
    // A wall over the whole circle, offsets included. Nothing wins by leaving
    // the curve, so the label does not: an overlapping label on the right
    // connection beats a clear label on no connection.
    const result = place([{ minX: -900, maxX: 900, minY: -900, maxY: 900 }]);
    expect(onArc(result)).toBeLessThan(1e-6);
    expect(result.anchor.offset).toBe(0);
    expect(result.overlap).toBeGreaterThan(0);
  });

  it('slides along the arc to dodge, rather than stepping off it', () => {
    // Bury the middle of the run only. The label should move — and every place
    // it can move to is further along the same circle.
    const clear = place([]);
    const result = place([{ minX: 300, maxX: 600, minY: -80, maxY: 80 }]);

    expect(onArc(result)).toBeLessThan(1e-6);
    expect(result.anchor.offset).toBe(0);
    expect(result.overlap).toBe(0);
    expect(Math.hypot(result.x - clear.x, result.y - clear.y)).toBeGreaterThan(1);
  });

  it('reaches further along the run than the old ladder did', () => {
    // The ladder had to grow when the radial rungs stopped being interleaved:
    // sliding is now the first and usually only move, so it needs the reach the
    // offsets used to cover. Bury exactly the 0.28-0.72 span the old seven rungs
    // spanned: the label must still find its way around, ON the curve.
    const buried = [];
    for (let s = 0.28; s <= 0.72; s += 0.02) {
      const a = arc.a0 + arc.sweep * s;
      const x = arc.cx + arc.radius * Math.cos(a);
      const y = arc.cy + arc.radius * Math.sin(a);
      buried.push({ minX: x - 20, maxX: x + 20, minY: y - 20, maxY: y + 20 });
    }
    const result = place(buried);
    expect(onArc(result)).toBeLessThan(1e-6);
    expect(result.anchor.offset).toBe(0);
    expect(result.overlap).toBe(0);
    // No `range` here, so the anchor parameter IS the fraction of the run.
    expect(Math.abs(result.anchor.t - 0.5)).toBeGreaterThan(0.22);
  });

  it('does not leave the curve just because a connection crosses the label', () => {
    // Crossings rank candidates but must not open the radial tier. Lombardi
    // arcs cross each other constantly; if a line through a label were enough
    // to detach it, labels would spend most of their time off their own curves
    // — which is the complaint this whole tier ordering exists to answer. The
    // halo keeps a crossed label readable; a detached one is a worse problem.
    const across = new Map([['other', [{ x: -900, y: -900 }, { x: 900, y: 900 }]]]);
    const result = chooseArcLabelPlacement(
      arc, 'is a kind of', [], new Set(), new Map(), new Map(), 40, 'e1', new Set(),
      { obstacles: [], segmentIndex: buildEdgeSegmentIndex(across) }
    );
    expect(onArc(result)).toBeLessThan(1e-6);
    expect(result.anchor.offset).toBe(0);
  });

  it('steps off only when something solid buries every spot on the curve', () => {
    // The case with no other answer: parallel connections between the same two
    // nodes fan their arcs a lane apart and stack their labels, and no amount
    // of sliding separates them. A band right along the arc, clear a line
    // height away — so the radial tier has somewhere to go and the slide does
    // not.
    const buried = [];
    for (let s = 0; s <= 1; s += 0.01) {
      const a = arc.a0 + arc.sweep * s;
      const x = arc.cx + arc.radius * Math.cos(a);
      const y = arc.cy + arc.radius * Math.sin(a);
      buried.push({ minX: x - 12, maxX: x + 12, minY: y - 12, maxY: y + 12 });
    }
    const result = place(buried);
    expect(result.anchor.offset).not.toBe(0);
    expect(result.overlap).toBeLessThan(place([]).overlap + 1);
  });

});

describe('a tilted label is not moved by the empty corners of its own box', () => {
  // See PHANTOM CORNERS in edgeLabelPlacement.js. A label that follows an arc's
  // tangent reserves the axis-aligned bounding box of a ROTATED rectangle, and
  // the four corners of that box hold no text whatever — on a label this long,
  // more of the box is empty corner than is label. An obstacle reaching into one
  // of those corners is not on the text, and must not be treated as if it were.
  //
  // Every arc in the suite above happens to run vertically through the middle of
  // its span, where the box is exact and there is nothing to get wrong. This one
  // is deliberately tilted (~20 degrees at the midpoint), which is the ordinary
  // case for a Lombardi connection and the case that misbehaved: labels drifting
  // along their arcs, or stepping off them entirely, with visibly free space all
  // around.
  const arc = { cx: 0, cy: 0, radius: 400, a0: -1.822, sweep: 1.2, delta: 1 };
  const onArc = (p) => Math.abs(Math.hypot(p.x - arc.cx, p.y - arc.cy) - arc.radius);
  const place = (obstacles) => chooseArcLabelPlacement(
    arc, 'is a kind of', [], new Set(), new Map(), new Map(), 40, 'e1', new Set(),
    { obstacles }
  );

  const clear = place([]);

  it('is actually tilted, or this test proves nothing', () => {
    expect(Math.abs(clear.angle % 90)).toBeGreaterThan(10);
  });

  it('ignores an obstacle that only clips a corner of the reserved box', () => {
    const rad = (clear.angle * Math.PI) / 180;
    const w = 264;                    // estimateTextWidth('is a kind of', 40)
    const h = 40 * 1.1;               // LABEL_BOX_LINE_HEIGHT
    const halfW = (w * Math.abs(Math.cos(rad)) + h * Math.abs(Math.sin(rad))) / 2;
    const halfH = (w * Math.abs(Math.sin(rad)) + h * Math.abs(Math.cos(rad))) / 2;
    // A 12px square tucked into the box's top-left corner — the corner furthest
    // from the rotated rectangle's own, and a couple of hundred pixels of empty
    // box away from any glyph.
    const result = place([{
      minX: clear.x - halfW, maxX: clear.x - halfW + 12,
      minY: clear.y - halfH, maxY: clear.y - halfH + 12,
    }]);

    expect(result.anchor.offset).toBe(0);
    expect(onArc(result)).toBeLessThan(1e-6);
    // Nor does it slide along the run: a corner nibble is not a reason to move
    // at all, so the label stays exactly where a wholly clear one sits. This is
    // the half that produced "placement a little off" without ever detaching.
    expect(result.anchor.t).toBe(clear.anchor.t);
  });

  it('still moves for something genuinely on the text', () => {
    // The allowance is a corner budget, not an amnesty. An obstacle over the
    // middle of the label overruns it many times over and still gets dodged —
    // by a whole line height and more, not the sub-pixel drift a nibble buys.
    // (This run is only ~480px long against a 264px label, so the label cannot
    // get entirely clear of a 160px block on it; what matters is that it tries.)
    const result = place([{
      minX: clear.x - 80, maxX: clear.x + 80,
      minY: clear.y - 80, maxY: clear.y + 80,
    }]);
    expect(Math.hypot(result.x - clear.x, result.y - clear.y)).toBeGreaterThan(40);
  });
});
