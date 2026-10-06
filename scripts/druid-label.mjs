#!/usr/bin/env node
/**
 * Label what the Druid was asked, with a teacher model (src/druid/lab/teacher.js).
 *
 *   npm run druid:label -- --in calls.jsonl --out labels.jsonl --dry-run
 *   ANTHROPIC_API_KEY=… npm run druid:label -- --in calls.jsonl --out labels.jsonl
 *   npm run druid:label -- --in calls.jsonl --out labels.jsonl --provider gemini --model gemini-3.8-flash
 *   npm run druid:label -- --in calls.jsonl --out labels.jsonl --provider openai --endpoint http://localhost:1234/v1/chat/completions --model some-model
 *
 * Keys come from the environment or the repo's .env (git-ignored):
 * ANTHROPIC_API_KEY, GEMINI_API_KEY, or TEACHER_API_KEY for --provider openai.
 *
 * Held-out subjects (lab/subjects.js EVAL) are never labeled: what the
 * benchmark measures must not be trained on. Each prompt is labeled once (by
 * a hash of what was shown), and a run picks up where the last one stopped.
 * --dry-run prints how many calls of each kind would be labeled and what it
 * would cost, and calls nothing. Calls training won't use are not labeled
 * (see OWN_VOICE and SHARE below); --all labels them anyway.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    in: { type: 'string', default: '' },
    out: { type: 'string', default: '' },
    provider: { type: 'string', default: 'anthropic' },
    model: { type: 'string', default: '' },
    endpoint: { type: 'string', default: '' },
    effort: { type: 'string', default: '' },
    concurrency: { type: 'string', default: '6' },
    limit: { type: 'string', default: '' },
    types: { type: 'string', default: '' },
    'dry-run': { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    'price-in': { type: 'string', default: '' },
    'price-out': { type: 'string', default: '' }
  }
});

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* no .env: the environment only */ }
/** [model, $/M in, $/M out] when none is given */
const DEFAULTS = { anthropic: ['claude-haiku-4-5-20251001', 1, 5], gemini: ['gemini-3.8-flash', 0.75, 3.75], openai: ['', 0, 0] };
const [defModel, defIn, defOut] = DEFAULTS[args.provider] || DEFAULTS.openai;
args.model ||= defModel;
args['price-in'] ||= String(defIn);
args['price-out'] ||= String(defOut);

for (const k of ['log', 'info', 'debug', 'warn']) console[k] = () => {};
const say = (s) => process.stdout.write(s);
if (!args.in || (!args.out && !args['dry-run'])) { say('Give --in calls.jsonl and --out labels.jsonl (or --dry-run).\n'); process.exit(1); }

const { EVAL } = await import('../src/druid/lab/subjects.js');
const { teaching, label, teacherBackend } = await import('../src/druid/lab/teacher.js');

const held = new Set(EVAL.map(s => s.toLowerCase()));
const hashOf = (r) => crypto.createHash('sha1').update(`${r.system}\u0000${r.user}\u0000${JSON.stringify(r.schema)}`).digest('hex');
const want = new Set(args.types ? args.types.split(',') : []);

const done = new Set();
if (args.out && fs.existsSync(args.out)) for (const line of fs.readFileSync(args.out, 'utf8').split('\n')) { if (line.trim()) { try { done.add(JSON.parse(line).hash); } catch { /* a torn last line */ } } }

const queue = [];
const seen = new Set();
let heldOut = 0;
for (const file of args.in.split(',')) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (held.has(String(rec.subject || '').toLowerCase())) { heldOut++; continue; }
    if (!rec.system || !rec.user || rec.meta?.retry) continue;
    const hash = hashOf(rec);
    if (seen.has(hash) || done.has(hash)) continue;
    seen.add(hash);
    const t = teaching(rec);
    if (want.size && !want.has(t.type)) continue;
    queue.push({ hash, rec, t });
  }
}
// Only what training will use is worth paying for (training/druid/prepare.py):
// the Druid's voice is learned from its own answers, so those calls need no
// teacher, and the yes-or-no helpers are capped at SHARE of the examples, so
// labeling more of them than that is money thrown away. Which helpers is
// fixed by hash, so a resumed run picks the same ones.
const OWN_VOICE = new Set(['thought', 'throughLine', 'speech']);
const SHARE = 0.3;
let skippedVoice = 0;
let skippedHelpers = 0;
let picked = queue;
if (!args.all) {
  const kept = queue.filter(j => !OWN_VOICE.has(j.t.type));
  skippedVoice = queue.length - kept.length;
  const doneTypes = [];
  if (args.out && fs.existsSync(args.out)) for (const line of fs.readFileSync(args.out, 'utf8').split('\n')) { try { doneTypes.push(JSON.parse(line).type); } catch { /* a torn line */ } }
  const others = kept.filter(j => j.t.type !== 'helper').length + doneTypes.filter(t => t && t !== 'helper' && !OWN_VOICE.has(t)).length;
  const room = Math.max(0, Math.ceil((SHARE / (1 - SHARE)) * others) - doneTypes.filter(t => t === 'helper').length);
  const helpers = kept.filter(j => j.t.type === 'helper').sort((a, b) => (a.hash < b.hash ? -1 : 1));
  skippedHelpers = Math.max(0, helpers.length - room);
  const chosen = new Set(helpers.slice(0, room));
  picked = kept.filter(j => j.t.type !== 'helper' || chosen.has(j));
}
const jobs = args.limit ? picked.slice(0, Number(args.limit)) : picked;

const byType = {};
let inTokens = 0;
for (const j of jobs) { byType[j.t.type] = (byType[j.t.type] || 0) + 1; inTokens += Math.ceil((j.t.system.length + j.t.user.length) / 3.6); }
const outTokens = jobs.length * 180;
const cost = (inTokens / 1e6) * Number(args['price-in']) + (outTokens / 1e6) * Number(args['price-out']);
say(`${jobs.length} call(s) to label (${done.size} already labeled, ${heldOut} from held-out subjects skipped)\n`);
if (skippedVoice || skippedHelpers) say(`not labeled, as training won't use them: ${skippedVoice} in the Druid's own voice, ${skippedHelpers} yes-or-no helpers over the cap (--all labels everything)\n`);
say(`${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
say(`about ${Math.round(inTokens / 1000)}K tokens in, ${Math.round(outTokens / 1000)}K out: about $${cost.toFixed(2)} at $${args['price-in']}/M in and $${args['price-out']}/M out\n`);
if (args['dry-run'] || !jobs.length) process.exit(0);

const teacher = teacherBackend({ provider: args.provider, model: args.model, endpoint: args.endpoint, effort: args.effort || undefined, apiKey: args.provider === 'openai' ? process.env.TEACHER_API_KEY : undefined });
const outFd = fs.openSync(args.out, 'a');
let next = 0;
let ok = 0;
let kept = 0;
let failed = 0;
const usage = { input: 0, output: 0 };
const worker = async () => {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      const r = await label(teacher, j.rec);
      usage.input += r.usage?.input || 0;
      usage.output += r.usage?.output || 0;
      if (r.label) ok++;
      if (r.target?.ok) kept++;
      fs.writeSync(outFd, `${JSON.stringify({ hash: j.hash, subject: j.rec.subject, type: r.type, label: r.label, target: r.target, raw: r.raw, rec: j.rec })}\n`);
    } catch (err) {
      failed++;
      if (failed > 20 && failed > ok) { say(`\nStopping: the teacher keeps failing (${String(err.message).slice(0, 200)})\n`); process.exit(1); }
    }
    if ((ok + failed) % 50 === 0) say(`  ${ok + failed}/${jobs.length} · ${kept} kept\n`);
  }
};
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
fs.closeSync(outFd);
say(`\nlabeled ${ok}, kept ${kept} as targets, failed ${failed} · ${usage.input} tokens in, ${usage.output} out\n`);
