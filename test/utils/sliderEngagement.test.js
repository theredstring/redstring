import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ENGAGED_ATTR,
  engageSlider,
  releaseSlider,
  pulseSlider
} from '../../src/utils/sliderEngagement.js';

const engaged = (el) => el.hasAttribute(ENGAGED_ATTR);

describe('sliderEngagement', () => {
  let el;

  beforeEach(() => {
    vi.useFakeTimers();
    el = document.createElement('input');
    el.type = 'range';
    document.body.appendChild(el);
  });

  afterEach(() => {
    vi.useRealTimers();
    el.remove();
  });

  it('marks and unmarks a slider', () => {
    expect(engaged(el)).toBe(false);
    engageSlider(el);
    expect(engaged(el)).toBe(true);
    releaseSlider(el);
    expect(engaged(el)).toBe(false);
  });

  it('tolerates a null element on both ends', () => {
    expect(() => engageSlider(null)).not.toThrow();
    expect(() => releaseSlider(null)).not.toThrow();
  });

  // The controller's case: a stick has no release event, so the mark has to let
  // go of itself once the drive stops arriving.
  it('releases itself a short time after the last pulse', () => {
    pulseSlider(el, 200);
    expect(engaged(el)).toBe(true);
    vi.advanceTimersByTime(199);
    expect(engaged(el)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(engaged(el)).toBe(false);
  });

  it('stays marked while pulses keep arriving', () => {
    pulseSlider(el, 200);
    for (let frame = 0; frame < 30; frame += 1) {
      vi.advanceTimersByTime(16);
      pulseSlider(el, 200);
    }
    expect(engaged(el)).toBe(true);
    vi.advanceTimersByTime(201);
    expect(engaged(el)).toBe(false);
  });

  // Stepping off a slider mid-drive must not leave its pending release to fire
  // later — or worse, leave it lit.
  it('an explicit release cancels a pending pulse', () => {
    pulseSlider(el, 200);
    releaseSlider(el);
    expect(engaged(el)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(engaged(el)).toBe(false);
  });

  // A pointer engage landing between pulses owns the mark outright: it is
  // released by its own pointerup, not by a timer the stick left behind.
  it('an explicit engage cancels a pending pulse', () => {
    pulseSlider(el, 200);
    engageSlider(el);
    vi.advanceTimersByTime(500);
    expect(engaged(el)).toBe(true);
  });
});
