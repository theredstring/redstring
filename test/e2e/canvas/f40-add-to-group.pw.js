// F40 (P5.06b): dropping a node onto a group asks "Add to Group?", and Add puts
// it in the group. The node is lifted like F1 (hold past the lift delay, let the
// drag-zoom settle), then released over the middle of the Pair group's members.
import {
  test, expect, openFixture, nodeBox, centerOf, activeGraphSnapshot, waitForCameraSettled, NODE_LIFT_DELAY_MS,
} from './helpers.js';

const pairGroup = (snap) => Object.entries(snap.groups).find(([, g]) => g.name === 'Pair');

test('F40 dropping a node onto a group asks to add it; Add makes it a member', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  const [pairId, pair] = pairGroup(before);
  expect(pair.memberInstanceIds).not.toContain('i-gamma');

  const from = centerOf(await nodeBox(page, 'i-gamma'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  await page.mouse.move(from.x, from.y + 4);
  await waitForCameraSettled(page);

  // Between the two members, where the group's box is, measured after the zoom-out.
  const [a, b] = await Promise.all(pair.memberInstanceIds.map((id) => nodeBox(page, id)));
  const to = { x: (centerOf(a).x + centerOf(b).x) / 2, y: (centerOf(a).y + centerOf(b).y) / 2 };
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + 4 + ((to.y - from.y - 4) * i) / steps);
  }
  await page.mouse.up();

  await expect(page.getByText('Add to Group?')).toBeVisible();
  // Nothing changes until the user confirms.
  expect((await activeGraphSnapshot(page)).groups[pairId].memberInstanceIds).not.toContain('i-gamma');

  // The dialog is DOM outside the SVG, so a locator click is safe here.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Add to Group?')).toBeHidden();
  await expect.poll(async () => (await activeGraphSnapshot(page)).groups[pairId].memberInstanceIds).toContain('i-gamma');
});
