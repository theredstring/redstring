/**
 * A FORMULA IS LAID OUT AT THE SIZE IT IS DRAWN.
 *
 * A group shown as its formula is solved as one block (formulaBlocks). The
 * block used to be its Things' bare bounds, while the canvas draws a band with
 * a title around them, so with no connections to hold them off, loose nodes
 * were packed right up to the Things: inside the band the user sees.
 */

import { describe, it, expect } from 'vitest';
import { applyLayout, deriveGroupVisualBounds } from '../graphLayoutService.js';
import { node } from './layoutHelpers.js';

const OPTS = { width: 2000, height: 2000, padding: 300, gridSize: 200 };

/** Ten loose Things and one three-Thing formula, no connections. */
const looseAndFormula = () => {
  const nodes = [];
  for (let i = 0; i < 10; i++) nodes.push({ ...node(`n${i}`, 160, 90), x: (i * 397) % 2000, y: (i * 911) % 2000 });
  ['g0', 'g1', 'g2'].forEach((id, k) => nodes.push({ ...node(id, 180, 90), x: 900 + k * 200, y: 900 }));
  nodes.push({ ...node('anchor', 200, 80), x: 1000, y: 750, isGroupAnchor: true });
  const group = {
    id: 'G', name: 'Kinetic Energy', format: 'formula',
    memberInstanceIds: ['g0', 'g1', 'g2'], linkedNodePrototypeId: 'pT', anchorInstanceId: 'anchor'
  };
  return { nodes, group };
};

const intersects = (p, w, h, r) => p.x < r.x + r.w && p.x + w > r.x && p.y < r.y + r.h && p.y + h > r.y;

describe('formula blocks', () => {
  ['best', 'pattern', 'node-driven'].forEach(algorithm => {
    it(`keeps loose nodes out of the formula's band (${algorithm})`, () => {
      const { nodes, group } = looseAndFormula();
      const at = new Map(applyLayout(nodes, [], algorithm, { ...OPTS, groups: [group] }).map(u => [u.instanceId, u]));
      const g0 = at.get('g0');
      // The band as the Things' group box: the fallback when no drawn frame is passed.
      const band = deriveGroupVisualBounds(group, { minX: g0.x, minY: g0.y, maxX: g0.x + 580, maxY: g0.y + 90 }, OPTS);
      const inside = nodes.filter(n => n.id.startsWith('n') && intersects(at.get(n.id), n.width, n.height, band));
      expect(inside.map(n => n.id)).toEqual([]);
    });

    it(`keeps loose nodes off the drawn frame, and the row rigid (${algorithm})`, () => {
      const { nodes, group } = looseAndFormula();
      const frame = { x: 700, y: 760, w: 1400, h: 420 }; // wider than its Things, title above
      const at = new Map(applyLayout(nodes, [], algorithm, { ...OPTS, groups: [group], formulaFrames: { G: frame } }).map(u => [u.instanceId, u]));
      const g0 = at.get('g0');
      expect(at.get('g1').x - g0.x).toBe(200);
      expect(at.get('g2').y).toBe(g0.y);
      const drawn = { ...frame, x: frame.x + g0.x - 900, y: frame.y + g0.y - 900 };
      const inside = nodes.filter(n => n.id.startsWith('n') && intersects(at.get(n.id), n.width, n.height, drawn));
      expect(inside.map(n => n.id)).toEqual([]);
    });
  });
});
