#!/usr/bin/env node
// NodeCanvas perf scenarios (refactor P0.04; scenarios in METRICS.md).
//
//   npm run perf:canvas                          # build dist-profile, run all, 5 runs each
//   npm run perf:canvas -- --scenario S1,S6      # some scenarios (L-S1 etc. for the large fixture)
//   npm run perf:canvas -- --no-build --runs 3   # reuse dist-profile/
//   npm run perf:canvas -- --fixtures medium     # medium only (chambers, or stress if absent)
//
// Prints a median table (commits under NodeCanvas's Profiler; how often the
// NodeCanvas function itself ran, and how many of those runs rendered rather
// than bailed out; total ms, max ms) and writes the
// raw runs plus the medians to test/perf/canvas/results/<time>-<sha>.json
// (gitignored). Record baselines in METRICS.md with the commit hash.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = path.join(ROOT, 'test', 'perf', 'canvas', 'results');

function parseArgs(argv) {
  const a = { scenarios: '', runs: 5, build: true, fixtures: 'medium,large' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--scenario' || k === '--scenarios') a.scenarios = argv[++i];
    else if (k === '--runs') a.runs = Number(argv[++i]);
    else if (k === '--no-build') a.build = false;
    else if (k === '--fixtures') a.fixtures = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  return r.status ?? 1;
}

export function summarize(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  return [...byId].map(([id, rs]) => ({
    id,
    fixture: rs[0].fixture,
    instances: rs[0].instances,
    runs: rs.length,
    commits: median(rs.map((r) => r.commits)),
    ncRan: median(rs.map((r) => r.ncRan ?? NaN)),
    ncRendered: median(rs.map((r) => r.ncRendered ?? NaN)),
    totalMs: median(rs.map((r) => r.totalMs)),
    maxMs: median(rs.map((r) => r.maxMs)),
    wallMs: median(rs.map((r) => r.wallMs)),
    commitsRange: [Math.min(...rs.map((r) => r.commits)), Math.max(...rs.map((r) => r.commits))],
  }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run perf:canvas -- [--scenario S1,S6] [--runs 5] [--no-build] [--fixtures medium,large]');
    return 0;
  }
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || 'unknown';
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'src'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() !== '';

  if (args.build || !fs.existsSync(path.join(ROOT, 'dist-profile', 'index.html'))) {
    console.log('[perf] building the profile bundle (vite build --mode profile)…');
    const code = run('npx', ['vite', 'build', '--mode', 'profile', '--logLevel', 'warn'], { NODE_OPTIONS: '--max-old-space-size=4096' });
    if (code !== 0) return code;
  }

  fs.mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const raw = path.join(RESULTS, `${stamp}-${sha}.jsonl`);
  fs.rmSync(raw, { force: true });

  const code = run('npx', ['playwright', 'test', '-c', 'test/perf/canvas/playwright.perf.config.js'], {
    PERF_OUT: raw, PERF_RUNS: String(args.runs), PERF_SCENARIOS: args.scenarios, PERF_FIXTURES: args.fixtures,
  });

  const rows = fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const table = summarize(rows);
  fs.writeFileSync(raw.replace(/\.jsonl$/, '.json'), JSON.stringify({ sha, dirty, runs: args.runs, table, rows }, null, 2));

  console.log(`\nNodeCanvas perf @ ${sha}${dirty ? ' (+ uncommitted src changes)' : ''}, median of ${args.runs} runs, profile build\n`);
  console.log('| Scenario | Fixture | Commits (range) | NodeCanvas ran (rendered) | Total ms | Max ms | Wall ms |');
  console.log('|---|---|---|---|---|---|---|');
  for (const t of table) {
    console.log(`| ${t.id} | ${t.fixture} (${t.instances}) | ${fmt(t.commits)} (${t.commitsRange.join('–')}) | ${fmt(t.ncRan)} (${fmt(t.ncRendered)}) | ${fmt(t.totalMs)} | ${fmt(t.maxMs)} | ${fmt(t.wallMs)} |`);
  }
  console.log(`\nRaw runs: ${path.relative(ROOT, raw)}`);
  return code;
}

process.exitCode = main();
