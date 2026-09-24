// F9: the abstraction carousel opens from the pie menu, steps along the
// generalization axis, and closes.
//
// Each carousel entry is a <g data-carousel-level="N"> (the touch path uses the
// attribute to hit-test taps). Alpha is a plain Thing, so its chain is two
// entries: Alpha itself at level 0 and Thing, its type, at level 1. The
// focused entry is the one drawn at full opacity; the rest are dimmed.
// While the carousel is up it owns the view: pan, zoom and destructive keys
// are blocked (see the guards in useCanvasKeyboard and AbstractionCarousel).
import {
  test, expect,
  openFixture, camera, waitForCameraSettled, activeGraphSnapshot, pieButton, clickCenter, openPieMenu,
} from './helpers.js';

const carouselEntries = (page) => page.evaluate(() => [...document.querySelectorAll('[data-carousel-level]')]
  .map((g) => ({ level: Number(g.getAttribute('data-carousel-level')), name: g.textContent.trim(), opacity: Number(getComputedStyle(g).opacity) }))
  .sort((a, b) => a.level - b.level));

/** Level of the entry at full opacity, once exactly one is. */
async function focusedLevel(page) {
  const full = (await carouselEntries(page)).filter((e) => e.opacity > 0.99);
  return full.length === 1 ? full[0].level : null;
}

test('F9 the abstraction carousel opens, steps, locks the view, and closes', async ({ page }) => {
  await openFixture(page, 'small');
  await openPieMenu(page, 'i-alpha');

  // Open: the pie's Abstraction button (layers icon) morphs into the carousel.
  await clickCenter(page, pieButton(page, 'layers'));
  await expect.poll(() => carouselEntries(page).then((es) => es.map((e) => [e.level, e.name])))
    .toEqual([[0, 'Alpha'], [1, 'Thing']]);
  await expect.poll(() => focusedLevel(page), { message: 'opens on the node itself' }).toBe(0);
  await expect(page.locator('.abstraction-control-panel')).toContainText('Generalization Axis');
  // The pie menu switches to its carousel buttons (Back is the left arrow).
  await expect(pieButton(page, 'arrow-left')).toBeVisible();
  // Opening frames the node; wait for that to finish.
  const framed = await waitForCameraSettled(page);

  // Step: the wheel moves along the axis instead of zooming the canvas.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => focusedLevel(page), { message: 'wheel steps up to Thing' }).toBe(1);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => focusedLevel(page), { message: 'and back down to Alpha' }).toBe(0);

  // The view is locked: neither the wheel nor the keyboard moved the camera,
  // and Backspace does not delete the node under the carousel.
  await page.keyboard.down('d');
  await page.waitForTimeout(250);
  await page.keyboard.up('d');
  await page.keyboard.press('Backspace');
  expect(await camera(page)).toEqual(framed);
  expect((await activeGraphSnapshot(page)).instances['i-alpha']).toBeTruthy();

  // Close with Escape: the carousel and its panel go, and the canvas is live again.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
  await expect(page.locator('.abstraction-control-panel')).toHaveCount(0);
  const before = await waitForCameraSettled(page);
  await page.keyboard.down('d');
  await page.waitForTimeout(250);
  await page.keyboard.up('d');
  const after = await waitForCameraSettled(page);
  expect(after.pan.x, 'the keyboard pans again once the carousel is closed').toBeLessThan(before.pan.x);
});

test('F9 the carousel\'s Back button closes it', async ({ page }) => {
  await openFixture(page, 'small');
  await openPieMenu(page, 'i-beta');
  await clickCenter(page, pieButton(page, 'layers'));
  await expect.poll(() => focusedLevel(page)).toBe(0);
  await waitForCameraSettled(page);

  await clickCenter(page, pieButton(page, 'arrow-left'));
  await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
  await expect(page.locator('.abstraction-control-panel')).toHaveCount(0);
});
