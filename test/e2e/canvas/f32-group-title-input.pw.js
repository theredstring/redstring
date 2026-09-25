// F32: input on a group's title pill, by mouse and by touch. Since P3.04 these
// handlers are one stable set (components/canvas/groups/groupInput.js) behind
// memoized group elements, instead of arrows rebuilt on every render; this
// checks they still act on the right group with current values.
import {
  test, expect, openFixture, storeEval, centerOf, activeGraphSnapshot, waitForCameraSettled, CLICK_DELAY_MS,
} from './helpers.js';
import { touchscreen, TOUCH_LIFT_DELAY_MS } from './gestures.js';

const firstGroup = (page) => storeEval(page, (st) => {
  const g = [...st.graphs.get(st.activeGraphId).groups.values()][0];
  return { id: g.id, name: g.name, members: [...g.memberInstanceIds] };
});
const groupName = (page, id) => storeEval(page, (st, gid) => st.graphs.get(st.activeGraphId).groups.get(gid)?.name, id);
const selectedGroupId = (page) => page.evaluate(async () => {
  const { default: store } = await import('/src/store/canvasUIStore.js');
  return store.getState().selectedGroupId;
});
const pill = (page, id) => page.locator(`svg.canvas [data-group-id="${id}"] g.group-label`).first();

test('F32 click selects the group; double-click renames on Enter and cancels on Escape', async ({ page }) => {
  await openFixture(page, 'small');
  await waitForCameraSettled(page);
  const g = await firstGroup(page);
  const at = centerOf(await pill(page, g.id).boundingBox());

  await page.mouse.click(at.x, at.y);
  await expect.poll(() => selectedGroupId(page)).toBe(g.id);

  await page.waitForTimeout(CLICK_DELAY_MS + 400);
  await page.mouse.dblclick(at.x, at.y);
  const field = page.locator('svg.canvas foreignObject textarea');
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(g.name);
  await field.fill('Renamed by F32');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect.poll(() => groupName(page, g.id)).toBe('Renamed by F32');

  await page.waitForTimeout(CLICK_DELAY_MS + 400);
  const at2 = centerOf(await pill(page, g.id).boundingBox());
  await page.mouse.dblclick(at2.x, at2.y);
  await expect(field).toBeVisible();
  await field.fill('Should not stick');
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  expect(await groupName(page, g.id)).toBe('Renamed by F32');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('F32 a tap on the title selects the group; a long-press drags its members', async ({ page }) => {
    await openFixture(page, 'small');
    await waitForCameraSettled(page);
    const g = await firstGroup(page);
    const ts = await touchscreen(page);
    const at = centerOf(await pill(page, g.id).boundingBox());

    await ts.start([at]);
    await page.waitForTimeout(60);
    await ts.end([]);
    await expect.poll(() => selectedGroupId(page)).toBe(g.id);

    await page.waitForTimeout(600);
    const before = await activeGraphSnapshot(page);
    const at2 = centerOf(await pill(page, g.id).boundingBox());
    await ts.drag(at2, { x: at2.x + 120, y: at2.y + 80 }, { holdMs: TOUCH_LIFT_DELAY_MS + 200, steps: 14 });
    await waitForCameraSettled(page);
    const after = await activeGraphSnapshot(page);
    const moved = g.members.map((id) => Math.hypot(after.instances[id].x - before.instances[id].x, after.instances[id].y - before.instances[id].y));
    for (const m of moved) expect(m, 'each member moved with the group').toBeGreaterThan(40);
    expect(Math.max(...moved) - Math.min(...moved), 'members moved together').toBeLessThan(1);
  });
});
