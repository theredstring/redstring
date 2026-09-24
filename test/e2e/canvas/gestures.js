// Gesture helpers for the P0.03b flows: touch through CDP, and the marquee.
// Kept out of helpers.js so the flows added here and the perf scenarios (P0.04)
// that build on helpers.js can land in either order without a conflict.
//
// Touch: Playwright's page.touchscreen only taps, so gestures go through the
// DevTools protocol (Input.dispatchTouchEvent), which Chromium turns into real
// touchstart/touchmove/touchend events with the matching pointer events. The
// page must come from a context with hasTouch: true, or the app's touch paths
// (which check 'ontouchstart' in window and pointer: coarse) stay off.
import { expect } from '@playwright/test';
import { nextFrames, marqueeModifier } from './helpers.js';

// useCanvasTouch: a finger held on a node this long lifts it into a drag
// (max(NODE_DOUBLE_TAP_MS, nodeLiftDelay * 1.8) = 450 ms with the default 250).
export const TOUCH_LIFT_DELAY_MS = 450;

/**
 * A touchscreen driven through CDP. Every call sends the full set of fingers
 * still on the glass, which is what the protocol expects: a finger missing
 * from a touchMove is read as lifted.
 */
export async function touchscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 5, radiusY: 5, force: 1 })),
  });
  return {
    start: (points) => send('touchStart', points),
    move: (points) => send('touchMove', points),
    /** `remaining` = the fingers still down after this lift. */
    end: (remaining = []) => send('touchEnd', remaining),

    /** One finger from `from` to `to` in `steps` moves, one frame apart. */
    async drag(from, to, { steps = 12, holdMs = 0 } = {}) {
      await send('touchStart', [from]);
      if (holdMs) await page.waitForTimeout(holdMs);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
        await nextFrames(page, 1);
      }
      await send('touchEnd', []);
    },

    /**
     * Two fingers placed `startGap` px apart either side of `center`
     * (horizontally), moved to `endGap` apart in `steps`, then lifted one at a
     * time. The midpoint stays on `center` throughout.
     */
    async pinch(center, startGap, endGap, { steps = 15 } = {}) {
      const at = (gap) => [{ x: center.x - gap / 2, y: center.y, id: 0 }, { x: center.x + gap / 2, y: center.y, id: 1 }];
      const [a] = at(startGap);
      await send('touchStart', [a]);
      await send('touchStart', at(startGap));
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', at(startGap + ((endGap - startGap) * i) / steps));
        await nextFrames(page, 1);
      }
      const [, b] = at(endGap);
      await send('touchEnd', [b]);
      await send('touchEnd', []);
    },
  };
}

/**
 * Marquee-select with the mouse: hold the marquee modifier, drag a rectangle,
 * release. Asserts the rubber band shows while dragging and is gone after.
 */
export async function marqueeSelect(page, from, to) {
  const modifier = await marqueeModifier(page);
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down(modifier);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await expect(page.locator('svg.canvas rect[stroke="red"]')).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up(modifier);
  await expect(page.locator('svg.canvas rect[stroke="red"]')).toHaveCount(0);
}
