// F46: a node's name fits the box it was sized for, and words only break when
// they have to.
//
// getNodeDimensions sizes a node from Pretext's canvas measurements; Node.jsx
// then lets the browser wrap the name inside that box. The two only agree when
// they measured the same font. The case that broke them: names measured before
// EmOne arrived kept the fallback font's (narrower) widths after it loaded, so
// "The Victoria Buchanan Message" got a two-line box and drew three lines, and
// "Submarine Communications Cable" got a box narrower than "Communications"
// and broke it mid-word. So the font is held back here, the way a cold start
// receives it, and every label is read from the real page afterwards.
//
// Two rules per label, in the page's own layout:
//   - the lines the browser drew are the lines the box was sized for;
//   - no word is split across lines unless it is wider than the widest text box
//     a node has (the barebones break-anywhere fallback for genuinely long words).
//
// Each text size also leaves a screenshot in .results/ to look at.
import { test, expect, storeEval, waitForCanvasReady, nextFrames } from './helpers.js';

const WEB = 'g-small-a';
const FONT_DELAY_MS = 2500;
const TEXT_SIZES = [1, 1.15, 1.3];

// Names near line-break edges at the sizes above, plus short and genuinely long ones.
const NAMES = [
  'The Victoria Buchanan Message',
  'Submarine Communications Cable',
  'Transatlantic Telegraph Cable',
  'International Telecommunication Union',
  'Hagen–Poiseuille Equation',
  'Bathymodiolin Mussel',
  'Electroencephalography Laboratory',
  'Hydrothermal Vent Community',
  'Continental Shelf Margin',
  'Mid-Atlantic Ridge',
  'Water Pressure',
  'Cat',
  'Pneumonoultramicroscopicsilicovolcanoconiosis',
  'Pneumonoultramicroscopicsilicovolcanoconiosis Study',
  'Deoxyribonucleic Acid',
  'Counterrevolutionaries',
];

const COLS = 3;
const COL_W = 700;
const ROW_H = 250;

test.use({ viewport: { width: 2400, height: 1700 } });

async function placeNames(page) {
  await storeEval(page, (st, [w, names, cols, colW, rowH]) => {
    for (const id of [...st.graphs.get(w).instances.keys()]) st.removeNodeInstance(w, id);
    names.forEach((name, i) => {
      const protoId = `lbl-proto-${i}`;
      st.addNodePrototype({ id: protoId, name, color: '#800000', definitionGraphIds: [] });
      const x = -350 + (i % cols) * colW;
      const y = -280 + Math.floor(i / cols) * rowH;
      st.addNodeInstance(w, protoId, { x, y }, `lbl-${i}`);
    });
  }, [WEB, NAMES, COLS, COL_W, ROW_H]);
}

/** Read every test label as the browser laid it out. */
function readLabels(page) {
  return page.evaluate(() => {
    const out = [];
    const measurer = document.createElement('span');
    document.body.appendChild(measurer);
    for (const g of document.querySelectorAll('svg.canvas g.node[data-instance-id^="lbl-"]')) {
      const span = g.querySelector('.node-name-text');
      const container = g.querySelector('.node-name-container');
      const bg = g.querySelector('.node-background');
      if (!span || !container || !bg) continue;
      const cs = getComputedStyle(container);
      const contentH = container.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const lineH = parseFloat(getComputedStyle(span).lineHeight);
      const fontPx = parseFloat(getComputedStyle(span).fontSize);
      const scale = fontPx / 45 / (window.useGraphStore.getState().textSettings.fontSize || 1);
      const k = window.useGraphStore.getState().textSettings.fontSize || 1;
      const ls = window.useGraphStore.getState().textSettings.lineSpacing || 1;
      const nodeH = parseFloat(bg.getAttribute('height'));
      const minH = 100 * 1.4 * scale;
      // getNodeDimensions budgets 45px per line (x size x spacing) plus 67px of padding.
      const plannedLines = nodeH <= minH + 0.5 ? 1 : Math.round((contentH + scale) / (45 * k * ls * scale));

      // Lines actually drawn: distinct line boxes across the label's text.
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      const texts = [];
      let full = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) { texts.push({ node: n, start: full.length }); full += n.data; }
      const locate = (offset) => {
        for (let i = texts.length - 1; i >= 0; i--) if (offset >= texts[i].start) return [texts[i].node, offset - texts[i].start];
        return [texts[0].node, 0];
      };
      const linesOf = (from, to) => {
        const r = document.createRange();
        r.setStart(...locate(from));
        r.setEnd(...locate(to));
        const tops = [];
        for (const rect of r.getClientRects()) {
          if (rect.width < 0.5) continue;
          if (!tops.some((t) => Math.abs(t - rect.top) < 2)) tops.push(rect.top);
        }
        return tops.length;
      };
      const drawnLines = full.length ? linesOf(0, full.length) : 0;

      // Words split across lines, and how wide each would be on its own.
      measurer.style.cssText = `position:absolute;left:-99999px;white-space:nowrap;font:${getComputedStyle(span).font}`;
      const maxBox = (420 * 1.4 - 2 * 30 * 1.4) * scale; // sEW - 2*sP
      const splitWords = [];
      for (const m of full.matchAll(/\S+/g)) {
        if (linesOf(m.index, m.index + m[0].length) > 1) {
          measurer.textContent = m[0];
          const width = measurer.getBoundingClientRect().width;
          splitWords.push({ word: m[0], width: Math.round(width * 10) / 10, mustBreak: width > maxBox });
        }
      }
      out.push({
        name: full,
        boxWidth: Math.round(parseFloat(span.style.maxWidth) * 10) / 10,
        plannedLines,
        drawnLines,
        overflows: span.offsetHeight > contentH + 0.5,
        needlessSplits: splitWords.filter((s) => !s.mustBreak),
        allowedSplits: splitWords.filter((s) => s.mustBreak).map((s) => s.word),
      });
    }
    measurer.remove();
    return out;
  });
}

test('F46 node names fit their boxes after the font arrives late, and break words only when they must', async ({ page }, testInfo) => {
  // Hold EmOne back so the first measurements happen against the fallback font.
  await page.route(/EmOne-SemiBold\.woff2?(\?.*)?$/, async (route) => {
    await new Promise((r) => setTimeout(r, FONT_DELAY_MS));
    await route.continue();
  });
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.goto('/?fixture=small');
  await page.waitForFunction(() => window.__fixture?.ready === true || !!window.__fixtureError, null, { timeout: 30_000 });

  // Placed while the font is still in flight.
  await placeNames(page);
  const fontLoadedAtPlacement = await page.evaluate(() => document.fonts.check("bold 45px 'EmOne'"));
  expect(fontLoadedAtPlacement, 'the font must still be loading when the names are first measured').toBe(false);

  await waitForCanvasReady(page);
  await page.evaluate(() => document.fonts.load("bold 45px 'EmOne'"));
  await expect.poll(() => page.evaluate(() => document.fonts.check("bold 45px 'EmOne'"))).toBe(true);

  const problems = [];
  for (const k of TEXT_SIZES) {
    await storeEval(page, (st, size) => st.setTextFontSize(size), k);
    await nextFrames(page, 4);
    await page.waitForTimeout(400); // the size transition
    await page.screenshot({ path: testInfo.outputPath(`labels-text-size-${k}.png`) });
    const labels = await readLabels(page);
    expect(labels.length).toBe(NAMES.length);
    for (const l of labels) {
      if (l.drawnLines !== l.plannedLines || l.overflows || l.needlessSplits.length) {
        problems.push({ textSize: k, ...l });
      }
    }
  }
  if (problems.length) console.log(JSON.stringify(problems, null, 1));
  expect(problems).toEqual([]);
});
