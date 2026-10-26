import { describe, it, expect } from 'vitest';
import { arcBounds, connectionRouteBounds, makeConnectionBoundsOf, routeFrom } from '../../src/components/canvas/groups/connectionBounds.js';
import { computeLombardiTangents, lombardiArcFor, sampleArc } from '../../src/utils/canvas/edgeRouting.js';
import { computeGroupLayout } from '../../src/services/groupLayout.js';

const dims = { currentWidth: 100, currentHeight: 40 };
const node = (id, x, y) => ({ id, x, y });
const edge = (id, sourceId, destinationId) => ({ id, sourceId, destinationId, directionality: { arrowsToward: new Set() } });

describe('connectionBounds', () => {
  it('bounds an arc exactly, extremes included', () => {
    // A half circle over the top: from 0 to π, radius 10 about (0, 0).
    const b = arcBounds({ cx: 0, cy: 0, radius: 10, a0: 0, sweep: Math.PI });
    expect(b.minX).toBeCloseTo(-10);
    expect(b.maxX).toBeCloseTo(10);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(10);
    // A negative sweep covers the other half.
    const c = arcBounds({ cx: 0, cy: 0, radius: 10, a0: 0, sweep: -Math.PI });
    expect(c.minY).toBeCloseTo(-10);
    expect(c.maxY).toBeCloseTo(0);
  });

  it('holds a Lombardi arc as drawn, past the chord between its ends', () => {
    const nodes = [node('a', 0, 0), node('b', 600, 0), node('c', 300, 500)];
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ca', 'c', 'a')];
    const dimsById = new Map(nodes.map(n => [n.id, dims]));
    const tangents = computeLombardiTangents(nodes, edges, dimsById);
    const route = routeFrom({ enableAutoRouting: true, routingStyle: 'lombardi', lombardiTangents: tangents, lombardiCurvature: 1, edgeCurveInfo: new Map() });
    const b = connectionRouteBounds(edges[0], nodes[0], nodes[1], dims, dims, route);
    const { arc } = lombardiArcFor(edges[0], nodes[0], nodes[1], dims, dims, tangents, 1, {});
    expect(arc).toBeTruthy();
    for (const p of sampleArc(arc, 64)) {
      expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-6);
      expect(p.x).toBeLessThanOrEqual(b.maxX + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(b.minY - 1e-6);
      expect(p.y).toBeLessThanOrEqual(b.maxY + 1e-6);
    }
    // The arc bows off the chord (both centres sit at y = 20).
    expect(Math.min(20 - b.minY, b.maxY - 20)).toBeLessThan(Math.max(20 - b.minY, b.maxY - 20));
  });

  it('counts only connections with both ends among the members', () => {
    const nodes = new Map([['a', node('a', 0, 0)], ['b', node('b', 600, 0)], ['out', node('out', 5000, 5000)]]);
    const hook = makeConnectionBoundsOf({
      edges: [edge('ab', 'a', 'b'), edge('a-out', 'a', 'out'), edge('aa', 'a', 'a')],
      nodeOf: id => nodes.get(id),
      dimsOf: () => dims,
      route: routeFrom({ enableAutoRouting: false, routingStyle: 'lombardi', edgeCurveInfo: new Map(), curveSpacing: 200 }),
    });
    const b = hook({ id: 'g', memberInstanceIds: ['a', 'b'] });
    expect(b.maxX).toBeLessThan(1000); // nothing toward `out`
    expect(b.minY).toBeLessThan(0); // the self-loop on a hangs off it
    expect(hook({ id: 'h', memberInstanceIds: ['out'] })).toBeNull();
  });

  it('grows the group box around its connections', () => {
    const nodesById = new Map([['a', node('a', 0, 0)], ['b', node('b', 600, 0)]]);
    const group = { id: 'g', name: 'G', memberInstanceIds: ['a', 'b'] };
    const context = {
      nodesById, dimsById: new Map([['a', dims], ['b', dims]]), groupsById: new Map([['g', group]]),
      groupsByMemberId: new Map(), gridSize: 200, measureLabelWidth: t => t.length * 10,
    };
    const plain = computeGroupLayout(group, { ...context, _cache: new Map() });
    const withLinks = computeGroupLayout(group, {
      ...context, _cache: new Map(),
      connectionBoundsOf: () => ({ minX: 50, minY: -300, maxX: 650, maxY: 20 }),
    });
    expect(withLinks.rect.y).toBeCloseTo(plain.rect.y - 300);
    expect(withLinks.rect.h).toBeCloseTo(plain.rect.h + 300);
    expect(withLinks.rect.x).toBe(plain.rect.x);
  });
});
