// @vitest-environment node
// The undefined-names gate CI runs over src/ (scripts/check-undefined-names.mjs,
// NodeCanvas refactor P0.06). These tests cover its comparison logic and keep the
// checked-in baseline well-formed; the end-to-end check is `npm run lint:undef`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { countUndefined, compareToBaseline, sortEntries, DEFAULT_BASELINE } from '../../scripts/check-undefined-names.mjs';

const ROOT = '/repo';
const undef = (name, line = 1) => ({ ruleId: 'no-undef', message: `'${name}' is not defined.`, line });
const result = (file, messages) => ({ filePath: path.join(ROOT, file), messages });

describe('undefined-names gate: counting', () => {
  it('counts no-undef uses per file and name, ignoring other rules', () => {
    const counts = countUndefined([
      result('src/a.js', [undef('x', 1), undef('x', 9), undef('y', 4), { ruleId: 'no-unused-vars', message: "'z' is defined but never used." }]),
      result('src/b.jsx', [undef('x', 2)]),
    ], ROOT);
    expect(Object.fromEntries([...counts].map(([k, n]) => [k.replace('\u0000', ' '), n]))).toEqual({
      'src/a.js x': 2, 'src/a.js y': 1, 'src/b.jsx x': 1,
    });
  });
});

describe('undefined-names gate: comparison', () => {
  const baseline = [{ file: 'src/a.js', name: 'x', count: 2 }];
  const counts = (entries) => new Map(entries.map(([f, n, c]) => [`${f}\u0000${n}`, c]));

  it('passes when the counts match the baseline', () => {
    expect(compareToBaseline(counts([['src/a.js', 'x', 2]]), baseline)).toEqual({ added: [], stale: [] });
  });

  it('flags a new name, and a listed name used more often than allowed', () => {
    const out = compareToBaseline(counts([['src/a.js', 'x', 3], ['src/c.js', 'gone', 1]]), baseline);
    expect(out.added).toEqual([
      { file: 'src/a.js', name: 'x', count: 3, allowed: 2 },
      { file: 'src/c.js', name: 'gone', count: 1, allowed: 0 },
    ]);
  });

  it('flags baseline entries that were fixed, fully or partly', () => {
    expect(compareToBaseline(counts([['src/a.js', 'x', 1]]), baseline).stale).toEqual([{ file: 'src/a.js', name: 'x', count: 2, now: 1 }]);
    expect(compareToBaseline(counts([]), baseline).stale).toEqual([{ file: 'src/a.js', name: 'x', count: 2, now: 0 }]);
  });
});

describe('test/known-undefined-names.json', () => {
  const data = JSON.parse(fs.readFileSync(DEFAULT_BASELINE, 'utf8'));
  const root = path.resolve(path.dirname(DEFAULT_BASELINE), '..');

  it('is sorted, has no duplicates, and every count is positive', () => {
    expect(data.entries).toEqual(sortEntries(data.entries));
    const keys = data.entries.map((e) => `${e.file}\u0000${e.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of data.entries) expect(e.count).toBeGreaterThan(0);
  });

  it('only names files that exist', () => {
    const files = [...new Set([...data.entries.map((e) => e.file), ...(data.unparseable || [])])];
    expect(files.filter((f) => !fs.existsSync(path.join(root, f)))).toEqual([]);
  });
});
