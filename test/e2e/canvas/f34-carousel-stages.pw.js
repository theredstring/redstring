// F34 (P5.02 step 0; T7/T8 in reports/P5.02a.md): the carousel pie's two
// stages. Stage 1 carries Back / Swap / Create Definition (plus) / Delete /
// Expand / Ask; plus shrinks it and pops stage 2 (Back, Add Above, Add Below).
// Stage 2's Back returns to stage 1. Cancelling the Add Above prompt drops back
// to stage 1 in place — and, today, leaves the stage flag set (NEW-2).
import { test, expect } from './helpers.js';
import { scenarios } from './lifecycleScenarios.js';
import { expectInOrder, findIndex, summarize } from './lifecycleTrace.js';

const steady = (n) => (s) => s.pies.length === 1 && s.pies[0] === `visible-steady x${n}`;
const inCarousel = (s) => s.carouselVisible && s.carouselNodeId === 'i-alpha';

test('F34 carousel stage 2 → Back returns to stage 1', async ({ page }) => {
  const { all } = await scenarios.F34_stageBack(page);
  expectInOrder(expect, all, [
    ['stage 1 pie', (s) => inCarousel(s) && s.stage === 1 && steady(6)(s)],
    ['plus: stage flag + transition', (s) => s.stageFlag && s.transitioning && s.stage === 1],
    ['stage 1 pie shrinks', (s) => s.stageFlag && s.pies[0] === 'shrinking x6'],
    ['stage flips to 2 after the shrink', (s) => s.stage === 2 && !s.stageFlag && !s.transitioning],
    ['stage 2 pie', (s) => s.stage === 2 && steady(3)(s)],
    ['Back: stage flag + transition', (s) => s.stage === 2 && s.stageFlag && s.transitioning],
    ['stage flips to 1', (s) => s.stage === 1 && !s.stageFlag && !s.transitioning],
    ['stage 1 pie again', (s) => s.stage === 1 && steady(6)(s)],
  ]);
  // A stage change never closes the carousel, never touches the exit guard and
  // keeps the pie's target.
  const open = findIndex(all, inCarousel);
  expect(all.slice(open).every((s) => inCarousel(s) && !s.exitGuard && s.pieTarget === 'i-alpha'), summarize(all)).toBe(true);
});

test('F34 Add Above → cancel → Back: the first Back goes to stage 2 (NEW-2, today\'s behaviour)', async ({ page }) => {
  const { all } = await scenarios.F34_cancelBack(page);

  // Cancel returns to stage 1 in place (no shrink): prompt hidden, stage 1,
  // and the stage flag left SET with no transition running.
  const [, , cancelled] = expectInOrder(expect, all, [
    ['stage 2 pie', (s) => s.stage === 2 && steady(3)(s)],
    ['prompt open', (s) => s.promptVisible && s.stage === 2],
    ['cancel: stage 1 with the flag left set', (s) => !s.promptVisible && s.stage === 1 && s.stageFlag && !s.transitioning],
  ]);
  const swapped = findIndex(all, (s) => s.stage === 1 && s.stageFlag && steady(6)(s), cancelled);
  expect(swapped, `stage-1 buttons swapped in under a visible menu\n${summarize(all)}`).toBeGreaterThan(cancelled);
  expect(all.slice(cancelled, swapped + 1).some((s) => /shrinking/.test(s.pies.join()))).toBe(false);

  // NEW-2 (current behaviour, a bug to be fixed): the first stage-1 Back after
  // the cancel does NOT close the carousel. It raises the exit guard, the pie
  // shrinks, and H-pieExit takes the stage-swap row because the flag is still
  // set: the carousel stays up and the pie pops stage 2.
  const [firstBack, toStage2] = expectInOrder(expect, all, [
    ['1st Back: exit guard + transition, flag still set', (s) => s.exitGuard && s.transitioning && s.stage === 1 && s.stageFlag],
    ['NEW-2: stage 2 instead of closing', (s) => s.stage === 2 && !s.stageFlag && !s.transitioning && inCarousel(s)],
    ['stage 2 pie pops', (s) => s.stage === 2 && steady(3)(s)],
  ], swapped);
  expect(all.slice(firstBack, toStage2 + 1).every(inCarousel), 'the carousel never started to exit').toBe(true);
  // …and the exit guard it raised stays up while the carousel stays open
  // (only the carousel's exit-complete timer lowers it). See the report's NEW-9.
  const closed = findIndex(all, (s) => !s.carouselVisible, firstBack);
  expect(all.slice(firstBack, closed).every((s) => s.exitGuard), summarize(all)).toBe(true);

  // The second Back (stage 2's) swaps back to stage 1 and clears the flag; the
  // third Back closes the carousel and the pie returns to Alpha.
  expectInOrder(expect, all, [
    ['2nd Back → stage 1, flag clear', (s) => s.stage === 1 && !s.stageFlag && inCarousel(s) && steady(6)(s)],
    ['3rd Back: carousel exits', (s) => s.carouselAnim === 'exiting'],
    ['carousel hidden', (s) => !s.carouselVisible && s.carouselAnim === 'hidden'],
    ['default pie back on Alpha', (s) => !s.carouselVisible && s.pieTarget === 'i-alpha' && steady(8)(s) && !s.exitGuard],
  ], toStage2);
});
