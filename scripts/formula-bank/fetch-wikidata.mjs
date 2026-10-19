#!/usr/bin/env node
/**
 * Fetch the formula bank's source from Wikidata into a snapshot file, for
 * build-bank.mjs. The fetching itself is shared with the app (Settings → Data
 * → Formula Bank): src/components/canvas/formats/formula/bank/population/fetchWikidata.js.
 *
 *   node scripts/formula-bank/fetch-wikidata.mjs [--out <file>] [--fresh]
 *
 * Classes the existing snapshot already traced to a discipline keep their
 * trace unless --fresh.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFormulaSnapshot } from '../../src/components/canvas/formats/formula/bank/population/fetchWikidata.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : `${HERE}/wikidata-snapshot.json`);
const previous = !process.argv.includes('--fresh') && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

let lastStage = null;
const snapshot = await fetchFormulaSnapshot({
  headers: { 'User-Agent': 'RedstringFormulaBank/0.1 (https://github.com/theredstring/redstring)' },
  previous,
  onProgress: ({ stage, done, total }) => {
    if (stage !== lastStage) { if (lastStage) process.stdout.write('\n'); lastStage = stage; }
    process.stdout.write(`\r${stage}${total ? ` ${done}/${total}` : '…'}`);
  },
});
process.stdout.write('\n');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(`Wrote ${Object.keys(snapshot.items).length} items, ${Object.keys(snapshot.concepts).length} concepts, ${Object.keys(snapshot.classes).length} classes to ${OUT}`);
