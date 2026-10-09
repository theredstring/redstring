// Temporary probe: Settings → Data and History → Backups. Deleted after use.
import { test, expect, openFixture } from './helpers.js';

const SHOTS = process.env.PROBE_SHOTS;

test('probe data settings and backups tab', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await openFixture(page, 'small');
  await page.evaluate(() => {
    localStorage.setItem('redstring_semantic_discovery_history', JSON.stringify([{ id: 'a', query: 'x' }, { id: 'b', query: 'y' }]));
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'data' } })));
  await page.evaluate(() => window.dispatchEvent(new Event('openSettingsModal')));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'data' } })));
  await expect(page.getByText('Keep Backups')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/data-settings.png` });

  // Two-step confirm on Discovery History.
  const clear = page.locator('.settings-row', { hasText: 'Discovery History' }).getByText('Clear', { exact: true });
  await clear.click();
  await expect(page.locator('.settings-row', { hasText: 'Discovery History' }).getByText('Clear all?')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/data-confirm.png` });
  await page.locator('.settings-row', { hasText: 'Discovery History' }).getByText('Clear all?').click();
  await expect(page.locator('.settings-row', { hasText: 'Discovery History' }).getByText('Cleared')).toBeVisible();

  // Repair reports.
  await page.locator('.settings-row', { hasText: 'Repair Web Links' }).getByText('Repair', { exact: true }).click();
  await expect(page.locator('.settings-row', { hasText: 'Repair Web Links' })).toContainText(/Nothing needed repair|Repaired/);

  // Restore a Backup → History, Backups tab.
  await page.locator('.settings-row', { hasText: 'Restore a Backup' }).getByText('Open', { exact: true }).click();
  await expect(page.locator('.filter-tab.active', { hasText: 'Backups' })).toBeVisible();
  await page.waitForTimeout(1500);
  console.log('SCROLL:', JSON.stringify(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, bx: document.body.scrollLeft, dx: document.documentElement.scrollLeft, root: document.getElementById('root')?.scrollLeft }))));
  await page.screenshot({ path: `${SHOTS}/history-backups.png` });

  console.log('ERRORS:', JSON.stringify(errors));
});
