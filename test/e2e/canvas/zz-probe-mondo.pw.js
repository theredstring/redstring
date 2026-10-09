// TEMP probe: drag-zoom frame trace on the real 500MB universe.
import fs from 'node:fs';
import http from 'node:http';
import { test, nodeBox, centerOf, openFixture, NODE_LIFT_DELAY_MS } from './helpers.js';
const SP = '/private/tmp/claude-501/-Users-granteubanks-Code-redstringuireact/50d17acc-b9ab-4c45-8634-9f9607609fcf/scratchpad';
const FILE = '/Users/granteubanks/Documents/Redstring/Mondo Full.redstring';
test('probe mondo', async ({ page }) => {
  test.setTimeout(900_000);
  await openFixture(page, 'small');
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); fs.createReadStream(FILE).pipe(res); });
  await new Promise(r => srv.listen(4999, '127.0.0.1', r));
  await page.route('**/__mondo.bin', (route) => route.continue({ url: 'http://127.0.0.1:4999/m' }));
  await page.evaluate(async () => {
    const buf = new Uint8Array(await (await fetch('/__mondo.bin')).arrayBuffer());
    const { parseRedstringBytes } = await import('/src/formats/universeBytes.js');
    const obj = await parseRedstringBytes(buf);
    await window.__loadFixture(obj, { activeGraphId: 'largest', frame: true, thumbnails: 'placeholder' });
  });
  srv.close();
  await page.waitForTimeout(3000);
  const nearest = () => page.evaluate(() => {
    let best = null, bd = 1e9;
    for (const n of document.querySelectorAll('svg.canvas g.node[data-instance-id]')) {
      const r = n.querySelector('.node-background')?.getBoundingClientRect(); if (!r || !r.width) continue;
      const d = Math.hypot(r.x + r.width / 2 - 640, r.y + r.height / 2 - 400); if (d < bd) { bd = d; best = { id: n.getAttribute('data-instance-id'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    }
    return best;
  });
  const anchor = await nearest();
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down('Meta');
  for (let i = 0; i < 40; i++) {
    const z = await page.evaluate(() => Number(/scale\(([-\d.e]+)\)/.exec(document.querySelector('svg.canvas > g').getAttribute('transform'))[1]));
    if (z >= 0.6) break;
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('Meta');
  await page.waitForTimeout(3000);
  const dragId = (await nearest()).id;
  await page.evaluate(() => {
    const log = []; window.__probe = log; const t0 = performance.now();
    const g = document.querySelector('svg.canvas > g');
    const frame = (ts) => { log.push({ k: 'frame', t: ts - t0, tr: g.getAttribute('transform') }); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) log.push({ k: 'long', t: e.startTime - t0, d: e.duration }); }).observe({ type: 'longtask' });
  });
  const box = await nodeBox(page, dragId);
  const from = centerOf(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  await page.mouse.move(from.x + 3, from.y + 4);
  await page.waitForTimeout(2500);
  for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + 3 + i * 8, from.y + 4 + i * 6); }
  await page.mouse.up();
  await page.waitForTimeout(3000);
  fs.writeFileSync(`${SP}/probe-mondo.json`, JSON.stringify({ dragId, log: await page.evaluate(() => window.__probe) }, null, 1));
});
