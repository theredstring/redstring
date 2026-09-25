// F22: the window events that open Help, Settings, Merge and Auto Graph still
// open them. Since P2.06b those modals and their listeners live in ModalHosts
// instead of NodeCanvas.
import { test, expect, openFixture } from './helpers.js';

const ui = (page, key) => page.evaluate(async (k) => {
  const { default: store } = await import('/src/store/canvasUIStore.js');
  return store.getState()[k];
}, key);

const MODALS = [
  { event: 'openHelpModal', flag: 'showHelpModal', setter: 'setShowHelpModal', selector: '.canvas-modal' },
  { event: 'openSettingsModal', flag: 'showSettingsModal', setter: 'setShowSettingsModal', selector: '.canvas-modal' },
  { event: 'openMergeModal', flag: 'showMergeThingsModal', setter: 'setShowMergeThingsModal', selector: '.canvas-modal' },
  { event: 'redstring:open-auto-graph-modal', flag: 'autoGraphModalVisible', setter: 'setAutoGraphModalVisible', selector: '.autograph-modal-overlay' },
];

test('F22 each modal opens from its window event and closes from the store', async ({ page }) => {
  await openFixture(page, 'small');
  for (const m of MODALS) {
    await expect(page.locator(m.selector)).toHaveCount(0);
    await page.evaluate((type) => window.dispatchEvent(new Event(type)), m.event);
    await expect.poll(() => ui(page, m.flag), { message: m.event }).toBe(true);
    await expect(page.locator(m.selector).first(), m.event).toBeVisible();
    await page.evaluate(async (setter) => {
      const { default: store } = await import('/src/store/canvasUIStore.js');
      store.getState()[setter](false);
    }, m.setter);
    await expect(page.locator(m.selector), `${m.event} closed`).toHaveCount(0, { timeout: 5_000 });
  }
});

// Since P2.06a the sync diagnostics live in SyncDebugHost.
test('F22b the debug overlay follows the Settings switch and fills with sync data', async ({ page }) => {
  await openFixture(page, 'small');
  const setOverlay = (on) => page.evaluate(async (v) => {
    const { default: debugConfig } = await import('/src/utils/debugConfig.js');
    debugConfig.setDebugOverlayEnabled(v);
  }, on);
  const overlay = page.locator('.debug-overlay');
  await expect(overlay).toHaveCount(0);
  await setOverlay(true);
  await expect(overlay).toBeVisible();
  // The 2 s refresh fills it with the engine/auth/universe snapshot.
  await expect(overlay).toContainText(/universe|engine|auth/i, { timeout: 6_000 });
  await setOverlay(false);
  await expect(overlay).toHaveCount(0);
});

// B-03: "Show Welcome Screen" (Help menu, Electron menu) fired an event nothing
// handled. It opens onboarding now, which is the welcome screen; closing it with
// a universe already loaded leaves that universe on the canvas.
test('F22c Show Welcome Screen opens onboarding, and closing it keeps the universe', async ({ page }) => {
  await openFixture(page, 'small');
  const nodes = page.locator('g.node');
  const before = await nodes.count();
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('openOnboardingModal')));
  await expect.poll(() => ui(page, 'showStorageSetupModal')).toBe(true);
  await expect(page.getByText('Welcome to Redstring')).toBeVisible();
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/canvasUIStore.js');
    store.getState().setShowStorageSetupModal(false);
  });
  await expect(page.getByText('Welcome to Redstring')).toHaveCount(0, { timeout: 5_000 });
  await expect(nodes).toHaveCount(before);
});
