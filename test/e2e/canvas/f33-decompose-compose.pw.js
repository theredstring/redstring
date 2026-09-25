// F33 (P5.02 step 0; T4/T5 in reports/P5.02a.md): the pie's Decompose opens
// the decompose preview, and its Compose closes it again. Both go through the
// same "shrink, then pop the next menu" hand-off: the button sets a pending
// slot and isTransitioningPieMenu, the menu shrinks, and its exit callback
// applies the change; the next menu then pops. Alpha has no definitions, so its
// decompose menu is the empty-state set (Add Definition, Decompose, Compose).
import { test, expect, storeEval } from './helpers.js';
import { scenarios } from './lifecycleScenarios.js';
import { expectInOrder, summarize } from './lifecycleTrace.js';

const steadyPie = (n) => (s) => s.pies.length === 1 && s.pies[0] === `visible-steady x${n}`;

test('F33 pie → Decompose previews the node; Compose returns to the default pie', async ({ page }) => {
  const { all } = await scenarios.F33(page);

  expectInOrder(expect, all, [
    ['default pie open', (s) => s.pieTarget === 'i-alpha' && steadyPie(8)(s)],
    // Decompose: pending slot + transition, then the default menu shrinks.
    ['Decompose pressed', (s) => s.pendingDecompose === 'i-alpha' && s.transitioning],
    ['default pie shrinks', (s) => s.pendingDecompose === 'i-alpha' && s.pies[0] === 'shrinking x8'],
    // Exit callback (H-pieExit row 2): pending cleared, transition over, preview on.
    ['preview set after the shrink', (s) => s.previewing === 'i-alpha' && !s.transitioning && s.pendingDecompose === null],
    ['decompose pie pops', (s) => s.previewing === 'i-alpha' && s.pies[0] === 'popping x3'],
    ['decompose pie steady', (s) => s.previewing === 'i-alpha' && steadyPie(3)(s)],
    // Compose: a plain transition (no pending slot), then H-pieExit row 4.
    ['Compose pressed', (s) => s.previewing === 'i-alpha' && s.transitioning && s.pendingDecompose === null],
    ['decompose pie shrinks', (s) => s.previewing === 'i-alpha' && s.pies[0] === 'shrinking x3'],
    ['preview cleared after the shrink', (s) => s.previewing === null && !s.transitioning],
    ['default pie pops again', (s) => s.previewing === null && s.pies[0] === 'popping x8'],
  ]);

  // The pie keeps its target and the node stays selected throughout: nothing
  // here goes through a closed pie.
  const opened = all.findIndex((s) => s.pieTarget === 'i-alpha');
  expect(all.slice(opened).every((s) => s.pieTarget === 'i-alpha' && s.selection.join() === 'i-alpha'), summarize(all)).toBe(true);
  // No carousel, no prompt, no pending abstraction at any point.
  expect(all.every((s) => !s.carouselVisible && !s.promptVisible && s.pendingAbstraction === null)).toBe(true);
  expect(all.at(-1)).toMatchObject({ pieTarget: 'i-alpha', previewing: null, transitioning: false, pies: ['visible-steady x8'] });
  // Alpha is untouched: a preview never writes the graph.
  expect(await storeEval(page, (st) => st.graphs.get('g-small-a').instances.get('i-alpha').prototypeId)).toBe('p-alpha');
});

test('F33 with the node control panel on, it switches to decompose mode and back in place', async ({ page }) => {
  const { all } = await scenarios.F33_nodePanel(page);
  expectInOrder(expect, all, [
    ['node panel shows with the pie', (s) => s.panels.node === 'nodes:visible'],
    ['decompose mode once the preview is set', (s) => s.previewing === 'i-alpha' && s.panels.node === 'decompose:visible'],
    ['back to nodes mode after Compose', (s) => s.previewing === null && s.panels.node === 'nodes:visible'],
  ]);
  // The panel never plays an exit during the swap: it changes mode in place.
  const shown = all.findIndex((s) => s.panels.node === 'nodes:visible');
  expect(all.slice(shown).every((s) => /:visible$/.test(s.panels.node || '')), summarize(all)).toBe(true);
});
