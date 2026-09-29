import { describe, it, expect } from 'vitest';
import { anchorInfoFacing } from '../../src/utils/canvas/nodeHitbox.js';
import { buildConnectionScene, connectionRoutingSettings, settledConnectionGeometry } from '../../src/utils/canvas/settledConnection.js';

// A node-group 600x500 at the origin, its title pill at the top centre.
const anchorInfo = {
  x: 200, y: 20, width: 200, height: 80,
  outerBounds: { x: 0, y: 0, width: 600, height: 500 },
  shellRect: { x: 0, y: 0, w: 600, h: 500, r: 40 },
};
const dims = { currentWidth: 150, currentHeight: 100 };

describe('anchorInfoFacing', () => {
  it('keeps the group box for an end outside the group', () => {
    expect(anchorInfoFacing(anchorInfo, { x: 800, y: 200 }, dims)).toBe(anchorInfo);
  });

  it('drops the group box for an end inside the group', () => {
    const faced = anchorInfoFacing(anchorInfo, { x: 60, y: 300 }, dims);
    expect(faced.outerBounds).toBeNull();
    expect(faced.shellRect).toBeNull();
    expect(faced).toMatchObject({ x: 200, y: 20, width: 200, height: 80 });
  });

  it('passes a missing record through', () => {
    expect(anchorInfoFacing(null, { x: 0, y: 0 }, dims)).toBeNull();
  });
});

// A member wired to its own group's Thing: the whole line lies inside the
// shell, so cutting the shell out erased it, and ending on the outer box put
// the arrowhead on the far rim behind the member.
describe('member to its own group anchor', () => {
  const anchors = new Map([['A', anchorInfo]]);
  const nodes = [{ id: 'A', x: 999, y: 999, isGroupAnchor: true }, { id: 'M', x: 60, y: 300 }];
  const dimsById = new Map([['A', dims], ['M', dims]]);
  const geometry = (arrowsToward) => {
    const edges = [{ id: 'e', sourceId: 'M', destinationId: 'A', directionality: { arrowsToward } }];
    const settings = connectionRoutingSettings({});
    return settledConnectionGeometry(edges[0], buildConnectionScene({ nodes, edges, dimsById, anchors, settings }));
  };

  it('is not cut out by the shell', () => {
    expect(geometry([]).clipShells).toEqual([]);
    expect(geometry(['M']).clipShells).toEqual([]);
  });

  it('puts the arrowhead at the pill, not the group rim', () => {
    const [arrow] = geometry(['A']).arrows;
    // Just below the pill (y 20..100), between the member and the pill.
    expect(arrow.y).toBeGreaterThan(100);
    expect(arrow.y).toBeLessThan(150);
    expect(arrow.x).toBeGreaterThan(200);
    expect(arrow.x).toBeLessThan(400);
  });
});
