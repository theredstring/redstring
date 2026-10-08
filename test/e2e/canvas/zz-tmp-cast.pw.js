import { test, openFixture, storeEval } from './helpers.js';
for (const via of ['row', 'header']) test(`cast ${via}`, async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openFixture(page, 'small');
  await storeEval(page, () => { window.useGraphStore.getState().setLeftPanelExpanded(true); });
  await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().openLeftPanelView('grid');
  });
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => { frames.push(f.data); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.waitForTimeout(300);
  const target = via === 'row'
    ? page.locator('.panel-content [data-graph-id]').nth(0)
    : page.locator('header, [class*=header]').getByText('Small Web B').first();
  const b = await target.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(20, b.height / 2));
  await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
  await page.waitForTimeout(1200);
  await cdp.send('Page.stopScreencast');
  const stats = await page.evaluate(async (frames) => {
    const out = [];
    for (const d of frames) {
      const img = new Image(); img.src = 'data:image/png;base64,' + d; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth;
      const p = x.getImageData(300 * sx, 100 * sx, 650 * sx, 600 * sx).data; let s = 0; for (let i = 0; i < p.length; i += 4) s += p[i] + p[i + 1] + p[i + 2];
      out.push(Math.round(s / (p.length / 4) / 3));
    }
    return out;
  }, frames);
  console.log(`CANVAS ${via}:`, stats.filter((v, i) => i === 0 || v !== stats[i - 1]).join(' '));
});
