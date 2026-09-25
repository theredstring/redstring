import { describe, it, expect } from 'vitest';
import { clampPan, clientToCanvas } from '../../src/utils/canvas/viewportMath.js';

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

describe('clientToCanvas (P4.01)', () => {
  const rect = { left: 250, top: 80 };
  const canvas = { offsetX: -50000, offsetY: -40000 };
  it('inverts translate(pan) scale(zoom) on the offset canvas, bit-for-bit like the inline copies', () => {
    const pan = { x: -1234.5, y: 678.25 };
    const zoom = 0.37;
    const clientX = 913.3;
    const clientY = 402.7;
    expect(clientToCanvas(clientX, clientY, rect, pan, zoom, canvas)).toEqual({
      x: (clientX - rect.left - pan.x) / zoom + canvas.offsetX,
      y: (clientY - rect.top - pan.y) / zoom + canvas.offsetY,
    });
  });
  it('round-trips with the forward transform', () => {
    const pan = { x: 300, y: -200 };
    const zoom = 2;
    const world = { x: -49900, y: -39950 };
    const client = {
      x: rect.left + pan.x + (world.x - canvas.offsetX) * zoom,
      y: rect.top + pan.y + (world.y - canvas.offsetY) * zoom,
    };
    expect(clientToCanvas(client.x, client.y, rect, pan, zoom, canvas)).toEqual(world);
  });
  it('treats a missing canvas as offset 0', () => {
    expect(clientToCanvas(260, 90, rect, { x: 0, y: 0 }, 1)).toEqual({ x: 10, y: 10 });
  });
});
