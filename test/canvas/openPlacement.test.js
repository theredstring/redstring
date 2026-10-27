import { describe, it, expect } from 'vitest';
import { nearestFreeShift } from '../../src/components/canvas/groups/openPlacement.js';

const box = { x: 0, y: 0, w: 400, h: 300 };

describe('nearestFreeShift', () => {
  it('keeps the wanted spot when nothing is in the way', () => {
    expect(nearestFreeShift(box, [{ x: 1000, y: 1000, w: 100, h: 100 }], { x: 50, y: -20 })).toEqual({ x: 50, y: -20 });
  });

  it('slides the box off a neighbour by the shortest way', () => {
    // A Thing just inside the box's right edge: moving left a little clears it.
    const shift = nearestFreeShift(box, [{ x: 380, y: 100, w: 200, h: 100 }], { x: 0, y: 0 });
    expect(shift.y).toBe(0);
    expect(shift.x).toBeLessThanOrEqual(-40);
    expect(shift.x).toBeGreaterThanOrEqual(-80);
  });

  it('lands clear of every obstacle', () => {
    const obstacles = [
      { x: -100, y: -100, w: 200, h: 200 },
      { x: 300, y: 200, w: 200, h: 200 },
      { x: -300, y: 250, w: 200, h: 200 },
    ];
    const s = nearestFreeShift(box, obstacles, { x: 0, y: 0 });
    const r = { x: box.x + s.x, y: box.y + s.y, w: box.w, h: box.h };
    for (const o of obstacles) {
      expect(r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h).toBe(false);
    }
  });
});
