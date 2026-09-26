// TEMP: screenshots for the Web Definitions section. Deleted before handing back.
import { readFileSync } from 'node:fs';
import { test, openFixture, storeEval, nextFrames, chambersPath, waitForCanvasReady } from './helpers.js';
test.use({ screenshot: 'off', trace: 'off', video: 'off' });
const OUT = process.env.SHOT_DIR;

test('shots', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openFixture(page, 'small');
  await page.evaluate((data) => window.__loadFixture(data, { label: 'chambers', activeGraphId: 'largest', frame: true }), readFileSync(chambersPath(), 'utf-8'));
  await waitForCanvasReady(page);
  const pick = await storeEval(page, (st) => {
    const rows = [];
    for (const p of st.nodePrototypes.values()) {
      const ids = p.definitionGraphIds || [];
      ids.forEach((gid, i) => {
        const g = st.graphs.get(gid);
        if (!g) return;
        rows.push({ id: p.id, name: p.name, i, n: ids.length, inst: g.instances?.size || 0, groups: g.groups?.size || 0, edges: g.edgeIds?.length || 0 });
      });
    }
    rows.sort((a, b) => (b.groups - a.groups) || (b.inst - a.inst));
    return rows.slice(0, 12);
  });
  console.log(JSON.stringify(pick, null, 0));
  const target = process.env.SHOT_PROTO || pick[0].id;
  await storeEval(page, (st, id) => { st.openRightPanelNodeTab(id); st.setRightPanelExpanded(true); }, target);
  await page.waitForTimeout(1200);
  await nextFrames(page, 3);
  const heading = page.getByText('Web Definitions', { exact: true }).first();
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/panel.png` });
});
