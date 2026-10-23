/**
 * RIGID GROUPS ARE LAID OUT AS THE CANVAS WILL PLACE THEM.
 *
 * A formula and an open definition are each solved as one block (rigidBlocks).
 *
 * A formula's block used to be its Things' bare bounds, while the canvas draws
 * a band with a title around them, so with no connections to hold them off,
 * loose nodes were packed right up to the Things: inside the band.
 *
 * An open definition's interior used to be laid out like any group's. The
 * store then moved the box as a whole, keeping the definition's arrangement,
 * so the box landed at its own size over the loose nodes the solver had
 * packed around the arrangement it planned.
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

  /** Ten loose Things and an open box of three, in the definition's arrangement. */
  const looseAndOpenBox = () => {
    const nodes = [];
    for (let i = 0; i < 10; i++) nodes.push({ ...node(`n${i}`, 240, 380), x: (i * 397) % 2000, y: (i * 911) % 2000 });
    // Spread out and uneven, the way a definition is often left.
    [['d0', 900, 900], ['d1', 1500, 1050], ['d2', 1100, 1500]].forEach(([id, x, y]) => nodes.push({ ...node(id, 240, 380), x, y }));
    nodes.push({ ...node('anchor', 240, 380), x: 300, y: 300 });
    const group = {
      id: 'open:anchor', name: 'Cum Town', isOpenDefinition: true,
      memberInstanceIds: ['d0', 'd1', 'd2'], linkedNodePrototypeId: 'pT', anchorInstanceId: 'anchor'
    };
    return { nodes, group };
  };

  ['best', 'pattern', 'node-driven'].forEach(algorithm => {
    it(`moves an open box whole and keeps loose nodes out of it (${algorithm})`, () => {
      const { nodes, group } = looseAndOpenBox();
      const at = new Map(applyLayout(nodes, [], algorithm, { ...OPTS, groups: [group] }).map(u => [u.instanceId, u]));
      const d0 = at.get('d0');
      // The definition's arrangement, which is what the store keeps.
      expect([at.get('d1').x - d0.x, at.get('d1').y - d0.y]).toEqual([600, 150]);
      expect([at.get('d2').x - d0.x, at.get('d2').y - d0.y]).toEqual([200, 600]);
      const box = deriveGroupVisualBounds(group, { minX: d0.x, minY: d0.y, maxX: d0.x + 840, maxY: d0.y + 980 }, OPTS);
      const inside = nodes.filter(n => n.id.startsWith('n') && intersects(at.get(n.id), n.width, n.height, box));
      expect(inside.map(n => n.id)).toEqual([]);
    });
  });
});
