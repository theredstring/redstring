import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
await page.goto('http://localhost:4001/?fixture=small', { waitUntil: 'load' });
await page.waitForTimeout(7000);
const m = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type==='mouseMoved'?'none':'left', clickCount: 1, buttons }).catch(()=>{});
const sleep = (t) => new Promise(r=>setTimeout(r,t));
await m('mousePressed', 25, 75, 1); await sleep(90); await m('mouseReleased', 25, 75, 0); await sleep(1500);
await page.evaluate(() => { for (const t of ['touchstart','touchmove','touchend','touchcancel','pointercancel','click']) document.addEventListener(t, e => console.log('EV', t, e.defaultPrevented), true);
  for (const t of ['touchmove','touchend']) window.addEventListener(t, e => console.log('EVB', t, e.defaultPrevented), false); });
page.on('console', mm => { if (mm.text().startsWith('EV')) console.log('  ', mm.text()); });
for (const [hold, jitter] of [[90,0],[150,2],[250,4],[400,1]]) {
  const x = 225, y = 75;
  m('mousePressed', x, y, 1);
  for (let i=1;i<=3;i++){ await sleep(hold/4); if (jitter) m('mouseMoved', x+jitter*(i%2?1:-1), y+jitter, 1); }
  await sleep(hold/4);
  m('mouseReleased', x+jitter, y, 0);
  await sleep(1000);
  console.log('hold', hold, 'jitter', jitter, 'items', await page.locator('.context-menu-item').count());
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.context-menu-backdrop')?.click());
  await sleep(500);
  console.log('   after close items', await page.locator('.context-menu-item').count());
}
await browser.close();
