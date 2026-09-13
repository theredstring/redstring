/**
 * Hover hysteresis for the connection hit-test.
 *
 * The bug these cover: hover on a heavily bowed Lombardi arc would show a
 * neighbouring connection, or nothing at all, while clicking the same spot
 * picked the right one. The geometry was never wrong — the arc the hit-test
 * measures against matches the drawn arc exactly. What was wrong is that hover
 * is a judgement re-made every frame and was being re-made from scratch, with
 * no memory of what it had just decided.
 *
 * Curved styles are where that bites. A straight connection crosses its
 * neighbours at a point; an arc bows clear of its chord, detours through
 * territory other connections occupy, and meets them at shallow angles, so the
 * near-tie is a STRETCH rather than a point — and the more extreme the bow, the
 * longer it runs. Across that stretch a pixel of cursor jitter flipped the
 * winner, and since arriving at a new target restarts the dwell delay, each
 * flip cost the full delay. Flicker faster than the delay showed nothing at all.
 *
 * A click never had the problem because a click happens once, which is also why
 * the fix must NOT reach the click path: `isSticky` false has to stay exact
 * nearest-wins.
 */

import { describe, it, expect } from 'vitest';
import { edgeHitScore } from '../geometryUtils.js';

const THRESHOLD = 50;
const MARGIN = 12.5; // THRESHOLD * EDGE_HOVER_STICKY_FRACTION

/** The scan in findNearestEdgeAtCanvasPoint, reduced to its ranking rule. */
const winner = (candidates, stickyEdgeId) => {
  let best = null;
  let bestScore = Infinity;
  for (const [id, distance] of candidates) {
    const score = edgeHitScore(distance, THRESHOLD, id === stickyEdgeId, MARGIN);
    if (score >= bestScore) continue;
    bestScore = score;
    best = id;
  }
  return best;
};

describe('edgeHitScore — no incumbent', () => {
  it('is exact nearest-wins, which is what click and tap rely on', () => {
    expect(winner([['a', 30], ['b', 29.5]], null)).toBe('b');
    expect(winner([['a', 29.5], ['b', 30]], null)).toBe('a');
  });

  it('admits nothing past the grab radius', () => {
    expect(edgeHitScore(THRESHOLD + 0.001, THRESHOLD, false, MARGIN)).toBe(Infinity);
    expect(winner([['a', 60]], null)).toBe(null);
  });
});

describe('edgeHitScore — with an incumbent', () => {
  it('holds the connection already showing through a near-tie', () => {
    // The flicker case: two connections running alongside each other, the
    // pointer wobbling by a pixel between frames. Without hysteresis the winner
    // alternates and hover never settles.
    expect(winner([['a', 20], ['b', 19.5]], 'a')).toBe('a');
    expect(winner([['a', 20.5], ['b', 20]], 'a')).toBe('a');
  });

  it('yields once a rival is genuinely closer, not merely closer', () => {
    // Beaten by less than the margin: the incumbent keeps it.
    expect(winner([['a', 30], ['b', 30 - MARGIN + 0.5]], 'a')).toBe('a');
    // Beaten by more: the rival takes it. Hysteresis must not mean "stuck".
    expect(winner([['a', 30], ['b', 30 - MARGIN - 0.5]], 'a')).toBe('b');
  });

  it('is released beyond the radius that caught it, but still released', () => {
    // Caught at `threshold`, held out to `threshold + margin` — without the
    // wider release the margin only sharpens the score and the incumbent is
    // still dropped the instant it crosses the plain threshold, which is the
    // same one-frame gap all over again.
    expect(edgeHitScore(THRESHOLD + 1, THRESHOLD, true, MARGIN)).toBeLessThan(Infinity);
    expect(winner([['a', THRESHOLD + 1]], 'a')).toBe('a');

    // But a connection the pointer has actually left goes, rather than trailing
    // behind the cursor forever.
    expect(edgeHitScore(THRESHOLD + MARGIN + 0.001, THRESHOLD, true, MARGIN)).toBe(Infinity);
    expect(winner([['a', THRESHOLD + MARGIN + 1]], 'a')).toBe(null);
  });

  it('gives an absent incumbent no say', () => {
    // The sticky id names a connection that has been culled, deleted, or was
    // never in this scan. Every candidate is then ranked plainly.
    expect(winner([['a', 30], ['b', 29.5]], 'gone')).toBe('b');
  });

  it('lets a rival inside the radius beat an incumbent outside it', () => {
    // The incumbent is only in the running at all because of the wider release
    // radius, so it must not outrank a connection the pointer is actually on.
    expect(winner([['a', THRESHOLD + 5], ['b', 3]], 'a')).toBe('b');
  });
});
