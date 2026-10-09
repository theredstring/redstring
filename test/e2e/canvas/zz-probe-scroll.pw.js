// Temporary probe: what scrolls the body sideways. Deleted after use.
import { test, openFixture } from './helpers.js';
const scroll = (page) => page.evaluate(() => document.body.scrollLeft);
const SHOTS = process.env.PROBE_SHOTS;

for (const variant of ['git-event-only', 'backups-event-only', 'settings-open-button']) {
  test(`scroll ${variant}`, async ({ page }) => {
    await openFixture(page, 'small');
    const before = await scroll(page);
    if (variant === 'settings-open-button') {
      await page.evaluate(() => window.dispatchEvent(new Event('openSettingsModal')));
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'data' } })));
      await page.locator('.settings-row', { hasText: 'Restore a Backup' }).getByText('Open', { exact: true }).click();
    } else {
      await page.evaluate((tab) => {
        window.__store?.getState?.();
        window.dispatchEvent(new CustomEvent('redstring:open-git-history', { detail: { tab } }));
      }, variant.startsWith('git') ? 'git' : 'backups');
      await page.evaluate(() => {});
    }
    await page.waitForTimeout(300);
    const mid = await scroll(page);
    await page.waitForTimeout(1500);
    console.log(variant, JSON.stringify({ before, mid, after: await scroll(page) }));
    await page.screenshot({ path: `${SHOTS}/scroll-${variant}.png` });
  });
}
