#!/usr/bin/env node
/**
 * The wizard's benchmark, and how its calls are gathered for training: the
 * wizard (small-model tier, as a local model gets it) asked to build a web of
 * each subject, headless, against an OpenAI-compatible server, measured by
 * src/wizard/lab/bench.js. The Druid's counterpart is scripts/druid-bench.mjs;
 * both use the subject lists in src/druid/lab/subjects.js, so held-out
 * subjects are held out for both roles.
 *
 *   npm run wizard:bench -- --model qwen/qwen3-4b-2507 --out runs/wizard-base.json
 *   npm run wizard:bench -- --split train --limit 40 --record training/druid/data/wizard/calls.jsonl
 *
 * The wizard's small tier sends about 9K tokens before the request: the
 * server's context must be at least --context (16K by default).
 *
 * --record writes every model call as it was made (messages, tools, the reply
 * put back together), one JSON line each, with its subject, so a call from a
 * held-out subject can never become a training example.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    endpoint: { type: 'string', default: 'http://localhost:1234/v1/chat/completions' },
    model: { type: 'string', default: 'qwen/qwen3-4b-2507' },
    'api-key': { type: 'string', default: 'local' },
    split: { type: 'string', default: 'eval' },
    subjects: { type: 'string', default: '' },
    limit: { type: 'string', default: '' },
    steps: { type: 'string', default: '24' },
    context: { type: 'string', default: '16384' },
    temperature: { type: 'string', default: '0.1' },
    record: { type: 'string', default: '' },
    out: { type: 'string', default: '' },
    verbose: { type: 'boolean', default: false }
  }
});

const say = (s) => process.stdout.write(s);
if (!args.verbose) for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = () => {};

const { EVAL, TRAIN } = await import('../src/druid/lab/subjects.js');
const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { applyToolResultToStore, configureToolResultApplier } = await import('../src/services/toolResultApplier.js');
const { runWizardInProcess } = await import('../src/wizard/runWizardInProcess.js');
const { graphStateFromStore } = await import('../src/druid/graphStateFromStore.js');
const { recordCalls } = await import('../src/wizard/lab/recorder.js');
const { snapshotOf, measureWizard, summarizeWizard } = await import('../src/wizard/lab/bench.js');

configureToolResultApplier({}); // no network enrichment: what it builds is its own

const pool = args.subjects ? args.subjects.split(',').map(s => s.trim()).filter(Boolean) : args.split === 'train' ? TRAIN : EVAL;
const subjects = args.limit ? pool.slice(0, Number(args.limit)) : pool;
const held = new Set(EVAL.map(s => s.toLowerCase()));
const ask = (subject) => `Make a web of ${subject}: its main parts, and how they connect.`;

const apiConfig = {
  provider: 'local',
  endpoint: args.endpoint,
  model: args.model,
  modelTier: 'small',
  settings: {
    temperature: Number(args.temperature),
    max_tokens: Math.min(2048, Math.floor(Number(args.context) / 4)),
    maxIterationsLocal: Number(args.steps),
    maxIterationsCloud: Number(args.steps)
  }
};

let recordFd = null;
if (args.record) {
  fs.mkdirSync(path.dirname(path.resolve(args.record)), { recursive: true });
  recordFd = fs.openSync(args.record, 'a');
}
let current = null;
let calls = 0;
const pending = [];
const recorder = recordCalls({
  endpoint: args.endpoint,
  onCall: (call) => {
    calls++;
    if (!recordFd || !current) return;
    const { request, ...reply } = call;
    pending.push(fs.promises.appendFile(recordFd, `${JSON.stringify({ role: 'wizard', run: current.run, subject: current.subject, scenario: 'build', heldOut: held.has(current.subject.toLowerCase()), request, ...reply })}\n`));
  }
});

say(`Wizard bench · ${args.model} · ${subjects.length} subject(s) · small tier, up to ${args.steps} steps\n\n`);
const results = [];
for (const subject of subjects) {
  useGraphStore.getState().clearUniverse();
  const before = snapshotOf(useGraphStore.getState());
  const run = `${Date.now().toString(36)}-${subject.toLowerCase().replace(/\W+/g, '-')}`;
  current = { run, subject };
  calls = 0;
  const events = [];
  const started = Date.now();
  try {
    for await (const e of runWizardInProcess({
      message: ask(subject),
      graphState: graphStateFromStore(useGraphStore.getState()),
      conversationHistory: [],
      apiKey: args['api-key'],
      apiConfig,
      cid: `bench-${run}`
    })) {
      events.push(e);
      if (e.type === 'tool_result' && e.result && !e.result.error) {
        try { applyToolResultToStore(e.name, e.result, e.id, `bench-${run}`, { confirmed: true }); } catch (err) { events.push({ type: 'error', message: `apply ${e.name}: ${err.message}` }); }
      }
    }
  } catch (err) {
    events.push({ type: 'error', message: err?.message || String(err) });
  }
  await Promise.all(pending.splice(0));
  const metrics = measureWizard(useGraphStore.getState(), before, { subject, events, calls, ms: Date.now() - started });
  results.push({ subject, run, metrics });
  say(`${subject.padEnd(18)} things ${String(metrics.things).padStart(3)} · webs ${metrics.webs} · edges ${String(metrics.edges).padStart(3)} · connected ${metrics.connectedPct}% · refused ${metrics.refused.length} · failed ${metrics.failedPct}% · calls ${metrics.calls}${metrics.error ? ` · ERROR ${metrics.error.slice(0, 80)}` : ''} · ${Math.round(metrics.ms / 1000)}s\n`);
  if (results.length === 3 && results.every(r => r.metrics.calls === 0 || r.metrics.error)) {
    say('\nEvery request failed: is the server running, with the model loaded and a context of at least --context?\n');
    break;
  }
}
recorder.restore();
if (recordFd) fs.closeSync(recordFd);

const total = summarizeWizard(results);
say('\n');
for (const [k, v] of Object.entries(total)) say(`${k}: ${v}\n`);
if (args.out) {
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify({ role: 'wizard', backend: `openai:${args.model}`, at: new Date().toISOString(), total, results }));
}
process.exit(0);
