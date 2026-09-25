import { describe, it, expect } from 'vitest';
import * as tuning from '../../src/utils/canvas/input/inputTuning.js';

// P4.01: the input tuning moved out of NodeCanvas verbatim. These pin the
// values, so a change to how the canvas feels is a deliberate, visible edit.
const EXPECTED = {
  PAN_MOMENTUM_MIN_SPEED: 0.01,
  TOUCH_MOMENTUM_VELOCITY_WINDOW_MS: 80,
  TOUCH_MOMENTUM_STATIONARY_GAP_MS: 60,
  TOUCH_MOMENTUM_LAUNCH_MIN_SPEED: 0.25,
  VIEW_MOTION_MIN_SPEED: 0.001,
  VIEW_MOTION_STALE_MS: 120,
  VIEW_MOTION_SAMPLE_MAX_GAP_MS: 120,
  VIEW_MOTION_MIN_SAMPLES: 2,
  TOUCH_PAN_FRICTION: 0.92,
  TOUCH_PAN_FRICTION_HIGH_VELOCITY: 0.955,
  TOUCH_HIGH_VELOCITY_THRESHOLD: 1.2,
  TOUCH_HIGH_VELOCITY_RAMP: 1.5,
  TRACKPAD_PAN_FRICTION: 0.94,
  MOUSE_PAN_FRICTION: 0.872,
  PAN_MOMENTUM_FRAME: 16.67,
  TOUCH_PAN_MOMENTUM_BOOST: 1.0,
  TRACKPAD_PAN_MOMENTUM_BOOST: 1.1,
  GLIDE_STRENGTH_FRICTION_RANGE: 0.12,
  GLIDE_FRICTION_MIN: 0.80,
  GLIDE_FRICTION_MAX: 0.985,
  ZOOM_MOMENTUM_BOOST: 0.8,
  ZOOM_MOMENTUM_FRICTION: 0.86,
  ZOOM_MOMENTUM_FRICTION_HIGH_VELOCITY: 0.91,
  ZOOM_HIGH_VELOCITY_THRESHOLD: 0.003,
  ZOOM_HIGH_VELOCITY_RAMP: 0.005,
  ZOOM_MOMENTUM_MIN_SPEED: 0.0004,
  ZOOM_MOMENTUM_MAX_SPEED: 0.009,
  PINCH_GLIDE_STRENGTH_VEL_RANGE: 0.8,
  PINCH_GLIDE_STRENGTH_FRICTION_RANGE: 0.08,
  TRACKPAD_ZOOM_MAX_STEP_DELTA: 40,
  TRACKPAD_ZOOM_SENSITIVITY_SLIDER_SCALE: 10.4,
  TRACKPAD_ZOOM_SMOOTHING: 0.6,
  TRACKPAD_ZOOM_SETTLE_EPSILON: 0.0004,
  TRACKPAD_ZOOM_IDLE_GAP_MULTIPLE: 2.4,
  TRACKPAD_ZOOM_IDLE_END_MIN_MS: 34,
  TRACKPAD_ZOOM_IDLE_END_MAX_MS: 110,
  TRACKPAD_ZOOM_VELOCITY_WINDOW_MS: 90,
  TRACKPAD_ZOOM_VELOCITY_MIN_SPAN_MS: 10,
  TRACKPAD_ZOOM_GLIDE_FRICTION: 0.72,
  TRACKPAD_ZOOM_GLIDE_FRICTION_SLIDER_RANGE: 0.40,
  TRACKPAD_ZOOM_GLIDE_FRICTION_MIN: 0.45,
  TRACKPAD_ZOOM_GLIDE_FRICTION_MAX: 0.88,
  TRACKPAD_ZOOM_GLIDE_MIN_SPEED: 0.0015,
  TRACKPAD_ZOOM_GLIDE_MAX_SPEED: 0.010,
  TRACKPAD_ZOOM_GLIDE_STOP_SPEED: 0.0004,
};

describe('inputTuning', () => {
  it('keeps the tuning values it had in NodeCanvas', () => {
    const actual = Object.fromEntries(Object.keys(EXPECTED).map((k) => [k, tuning[k]]));
    expect(actual).toEqual(EXPECTED);
  });

  describe('measureTrackpadZoomVelocity', () => {
    const measure = tuning.measureTrackpadZoomVelocity;
    it('is 0 without two samples', () => {
      expect(measure(null)).toBe(0);
      expect(measure([{ t: 0, lz: 0 }])).toBe(0);
    });
    it('measures log-zoom per ms over the window', () => {
      const hist = [{ t: 0, lz: 0 }, { t: 20, lz: 0.02 }, { t: 40, lz: 0.04 }, { t: 60, lz: 0.06 }];
      expect(measure(hist)).toBeCloseTo(0.001, 6);
    });
    it('ignores a burst shorter than the minimum span', () => {
      expect(measure([{ t: 0, lz: 0 }, { t: 2, lz: 0.5 }])).toBe(0);
    });
  });
});
