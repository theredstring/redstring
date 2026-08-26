import { describe, it, expect } from 'vitest';
import { getNodeEdgeIntersection } from '../../src/utils/canvas/nodeHitbox.js';

// getNodeEdgeIntersection is shared by the settled render (NodeCanvas) and the
// drag-time DOM writer (useNodeDrag) — a selected connection's endpoint dots
// are placed from it in both, so the two must agree exactly or the dots jump
// on drop.
describe('getNodeEdgeIntersection', () => {
  // 200x80 node at the origin: center (100, 40), half-extents (100, 40).
  const node = { x: 0, y: 0, w: 200, h: 80 };
  const hit = (dirX, dirY) => getNodeEdgeIntersection(node.x, node.y, node.w, node.h, dirX, dirY);

  it('exits the right edge for a rightward ray', () => {
    expect(hit(1, 0)).toMatchObject({ x: 200, y: 40 });
  });

  it('exits the left edge for a leftward ray', () => {
    expect(hit(-1, 0)).toMatchObject({ x: 0, y: 40 });
  });

  it('exits the bottom edge for a downward ray', () => {
    expect(hit(0, 1)).toMatchObject({ x: 100, y: 80 });
  });

  it('exits the top edge for an upward ray', () => {
    expect(hit(0, -1)).toMatchObject({ x: 100, y: 0 });
  });

  it('takes the nearer crossing on a diagonal', () => {
    // Down-right at 45°: the horizontal half-extent is 100 and the vertical 40,
    // so the ray leaves through the bottom (t = 40) before the right (t = 100).
    const p = hit(1, 1);
    expect(p.y).toBe(80);
    expect(p.x).toBeCloseTo(140);
  });

  it('is unaffected by the ray magnitude', () => {
    const unit = hit(0.6, 0.8);
    const scaled = hit(6, 8);
    expect(scaled.x).toBeCloseTo(unit.x);
    expect(scaled.y).toBeCloseTo(unit.y);
  });

  it('returns null for a degenerate direction', () => {
    expect(hit(0, 0)).toBeNull();
  });
});
