#!/usr/bin/env node
/**
 * The rewards (src/druid/lab/rewards.js), as a process the trainer talks to:
 * one JSON object a line in, one out, so a reward is computed by the Druid's
 * own checks, in the Druid's own code, however the trainer is written.
 *
 *   in:  {"rec": {...a recorded call}, "label": {...or null}, "completions": ["{\"text\": …}", …]}
 *   out: {"rewards": [0.8, -1, …], "details": [{"type": "list", "reasons": [...]}, …]}
 *
 * training/druid/grpo.py starts it once and keeps it open.
 */

import readline from 'node:readline';

for (const k of ['log', 'info', 'debug', 'warn']) console[k] = () => {};
const { rewardWithLabel } = await import('../src/druid/lab/rewards.js');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let reply;
  try {
    const { rec, label = null, completions = [] } = JSON.parse(line);
    const scored = completions.map(c => rewardWithLabel(rec, c, label));
    reply = { rewards: scored.map(s => s.reward), details: scored.map(s => ({ type: s.type, rl: s.rl, reasons: s.reasons })) };
  } catch (err) {
    reply = { error: String(err?.message || err) };
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}
