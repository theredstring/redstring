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
