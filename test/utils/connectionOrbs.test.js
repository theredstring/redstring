import { describe, it, expect } from 'vitest';
import { nearestConnectionOrb, ORB_HIT_PADDING_TOUCH } from '../../src/utils/canvas/connectionOrbs.js';

// The endpoint orbs are the only way to direct a connection on the canvas, and
// three inputs reach them through this one hit test: a click (via the SVG disc,
// whose geometry this mirrors), a tap, and the controller's crosshair. They
// have to agree, so the rules are pinned here rather than in each caller.
describe('nearestConnectionOrb', () => {
  const orb = (id, nodeId, cx, cy, r = 36) => ({ cx, cy, r, edgeId: id, nodeId });
  const map = (...orbs) => new Map(orbs.map(o => [o.edgeId, [o]]));

  it('returns null for an empty or missing map', () => {
    expect(nearestConnectionOrb(new Map(), 0, 0)).toBeNull();
    expect(nearestConnectionOrb(null, 0, 0)).toBeNull();
    expect(nearestConnectionOrb(undefined, 0, 0)).toBeNull();
  });

  it('hits an orb the point lands inside', () => {
    const hit = nearestConnectionOrb(map(orb('e1', 'n1', 100, 100)), 110, 105);
    expect(hit).toMatchObject({ edgeId: 'e1', nodeId: 'n1' });
  });

  it('misses just outside the drawn radius at the default padding', () => {
    const orbs = map(orb('e1', 'n1', 100, 100, 36));
    expect(nearestConnectionOrb(orbs, 137, 100)).toBeNull();
    expect(nearestConnectionOrb(orbs, 135, 100)).not.toBeNull();
  });

  it('takes the same miss as a hit once a finger widens it', () => {
    const orbs = map(orb('e1', 'n1', 100, 100, 36));
    expect(nearestConnectionOrb(orbs, 137, 100, ORB_HIT_PADDING_TOUCH))
      .toMatchObject({ edgeId: 'e1' });
  });

  it('prefers the nearest orb when two connections meet at one node', () => {
    // Two edges landing at the same node put their orbs within a radius of each
    // other. First-wins would hand back whichever edge rendered first, which
    // from the user's side is arbitrary.
    const orbs = map(orb('far', 'n1', 120, 100), orb('near', 'n1', 104, 100));
    expect(nearestConnectionOrb(orbs, 100, 100)).toMatchObject({ edgeId: 'near' });
  });

  it('scans every orb an edge contributes, not just its first', () => {
    // A hovered connection registers both of its ends under one edge id.
    const both = new Map([['e1', [orb('e1', 'src', 0, 0), orb('e1', 'dst', 500, 500)]]]);
    expect(nearestConnectionOrb(both, 500, 500)).toMatchObject({ nodeId: 'dst' });
  });

  it('tolerates an edge whose orb list is missing', () => {
    const orbs = new Map([['e1', null], ['e2', [orb('e2', 'n1', 10, 10)]]]);
    expect(nearestConnectionOrb(orbs, 10, 10)).toMatchObject({ edgeId: 'e2' });
  });
});
