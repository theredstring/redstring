// @vitest-environment node
// The known-failures gate CI runs the suite through (scripts/check-known-failures.mjs,
// NodeCanvas refactor P0.06). These tests cover its comparison logic and keep the
// checked-in list well-formed; the end-to-end check is `npm run test:ci`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  collectResults,
  compareToKnown,
  countUnhandledErrors,
  readList,
  sortEntries,
  toRelative,
  DEFAULT_LIST,
  FILE_LEVEL,
} from '../../scripts/check-known-failures.mjs';

const ROOT = '/repo';
const abs = (rel) => path.join(ROOT, rel);

// Just the fields of vitest's JSON report the gate reads.
function report(files) {
  let total = 0;
  const testResults = files.map(({ file, tests = [], status, message = '' }) => {
    total += tests.length;
    const anyFailed = tests.some((t) => t.status === 'failed');
    return {
      name: abs(file),
      status: status ?? (anyFailed ? 'failed' : 'passed'),
      message,
      assertionResults: tests.map((t) => ({
        fullName: t.name,
        status: t.status,
        failureMessages: t.status === 'failed' ? [`AssertionError: ${t.name} broke\n    at stack`] : [],
      })),
    };
  });
  return { numTotalTests: total, testResults };
}

const known = [
  { file: 'test/a.test.js', name: 'a fails' },
  { file: 'test/b.test.js', name: FILE_LEVEL },
];

describe('known-failures gate: comparison', () => {
  it('passes when exactly the known failures fail', () => {
    const r = report([
      { file: 'test/a.test.js', tests: [{ name: 'a fails', status: 'failed' }, { name: 'a ok', status: 'passed' }] },
      { file: 'test/b.test.js', status: 'failed', message: 'No "X" export is defined on the mock' },
    ]);
    const out = compareToKnown(r, known, ROOT);
    expect(out.newFailures).toEqual([]);
    expect(out.stale).toEqual([]);
    expect(out.stillKnown).toHaveLength(2);
  });

  it('reports a failure that is not on the list as new, with its first message line', () => {
    const r = report([
      { file: 'test/a.test.js', tests: [{ name: 'a fails', status: 'failed' }, { name: 'a ok', status: 'failed' }] },
      { file: 'test/b.test.js', status: 'failed', message: 'mock error' },
    ]);
    const out = compareToKnown(r, known, ROOT);
    expect(out.newFailures).toEqual([
      { file: 'test/a.test.js', name: 'a ok', message: 'AssertionError: a ok broke' },
    ]);
  });

  it('matches on file AND name: the same test name failing in another file is new', () => {
    const r = report([
      { file: 'test/a.test.js', tests: [{ name: 'a fails', status: 'failed' }] },
      { file: 'test/b.test.js', status: 'failed', message: 'mock error' },
      { file: 'test/c.test.js', tests: [{ name: 'a fails', status: 'failed' }] },
    ]);
    expect(compareToKnown(r, known, ROOT).newFailures.map((f) => f.file)).toEqual(['test/c.test.js']);
  });

  it('flags a known failure that now passes, and one that no longer runs', () => {
    const r = report([
      { file: 'test/a.test.js', tests: [{ name: 'a fails', status: 'passed' }] },
      { file: 'test/b.test.js', tests: [{ name: 'b loads now', status: 'passed' }] },
    ]);
    const out = compareToKnown(r, known, ROOT);
    expect(out.newFailures).toEqual([]);
    expect(out.stale).toEqual([
      { file: 'test/a.test.js', name: 'a fails', nowPasses: true },
      { file: 'test/b.test.js', name: FILE_LEVEL, nowPasses: false },
    ]);
  });

  it('treats a whole file failing to run as a new file-level failure', () => {
    const r = report([
      { file: 'test/a.test.js', tests: [{ name: 'a fails', status: 'failed' }] },
      { file: 'test/b.test.js', status: 'failed', message: 'mock error' },
      { file: 'test/d.test.js', status: 'failed', message: 'SyntaxError: Unexpected token' },
    ]);
    expect(compareToKnown(r, known, ROOT).newFailures).toEqual([
      { file: 'test/d.test.js', name: FILE_LEVEL, message: 'SyntaxError: Unexpected token' },
    ]);
  });

  it('records a file-level error even when tests in that file also failed', () => {
    const r = report([
      { file: 'test/e.test.js', tests: [{ name: 'e1', status: 'failed' }], message: 'afterAll hook threw' },
    ]);
    const names = collectResults(r, ROOT).failures.map((f) => f.name);
    expect(names).toEqual(['e1', FILE_LEVEL]);
  });

  it('ignores skipped and todo tests', () => {
    const r = report([
      { file: 'test/a.test.js', tests: [{ name: 'a fails', status: 'failed' }, { name: 's', status: 'skipped' }, { name: 't', status: 'todo' }] },
      { file: 'test/b.test.js', status: 'failed', message: 'mock error' },
    ]);
    const out = compareToKnown(r, known, ROOT);
    expect(out.newFailures).toEqual([]);
    expect(out.stale).toEqual([]);
  });
});

describe('known-failures gate: helpers', () => {
  it('stores repo-relative POSIX paths', () => {
    expect(toRelative('/repo/src/x/y.test.js', '/repo')).toBe('src/x/y.test.js');
    expect(toRelative('src/x/y.test.js', '/repo')).toBe('src/x/y.test.js');
  });

  it('counts unhandled errors from vitest output, colour codes or not', () => {
    expect(countUnhandledErrors('Test Files  3 passed\n')).toBe(0);
    expect(countUnhandledErrors('\u001b[31mVitest caught 2 unhandled errors during the test run.\u001b[39m')).toBe(2);
    expect(countUnhandledErrors('Vitest caught 1 unhandled error during the test run.')).toBe(1);
  });

  it('sorts entries by file, then name', () => {
    const sorted = sortEntries([
      { file: 'b', name: '2' }, { file: 'a', name: 'z' }, { file: 'b', name: '1' },
    ]);
    expect(sorted).toEqual([{ file: 'a', name: 'z' }, { file: 'b', name: '1' }, { file: 'b', name: '2' }]);
  });
});

describe('test/known-failures.json', () => {
  const { failures } = readList(DEFAULT_LIST);

  it('is sorted, so diffs stay reviewable', () => {
    expect(failures).toEqual(sortEntries(failures));
  });

  it('has no duplicate entries', () => {
    const keys = failures.map((f) => `${f.file}\u0000${f.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only names test files that exist', async () => {
    const fs = await import('node:fs');
    const root = path.resolve(path.dirname(DEFAULT_LIST), '..');
    const missing = [...new Set(failures.map((f) => f.file))].filter((f) => !fs.existsSync(path.join(root, f)));
    expect(missing).toEqual([]);
  });
});
