import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Fixture-driven format regression suite (P0.1).
 *
 * Drop ANY real `.redstring` file into `test/fixtures/universes/` (subfolders ok)
 * and it automatically becomes a regression fixture — no code change required.
 * For each file we assert:
 *   1. it imports without throwing, then
 *   2. export → re-import is count-stable (prototypes / graphs / edges).
 *
 * Counts (not deep equality) are used on purpose: auto-enriched Wikipedia images
 * are intentionally NOT re-imported (redstringFormat.js OOM guard), so a
 * byte-for-byte round-trip would false-fail on enriched nodes. Structural counts
 * are the invariant that actually matters for "did migration lose anything".
 *
 * Passes vacuously when the folder is empty.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'universes');

const collectFixtures = () => {
  let entries;
  try {
    entries = readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.redstring'))
    .map((e) => join(e.parentPath || e.path || FIXTURES_DIR, e.name));
};

const counts = (storeState) => ({
  prototypes: storeState.nodePrototypes?.size ?? 0,
  graphs: storeState.graphs?.size ?? 0,
  edges: storeState.edges?.size ?? 0
});

describe('Fixture .redstring round-trip', () => {
  const fixtures = collectFixtures();

  if (fixtures.length === 0) {
    it('has no fixtures yet (vacuous pass — drop files into test/fixtures/universes/)', () => {
      expect(true).toBe(true);
    });
    return;
  }

  it.each(fixtures.map((f) => [relative(FIXTURES_DIR, f), f]))(
    'round-trips %s without losing entities',
    (_label, filePath) => {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));

      const firstImport = importFromRedstring(data, {});
      expect(firstImport?.storeState).toBeTruthy();

      const exported = exportToRedstring(firstImport.storeState);
      const secondImport = importFromRedstring(exported, {});

      expect(counts(secondImport.storeState)).toEqual(counts(firstImport.storeState));
    }
  );
});
