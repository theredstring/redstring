// F29: while the abstraction carousel steps, the pie menu tracks the focused
// node's size frame by frame, so its bubbles stay clear of a node that grows or
// shrinks. Since P5.04a the carousel's size reports rebuild the pie data
// directly (NodeCanvas no longer re-renders per frame), so this pins the
// report → pie path: the pie's size is the carousel's, it moves during a step,
// and the pie stays centred on the carousel.
import { test, expect, openFixture, pieButton, clickCenter, openPieMenu, waitForCameraSettled } from './helpers.js';

const pieData = (page) => page.evaluate(async () => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  const d = ui.getState().currentPieMenuData;
  return d && { id: d.node.id, x: d.node.x, y: d.node.y, dims: d.nodeDimensions };
});

test('F29 the pie menu follows the carousel\'s focused node while it steps', async ({ page }) => {
  await openFixture(page, 'small');
  await openPieMenu(page, 'i-alpha');
  const before = await pieData(page);
  const center = { x: before.x + before.dims.currentWidth / 2, y: before.y + before.dims.currentHeight / 2 };

  await clickCenter(page, pieButton(page, 'layers'));
  // The carousel reports only these three measurements; the node's own
  // getNodeDimensions carries more. So this says the pie is sized by the report.
  await expect.poll(() => pieData(page).then((d) => d && Object.keys(d.dims).sort()), { message: 'pie sized by the carousel' })
    .toEqual(['currentHeight', 'currentWidth', 'textAreaHeight']);
  await waitForCameraSettled(page);

  // Step and sample: the size moves through the carousel's interpolation.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  const widths = new Set();
  for (let i = 0; i < 20; i++) {
    const d = await pieData(page);
    if (d) widths.add(d.dims.currentWidth);
    await page.waitForTimeout(25);
  }
  // Tracking every frame gives 14–15 distinct sizes here. Rebuilding only when
  // NodeCanvas happens to render (the focused node changing level) gives 3.
  expect(widths.size, 'the pie tracked the step frame by frame').toBeGreaterThanOrEqual(8);

  // And stays centred on the carousel, whatever size it settles at.
  await page.waitForTimeout(800);
  const after = await pieData(page);
  expect(after.id).toBe('i-alpha');
  expect(after.x + after.dims.currentWidth / 2).toBeCloseTo(center.x, 3);
  expect(after.y + after.dims.currentHeight / 2).toBeCloseTo(center.y, 3);
});
