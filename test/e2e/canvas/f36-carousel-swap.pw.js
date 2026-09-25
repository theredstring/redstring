// F36 (P5.02 step 0; T10 in reports/P5.02a.md): the carousel's Swap. Stepping
// Alpha's carousel up to Thing (Alpha's only generalization in the small
// fixture) and pressing Swap replaces the instance's prototype with Thing.
// Swap clears the pie target first (no exit guard), the pie shrinks with no
// target, the carousel exits, and the exit callback applies the swap and puts
// the selection and the pie back on the same instance.
import { test, expect, storeEval } from './helpers.js';
import { scenarios } from './lifecycleScenarios.js';
import { expectInOrder, findIndex, summarize } from './lifecycleTrace.js';

const steady = (n) => (s) => s.pies.length === 1 && s.pies[0] === `visible-steady x${n}`;
const instanceProto = (page) => storeEval(page, (st) => st.graphs.get('g-small-a').instances.get('i-alpha')?.prototypeId);

test('F36 carousel Swap turns the instance into the focused concept and the pie returns to it', async ({ page }) => {
  const { all } = await scenarios.F36(page);

  const [, focused, swapPressed, , , exited, back] = expectInOrder(expect, all, [
    ['carousel open on Alpha (level 0)', (s) => s.carouselVisible && s.carouselFocus === 0 && steady(6)(s)],
    ['stepped up to Thing (level 1)', (s) => s.carouselVisible && s.carouselFocus === 1],
    // T10: target cleared and transition raised; the exit guard is NOT raised.
    ['Swap: target cleared, transition', (s) => s.carouselVisible && s.pieTarget === null && s.transitioning],
    ['pie shrinks with no target', (s) => s.pieTarget === null && s.pies[0] === 'shrinking x6'],
    ['carousel exits', (s) => s.carouselAnim === 'exiting'],
    ['carousel hidden, transition over', (s) => !s.carouselVisible && s.carouselAnim === 'hidden' && !s.transitioning],
    ['target restored to the same instance', (s) => !s.carouselVisible && s.pieTarget === 'i-alpha'],
    ['default pie steady', (s) => s.pieTarget === 'i-alpha' && steady(8)(s)],
  ]);
  expect(focused).toBeLessThan(swapPressed);
  expect(all.slice(swapPressed, back).every((s) => s.pieTarget === null), summarize(all)).toBe(true);
  // Unlike Back / Escape, this path never raises justCompletedCarouselExit.
  expect(findIndex(all, (s) => s.exitGuard), summarize(all)).toBe(-1);
  // The selection stays on the instance the whole time (the target is what moves).
  const opened = findIndex(all, (s) => s.carouselVisible);
  expect(all.slice(opened).every((s) => s.selection.join() === 'i-alpha')).toBe(true);
  // Since P5.02b step 4 the machine hides the carousel and restores the target in
  // one store write, so these can be the same state; they were separate writes.
  expect(exited).toBeLessThanOrEqual(back);

  // The swap was applied: same instance, now a Thing.
  expect(await instanceProto(page)).toBe('base-thing-prototype');
});
