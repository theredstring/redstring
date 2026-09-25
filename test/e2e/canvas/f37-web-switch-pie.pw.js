// F37 (P5.02 step 0; §4.9 in reports/P5.02a.md): switching web while a node's
// pie is open.
//
// P5.02a §4.9 predicted the pie would play its shrink at the old node's
// position in the new web. It does not (see the report's NEW-10): in the commit
// that follows the switch, the close-all effect clears the selection and the
// target, and in the same effect flush the pie-data rebuild — still holding the
// old target in its closure but already given the new web's nodes — finds no
// such node and nulls the pie data. The layer's mount gate needs the data, so
// the menu unmounts at once, with no shrink, and isPieMenuRendered is left
// true. This flow pins that.
import { test, expect } from './helpers.js';
import { scenarios } from './lifecycleScenarios.js';
import { expectInOrder, findIndex, summarize } from './lifecycleTrace.js';

const steady = (n) => (s) => s.pies.length === 1 && s.pies[0] === `visible-steady x${n}`;

test('F37 switching web with the pie open: the pie is dropped at once, no shrink (NEW-10, today\'s behaviour)', async ({ page }) => {
  const { all } = await scenarios.F37(page);

  const [open, switched, , nulled, gone] = expectInOrder(expect, all, [
    ['pie open on Alpha in web A', (s) => s.activeGraphId === 'g-small-a' && steady(8)(s)],
    ['web B: selection cleared', (s) => s.activeGraphId === 'g-small-b' && s.selection.length === 0],
    ['target cleared', (s) => s.activeGraphId === 'g-small-b' && s.pieTarget === null],
    ['pie data nulled, still "rendered"', (s) => s.pieDataNodeId === null && s.pieRendered],
    ['menu unmounted', (s) => s.activeGraphId === 'g-small-b' && s.pies.length === 0],
  ]);
  expect(open).toBeLessThan(switched);
  // No state of the switch shows a shrinking (or any other animating) menu.
  expect(all.slice(switched).some((s) => s.pies.some((p) => !/^visible-steady/.test(p))), summarize(all)).toBe(false);
  // Nothing ran the pie's exit callback, so isPieMenuRendered stays true.
  expect(all.slice(nulled).every((s) => s.pieRendered), summarize(all)).toBe(true);
  expect(all.at(-1)).toMatchObject({ activeGraphId: 'g-small-b', pieTarget: null, pieDataNodeId: null, pieRendered: true, transitioning: false, selection: [], pies: [] });
  expect(gone).toBe(nulled + 1);
});

test('F37 with the node control panel on, the panel plays its exit while the pie vanishes', async ({ page }) => {
  const { all } = await scenarios.F37_nodePanel(page);
  const [, gone] = expectInOrder(expect, all, [
    ['node panel with the pie', (s) => s.activeGraphId === 'g-small-a' && s.panels.node === 'nodes:visible' && steady(8)(s)],
    ['pie gone in web B, panel still up', (s) => s.activeGraphId === 'g-small-b' && s.pies.length === 0 && s.panels.node === 'nodes:visible'],
    ['then the panel exits', (s) => s.panels.node === 'nodes:exiting'],
    ['and unmounts', (s) => s.panels.node === null && s.activeGraphId === 'g-small-b'],
  ]);
  expect(findIndex(all, (s) => s.pies.some((p) => /shrinking/.test(p)))).toBe(-1);
  expect(gone).toBeGreaterThan(0);
});
