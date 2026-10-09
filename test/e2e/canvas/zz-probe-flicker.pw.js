// TEMP probe: per-frame camera + reference-node trace across a drag-zoom lift.
import fs from 'node:fs';
import { test, openFixture, nodeBox, centerOf, NODE_LIFT_DELAY_MS, waitForCameraSettled } from './helpers.js';

for (const fixture of ['small', 'stress']) {
test(`probe ${fixture}`, async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, fixture);
  const ids = await page.evaluate(() => [...document.querySelectorAll('svg.canvas g.node[data-instance-id]')].map(n => n.getAttribute('data-instance-id')));
  const dragId = await page.evaluate(() => {
    let best = null, bd = 1e9;
    for (const n of document.querySelectorAll('svg.canvas g.node[data-instance-id]')) {
      const r = n.querySelector('.node-background')?.getBoundingClientRect(); if (!r || !r.width) continue;
      const d = Math.hypot(r.x + r.width / 2 - 640, r.y + r.height / 2 - 400); if (d < bd) { bd = d; best = n.getAttribute('data-instance-id'); }
    }
    return best;
  });
  const refId = ids.find(i => i !== dragId);
  await page.evaluate(({ refId }) => {
    const log = [];
    window.__probe = log;
    const g = document.querySelector('svg.canvas > g');
    const t0 = performance.now();
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.target === g || r.target.matches?.('svg.canvas')) log.push({ k: 'mut', t: performance.now() - t0, el: r.target === g ? 'content' : 'svg', attr: r.attributeName, v: r.target.getAttribute(r.attributeName) });
      }
    });
    mo.observe(document.querySelector('svg.canvas'), { attributes: true, subtree: false });
    mo.observe(g, { attributes: true });
    const frame = (ts) => {
      // sample after all other rAF callbacks of this frame via a nested microtask chain at end
      queueMicrotask(() => {});
      const ref = document.querySelector(`svg.canvas g.node[data-instance-id="${refId}"] .node-background`);
      const r = ref?.getBoundingClientRect();
      log.push({ k: 'frame', t: ts - t0, now: performance.now() - t0, tr: g.getAttribute('transform'), ref: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width)] : null });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // post-paint sampler
    const mc = new MessageChannel();
    mc.port1.onmessage = () => {
      const ref = document.querySelector(`svg.canvas g.node[data-instance-id="${refId}"] .node-background`);
      const r = ref?.getBoundingClientRect();
      log.push({ k: 'post', t: performance.now() - t0, tr: g.getAttribute('transform'), ref: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width)] : null });
    };
    const late = () => { requestAnimationFrame(() => { mc.port2.postMessage(0); late(); }); };
    late();
  }, { refId });

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const SP = '/private/tmp/claude-501/-Users-granteubanks-Code-redstringuireact/50d17acc-b9ab-4c45-8634-9f9607609fcf/scratchpad';
  fs.mkdirSync(`${SP}/frames-${fixture}`, { recursive: true });
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.waitForTimeout(300);
  const box = await nodeBox(page, dragId);
  const from = centerOf(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  await page.mouse.move(from.x + 3, from.y + 4);
  await page.waitForTimeout(500);
  for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + 3 + i * 8, from.y + 4 + i * 6); }
  await page.mouse.up();
  await page.waitForTimeout(600);
  await cdp.send('Page.stopScreencast');
  frames.forEach((f, i) => fs.writeFileSync(`${SP}/frames-${fixture}/${String(i).padStart(4, '0')}-${f.ts.toFixed(3)}.png`, Buffer.from(f.data, 'base64')));
  const log = await page.evaluate(() => window.__probe);
  fs.writeFileSync(`/private/tmp/claude-501/-Users-granteubanks-Code-redstringuireact/50d17acc-b9ab-4c45-8634-9f9607609fcf/scratchpad/probe-${fixture}.json`, JSON.stringify({ dragId, refId, log }, null, 1));
});
}
