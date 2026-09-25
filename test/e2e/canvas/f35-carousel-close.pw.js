// F35 (P5.02 step 0; T9 in reports/P5.02a.md): closing the carousel with
// Escape or a mouse click-away. Both go through onCarouselClose: exit guard up,
// the carousel pie shrinks, the carousel plays its 200 ms exit, then the exit
// callback restores the selection and the pie returns to the node with the
// default menu. A click-away behaves exactly like Escape (NEW-1: the
// "closed by click-away" ref that once made it different is dead).
import { test, expect } from './helpers.js';
import { scenarios } from './lifecycleScenarios.js';
import { expectInOrder, findIndex, summarize, traceViews } from './lifecycleTrace.js';

const steady = (n) => (s) => s.pies.length === 1 && s.pies[0] === `visible-steady x${n}`;

function expectCloseReturnsPie(all) {
  const [open, close, , , hidden, back] = expectInOrder(expect, all, [
    ['carousel open, stage-1 pie', (s) => s.carouselVisible && s.carouselAnim === 'visible' && steady(6)(s) && s.panels.abstraction === 'abstraction:visible'],
    ['close: exit guard + transition', (s) => s.carouselVisible && s.exitGuard && s.transitioning],
    ['carousel pie shrinks first', (s) => s.carouselVisible && s.exitGuard && s.pies[0] === 'shrinking x6'],
    ['then the carousel exits', (s) => s.carouselAnim === 'exiting' && s.transitioning],
    ['carousel hidden, transition over', (s) => !s.carouselVisible && s.carouselAnim === 'hidden' && !s.transitioning],
    ['default pie pops on Alpha', (s) => !s.carouselVisible && s.pieTarget === 'i-alpha' && s.pies[0] === 'popping x8'],
    ['exit guard lowered', (s) => !s.exitGuard && !s.carouselVisible],
    ['default pie steady, abstraction panel gone', (s) => steady(8)(s) && s.panels.abstraction === null],
  ]);
  expect(open).toBeLessThan(close);
  // The selection and the pie target stay on Alpha through the whole close.
  expect(all.slice(open).every((s) => s.selection.join() === 'i-alpha' && s.pieTarget === 'i-alpha'), summarize(all)).toBe(true);
  // The carousel pie never shows again once the exit started, and the stage is 1.
  expect(all.slice(hidden, back).every((s) => s.pies.length === 0)).toBe(true);
  expect(all.at(-1)).toMatchObject({ stage: 1, stageFlag: false, carouselLevels: 0, transitioning: false });
}

test('F35 Escape closes the carousel and the pie returns to the node', async ({ page }) => {
  const { all } = await scenarios.F35_escape(page);
  expectCloseReturnsPie(all);
});

test('F35 a mouse click on empty canvas closes the carousel the same way (NEW-1)', async ({ page }) => {
  const clickAway = (await scenarios.F35_clickAway(page)).all;
  expectCloseReturnsPie(clickAway);
  // Not just similar: the same distinct states as the Escape close (F35_escape
  // baseline). If click-away is ever made to leave the pie closed (A-6), this
  // is the assertion to change.
  const { all: escape } = await scenarios.F35_escape(page);
  // Compared view by view: a control panel renders from its own host and can land
  // a commit apart from the pie (P5.05a), so whole snapshots can interleave
  // differently while every part goes through the same states in the same order.
  expect(traceViews(clickAway)).toEqual(traceViews(escape));
});

test('F35 with the node control panel on, the panels swap by cutting each other (§4.7)', async ({ page }) => {
  const { all } = await scenarios.F35_escape_nodePanel(page);
  expectInOrder(expect, all, [
    ['node panel with the pie', (s) => s.panels.node === 'nodes:visible' && !s.carouselVisible],
    // E-abs cuts the node panel: it is gone in the same state the abstraction
    // panel mounts, without an exit animation.
    ['carousel opens: node panel cut as the abstraction panel mounts',
      (s) => s.carouselVisible && s.panels.node === null && s.panels.abstraction === 'abstraction:entering'],
    ['abstraction panel in', (s) => s.panels.abstraction === 'abstraction:visible'],
    // E-node cuts the abstraction panel on the way back, the same way.
    ['after the close: node panel flies in, abstraction panel cut',
      (s) => !s.carouselVisible && s.panels.node === 'nodes:entering' && s.panels.abstraction === null],
    ['node panel settles', (s) => s.panels.node === 'nodes:visible' && steady(8)(s)],
  ]);
  expect(findIndex(all, (s) => s.panels.node === 'nodes:exiting'), 'the node panel never plays an exit').toBe(-1);
  expect(findIndex(all, (s) => s.panels.abstraction === 'abstraction:exiting'), 'nor does the abstraction panel').toBe(-1);
});

test('F35 Escape from stage 2 leaves the stage at 2: the next carousel opens on stage 2 (NEW-4, today\'s behaviour)', async ({ page }) => {
  const { all } = await scenarios.F35_stage2Escape(page);
  // NEW-4 (current behaviour, a bug to be fixed): the carousel's exit does not
  // reset carouselPieMenuStage, so the default pie comes back with stage 2
  // still stored, and reopening the carousel pops the stage-2 set first.
  const [, , closed] = expectInOrder(expect, all, [
    ['stage 2 pie', (s) => s.carouselVisible && s.stage === 2 && steady(3)(s)],
    ['Escape: carousel exits', (s) => s.carouselAnim === 'exiting' && s.stage === 2],
    ['closed, stage still 2', (s) => !s.carouselVisible && s.carouselAnim === 'hidden' && steady(8)(s) && s.stage === 2],
    ['reopened on stage 2 (3 buttons)', (s) => s.carouselVisible && s.stage === 2 && steady(3)(s)],
  ]);
  expect(all.slice(closed).every((s) => s.stage === 2), summarize(all)).toBe(true);
});
