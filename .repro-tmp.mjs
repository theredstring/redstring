import { chromium } from 'playwright';
const browser = await chromium.launch();
for (const vw of [390, 1100]) {
const ctx = await browser.newContext({ viewport: { width: vw, height: 844 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
await page.goto('http://localhost:4001/', { waitUntil: 'load' });
await page.addInitScript(() => {});
await page.waitForTimeout(6000);
const c = await page.getByText('Continue without linking').boundingBox();
await page.mouse.click(c.x+c.width/2, c.y+c.height/2);
await page.waitForTimeout(2500);
if (vw > 500) {
  // shrink left panel via localStorage then reload
  await page.evaluate(() => localStorage.setItem('panelWidth_left', '180'));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(6000);
}
await page.evaluate(() => {
  for (const t of ['touchstart','touchend','pointerdown','pointerup','mousedown','mouseup','click','contextmenu'])
    document.addEventListener(t, e => console.log('EV', t, e.target?.tagName, e.defaultPrevented, performance.now().toFixed(0)), true);
  for (const t of ['touchend','click','pointerup'])
    window.addEventListener(t, e => console.log('EVBUBBLE', t, e.defaultPrevented), false);
});
page.on('console', m => { if (m.text().startsWith('EV')) console.log('  ', m.text()); });
const more = page.locator('.panel-left-tab-strip > [title="More views"]');
const box = await more.boundingBox();
console.log('vw', vw, 'box', JSON.stringify(box));
if (!box) { await ctx.close(); continue; }
await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
await page.waitForTimeout(800);
console.log('vw', vw, 'menu items', await page.locator('.context-menu-item').count());
await page.screenshot({ path: '/private/tmp/claude-501/-Users-granteubanks-Code-redstringuireact/3369561c-9e61-4336-aab1-f57026c3a45d/scratchpad/cdp'+vw+'.png' });
await ctx.close();
}
await browser.close();
