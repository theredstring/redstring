// F43: Import Ontology, end to end in the app. The dialog reads the file in its
// worker, finds a root by search, imports the slice into the open universe, and
// opens the import's folder web. Importing the same slice again adds nothing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, openFixture, storeEval } from './helpers.js';

const ZOO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/ontology/zoo.owl');

async function importCat(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('openOntologyImport')));
  const dialog = page.locator('.rs-dialog-scrim');
  await expect(dialog.getByText('Import ontology')).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles(ZOO);
  await expect(dialog.getByText('Zoo Ontology')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(/16 terms/)).toBeVisible();

  await dialog.getByRole('textbox').fill('cat');
  await dialog.getByRole('radio', { name: /^cat/ }).first().click();
  const importButton = dialog.getByRole('button', { name: /^Import \d+ things$/ });
  await expect(importButton).toBeVisible();
  await importButton.click();
  await expect(dialog.getByText('Import complete')).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test('F43 an ontology slice imports into the open universe and opens its folder web', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await storeEval(page, (st) => st.nodePrototypes.size);

  const dialog = await importCat(page);
  await dialog.getByRole('button', { name: 'Open Zoo Ontology' }).click();
  await expect(dialog).toHaveCount(0);

  const after = await storeEval(page, (st) => {
    const active = st.graphs.get(st.activeGraphId);
    const names = [...active.instances.values()].map((i) => st.nodePrototypes.get(i.prototypeId)?.name);
    const cat = [...st.nodePrototypes.values()].find((p) => p.semanticMetadata?.ontology?.iri === 'http://example.org/zoo/Cat');
    // Every connection drawn from Cat, in any web: what the panel's Universe connections list.
    const catInstances = new Set();
    for (const g of st.graphs.values()) for (const i of g.instances.values()) if (i.prototypeId === cat?.id) catInstances.add(i.id);
    const fromCat = [...st.edges.values()].filter((e) => catInstances.has(e.sourceId)).map((e) => e.name).sort();
    return { size: st.nodePrototypes.size, activeName: active.name, names, catLinks: cat?.externalLinks, catWebs: cat?.definitionGraphIds?.length, fromCat };
  });
  expect(after.size).toBeGreaterThan(before);
  expect(after.activeName).toBe('Zoo Ontology');
  expect(after.names).toEqual(['Cat']);
  expect(after.catLinks).toEqual(['http://example.org/zoo/Cat']);
  // Its parts, its connections, and its kinds (Garfield, Kitten).
  expect(after.catWebs).toBe(3);
  expect(after.fromCat).toEqual(['Has Part', 'Has Part', 'Has Role']);
  await expect(page.locator('g.node').filter({ hasText: 'cat' }).first()).toBeVisible();
});

test('F43b importing the same slice again adds nothing', async ({ page }) => {
  await openFixture(page, 'small');
  const first = await importCat(page);
  await first.getByRole('button', { name: 'Done' }).click();
  const size = await storeEval(page, (st) => [st.nodePrototypes.size, st.graphs.size, st.edges.size]);

  const second = await importCat(page);
  await expect(second.getByText('Things added').locator('..')).toContainText('0');
  await second.getByRole('button', { name: 'Done' }).click();
  expect(await storeEval(page, (st) => [st.nodePrototypes.size, st.graphs.size, st.edges.size])).toEqual(size);
});

test('F43c the Universes panel\'s Load menu opens the same import', async ({ page }) => {
  await openFixture(page, 'small');
  await page.getByTitle('Expand Panel').first().click();
  await page.getByTitle('More views').first().click();
  await page.getByText('Universes', { exact: true }).first().click();
  await page.getByTitle('Load', { exact: true }).first().click();
  await page.getByText('Import Ontology...').click();
  await expect(page.locator('.rs-dialog-scrim').getByText('Import ontology')).toBeVisible();
});
