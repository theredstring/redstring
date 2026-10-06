#!/usr/bin/env node
/**
 * Whether a trained model is better than the one it would replace, on the
 * benchmark's held-out subjects (scripts/druid-bench.mjs or wizard-bench.mjs --out),
 * each role by its own measures.
 *
 *   node scripts/druid-bench-compare.mjs runs/base.json runs/candidate.json
 *
 * The rewards are what training pushes on; this is what decides. A candidate
 * is used only if it is no worse on every measure, within a little noise, and
 * better on at least one. A model that games its rewards (says little, names
 * positions, invents) shows up here as worse on what was built.
 */

import fs from 'node:fs';

const [basePath, candPath] = process.argv.slice(2);
if (!basePath || !candPath) { process.stdout.write('node scripts/druid-bench-compare.mjs base.json candidate.json\n'); process.exit(1); }
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));

const subjects = (r) => r.results.map(x => x.subject).sort().join(',');
if (subjects(base) !== subjects(cand)) process.stdout.write('Warning: not the same subjects; the comparison is loose.\n\n');

/** [measure, higher is better, noise]: the Druid's, or the wizard's (scripts/wizard-bench.mjs) */
const WIZARD = [
  ['thingsPerRun', true, 1], ['edgesPerRun', true, 1], ['connectedPct', true, 5], ['subjectWebPct', true, 5],
  ['refusedPerRun', false, 0.3], ['dupesPerRun', false, 0.3], ['failedPct', false, 3], ['answeredPct', true, 5], ['erroredPct', false, 5]
];
if (base.role !== cand.role) { process.stdout.write(`These are different roles' benchmarks (${base.role || 'druid'} and ${cand.role || 'druid'}).\n`); process.exit(1); }
const MEASURES = base.role === 'wizard' ? WIZARD : [
  ['onSubjectPct', true, 3], ['driftPerRun', false, 0.5], ['positionsPerRun', false, 0.2],
  ['failedPct', false, 3], ['emptyPct', false, 2], ['ungroundedThoughtsPct', false, 3], ['daydreamPct', false, 2],
  ['turnedPct', true, 5], ['turnLatency', false, 0.5], ['heldPct', true, 5], ['answeredPct', true, 5],
  ['unknownClaimsPerRun', false, 0.3], ['repeatsPerRun', false, 0.3], ['thingsPerRun', true, 1], ['breadth', true, 0.5]
];

let worse = 0;
let better = 0;
const rows = [];
for (const [k, up, noise] of MEASURES) {
  const a = base.total[k];
  const b = cand.total[k];
  if (a == null || b == null) { rows.push([k, a, b, 'n/a']); continue; }
  const d = up ? b - a : a - b;
  const verdict = d > noise ? 'better' : d < -noise ? 'WORSE' : 'same';
  if (verdict === 'better') better++;
  if (verdict === 'WORSE') worse++;
  rows.push([k, a, b, verdict]);
}
for (const [k, a, b, v] of rows) process.stdout.write(`${k.padEnd(24)} ${String(a).padStart(7)} → ${String(b).padEnd(7)} ${v}\n`);
const use = worse === 0 && better > 0;
process.stdout.write(`\n${use ? 'USE IT' : 'DO NOT USE IT'}: ${better} better, ${worse} worse (${base.backend} → ${cand.backend})\n`);
process.exit(use ? 0 : 2);
