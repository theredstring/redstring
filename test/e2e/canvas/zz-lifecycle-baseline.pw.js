// Lifecycle baseline recorder (P5.02 step 0). A tool, not a gate: skipped
// unless LIFECYCLE_TRACE_DIR is set.
//
//   LIFECYCLE_TRACE_DIR=test/e2e/canvas/lifecycle-baselines \
//     CI=1 CANVAS_E2E_PORT=48xx npx playwright test zz-lifecycle-baseline
//
// Writes each scenario's trace (lifecycleScenarios.js) to
// $LIFECYCLE_TRACE_DIR/<scenario>.json: the sequence of distinct lifecycle
// states, sampled on every canvasUIStore write and every frame, one per line.
// Two recordings on the same code are byte-identical (reports/P5.02-step0.md),
// so `diff -r` against the committed lifecycle-baselines/ is an exact check.
//
// Batching the lifecycle writes (P5.02 steps 4+) is expected to drop some
// intermediate states. Set LIFECYCLE_BASELINE_DIR as well to check a recording
// against a baseline under that rule (compareTraces): the fresh trace must be
// the baseline with states removed, never added or reordered; the states it
// dropped are printed for review.
//
// Only the committed `small` fixture is used.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { test, expect } from './helpers.js';
import { scenarios } from './lifecycleScenarios.js';
import { compareTraces, summarize } from './lifecycleTrace.js';

const DIR = process.env.LIFECYCLE_TRACE_DIR;
const BASELINE_DIR = process.env.LIFECYCLE_BASELINE_DIR;

for (const [name, run] of Object.entries(scenarios)) {
  test(`lifecycle baseline: ${name}`, async ({ page }) => {
    test.skip(!DIR, 'set LIFECYCLE_TRACE_DIR to record lifecycle traces');
    const { all } = await run(page);
    mkdirSync(DIR, { recursive: true });
    // One snapshot per line, so a diff between two recordings reads as a list
    // of changed states.
    writeFileSync(path.join(DIR, `${name}.json`), `[\n${all.map((s) => JSON.stringify(s)).join(',\n')}\n]\n`);

    if (BASELINE_DIR) {
      const file = path.join(BASELINE_DIR, `${name}.json`);
      expect(existsSync(file), `no baseline for ${name} in ${BASELINE_DIR}`).toBe(true);
      const baseline = JSON.parse(readFileSync(file, 'utf8'));
      const res = compareTraces(baseline, all);
      if (res.dropped.length) console.log(`[${name}] states dropped vs baseline:\n${summarize(res.dropped)}`);
      expect(res.ok, `${name}: ${res.message}`).toBe(true);
    }
  });
}
