import { readFileSync } from 'node:fs';
import { test, openFixture, waitForCanvasReady } from './helpers.js';
const FILE = '/Users/granteubanks/Documents/Redstring/Redstring Graphics.redstring';
const OUT = process.env.SHOT_DIR;
test.use({ screenshot: 'off', trace: 'off', video: 'off' });
test.setTimeout(120_000);
const WEBS = { ocean: 'graph-1795117043543-0wpnqs', silk: 'graph-1795117792045-mjqqvj', ember: 'graph-1795117358622-ygqka5' };
const SIZES = JSON.parse(process.env.SIZES || '{"iphone":[440,956,3],"ipad":[1032,1376,2],"banner":[1024,620,2]}');
const PADS = { iphone: { top: 120, bottom: 100, side: 18 }, ipad: { top: 110, bottom: 100, side: 80 }, banner: { top: 26, bottom: 26, side: 34 }, play: { top: 110, bottom: 95, side: 16 } };

let images = null;
async function loadImages() {
  if (images) return images;
  const { readFileSync: rf } = await import('node:fs');
  images = {};
  const map = rf(process.env.THUMBS + '/map.tsv', 'utf-8').trim().split('\n');
  for (const line of map) { const [url, file] = line.split('\t'); images[url] = 'data:image/jpeg;base64,' + rf(file).toString('base64'); }
  return images;
}

const window_h = (clip) => 620 - (clip.y + clip.height) + 26;
async function frameDrawn(page, id, pad) {
  for (let pass = 0; pass < 6; pass++) {
    const plan = await page.evaluate(({ pad }) => {
      const g = document.querySelector('svg.canvas > g');
      const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)\s*scale\(([-\d.e]+)/.exec(g.getAttribute('transform'));
      const pan = { x: +m[1], y: +m[2] }; const zoom = +m[3];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of document.querySelectorAll('svg.canvas g.node, svg.canvas .node-group-bg, svg.canvas .node-group-title')) {
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      }
      const W = window.innerWidth, H = window.innerHeight;
      const tx0 = pad.side, tx1 = W - pad.side, ty0 = pad.top, ty1 = H - pad.bottom;
      let s = Math.min((tx1 - tx0) / (x1 - x0), (ty1 - ty0) / (y1 - y0));
      const svg = document.querySelector('svg.canvas').getBoundingClientRect();
      const cs = { x: (x0 + x1) / 2 - svg.left, y: (y0 + y1) / 2 - svg.top };
      const ct = { x: (tx0 + tx1) / 2 - svg.left, y: (ty0 + ty1) / 2 - svg.top };
      const need = zoom * s;
      s = Math.max(s, 0.2 / zoom);
      return { need, s, pan: { x: ct.x - (cs.x - pan.x) * s, y: ct.y - (cs.y - pan.y) * s }, zoom: zoom * s };
    }, { pad });
    const before = await page.evaluate(() => document.querySelector('svg.canvas > g').getAttribute('transform'));
    console.log('PASS', pass, JSON.stringify(plan), before, JSON.stringify(await page.evaluate(() => { const s = document.querySelector('svg.canvas').getBoundingClientRect(); return [s.left, s.top, s.width]; })));
    if (plan.need < 0.24 && pass < 3) {
      // Too spread out to fit at a readable zoom: draw the Things closer
      // together around their middle (sandbox only, never saved).
      const f = Math.max(0.4, plan.need / 0.3);
      await page.evaluate(({ id, f }) => {
        const st = window.useGraphStore.getState();
        const inst = [...st.graphs.get(id).instances.values()];
        const cx = inst.reduce((a, i) => a + i.x, 0) / inst.length;
        const cy = inst.reduce((a, i) => a + i.y, 0) / inst.length;
        st.updateMultipleNodeInstancePositions(id, inst.map((i) => ({ instanceId: i.id, x: cx + (i.x - cx) * f, y: cy + (i.y - cy) * f })), { finalize: true });
      }, { id, f });
      await page.waitForTimeout(800);
      continue;
    }
    if (Math.abs(plan.s - 1) < 0.01) return;
    await page.evaluate((id) => { const st = window.useGraphStore.getState(); st.setActiveGraph(st.openGraphIds.find((x) => x !== id)); }, id);
    await page.waitForTimeout(500);
    await page.evaluate(({ id, plan }) => { const st = window.useGraphStore.getState(); st.updateGraphView(id, plan.pan, plan.zoom); st.setActiveGraph(id); }, { id, plan });
    await page.waitForTimeout(900);
  }
}

for (const [size, [w, h, dsf]] of Object.entries(SIZES)) {
  test.describe(size, () => {
    test.use({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: size !== 'banner', isMobile: size === 'iphone' || size === 'play' });
    for (const [key, id] of Object.entries(WEBS)) {
      if (size === 'banner' && key !== (process.env.BANNER || 'ocean')) continue;
      test(`${size} ${key}`, async ({ page }) => {
        const text = readFileSync(FILE, 'utf-8');
        const imgs = await loadImages();
        console.log('IMAGES', Object.keys(imgs).length);
        await openFixture(page, 'small');
        await page.evaluate(({ data, id }) => window.__loadFixture(data, { label: 'graphics', activeGraphId: id, thumbnails: 'placeholder' }), { data: text, id });
        await page.evaluate((imgs) => {
          const st = window.useGraphStore.getState();
          const cache = window.__imageCache.getState();
          for (const [pid, p] of st.nodePrototypes) {
            const url = p?.semanticMetadata?.wikipediaThumbnail;
            if (url && imgs[url]) cache.setImage(pid, { thumbnailSrc: imgs[url], imageAspectRatio: p.semanticMetadata.imageAspectRatio || 1 });
          }
        }, imgs);
        await waitForCanvasReady(page);
        await page.waitForTimeout(1200);
        let clip = null;
        if (size === 'banner') {
          await page.addStyleTag({ content: 'header, .zoom-bar, footer.type-list-bar, .type-list-toggle-button { visibility: hidden !important; }' });
          clip = await page.evaluate(() => {
            const hide = (el) => { if (el) el.style.visibility = 'hidden'; };
            for (const [x, y] of [[30, 80], [994, 80]]) { const el = document.elementFromPoint(x, y); hide(el?.closest('svg')?.parentElement); }
            for (const el of document.querySelectorAll('body *')) if (el.children.length === 0 && /^(Saved|Saving…|Syncing…)$/.test(el.textContent.trim())) hide(el);
            const a = document.querySelector('.canvas-area').getBoundingClientRect();
            const top = Math.round(a.top + (Math.min(a.bottom, window.innerHeight) - a.top - 500) / 2);
            return { x: 0, y: top, width: 1024, height: 500 };
          });
          await frameDrawn(page, id, { top: clip.y + 26, bottom: window_h(clip), side: 34 });
        } else {
          await frameDrawn(page, id, PADS[size]);
        }
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${size}-${key}.png`, ...(clip && { clip }) });
      });
    }
  });
}
