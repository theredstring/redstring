#!/usr/bin/env node
/**
 * The canaries (src/druid/lab/canaries.js): hand-labeled Druid calls, asked of
 * a model, scored. A fast check of a model, and of a trained one gaming its
 * rewards; the benchmark (druid:bench) is the full measure.
 *
 *   npm run druid:canary -- --mind openai --model qwen/qwen3-4b-2507
 *   npm run druid:canary -- --mind afm
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    mind: { type: 'string', default: 'openai' },
    endpoint: { type: 'string', default: 'http://localhost:1234/v1/chat/completions' },
    model: { type: 'string', default: 'qwen/qwen3-4b-2507' },
    bridge: { type: 'string', default: path.join(here, '..', 'native', 'afm-bridge', '.build', 'release', 'afm-bridge') }
  }
});
for (const k of ['log', 'info', 'debug', 'warn']) console[k] = () => {};

const { openaiCompatible } = await import('../src/druid/mind/backends.js');
const { runCanaries } = await import('../src/druid/lab/canaries.js');
const { rewardWithLabel } = await import('../src/druid/lab/rewards.js');
const backend = args.mind === 'afm'
  ? await (await import('../src/druid/mind/afmBackend.js')).afmBackend({ executable: args.bridge })
  : openaiCompatible({ endpoint: args.endpoint, model: args.model });

const { score, results } = await runCanaries(backend, { rewardWithLabel });
for (const r of results) process.stdout.write(`${r.reward.toFixed(2).padStart(5)}  ${r.name.padEnd(40)} ${String(r.content ?? '').replace(/\s+/g, ' ').slice(0, 90)}${r.reasons?.length ? `  [${r.reasons.join('; ').slice(0, 120)}]` : ''}\n`);
process.stdout.write(`\ncanary score ${score} (from -1 to 1) · ${backend.id}\n`);
backend.close?.();
process.exit(0);
