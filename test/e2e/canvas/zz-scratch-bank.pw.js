import { test } from './helpers.js';
test('scratch: the in-app fetch and build, in a real browser, against Wikidata', async ({ page }) => {
  test.setTimeout(900000);
  await page.goto('/');
  await page.waitForTimeout(1500);
  page.on('console', m => { if (m.text().startsWith('[bank]')) console.log(m.text()); });
  const out = await page.evaluate(async () => {
    const { fetchFormulaSnapshot } = await import('/src/components/canvas/formats/formula/bank/population/fetchWikidata.js');
    const { buildBank } = await import('/src/components/canvas/formats/formula/bank/population/buildBank.js');
    const t0 = performance.now();
    let last = '';
    const snap = await fetchFormulaSnapshot({
      onProgress: ({ stage, done, total }) => {
        if (stage !== last) { console.log(`[bank] ${Math.round((performance.now() - t0) / 1000)}s ${stage}`); last = stage; }
      },
    });
    const { report } = buildBank(snap);
    return { seconds: Math.round((performance.now() - t0) / 1000), items: Object.keys(snap.items).length, accepted: report.accepted, byDiscipline: report.byDiscipline };
  });
  console.log('[bank] result', JSON.stringify(out));
});
