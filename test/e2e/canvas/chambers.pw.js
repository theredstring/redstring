// F1, F2 and F6 on the local-only "chambers" fixture: a copy of Grant's real
// universe (D-15, F-66), on its largest graph (54 instances, ~40 edges, 13
// groups).
//
// PRIVACY: the file is personal. It is read from outside the repo (absolute
// path, or REDSTRING_LOCAL_FIXTURE), injected with window.__loadFixture, and
// never written anywhere. These tests print no names or content, and turn off
// screenshots and traces so failure artefacts don't capture it either.
// Skipped when the file is absent (CI, other machines, other worktrees without
// access).
import { readFileSync } from 'node:fs';
import {
  test, expect, openFixture, waitForCanvasReady, chambersPath, nodeBox, centerOf, camera,
  waitForCameraSettled, worldToClient, storeEval, selectedNodeIds, pieButton, openPieMenu,
  clickCenter, findBareSpot, NODE_LIFT_DELAY_MS,
} from './helpers.js';

const FIXTURE = chambersPath();
test.skip(!FIXTURE, 'local chambers fixture not present (see D-15)');
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

let text = null;
test.beforeAll(() => { text = readFileSync(FIXTURE, 'utf-8'); });

async function openChambers(page, { storageSeed } = {}) {
  if (storageSeed) await page.addInitScript((seed) => { window.__fixtureStorageSeed = seed; }, storageSeed);
  await openFixture(page, 'small');
  const summary = await page.evaluate(
    (data) => window.__loadFixture(data, { label: 'chambers', activeGraphId: 'largest', frame: true }),
    text,
  );
  // Sanity against F-66, without naming anything.
  expect(summary.graphs).toBeGreaterThan(150);
  expect(summary.instancesOnActive).toBeGreaterThanOrEqual(50);
  await expect.poll(() => storeEval(page, (st) => st.activeGraphId)).toBe(summary.activeGraphId);
  await waitForCanvasReady(page);
  await waitForCameraSettled(page);
  return summary;
}

/** A rendered node that isn't a group anchor or member, fully on screen. */
async function freeNode(page) {
  const free = await storeEval(page, (st) => {
    const g = st.graphs.get(st.activeGraphId);
    const grouped = new Set();
    for (const gr of g.groups?.values() || []) {
      (gr.memberInstanceIds || []).forEach((id) => grouped.add(id));
      if (gr.anchorInstanceId) grouped.add(gr.anchorInstanceId);
    }
    return [...g.instances.values()].filter((i) => !i.isGroupAnchor && !grouped.has(i.id)).map((i) => i.id);
  });
  const area = await page.locator('.canvas-area').boundingBox();
  for (const id of free) {
    const loc = page.locator(`svg.canvas g.node[data-instance-id="${id}"] .node-background`);
    if (await loc.count() === 0) continue;
    const b = await loc.first().boundingBox();
    if (b && b.x > area.x + 40 && b.y > area.y + 40 && b.x + b.width < area.x + area.width - 40 && b.y + b.height < area.y + area.height - 90) {
      return id;
    }
  }
  return null;
}

test('chambers F1 node drag moves the instance', async ({ page }) => {
  // Drag-zoom off here so the drop lands where the bare patch was found; the
  // drag-zoom path itself is covered on the small fixture (f01).
  await openChambers(page, { storageSeed: { redstring_drag_zoom_enabled: 'false' } });
  const id = await freeNode(page);
  test.skip(!id, 'no ungrouped node fully on screen in this graph');
  const start = await storeEval(page, (st, iid) => ({ ...st.graphs.get(st.activeGraphId).instances.get(iid) }), id);
  const box0 = await nodeBox(page, id);
  const from = centerOf(box0);
  const to = await findBareSpot(page);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  const steps = 15;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
  await waitForCameraSettled(page);

  const box1 = await nodeBox(page, id);
  expect(Math.hypot(centerOf(box1).x - to.x, centerOf(box1).y - to.y), 'released under the pointer').toBeLessThan(8);
  const end = await storeEval(page, (st, iid) => ({ ...st.graphs.get(st.activeGraphId).instances.get(iid) }), id);
  expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(20);
  const drawnAt = await worldToClient(page, end.x + 6, end.y + 6);
  expect(Math.abs(drawnAt.x - box1.x)).toBeLessThan(3);
  expect(Math.abs(drawnAt.y - box1.y)).toBeLessThan(3);
});

test('chambers F2 drag-pan moves the camera, glides and settles', async ({ page }) => {
  await openChambers(page);
  const cam0 = await camera(page);
  const from = await findBareSpot(page, { halfW: 20, halfH: 20 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x - 15 * i, from.y - 10 * i);
  const atRelease = await camera(page);
  await page.mouse.up();
  expect(atRelease.pan.x).toBeLessThan(cam0.pan.x - 90);
  const settled = await waitForCameraSettled(page);
  expect(settled.pan.x).toBeLessThan(atRelease.pan.x); // glide continued
  expect(settled.zoom).toBeCloseTo(cam0.zoom, 6);
  await expect.poll(async () => {
    const v = await storeEval(page, (st) => st.graphViews.get(st.activeGraphId));
    return Math.hypot(v.panOffset.x - settled.pan.x, v.panOffset.y - settled.pan.y);
  }).toBeLessThan(0.5);
});

test('chambers F6 pie menu opens, Save toggles, click-off closes', async ({ page }) => {
  await openChambers(page);
  const id = await freeNode(page);
  test.skip(!id, 'no ungrouped node fully on screen in this graph');
  const protoId = await storeEval(page, (st, iid) => st.graphs.get(st.activeGraphId).instances.get(iid).prototypeId, id);
  const saved0 = await storeEval(page, (st, pid) => st.savedNodeIds.has(pid), protoId);

  await openPieMenu(page, id);
  await clickCenter(page, pieButton(page, 'bookmark'));
  await expect.poll(() => storeEval(page, (st, pid) => st.savedNodeIds.has(pid), protoId)).toBe(!saved0);

  const off = await findBareSpot(page, { halfW: 20, halfH: 20 });
  await page.mouse.click(off.x, off.y);
  await expect.poll(() => selectedNodeIds(page)).toEqual([]);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
});
