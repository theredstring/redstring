import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/Users/granteubanks/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const viewports = [['desktop', { width: 1280, height: 720 }], ['mobile', { width: 390, height: 760 }]];
const modes = ['connections', 'short', 'long', 'nodes', 'hover'];
for (const [name, viewport] of viewports) {
  for (const mode of modes) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}/dev-preview/index.html?mode=${mode}`);
    await page.waitForSelector('[data-harness-ready]', { timeout: 60000, state: 'attached' });
    await page.waitForTimeout(700);
    const clip = mode === 'hover'
      ? { x: 0, y: 0, width: viewport.width, height: 330 }
      : { x: 0, y: viewport.height - 240, width: viewport.width, height: 240 };
    await page.screenshot({ path: `${outDir}/${name}-${mode}.png`, clip });
    if (errors.length) console.log(`${name}-${mode} page errors:`, errors.join('\n'));
    await page.close();
  }
}
await browser.close();
console.log('done');
