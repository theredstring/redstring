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

  it('caps a stall between normal frames, however many frames it has seen', () => {
    const tick = createFrameClock();
    let t = 1000;
    tick(t);
    for (let i = 0; i < 5; i++) tick(t += 16);
    const before = tick(t += 16);
    expect(tick(t += 270) - before).toBeCloseTo(MAX_STEP_MS);
    expect(tick(t += 270) - before).toBeCloseTo(2 * MAX_STEP_MS);
  });

  it('caps a run of stalls at the start, before it knows the frame rate', () => {
    const tick = createFrameClock();
    tick(1000);
    expect(tick(1250)).toBeCloseTo(FIRST_STEP_MS + MAX_STEP_MS);
    expect(tick(1500)).toBeCloseTo(FIRST_STEP_MS + 2 * MAX_STEP_MS);
    expect(tick(1750)).toBeCloseTo(FIRST_STEP_MS + 3 * MAX_STEP_MS);
  });

  it('keeps wall time on a device whose every frame is slow, so a move is not slow motion', () => {
    // A phone at ~15 fps. Capping every frame took a 320 ms move about ten
    // frames (~670 ms); now only the frames before the rate is known are capped.
    const tick = createFrameClock();
    let t = 1000;
    let elapsed = tick(t);
    let frames = 0;
    while (elapsed < 320) { elapsed = tick(t += 67); frames++; }
    expect(t - 1000).toBeLessThan(500);
    expect(frames).toBeLessThanOrEqual(7);
  });

  it('still holds back a stall on a slow device', () => {
    const tick = createFrameClock();
    let t = 1000;
    tick(t);
    for (let i = 0; i < 4; i++) tick(t += 60);
    const before = tick(t += 60);
    expect(tick(t += 400) - before).toBeCloseTo(60 * 1.5);
  });

  it('never runs backwards', () => {
    const tick = createFrameClock();
    tick(1000);
    expect(tick(990)).toBeCloseTo(FIRST_STEP_MS);
  });
});
