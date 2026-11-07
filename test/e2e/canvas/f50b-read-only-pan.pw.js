// F50b: in a read-only universe, a press that moves off a Thing or a group's
// title pans the canvas, by mouse and by finger. Nothing is drawn, moved or
// selected. A tap on a Thing still selects it.
import fs from 'node:fs';
import {
  test, expect, waitForCanvasReady, camera, waitForCameraSettled, centerOf, selectedNodeIds, storeEval, mouseDrag,
} from './helpers.js';
import { touchscreen } from './gestures.js';

const SOURCE = 'https://files.example.test/atlas.redstring';
const LINK = `/open?url=${encodeURIComponent(SOURCE)}`;
const file = fs.readFileSync(new URL('../../fixtures/canvas/small.redstring', import.meta.url));

async function openVisit(page) {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => (route.request().url() === SOURCE
    ? route.fulfill({ status: 200, body: file, headers: { 'access-control-allow-origin': '*' } })
    : route.abort()));
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
}

// A visit opens the Universes panel, which covers the fixture's left side.
const gamma = (page) => page.locator('svg.canvas g.node', { hasText: 'Gamma' });
const title = (page, name) => page.locator('svg.canvas g.group-label', { hasText: name });

const documentNow = (page) => storeEval(page, (st) => {
  const g = st.graphs.get(st.activeGraphId);
  return JSON.stringify({ at: [...g.instances.values()].map((i) => [i.x, i.y]), edges: st.edges.size });
});

const lineBeingDrawn = (page) => page.evaluate(async () => {
  const { default: useCanvasUIStore } = await import('/src/store/canvasUIStore.js');
  return useCanvasUIStore.getState().connectionDropTargetId ?? null;
});

test.describe('by mouse', () => {
  test('F50b dragging off a Thing pans, and draws nothing', async ({ page }) => {
    await openVisit(page);
    const before = await documentNow(page);
    const cam0 = await camera(page);
    const box = await gamma(page).boundingBox();
    const from = centerOf(box);
    const by = { x: 150, y: 90 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(from.x + (by.x * i) / 12, from.y + (by.y * i) / 12);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const mid = await camera(page);
    expect(Math.abs(mid.pan.x - cam0.pan.x - by.x), `pan x ${mid.pan.x - cam0.pan.x}`).toBeLessThan(by.x * 0.25);
    expect(Math.abs(mid.pan.y - cam0.pan.y - by.y), `pan y ${mid.pan.y - cam0.pan.y}`).toBeLessThan(by.y * 0.25);
    expect(await lineBeingDrawn(page)).toBeNull();

    // The hold gets the Thing's lift delay out of the way: a late drag doesn't start.
    await page.waitForTimeout(400);
    await page.mouse.up();
    await waitForCameraSettled(page);
    expect(await documentNow(page)).toBe(before);
    expect(await selectedNodeIds(page)).toEqual([]);
  });

  test('F50b holding a Thing and then moving pans too', async ({ page }) => {
    await openVisit(page);
    const before = await documentNow(page);
    const cam0 = await camera(page);
    const from = centerOf(await gamma(page).boundingBox());
    await mouseDrag(page, from, { x: from.x + 120, y: from.y + 80 }, { holdMs: 500, stepDelayMs: 16 });
    const cam1 = await waitForCameraSettled(page);
    expect(cam1.pan.x).toBeGreaterThan(cam0.pan.x + 60);
    expect(await documentNow(page)).toBe(before);
  });

  for (const name of ['Cluster', 'Pair']) {
    test(`F50b dragging the title of ${name} pans, and doesn't select it`, async ({ page }) => {
      await openVisit(page);
      const before = await documentNow(page);
      const cam0 = await camera(page);
      const from = centerOf(await title(page, name).boundingBox());
      await mouseDrag(page, from, { x: from.x + 60, y: from.y + 100 }, { stepDelayMs: 16 });
      const cam1 = await waitForCameraSettled(page);
      expect(cam1.pan.y).toBeGreaterThan(cam0.pan.y + 50);
      expect(await documentNow(page)).toBe(before);
      expect(await page.evaluate(async () => {
        const { default: useCanvasUIStore } = await import('/src/store/canvasUIStore.js');
        return useCanvasUIStore.getState().selectedGroupId;
      })).toBeNull();
    });
  }

  test('F50b a click on a Thing still selects it', async ({ page }) => {
    await openVisit(page);
    const from = centerOf(await gamma(page).boundingBox());
    await page.mouse.click(from.x, from.y);
    await expect.poll(async () => (await selectedNodeIds(page)).length).toBe(1);
  });
});

test.describe('by finger', () => {
  test.use({ hasTouch: true });

  test('F50b dragging off a Thing pans, glides, and draws nothing', async ({ page }) => {
    await openVisit(page);
    const touch = await touchscreen(page);
    const before = await documentNow(page);
    const cam0 = await camera(page);
    const from = centerOf(await gamma(page).boundingBox());
    const by = { x: 150, y: 90 };

    await touch.start([from]);
    for (let i = 1; i <= 12; i++) {
      await touch.move([{ x: from.x + (by.x * i) / 12, y: from.y + (by.y * i) / 12 }]);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const mid = await camera(page);
    // The first 12px are the finger deciding it isn't a tap.
    expect(mid.pan.x - cam0.pan.x, 'pan x follows the finger').toBeGreaterThan(by.x * 0.6);
    expect(mid.pan.y - cam0.pan.y, 'pan y follows the finger').toBeGreaterThan(by.y * 0.6);
    expect(await lineBeingDrawn(page)).toBeNull();

    await touch.end();
    const settled = await waitForCameraSettled(page);
    expect(settled.pan.x).toBeGreaterThanOrEqual(mid.pan.x);
    expect(await documentNow(page)).toBe(before);
    expect(await selectedNodeIds(page)).toEqual([]);

    // The gesture is over and nothing is stuck: bare canvas still pans.
    const spot = { x: 1000, y: 650 };
    await touch.start([spot]);
    for (let i = 1; i <= 8; i++) {
      await touch.move([{ x: spot.x - 10 * i, y: spot.y }]);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await touch.end();
    const again = await waitForCameraSettled(page);
    expect(again.pan.x).toBeLessThan(settled.pan.x);
  });

  for (const name of ['Cluster', 'Pair']) {
    test(`F50b dragging the title of ${name} pans`, async ({ page }) => {
      await openVisit(page);
      const touch = await touchscreen(page);
      const before = await documentNow(page);
      const cam0 = await camera(page);
      const from = centerOf(await title(page, name).boundingBox());
      await touch.start([from]);
      for (let i = 1; i <= 12; i++) {
        await touch.move([{ x: from.x + 5 * i, y: from.y + 8 * i }]);
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      const mid = await camera(page);
      expect(mid.pan.y - cam0.pan.y, 'pan y follows the finger').toBeGreaterThan(50);
      await touch.end();
      await waitForCameraSettled(page);
      expect(await documentNow(page)).toBe(before);

      // Nothing is stuck: bare canvas still pans.
      const settled = await camera(page);
      const spot = { x: 1000, y: 650 };
      await touch.start([spot]);
      for (let i = 1; i <= 8; i++) {
        await touch.move([{ x: spot.x - 10 * i, y: spot.y }]);
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await touch.end();
      expect((await waitForCameraSettled(page)).pan.x).toBeLessThan(settled.pan.x);
    });
  }

  test('F50b a tap on a Thing still selects it, and one on bare canvas makes nothing', async ({ page }) => {
    await openVisit(page);
    const touch = await touchscreen(page);
    const from = centerOf(await gamma(page).boundingBox());
    await touch.start([from]);
    await touch.end();
    await expect.poll(async () => (await selectedNodeIds(page)).length).toBe(1);

    const spot = { x: 1000, y: 650 };
    for (let i = 0; i < 2; i++) { // The first only clears the selection.
      await touch.start([spot]);
      await touch.end();
      await page.waitForTimeout(350);
    }
    await expect(page.locator('[data-plus-sign="true"]')).toHaveCount(0);
  });
});
