// @vitest-environment node
/**
 * Size ratchet for src/NodeCanvas.jsx (NodeCanvas refactor, card P0.07).
 *
 * The file regrew after every earlier extraction (FINDINGS F-49), and a
 * "whitespace cleanup" once cut it to 4,104 lines without anyone noticing
 * (F-64). This test is the guard for both:
 *
 *   - ceiling: the line count may not exceed `budget`
 *   - ratchet: `budget` must equal the line count, so any commit that shrinks
 *     the file also lowers the budget, and the space it freed can't be quietly
 *     regrown later
 *   - floor:   the line count may not fall below `floor`; a drop that far is
 *     much more likely an accidental wipe than a refactor
 *
 * Numbers live in nodecanvas-budget.json. Lines are counted like `wc -l`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const TARGET = 'src/NodeCanvas.jsx';
const BUDGET_FILE = 'test/meta/nodecanvas-budget.json';
const DECISIONS = 'documentation/dev-ops/nodecanvas-refactor/DECISIONS.md';

const { budget, floor } = JSON.parse(readFileSync(path.join(REPO_ROOT, BUDGET_FILE), 'utf8'));
const source = readFileSync(path.join(REPO_ROOT, TARGET), 'utf8');
// `wc -l` counts newline characters, so a file that ends in one (as this one
// does) reports exactly its line count.
const lines = (source.match(/\n/g) || []).length;

describe(`${TARGET} size ratchet`, () => {
  it('has a well-formed budget file', () => {
    expect(Number.isInteger(budget) && Number.isInteger(floor),
      `${BUDGET_FILE}: "budget" and "floor" must both be integers`).toBe(true);
    expect(floor < budget, `${BUDGET_FILE}: "floor" (${floor}) must be below "budget" (${budget})`).toBe(true);
  });

  it('is not above its line budget', () => {
    expect(lines <= budget, [
      `${TARGET} is ${lines} lines, ${lines - budget} over its budget of ${budget}.`,
      'The budget only goes down. Put new canvas code in the new structure, not back into',
      'NodeCanvas.jsx (documentation/dev-ops/nodecanvas-refactor/README.md, principle 6).',
      `Never raise the budget in ${BUDGET_FILE} without a DECISION in ${DECISIONS}.`,
    ].join('\n')).toBe(true);
  });

  it('has had its budget lowered to match (ratchet)', () => {
    // Below the floor, the floor test reports it. "Lower the budget to match"
    // is the wrong advice for a wipe.
    expect(lines >= budget || lines < floor, [
      `${TARGET} shrank to ${lines} lines, but its budget is still ${budget}.`,
      `When the file shrinks, lower "budget" in ${BUDGET_FILE} to ${lines} in the same commit,`,
      'so the lines it freed cannot be regrown later (FINDINGS F-49).',
    ].join('\n')).toBe(true);
  });

  it('has not collapsed below the sanity floor', () => {
    expect(lines >= floor, [
      `${TARGET} is ${lines} lines, below the sanity floor of ${floor}.`,
      'A drop this large suggests an accidental wipe, like the "whitespace cleanup" that',
      'cut this file to 4,104 lines unnoticed (FINDINGS F-64). Check `git diff --stat` before committing.',
      `If the refactor genuinely got it this small, lower "floor" in ${BUDGET_FILE} and record why in ${DECISIONS}.`,
    ].join('\n')).toBe(true);
  });
});
