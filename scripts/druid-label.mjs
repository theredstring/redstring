#!/usr/bin/env node
/**
 * Label what the Druid was asked, with a teacher model (src/druid/lab/teacher.js).
 *
 *   npm run druid:label -- --in calls.jsonl --out labels.jsonl --dry-run
 *   ANTHROPIC_API_KEY=… npm run druid:label -- --in calls.jsonl --out labels.jsonl
 *   npm run druid:label -- --in calls.jsonl --out labels.jsonl --provider openai --endpoint http://localhost:1234/v1/chat/completions --model some-model
 *
 * Held-out subjects (lab/subjects.js EVAL) are never labeled: what the
 * benchmark measures must not be trained on. Each prompt is labeled once (by
 * a hash of what was shown), and a run picks up where the last one stopped.
 * --dry-run prints how many calls of each kind would be labeled and what it
 * would cost, and calls nothing.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    in: { type: 'string', default: '' },
    out: { type: 'string', default: '' },
    provider: { type: 'string', default: 'anthropic' },
    model: { type: 'string', default: 'claude-haiku-4-5-20251001' },
    endpoint: { type: 'string', default: '' },
    concurrency: { type: 'string', default: '6' },
    limit: { type: 'string', default: '' },
    types: { type: 'string', default: '' },
    'dry-run': { type: 'boolean', default: false },
    'price-in': { type: 'string', default: '1' },
    'price-out': { type: 'string', default: '5' }
  }
});

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
const jobs = args.limit ? queue.slice(0, Number(args.limit)) : queue;

const byType = {};
let inTokens = 0;
for (const j of jobs) { byType[j.t.type] = (byType[j.t.type] || 0) + 1; inTokens += Math.ceil((j.t.system.length + j.t.user.length) / 3.6); }
const outTokens = jobs.length * 180;
const cost = (inTokens / 1e6) * Number(args['price-in']) + (outTokens / 1e6) * Number(args['price-out']);
say(`${jobs.length} call(s) to label (${done.size} already labeled, ${heldOut} from held-out subjects skipped)\n`);
say(`${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
say(`about ${Math.round(inTokens / 1000)}K tokens in, ${Math.round(outTokens / 1000)}K out: about $${cost.toFixed(2)} at $${args['price-in']}/M in and $${args['price-out']}/M out\n`);
if (args['dry-run'] || !jobs.length) process.exit(0);

const teacher = teacherBackend({ provider: args.provider, model: args.model, endpoint: args.endpoint, apiKey: args.provider === 'openai' ? process.env.TEACHER_API_KEY : undefined });
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
