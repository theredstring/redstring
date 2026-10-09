import { describe, it, expect } from 'vitest';
import { createFrameClock, FIRST_STEP_MS, MAX_STEP_MS } from '../../src/components/canvas/camera/frameClock.js';

describe('createFrameClock', () => {
  it('counts the first frame as one frame, whenever it lands', () => {
    expect(createFrameClock()(5000)).toBeCloseTo(FIRST_STEP_MS);
  });

  it('advances by frame time at a normal frame rate', () => {
    const tick = createFrameClock();
    tick(1000);
    expect(tick(1016)).toBeCloseTo(FIRST_STEP_MS + 16);
  });

  it('caps a stalled frame, so a long task pauses rather than skips', () => {
    const tick = createFrameClock();
    tick(1000);
    expect(tick(1270)).toBeCloseTo(FIRST_STEP_MS + MAX_STEP_MS);
  });

  it('never runs backwards', () => {
    const tick = createFrameClock();
    tick(1000);
    expect(tick(990)).toBeCloseTo(FIRST_STEP_MS);
  });
});
