#!/usr/bin/env node
// Known-failures gate for the vitest suite (NodeCanvas refactor P0.06).
//
//   npm run test:ci                   # run the whole suite, then gate it
//   npm run test:ci -- --prune        # same, and drop list entries that now pass
//   node scripts/check-known-failures.mjs --report r.json   # gate an existing report
//
// The suite has had failing tests for months (FINDINGS F-62, F-69), so "vitest
// exits 0" can't be the bar. Instead, every test that is failing today is listed
// by file + full name in test/known-failures.json, and this gate:
//
//   - FAILS on any failure that is not on the list (a new failure);
//   - FAILS on any list entry that no longer fails (it passes now, or it was
//     renamed or deleted). A stale entry would silently cover that test if it
//     broke again, so the list must only ever shrink, in the same commit as the
//     fix. `--prune` removes those entries for you. It never adds any;
//   - FAILS if vitest reports unhandled errors, or if the run produced no
//     report at all (a crash).
//
// A whole file that fails to run (an import or mock error, an error in a hook
// outside any test) has no test to name, so it is listed under the name
// FILE_LEVEL below.
//
// Never add an entry to the list to get a red build green. The list exists so
// CI can gate on *new* failures while the old ones are fixed, one by one.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_LIST = path.join(ROOT, 'test', 'known-failures.json');
export const FILE_LEVEL = '(whole file failed to run)';

const keyOf = (file, name) => `${file}\u0000${name}`;
const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 300) ?? '';

/** Report paths are absolute; the list stores repo-relative POSIX paths. */
export function toRelative(file, root = ROOT) {
  const rel = path.isAbsolute(file) ? path.relative(root, file) : file;
  return rel.split(path.sep).join('/');
}

/**
 * Failures and passes in a vitest JSON report, keyed by file + full name.
 * A file counts as failing at the file level when vitest attached an error to
 * the file itself, or marked it failed with no failing test inside it.
 */
export function collectResults(report, root = ROOT) {
  const failures = [];
  const passed = new Set();
  for (const file of report?.testResults ?? []) {
    const rel = toRelative(file.name, root);
    const tests = file.assertionResults ?? [];
    const failed = tests.filter((t) => t.status === 'failed');
    for (const t of tests) if (t.status === 'passed') passed.add(keyOf(rel, t.fullName));
    for (const t of failed) {
      failures.push({ file: rel, name: t.fullName, message: firstLine(t.failureMessages?.[0]) });
    }
    if (file.status === 'failed' && (file.message || failed.length === 0)) {
      failures.push({ file: rel, name: FILE_LEVEL, message: firstLine(file.message) });
    }
  }
  return { failures, passed };
}

/** Compare a report against the known list. Pure; the CLI below is the only I/O. */
export function compareToKnown(report, known, root = ROOT) {
  const { failures, passed } = collectResults(report, root);
  const knownKeys = new Set(known.map((k) => keyOf(k.file, k.name)));
  const failingKeys = new Set(failures.map((f) => keyOf(f.file, f.name)));
  return {
    total: report?.numTotalTests ?? 0,
    failing: failures.length,
    newFailures: failures.filter((f) => !knownKeys.has(keyOf(f.file, f.name))),
    stillKnown: known.filter((k) => failingKeys.has(keyOf(k.file, k.name))),
    stale: known
      .filter((k) => !failingKeys.has(keyOf(k.file, k.name)))
      .map((k) => ({ ...k, nowPasses: passed.has(keyOf(k.file, k.name)) })),
  };
}

export function readList(listPath = DEFAULT_LIST) {
  const data = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  if (!Array.isArray(data.failures)) throw new Error(`${listPath}: "failures" must be an array`);
  for (const f of data.failures) {
    if (typeof f.file !== 'string' || typeof f.name !== 'string') {
      throw new Error(`${listPath}: every entry needs a string "file" and "name": ${JSON.stringify(f)}`);
    }
  }
  return data;
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
}

/** `Vitest caught N unhandled error(s)` — these fail a run but aren't in the JSON report. */
export function countUnhandledErrors(output) {
  // eslint-disable-next-line no-control-regex
  const plain = String(output).replace(/\u001b\[[0-9;]*m/g, '');
  const m = plain.match(/Vitest caught (\d+) unhandled error/);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { list: DEFAULT_LIST, report: null, out: null, prune: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prune') args.prune = true;
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--list') args.list = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a} (see --help)`);
  }
  return args;
}

function runVitest(outFile) {
  const vitestBin = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  const argv = [vitestBin, 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${outFile}`];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, output }));
  });
}

const inActions = !!process.env.GITHUB_ACTIONS;
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
function annotate(level, file, title, message) {
  if (!inActions) return;
  const fileProp = file ? `file=${escapeProp(file)},` : '';
  console.log(`::${level} ${fileProp}title=${escapeProp(title)}::${escapeData(message)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/check-known-failures.mjs [--prune] [--report <json>] [--out <json>] [--list <json>]');
    return 0;
  }

  const listRel = toRelative(path.resolve(args.list)).startsWith('..') ? args.list : toRelative(path.resolve(args.list));
  const listData = readList(args.list);
  let reportPath = args.report;
  let unhandled = 0;

  if (!reportPath) {
    reportPath = args.out || path.join(os.tmpdir(), `vitest-known-failures-${process.pid}.json`);
    fs.rmSync(reportPath, { force: true });
    const { code, signal, output } = await runVitest(reportPath);
    unhandled = countUnhandledErrors(output);
    console.log(`\n[known-failures] vitest exited with ${signal ?? code}; report: ${reportPath}`);
  }

  if (!fs.existsSync(reportPath)) {
    console.error(`[known-failures] FAIL: no report at ${reportPath}. vitest crashed before writing it.`);
    annotate('error', null, 'vitest produced no report', 'The run crashed before writing its JSON report.');
    return 1;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const result = compareToKnown(report, listData.failures);
  let failed = false;

  console.log(
    `\n[known-failures] ${result.total} tests, ${result.failing} failing: ` +
    `${result.stillKnown.length} known, ${result.newFailures.length} new. ` +
    `${result.stale.length} of ${listData.failures.length} list entries no longer fail.`,
  );

  if (result.newFailures.length) {
    failed = true;
    console.error(`\n[known-failures] FAIL: ${result.newFailures.length} new failure(s), not in ${listRel}:`);
    for (const f of result.newFailures) {
      console.error(`  ✗ ${f.file} › ${f.name}${f.message ? `\n      ${f.message}` : ''}`);
      annotate('error', f.file, 'New test failure', `${f.name}${f.message ? `\n${f.message}` : ''}`);
    }
    console.error('  Fix these. Do not add them to the list to make CI pass.');
  }

  if (result.stale.length) {
    if (args.prune) {
      const staleKeys = new Set(result.stale.map((s) => keyOf(s.file, s.name)));
      listData.failures = sortEntries(listData.failures.filter((k) => !staleKeys.has(keyOf(k.file, k.name))));
      fs.writeFileSync(args.list, JSON.stringify(listData, null, 2) + '\n');
      console.log(`\n[known-failures] Pruned ${result.stale.length} entr${result.stale.length === 1 ? 'y' : 'ies'} from ${listRel}:`);
      for (const s of result.stale) console.log(`  - ${s.file} › ${s.name}`);
      console.log('  Commit the trimmed list with the change that fixed them.');
    } else {
      failed = true;
      console.error(`\n[known-failures] FAIL: ${result.stale.length} known failure(s) no longer fail. Trim ${listRel}:`);
      for (const s of result.stale) {
        const why = s.nowPasses ? 'now passes' : 'did not run (renamed, deleted, or its file failed)';
        console.error(`  ✓ ${s.file} › ${s.name}  (${why})`);
        annotate('error', s.file, 'Known failure no longer fails', `${s.name} ${why}. Remove it from ${listRel}.`);
      }
      console.error(
        '  Nice work if you fixed these. Remove them from the list in the same commit\n' +
        '  (`npm run test:ci -- --prune` does it), so they are covered again if they regress.',
      );
    }
  }

  if (unhandled > 0) {
    failed = true;
    console.error(`\n[known-failures] FAIL: vitest caught ${unhandled} unhandled error(s). See "Unhandled Errors" above.`);
    annotate('error', null, 'Unhandled errors', `vitest caught ${unhandled} unhandled error(s) during the run.`);
  }

  if (!failed) console.log('\n[known-failures] PASS: no new failures.');
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(`[known-failures] ${err.stack || err}`); process.exitCode = 1; },
  );
}
