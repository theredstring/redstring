#!/usr/bin/env node
// Undefined-names gate for src/ (NodeCanvas refactor P0.06).
//
//   npm run lint:undef              # gate
//   npm run lint:undef -- --prune   # same, and drop baseline entries that are gone
//
// `npm run lint` reports thousands of errors today (mostly prop-types and unused
// vars), so CI can't gate on it. The class that matters most while NodeCanvas is
// being cut up is no-undef: a deleted variable that something still references
// is a ReferenceError the first time that path runs, and the build does not
// catch it. This runs ESLint with only no-undef over src/ (tests excluded) and
// compares against test/known-undefined-names.json:
//
//   - FAILS on any undefined name in a file that the baseline doesn't list, or
//     on more occurrences of a listed name in a file than the baseline allows;
//   - FAILS on baseline entries that no longer occur (fixed or moved), so the
//     list only shrinks. `--prune` trims them.
//
// Counts are per file + name rather than per line, so unrelated edits that
// shift line numbers don't trip the gate.
//
// Never add an entry to get a red build green. Each entry is a latent crash.

import { ESLint } from 'eslint';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BASELINE = path.join(ROOT, 'test', 'known-undefined-names.json');
const PATTERNS = ['src/**/*.{js,jsx}'];
const IGNORE = ['src/**/*.test.{js,jsx}', 'src/**/__tests__/**', 'src/test-utils/**'];

const keyOf = (file, name) => `${file}\u0000${name}`;
const nameOf = (message) => (/'([^']+)'/.exec(message) || [])[1] || message;

/** { "file\0name": count } from ESLint results. */
export function countUndefined(results, root = ROOT) {
  const counts = new Map();
  for (const r of results) {
    const file = path.relative(root, r.filePath).split(path.sep).join('/');
    for (const m of r.messages) {
      if (m.ruleId !== 'no-undef') continue;
      const k = keyOf(file, nameOf(m.message));
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return counts;
}

/** Compare current counts with the baseline entries [{ file, name, count }]. */
export function compareToBaseline(counts, baseline) {
  const allowed = new Map(baseline.map((b) => [keyOf(b.file, b.name), b.count]));
  const added = [];
  const stale = [];
  for (const [k, n] of counts) {
    const limit = allowed.get(k) || 0;
    if (n > limit) {
      const [file, name] = k.split('\u0000');
      added.push({ file, name, count: n, allowed: limit });
    }
  }
  for (const b of baseline) {
    const n = counts.get(keyOf(b.file, b.name)) || 0;
    if (n < b.count) stale.push({ ...b, now: n });
  }
  return { added, stale };
}

export const sortEntries = (entries) => [...entries].sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

async function main() {
  const prune = process.argv.includes('--prune');
  const data = JSON.parse(fs.readFileSync(DEFAULT_BASELINE, 'utf8'));
  const eslint = new ESLint({
    cwd: ROOT,
    ignorePatterns: IGNORE,
    ruleFilter: ({ ruleId }) => ruleId === 'no-undef',
  });
  const results = await eslint.lintFiles(PATTERNS);
  // A file that doesn't parse gets no no-undef check at all, so a new one fails
  // the gate. The baseline's `unparseable` lists the ones that already don't
  // (dead files nothing imports; see FINDINGS X-09).
  const knownUnparseable = new Set(data.unparseable || []);
  const parseErrors = results.flatMap((r) => r.messages.filter((m) => m.fatal)
    .map((m) => ({ file: path.relative(ROOT, r.filePath).split(path.sep).join('/'), line: m.line, message: m.message })))
    .filter((e) => !knownUnparseable.has(e.file))
    .map((e) => `${e.file}:${e.line} ${e.message}`);
  const counts = countUndefined(results);
  const { added, stale } = compareToBaseline(counts, data.entries);
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  let failed = false;

  console.log(`[undefined-names] ${results.length} files, ${total} undefined-name uses (baseline ${data.entries.reduce((s, e) => s + e.count, 0)}).`);

  if (parseErrors.length) {
    failed = true;
    console.error(`[undefined-names] FAIL: ${parseErrors.length} file(s) failed to parse:`);
    for (const e of parseErrors) console.error(`  ✗ ${e}`);
  }
  if (added.length) {
    failed = true;
    console.error(`[undefined-names] FAIL: ${added.length} new undefined name(s). Each is a ReferenceError waiting to happen:`);
    for (const a of added) console.error(`  ✗ ${a.file}: '${a.name}' used ${a.count}x (baseline allows ${a.allowed})`);
    console.error(`  Run \`npx eslint ${added[0].file}\` for line numbers.`);
  }
  if (stale.length) {
    if (prune) {
      const byKey = new Map(stale.map((s) => [keyOf(s.file, s.name), s.now]));
      data.entries = sortEntries(data.entries
        .map((e) => (byKey.has(keyOf(e.file, e.name)) ? { ...e, count: byKey.get(keyOf(e.file, e.name)) } : e))
        .filter((e) => e.count > 0));
      fs.writeFileSync(DEFAULT_BASELINE, JSON.stringify(data, null, 2) + '\n');
      console.log(`[undefined-names] Pruned ${stale.length} entr${stale.length === 1 ? 'y' : 'ies'}. Commit the trimmed baseline with the fix.`);
    } else {
      failed = true;
      console.error(`[undefined-names] FAIL: ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} fixed. Trim test/known-undefined-names.json (npm run lint:undef -- --prune):`);
      for (const s of stale) console.error(`  ✓ ${s.file}: '${s.name}' ${s.count} → ${s.now}`);
    }
  }
  if (!failed) console.log('[undefined-names] PASS: no new undefined names.');
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(`[undefined-names] ${err.stack || err}`); process.exitCode = 1; },
  );
}
