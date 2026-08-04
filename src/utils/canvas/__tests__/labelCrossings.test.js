/**
 * Labels move off connections that would strike through them.
 *
 * The placer has always walked a ladder of positions along its own line; what
 * it lacked was any reason to reject the one it was landing on. These tests
 * pin the two halves of that: the index/query that notices a connection is in
 * the way, and the placer preferring a clear spot when one exists.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEdgeSegmentIndex,
  countCrossingEdges,
  chooseRoutedLabelPlacement,
  estimateTextWidth,
} from '../edgeLabelPlacement.js';

const rect = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
const line = (...pts) => pts.map(([x, y]) => ({ x, y }));

describe('buildEdgeSegmentIndex / countCrossingEdges', () => {
  it('finds a connection passing through a box', () => {
    const index = buildEdgeSegmentIndex(new Map([['a', line([0, 50], [400, 50])]]));
    expect(countCrossingEdges(rect(100, 0, 200, 100), index, null)).toBe(1);
  });

  it('ignores one that misses', () => {
    const index = buildEdgeSegmentIndex(new Map([['a', line([0, 500], [400, 500])]]));
    expect(countCrossingEdges(rect(100, 0, 200, 100), index, null)).toBe(0);
  });

  it('ignores the label\'s own connection', () => {
    const index = buildEdgeSegmentIndex(new Map([['self', line([0, 50], [400, 50])]]));
    expect(countCrossingEdges(rect(100, 0, 200, 100), index, 'self')).toBe(0);
  });

  it('counts distinct connections, not segments', () => {
    // One edge zig-zagging through the box must still count once, or a polyline
    // with more bends would look worse than a straight line through the middle.
    const index = buildEdgeSegmentIndex(new Map([
      ['zig', line([100, 10], [150, 90], [200, 10], [250, 90])],
      ['other', line([120, 0], [120, 100])],
    ]));
    expect(countCrossingEdges(rect(100, 0, 300, 100), index, null)).toBe(2);
  });

  it('catches a segment that lies entirely inside the box', () => {
    const index = buildEdgeSegmentIndex(new Map([['a', line([120, 40], [180, 60])]]));
    expect(countCrossingEdges(rect(100, 0, 200, 100), index, null)).toBe(1);
  });

  it('catches a long diagonal without indexing its whole bounding box', () => {
    // A corner-to-corner line: its bounding box covers the entire area, so a
    // bbox-based index would report it as crossing boxes it passes nowhere
    // near. It must be found where it actually runs and nowhere else.
    const index = buildEdgeSegmentIndex(new Map([['d', line([0, 0], [2000, 2000])]]));
    expect(countCrossingEdges(rect(900, 900, 1100, 1100), index, null)).toBe(1);
    expect(countCrossingEdges(rect(1800, 100, 1950, 250), index, null)).toBe(0);
  });

  it('handles negative coordinates', () => {
    const index = buildEdgeSegmentIndex(new Map([['a', line([-900, -450], [-500, -450])]]));
    expect(countCrossingEdges(rect(-800, -500, -700, -400), index, null)).toBe(1);
    expect(countCrossingEdges(rect(-800, 400, -700, 500), index, null)).toBe(0);
  });

  it('is a no-op when there is nothing to index', () => {
    expect(buildEdgeSegmentIndex(new Map())).toBeNull();
    expect(buildEdgeSegmentIndex(null)).toBeNull();
    expect(countCrossingEdges(rect(0, 0, 10, 10), null, null)).toBe(0);
  });
});

describe('label placement avoiding other connections', () => {
  const FONT = 40;
  const NAME = 'depends on';
  const place = (routing, index) => chooseRoutedLabelPlacement(
    routing, NAME, [], new Set(), new Map(), new Map(), FONT, 'self', new Set(),
    { obstacles: [], segmentIndex: index }
  );

  // A long horizontal run. Left to itself the label sits at its midpoint.
  const ROUTING = { points: line([0, 0], [1200, 0]) };

  it('sits at the midpoint when nothing is in the way', () => {
    expect(place(ROUTING, null).x).toBeCloseTo(600, 6);
  });

  it('moves along its own line when a connection covers the midpoint', () => {
    const blocker = buildEdgeSegmentIndex(new Map([['other', line([600, -400], [600, 400])]]));
    const placed = place(ROUTING, blocker);
    expect(placed.crossings).toBe(0);
    // Still on its own connection, just further along it.
    expect(placed.y).toBeCloseTo(0, 6);
    expect(Math.abs(placed.x - 600)).toBeGreaterThan(estimateTextWidth(NAME, FONT) / 2);
  });

  it('takes the least-crossed spot when every spot is crossed', () => {
    // Three connections cover the middle of the run and one covers the end, so
    // there is no clear spot — the label must still prefer the cheapest.
    const crowd = new Map([
      ['x1', line([560, -400], [560, 400])],
      ['x2', line([600, -400], [600, 400])],
      ['x3', line([640, -400], [640, 400])],
    ]);
    // Blanket the rest of the run so no candidate escapes entirely.
    for (let x = 0; x <= 1200; x += 40) crowd.set(`w${x}`, line([x, -400], [x, 400]));
    const placed = place(ROUTING, buildEdgeSegmentIndex(crowd));
    expect(placed.crossings).toBeGreaterThan(0);
    expect(placed).toHaveProperty('x');
  });

  it('never trades a node collision for a crossing', () => {
    // Nodes stay a HARD reject and crossings only a preference. A label under a
    // node is both unreadable and untraceable; a line through one is merely
    // ugly. So when the only uncrossed spots are the ones a node sits on, the
    // label takes a crossing rather than hiding under the node.
    const nodeBox = rect(500, -60, 700, 60);
    const blocked = buildEdgeSegmentIndex(new Map([
      ['left', line([300, -400], [300, 400])],
      ['right', line([900, -400], [900, 400])],
    ]));
    const placed = chooseRoutedLabelPlacement(
      ROUTING, NAME, [], new Set(), new Map(), new Map(), FONT, 'self', new Set(),
      { obstacles: [nodeBox], segmentIndex: blocked }
    );
    const halfW = estimateTextWidth(NAME, FONT) / 2;
    const overlapsNode = placed.x + halfW > nodeBox.minX && placed.x - halfW < nodeBox.maxX
      && placed.y + FONT / 2 > nodeBox.minY && placed.y - FONT / 2 < nodeBox.maxY;
    expect(overlapsNode).toBe(false);
    expect(placed.crossings).toBe(1);
  });

  it('applies to arcs as well as polylines', () => {
    // Lombardi labels ride an arc; the same avoidance has to reach them.
    const arc = { cx: 600, cy: 900, radius: 1000, a0: -2.0, sweep: 0.8, delta: 0.4, straight: false };
    const clear = chooseRoutedLabelPlacement(
      { arc }, NAME, [], new Set(), new Map(), new Map(), FONT, 'self', new Set(),
      { obstacles: [], segmentIndex: null }
    );
    const blocker = buildEdgeSegmentIndex(new Map([
      ['other', line([clear.x, clear.y - 400], [clear.x, clear.y + 400])],
    ]));
    const dodged = chooseRoutedLabelPlacement(
      { arc }, NAME, [], new Set(), new Map(), new Map(), FONT, 'self', new Set(),
      { obstacles: [], segmentIndex: blocker }
    );
    expect(dodged.crossings).toBe(0);
    expect(Math.hypot(dodged.x - clear.x, dodged.y - clear.y)).toBeGreaterThan(1);
  });
});
