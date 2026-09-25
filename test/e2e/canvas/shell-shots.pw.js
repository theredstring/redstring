// Shell screenshots for before/after layout comparisons (P2.11). Skipped unless
// SHELL_SHOTS_DIR is set; compare two runs with scripts/compare-shots.mjs:
//
//   git checkout <before> -- src && SHELL_SHOTS_DIR=/tmp/a npx playwright test shell-shots
//   git checkout HEAD -- src     && SHELL_SHOTS_DIR=/tmp/b npx playwright test shell-shots
//   node scripts/compare-shots.mjs /tmp/a /tmp/b
import path from 'node:path';
import { test, openFixture, storeEval, waitForCameraSettled, nextFrames } from './helpers.js';

const DIR = process.env.SHELL_SHOTS_DIR;
test.skip(!DIR, 'set SHELL_SHOTS_DIR to take shell screenshots');

const setUI = (page, fn, arg) => page.evaluate(async ([source, a]) => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  // eslint-disable-next-line no-new-func
  new Function(`return (${source})`)()(ui.getState(), window.useGraphStore.getState(), a);
}, [fn.toString(), arg]);

async function shot(page, name) {
  await waitForCameraSettled(page);
  // Let panel and control-panel transitions finish before capturing.
  await page.waitForTimeout(900);
  await nextFrames(page, 3);
  await page.screenshot({ path: path.join(DIR, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

const SCENES = [
  { name: 'desktop-both-panels', viewport: { width: 1280, height: 800 }, setup: (ui, g) => { g.setLeftPanelExpanded(true); g.setRightPanelExpanded(true); } },
  { name: 'desktop-left-only', viewport: { width: 1280, height: 800 }, setup: (ui, g) => { g.setLeftPanelExpanded(true); g.setRightPanelExpanded(false); } },
  { name: 'desktop-no-panels', viewport: { width: 1280, height: 800 }, setup: (ui, g) => { g.setLeftPanelExpanded(false); g.setRightPanelExpanded(false); } },
  { name: 'desktop-typelist-types', viewport: { width: 1280, height: 800 }, setup: (ui, g) => { g.setTypeListMode('node'); } },
  { name: 'desktop-node-selected', viewport: { width: 1280, height: 800 }, setup: (ui) => { ui.setSelectedInstanceIds(new Set(['i-alpha', 'i-beta'])); } },
  { name: 'desktop-help-modal', viewport: { width: 1280, height: 800 }, setup: () => { window.dispatchEvent(new Event('openHelpModal')); } },
  { name: 'narrow-right-panel', viewport: { width: 1000, height: 700 }, setup: (ui, g) => { g.setLeftPanelExpanded(false); g.setRightPanelExpanded(true); } },
  { name: 'landscape-shell', viewport: { width: 900, height: 420 }, shell: true, setup: () => {} },
  { name: 'landscape-shell-left-panel', viewport: { width: 900, height: 420 }, shell: true, setup: (ui, g) => { g.setLeftPanelExpanded(true); } },
];

for (const scene of SCENES) {
  test(`shell shot: ${scene.name}`, async ({ page }) => {
    await page.setViewportSize(scene.viewport);
    if (scene.shell) {
      await page.addInitScript(() => localStorage.setItem('redstring_landscape_shell_mode', 'on'));
    }
    await openFixture(page, 'small');
    await setUI(page, scene.setup);
    await storeEval(page, () => true);
    await shot(page, scene.name);
  });
}
