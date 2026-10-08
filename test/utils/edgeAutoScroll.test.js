import { describe, it, expect } from 'vitest';
import {
  edgeScrollDepth, edgeScrollTargetSpeed, stepEdgeScrollVelocity, EDGE_SCROLL_DEFAULTS,
} from '../../src/utils/edgeAutoScroll.js';

// The edge scroll is meant to be gentle: it always starts from rest, rises
// slowly to a modest top speed, and drops back quickly when let go of.
describe('edge scroll speed', () => {
  const { maxSpeed, accel } = EDGE_SCROLL_DEFAULTS;

  /** Runs `ms` of 60Hz frames toward `target`, from `v`. */
  const run = (v, target, ms) => {
    let vel = v;
    for (let t = 0; t < ms; t += 16) vel = stepEdgeScrollVelocity(vel, target, 16);
    return vel;
  };

  it('asks for nothing outside the zone and the top speed at full depth', () => {
    expect(edgeScrollTargetSpeed(0)).toBe(0);
    expect(edgeScrollTargetSpeed(1)).toBe(maxSpeed);
    expect(edgeScrollTargetSpeed(0.5)).toBeLessThan(maxSpeed);
  });

  it('starts from rest and rises slowly, even when the target is the top speed', () => {
    const afterOneFrame = stepEdgeScrollVelocity(0, maxSpeed, 16);
    expect(afterOneFrame).toBeCloseTo(accel * 0.016);
    expect(run(0, maxSpeed, 400)).toBeLessThan(maxSpeed * 0.5);
    expect(run(0, maxSpeed, 1100)).toBe(maxSpeed);
  });

  it('never passes the speed it is rising toward', () => {
    expect(run(0, 100, 2000)).toBe(100);
  });

  it('drops back to rest quickly when the pointer leaves the zone', () => {
    expect(run(maxSpeed, 0, 160)).toBe(0);
  });

  it('turning round passes through rest and rises again from nothing', () => {
    let v = run(maxSpeed, -maxSpeed, 160);
    expect(v).toBeLessThanOrEqual(0);
    expect(v).toBeGreaterThan(-maxSpeed * 0.2);
    v = run(v, -maxSpeed, 400);
    expect(v).toBeGreaterThan(-maxSpeed * 0.6);
  });

  it('a shallower pointer slows it to the new target, not to rest', () => {
    expect(run(maxSpeed, 100, 300)).toBe(100);
  });
});

// Each edge's zone straddles it, and going past the edge never stops the
// scroll: that is where the drag is when it wants to travel.
describe('edgeScrollDepth', () => {
  const bounds = { lo: 100, hi: 600 };
  const screen = { lo: 0, hi: 800 };
  const zones = { start: { inside: 16, outside: 64 }, end: { inside: 40, outside: 56 } };

  it('is still in the middle', () => {
    expect(edgeScrollDepth(350, bounds, screen, zones)).toEqual({ dir: 0, depth: 0 });
  });

  it('starts just inside an edge, by that edge\'s own inside reach', () => {
    expect(edgeScrollDepth(117, bounds, screen, zones).dir).toBe(0);
    expect(edgeScrollDepth(115, bounds, screen, zones).dir).toBe(-1);
    expect(edgeScrollDepth(561, bounds, screen, zones).dir).toBe(1);
  });

  it('builds past the edge, then holds full depth however far it goes', () => {
    const atEdge = edgeScrollDepth(100, bounds, screen, zones);
    expect(atEdge.depth).toBeCloseTo(16 / 80);
    expect(edgeScrollDepth(36, bounds, screen, zones)).toEqual({ dir: -1, depth: 1 });
    expect(edgeScrollDepth(-500, bounds, screen, zones)).toEqual({ dir: -1, depth: 1 });
    expect(edgeScrollDepth(5000, bounds, screen, zones)).toEqual({ dir: 1, depth: 1 });
  });

  it('reaches full depth at the screen edge when there is no room past the scroller', () => {
    const flush = { lo: 100, hi: 800 };
    expect(edgeScrollDepth(800, flush, screen, zones)).toEqual({ dir: 1, depth: 1 });
    expect(edgeScrollDepth(780, flush, screen, zones).depth).toBeCloseTo(0.5);
  });
});
