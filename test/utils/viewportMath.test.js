import { describe, it, expect } from 'vitest';
import { clampPan } from '../../src/utils/canvas/viewportMath.js';

describe('clampPan (P4.01)', () => {
  const viewport = { width: 800, height: 600 };
  const canvas = { width: 100000, height: 100000 };
  it('leaves a pan that keeps the canvas covering the viewport', () => {
    expect(clampPan({ x: -50000, y: -40000 }, 1, viewport, canvas)).toEqual({ x: -50000, y: -40000 });
  });
  it('never pans past the canvas origin', () => {
    expect(clampPan({ x: 10, y: 20 }, 1, viewport, canvas)).toEqual({ x: 0, y: 0 });
  });
  it('never pans past the far edge at the given zoom', () => {
    expect(clampPan({ x: -1e9, y: -1e9 }, 0.5, viewport, canvas)).toEqual({ x: 800 - 50000, y: 600 - 50000 });
  });
});
