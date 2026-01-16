import { describe, it, expect } from 'vitest';
import { calculateParallelEdgePath } from '../../src/utils/canvas/parallelEdgeUtils.js';

describe('calculateParallelEdgePath', () => {
  // Test with a horizontal edge from (0,0) to (200,0) for easy verification
  const startX = 0, startY = 0, endX = 200, endY = 0;

  describe('single edge (no curveInfo)', () => {
    it('returns straight line for null curveInfo', () => {
      const result = calculateParallelEdgePath(startX, startY, endX, endY, null);
      expect(result.type).toBe('line');
      expect(result.path).toBe('M 0 0 L 200 0');
      expect(result.apexX).toBe(100); // midpoint
      expect(result.apexY).toBe(0);
      expect(result.labelAngle).toBe(0); // horizontal
    });

    it('returns straight line for totalInPair=1', () => {
      const result = calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: 0, totalInPair: 1 });
      expect(result.type).toBe('line');
      expect(result.apexX).toBe(100);
      expect(result.apexY).toBe(0);
    });
  });

  describe('two edges (symmetrical pair)', () => {
    it('curves in opposite directions with equal magnitude', () => {
      const edge0 = calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: 0, totalInPair: 2 });
      const edge1 = calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: 1, totalInPair: 2 });

      expect(edge0.type).toBe('curve');
      expect(edge1.type).toBe('curve');

      // For 2 edges: centerIndex = 0.5
      // edge0: offsetSteps = 0 - 0.5 = -0.5, perpOffset = -50
      // edge1: offsetSteps = 1 - 0.5 = 0.5, perpOffset = 50
      // Control point Y should be offset by perpOffset (for horizontal edge, perpX = 0, perpY = 1)
      // Actually for horizontal edge going right: perpX = -0/200 = 0, perpY = 200/200 = 1
      // Wait - perpX = -edgeDy/edgeLen = -0/200 = 0
      // perpY = edgeDx/edgeLen = 200/200 = 1
      // So ctrlY = midY + perpY * perpOffset = 0 + 1 * perpOffset
      expect(edge0.ctrlY).toBe(-50); // curves "up" (negative Y in screen coords)
      expect(edge1.ctrlY).toBe(50);  // curves "down"

      // Offsets should be equal magnitude, opposite sign
      expect(Math.abs(edge0.ctrlY)).toBe(Math.abs(edge1.ctrlY));
    });
  });

  describe('three edges (symmetrical with center straight)', () => {
    it('produces top curve, straight middle, bottom curve', () => {
      const edge0 = calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: 0, totalInPair: 3 });
      const edge1 = calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: 1, totalInPair: 3 });
      const edge2 = calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: 2, totalInPair: 3 });

      // For 3 edges: centerIndex = 1
      // edge0: offsetSteps = 0 - 1 = -1, perpOffset = -100
      // edge1: offsetSteps = 1 - 1 = 0, perpOffset = 0 (straight!)
      // edge2: offsetSteps = 2 - 1 = 1, perpOffset = 100

      // Edge 0: curves UP (negative Y offset for horizontal edge)
      expect(edge0.type).toBe('curve');
      expect(edge0.ctrlY).toBe(-100);

      // Edge 1: center edge should have zero offset (effectively straight)
      expect(edge1.type).toBe('curve'); // Still 'curve' type since totalInPair > 1
      expect(edge1.ctrlY).toBe(0);      // But offset is 0, so it's a straight line visually

      // Edge 2: curves DOWN (positive Y offset)
      expect(edge2.type).toBe('curve');
      expect(edge2.ctrlY).toBe(100);

      // Symmetry: edge0 and edge2 should have equal magnitude offsets
      expect(Math.abs(edge0.ctrlY)).toBe(Math.abs(edge2.ctrlY));
    });
  });

  describe('four edges (symmetrical, no center)', () => {
    it('distributes symmetrically: -1.5, -0.5, +0.5, +1.5 spacing units', () => {
      const edges = [0, 1, 2, 3].map(i =>
        calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: i, totalInPair: 4 })
      );

      // For 4 edges: centerIndex = 1.5
      // edge0: offsetSteps = 0 - 1.5 = -1.5, perpOffset = -150
      // edge1: offsetSteps = 1 - 1.5 = -0.5, perpOffset = -50
      // edge2: offsetSteps = 2 - 1.5 = 0.5, perpOffset = 50
      // edge3: offsetSteps = 3 - 1.5 = 1.5, perpOffset = 150

      expect(edges[0].ctrlY).toBe(-150);
      expect(edges[1].ctrlY).toBe(-50);
      expect(edges[2].ctrlY).toBe(50);
      expect(edges[3].ctrlY).toBe(150);

      // Check symmetry
      expect(edges[0].ctrlY).toBe(-edges[3].ctrlY);
      expect(edges[1].ctrlY).toBe(-edges[2].ctrlY);
    });
  });

  describe('five edges (symmetrical with center straight)', () => {
    it('distributes symmetrically: -2, -1, 0, +1, +2 spacing units', () => {
      const edges = [0, 1, 2, 3, 4].map(i =>
        calculateParallelEdgePath(startX, startY, endX, endY, { pairIndex: i, totalInPair: 5 })
      );

      // For 5 edges: centerIndex = 2
      // edge0: offsetSteps = 0 - 2 = -2, perpOffset = -200
      // edge1: offsetSteps = 1 - 2 = -1, perpOffset = -100
      // edge2: offsetSteps = 2 - 2 = 0, perpOffset = 0 (center straight)
      // edge3: offsetSteps = 3 - 2 = 1, perpOffset = 100
      // edge4: offsetSteps = 4 - 2 = 2, perpOffset = 200

      expect(edges[0].ctrlY).toBe(-200);
      expect(edges[1].ctrlY).toBe(-100);
      expect(edges[2].ctrlY).toBe(0);    // center is straight
      expect(edges[3].ctrlY).toBe(100);
      expect(edges[4].ctrlY).toBe(200);

      // Check symmetry around center (edge 2)
      expect(edges[0].ctrlY).toBe(-edges[4].ctrlY);
      expect(edges[1].ctrlY).toBe(-edges[3].ctrlY);
    });
  });

  describe('label positioning', () => {
    it('calculates apex at Bezier midpoint for curves', () => {
      const result = calculateParallelEdgePath(0, 0, 200, 0, { pairIndex: 0, totalInPair: 2 });

      // For edge0 with perpOffset = -50:
      // ctrlX = 100, ctrlY = -50
      // apexX = 0.25*0 + 0.5*100 + 0.25*200 = 0 + 50 + 50 = 100
      // apexY = 0.25*0 + 0.5*(-50) + 0.25*0 = -25
      expect(result.apexX).toBe(100);
      expect(result.apexY).toBe(-25); // y should be offset toward the curve
    });

    it('calculates midpoint for straight lines', () => {
      const result = calculateParallelEdgePath(0, 0, 200, 100, null);
      expect(result.apexX).toBe(100);
      expect(result.apexY).toBe(50);
    });

    it('provides labelAngle for text rotation', () => {
      const horizontal = calculateParallelEdgePath(0, 0, 200, 0, null);
      expect(horizontal.labelAngle).toBe(0); // horizontal edge

      const diagonal = calculateParallelEdgePath(0, 0, 100, 100, null);
      expect(diagonal.labelAngle).toBe(45); // 45-degree edge

      const vertical = calculateParallelEdgePath(0, 0, 0, 100, null);
      expect(vertical.labelAngle).toBe(90); // vertical edge

      const negativeDiag = calculateParallelEdgePath(0, 0, 100, -100, null);
      expect(negativeDiag.labelAngle).toBe(-45); // -45-degree edge
    });
  });

  describe('degenerate cases', () => {
    it('handles zero-length edge', () => {
      const result = calculateParallelEdgePath(100, 100, 100, 100, { pairIndex: 0, totalInPair: 2 });
      expect(result.type).toBe('line'); // fallback to line for degenerate case
      expect(result.apexX).toBe(100);
      expect(result.apexY).toBe(100);
    });

    it('handles undefined curveInfo', () => {
      const result = calculateParallelEdgePath(0, 0, 200, 0, undefined);
      expect(result.type).toBe('line');
    });
  });

  describe('return value structure', () => {
    it('returns all required properties for curves', () => {
      const result = calculateParallelEdgePath(0, 0, 200, 0, { pairIndex: 0, totalInPair: 2 });

      expect(result).toHaveProperty('type', 'curve');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('startX', 0);
      expect(result).toHaveProperty('startY', 0);
      expect(result).toHaveProperty('endX', 200);
      expect(result).toHaveProperty('endY', 0);
      expect(result).toHaveProperty('ctrlX');
      expect(result).toHaveProperty('ctrlY');
      expect(result).toHaveProperty('apexX');
      expect(result).toHaveProperty('apexY');
      expect(result).toHaveProperty('labelAngle');
    });

    it('returns all required properties for lines', () => {
      const result = calculateParallelEdgePath(0, 0, 200, 0, null);

      expect(result).toHaveProperty('type', 'line');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('startX', 0);
      expect(result).toHaveProperty('startY', 0);
      expect(result).toHaveProperty('endX', 200);
      expect(result).toHaveProperty('endY', 0);
      expect(result).toHaveProperty('ctrlX', null);
      expect(result).toHaveProperty('ctrlY', null);
      expect(result).toHaveProperty('apexX');
      expect(result).toHaveProperty('apexY');
      expect(result).toHaveProperty('labelAngle');
    });
  });
});
