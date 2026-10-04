#!/usr/bin/env node
/**
 * The health of a Druid's universe, as numbers (src/druid/lab/health.js).
 *
 *   node scripts/druid-health.mjs <file.redstring> [--judge openai|afm] [--json]
 *
 * Reads the file; never writes it. --judge asks a model whether insides hold
 * parts and connections make sense; use a different model from the one the
 * Druid ran with (its own helpers already asked it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    judge: { type: 'string', default: '' },
    endpoint: { type: 'string', default: 'http://localhost:1234/v1/chat/completions' },
    model: { type: 'string', default: 'qwen/qwen3-4b-2507' },
    json: { type: 'boolean', default: false }
  }
});
if (!positionals[0]) { process.stderr.write('usage: druid-health.mjs <file.redstring> [--judge openai|afm] [--json]\n'); process.exit(1); }
for (const k of ['log', 'info', 'debug', 'warn']) console[k] = () => {};

const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { createWorld } = await import('../src/druid/world.js');
const { health, renderHealth } = await import('../src/druid/lab/health.js');
useGraphStore.getState().loadUniverseFromFile(JSON.parse(fs.readFileSync(positionals[0], 'utf8')));
const world = createWorld({ store: useGraphStore });

let judge = null;
let judgePart = null;
let backend = null;
if (args.judge) {
  const { createMind } = await import('../src/druid/mind/createMind.js');
  const { plausible, madeOf } = await import('../src/druid/mind/helpers.js');
  if (args.judge === 'afm') {
    const { afmBackend } = await import('../src/druid/mind/afmBackend.js');
    backend = await afmBackend({ executable: path.join(here, '..', 'native', 'afm-bridge', '.build', 'release', 'afm-bridge') });
  } else {
    const { openaiCompatible } = await import('../src/druid/mind/backends.js');
    backend = openaiCompatible({ endpoint: args.endpoint, model: args.model });
  }
  const judgeMind = createMind({ backend });
  judge = plausible(judgeMind);
  judgePart = madeOf(judgeMind);
}
const r = await health(world, { judge, judgePart });
process.stdout.write(args.json ? `${JSON.stringify(r)}\n` : `${renderHealth(r)}\n`);
backend?.close?.();
process.exit(0);
