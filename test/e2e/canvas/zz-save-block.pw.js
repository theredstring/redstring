import { test, expect, openFixture } from './helpers.js';
test.setTimeout(300_000);
test('save blocking on mondo', async ({ page }) => {
  await openFixture(page, 'small');
  await page.evaluate(() => window.dispatchEvent(new Event('openOntologyImport')));
  const dialog = page.locator('.rs-dialog-scrim');
  await dialog.locator('input[type="file"]').setInputFiles('/Users/granteubanks/Downloads/mondo-simple.owl');
  const importButton = dialog.getByRole('button', { name: /^Import [\d,]+ things$/ });
  await expect(importButton).toBeVisible({ timeout: 120_000 });
  await importButton.click();
  await expect(dialog.getByText('Import complete')).toBeVisible({ timeout: 240_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(3000);

  await page.evaluate(async () => {
    const { saveCoordinator: sc } = await import('/src/backend/sync/index.js');
    window.__writes = [];
    sc.initialize({
      saveToFile: async (state, show, opts = {}) => {
        const t = performance.now();
        const payload = opts.serializedData;
        // Stand-in for Electron's IPC, which structured-clones what it sends.
        if (payload) structuredClone(payload);
        window.__writes.push({ cloneMs: Math.round(performance.now() - t), kind: payload == null ? 'none' : (typeof payload === 'string' ? 'string' : payload.constructor.name), size: payload?.length ?? payload?.byteLength });
        return { success: true };
      },
    }, null);
    sc.hasLoadedFromFile = true;
    sc.lastSaveHash = 'baseline';
    window.__long = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  for (let round = 0; round < 2; round++) {
    await page.evaluate((r) => {
      window.__long.length = 0;
      const st = window.useGraphStore.getState();
      const id = [...st.nodePrototypes.keys()][100 + r];
      st.updateNodePrototype(id, (d) => { d.name = d.name + ' edited'; });
    }, round);
    await page.waitForTimeout(16000);
    const r = await page.evaluate(async () => {
      const { saveCoordinator: sc } = await import('/src/backend/sync/index.js');
      return { long: [...window.__long].sort((a, b) => b - a), writes: window.__writes.slice(-1),
        sc: { enabled: sc.isEnabled, worker: !!sc.saveWorker, dirty: sc.isDirty, saving: sc.isSaving, pendingHash: sc.pendingHash, lastWorkerMs: sc.lastWorkerMs, block: sc.lastBlockReason, drag: sc.isGlobalDragging, loaded: sc.hasLoadedFromFile, err: sc.lastError } };
    });
    console.log('SC', JSON.stringify(r.sc));
    console.log(`ROUND ${round} longtasks(ms):`, JSON.stringify(r.long.slice(0, 10)), 'total', r.long.reduce((a, b) => a + b, 0), 'write', JSON.stringify(r.writes));
  }
});
