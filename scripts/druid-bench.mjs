#!/usr/bin/env node
/**
 * The Druid's benchmark (src/druid/lab/bench.js): subjects, a run of moments
 * each, what a person says along the way, and the numbers a model has to beat.
 *
 *   npm run druid:bench -- --mind afm                       held-out subjects, Apple's model
 *   npm run druid:bench -- --mind openai --model qwen3-1.7b  a model in LM Studio
 *   npm run druid:bench -- --split train --record calls.jsonl   gather what it is asked, for training
 *   npm run druid:bench -- --subjects "Venus,Piano" --moments 80 --scenario pivot
 *
 * Scenarios (lab/subjects.js): solo, request, pivot, polite, or mixed (each
 * subject in turn). --record writes every model call, prompt and answer, one
 * JSON object a line, with where the Druid stood when it was asked.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    mind: { type: 'string', default: 'afm' },
    endpoint: { type: 'string', default: 'http://localhost:1234/v1/chat/completions' },
    model: { type: 'string', default: 'qwen/qwen3-4b-2507' },
    bridge: { type: 'string', default: path.join(here, '..', 'native', 'afm-bridge', '.build', 'release', 'afm-bridge') },
    split: { type: 'string', default: 'eval' },
    subjects: { type: 'string', default: '' },
    limit: { type: 'string', default: '' },
    moments: { type: 'string', default: '40' },
    scenario: { type: 'string', default: 'mixed' },
    at: { type: 'string', default: '12' },
    temperature: { type: 'string', default: '0.6' },
    record: { type: 'string', default: '' },
    out: { type: 'string', default: '' }
  }
});

for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = () => {};
const say = (s) => process.stdout.write(s);

const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { applyToolResultToStore, configureToolResultApplier } = await import('../src/services/toolResultApplier.js');
const { executeTool } = await import('../src/wizard/tools/index.js');
const { createWorld } = await import('../src/druid/world.js');
const { createMind } = await import('../src/druid/mind/createMind.js');
const { openaiCompatible } = await import('../src/druid/mind/backends.js');
const { createDruid } = await import('../src/druid/druid.js');
const { promptSpaceFrom } = await import('../src/druid/promptSpace.js');
const { benchSubject, summarize } = await import('../src/druid/lab/bench.js');
const { EVAL, TRAIN, OTHER, SCENARIOS } = await import('../src/druid/lab/subjects.js');
configureToolResultApplier({});

const backend = args.mind === 'afm'
  ? await (await import('../src/druid/mind/afmBackend.js')).afmBackend({ executable: args.bridge })
  : openaiCompatible({ endpoint: args.endpoint, model: args.model });
const promptSpace = promptSpaceFrom(JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'druid', 'prompt-space.redstring'), 'utf8')));

const empty = () => ({
  graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
  activeDefinitionNodeId: null, expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
  savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: true
});

let subjects = args.subjects ? args.subjects.split(',').map(s => s.trim()).filter(Boolean) : (args.split === 'train' ? TRAIN : EVAL);
if (args.limit) subjects = subjects.slice(0, Number(args.limit));
const kinds = Object.keys(SCENARIOS);
const recordTo = args.record ? fs.openSync(args.record, 'a') : null;
const runId = `${Date.now().toString(36)}`;
const results = [];

say(`Druid bench · ${backend.id} · ${subjects.length} subject(s) × ${args.moments} moments · ${args.scenario}\n\n`);
for (const [i, subject] of subjects.entries()) {
  const scenario = args.scenario === 'mixed' ? kinds[i % kinds.length] : args.scenario;
  const other = OTHER[i % OTHER.length];
  const events = SCENARIOS[scenario](Number(args.at), other);
  useGraphStore.getState().loadUniverseFromFile(empty());
  const world = createWorld({ store: useGraphStore, executeTool, applyToolResult: (n, r, id, cid) => applyToolResultToStore(n, r, id, cid, { confirmed: true }) });
  let calls = 0;
  let failedCalls = 0;
  let lastError = '';
  const mind = createMind({
    backend,
    temperature: Number(args.temperature),
    onCall: (c) => {
      calls++;
      if (c.error) { failedCalls++; lastError = c.error; }
      if (!recordTo) return;
      // Where it stood when it was asked: what a reward needs besides the prompt.
      const web = useGraphStore.getState().activeGraphId;
      const where = web ? { web: world.graph(web)?.name || null, topic: world.topicOf?.(web) || null, things: world.thingsIn(web).map(world.nameOf).slice(0, 40) } : null;
      fs.writeSync(recordTo, `${JSON.stringify({ run: runId, subject, scenario, kind: c.kind, meta: c.meta, system: c.system, user: c.user, schema: c.schema, maxTokens: c.maxTokens, temperature: c.temperature, content: c.content, value: c.value, ok: c.ok, error: c.error, ms: c.ms, where })}\n`);
    }
  });
  const r = await benchSubject({ world, mind, promptSpace, createDruid }, { subject, moments: Number(args.moments), events });
  // A model that answers nothing measures nothing: say so, and stop.
  if (calls > 0 && failedCalls === calls) {
    say(`\nEvery call to the model failed; nothing was measured. Last error:\n${String(lastError).slice(0, 400)}\n`);
    backend.close?.();
    process.exit(1);
  }
  results.push({ subject, scenario, other, ...r });
  const m = r.metrics;
  const steer = m.steering.map(s => `${s.request}: ${s.turned ? `turned in ${s.latency}, held ${s.held}%` : 'never turned'}`).join('; ');
  say(`${subject.padEnd(18)} ${scenario.padEnd(8)} things ${String(m.things).padStart(3)} · on subject ${String(m.onSubject).padStart(3)}% · drift ${m.driftCount} · positions ${m.positions.length} · failed ${m.failedPct}% · daydream ${m.daydreamPct}% · ${Math.round(r.ms / 1000)}s${steer ? `\n${' '.repeat(28)}${steer}` : ''}${m.drift.length ? `\n${' '.repeat(28)}drift: ${m.drift.join(', ')}` : ''}\n`);
}

const total = summarize(results);
say(`\n${Object.entries(total).map(([k, v]) => `${k}: ${v}`).join('\n')}\n`);
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ backend: backend.id, args, total, results }, null, 0));
if (recordTo) fs.closeSync(recordTo);
backend.close?.();
process.exit(0);
