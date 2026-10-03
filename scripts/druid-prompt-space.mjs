#!/usr/bin/env node
/**
 * Build the Druid's prompt space: its standing instructions as a Redstring
 * universe (src/druid/prompt-space.redstring).
 *
 *   node scripts/druid-prompt-space.mjs            write it from the defaults
 *   node scripts/druid-prompt-space.mjs --force    overwrite an edited one
 *
 * After that, the file is the source of truth: open it in Redstring, edit the
 * Things' descriptions, and the Druid reads the new instructions on its next
 * start. It is read-only to the Druid.
 *
 *   Identity   "Who you are"          — the system prompt
 *   Questions  "Choose", "Thought"    — how each call is asked
 *   Moves      one Thing per move     — what each move does (for people; the
 *                                        Druid sees the move's own menu wording)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'src', 'druid', 'prompt-space.redstring');
const force = process.argv.includes('--force');

if (fs.existsSync(target) && !force) {
  process.stdout.write(`${target} exists (it may have been edited). Pass --force to rebuild it from the defaults.\n`);
  process.exit(0);
}
for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = () => {};

const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { exportToRedstring } = await import('../src/formats/redstringFormat.js');
const { applyToolResultToStore, configureToolResultApplier } = await import('../src/services/toolResultApplier.js');
const { executeTool } = await import('../src/wizard/tools/index.js');
const { createWorld } = await import('../src/druid/world.js');
const { DEFAULT_PROMPT_SPACE } = await import('../src/druid/promptSpace.js');
const { druidMoves } = await import('../src/druid/druid.js');
const { buildUniverse } = await import('../src/druid/lab/scenarios.js');
configureToolResultApplier({});

const MOVE_NOTES = {
  newWeb: 'Start a new web: a fresh region of the universe.',
  make: 'Make a Thing in the current web, optionally connected to the Thing in focus.',
  connect: 'Connect the focus to another Thing here, with a relation the Druid names.',
  follow: 'Move focus along a connection.',
  look: 'Move focus to another Thing in view.',
  open: 'Go inside a Thing, or open one up by naming what it is made of.',
  close: 'Step back out to the Thing whose inside this is.',
  describe: 'Write or rewrite the focus\'s description.',
  goWeb: 'Go to another top-level web.',
  letGo: 'Drop a Thing from working memory, and keep it from coming straight back.',
  note: 'Hold a half-formed thought: a Thing that exists only in working memory until kept.',
  promote: 'Keep a half-formed thought as a lasting Thing in the current web.',
  commitGoal: 'Set a goal (a Thing of kind Goal). Open goals pull attention every cycle.',
  pursueGoal: 'Go to where a goal\'s words point in the universe.',
  resolveGoal: 'Mark a goal reached.',
  abandonGoal: 'Give a goal up.',
  breakDownGoal: 'Add a smaller goal inside a goal.',
  makePlan: 'Start a plan for a goal: its inside holds steps chained by "then".',
  addStep: 'Add the next step to a plan.',
  stepDone: 'Advance a plan\'s cursor to its next step.',
  believe: 'State a belief about the focus. Its confidence comes from evidence.',
  weighBelief: 'Judge how the focus bears on a belief; adds evidence (one per source).',
  variant: 'Imagine a version of the focus that differs in one way; shares its parts.',
  specialize: 'Name a kind of the focus (is-a), inheriting its parts.',
  chunk: 'Gather Things that keep coming up together into one Thing whose inside they are.',
  contrast: 'Name the key difference between two Things; kept as a belief.',
  generalize: 'Name what two Things are both kinds of.',
  analogy: 'Judge whether a Thing elsewhere with the same shape of connections is really alike.',
  wonder: 'Turn to a gap: something undescribed, unconnected, or never opened up.'
};

useGraphStore.getState().loadUniverseFromFile({
  graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
  activeDefinitionNodeId: null, expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
  savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: true
});
const world = createWorld({ store: useGraphStore, executeTool, applyToolResult: (n, r, id, cid) => applyToolResultToStore(n, r, id, cid, { confirmed: true }) });

const moves = {};
for (const m of druidMoves()) moves[m.id] = MOVE_NOTES[m.id] || '';
await buildUniverse(world, {
  webs: {
    Identity: { description: 'Who the Druid is told it is.', things: { 'Who you are': DEFAULT_PROMPT_SPACE.system } },
    Questions: { description: 'How each kind of call is asked.', things: { Choose: DEFAULT_PROMPT_SPACE.questions.choose, Thought: DEFAULT_PROMPT_SPACE.questions.thought } },
    Moves: { description: 'The Druid\'s repertoire. Each is one menu option and a chain of deterministic steps.', things: moves }
  }
});

fs.writeFileSync(target, JSON.stringify(exportToRedstring(useGraphStore.getState())));
process.stdout.write(`wrote ${target} (${Object.keys(moves).length} moves)\n`);
process.exit(0);
