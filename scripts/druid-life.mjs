#!/usr/bin/env node
/**
 * The Druid, v2: a small model living in a Redstring universe, choosing from a
 * menu of moves each cycle. See documentation/ai-agent-mcp/DRUID_PLAN.md.
 *
 *   npm run druid                                  LM Studio, the loaded model
 *   npm run druid -- --model qwen/qwen3-4b-2507 --cycles 30
 *   npm run druid -- --mind afm                    Apple's on-device model (native/afm-bridge)
 *
 * Files beside the universe (default ~/.redstring/druid/druid.redstring), in <name>.druid/:
 *   state.json  tick, locus, last thoughts — a restart resumes (waking, with working memory faded)
 *   life.jsonl  one line per cycle: the menu, the choice, the result, the thought
 *   epochs/     the universe at every sleep
 *
 * Give it its own universe file: the writer takes a lock.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    universe: { type: 'string', default: process.env.DRUID_UNIVERSE || path.join(os.homedir(), '.redstring', 'druid', 'druid.redstring') },
    mind: { type: 'string', default: process.env.DRUID_MIND || 'openai' },
    endpoint: { type: 'string', default: process.env.DRUID_ENDPOINT || 'http://localhost:1234/v1/chat/completions' },
    model: { type: 'string', default: process.env.DRUID_MODEL || 'qwen/qwen3-4b-2507' },
    bridge: { type: 'string', default: path.join(here, '..', 'native', 'afm-bridge', '.build', 'release', 'afm-bridge') },
    window: { type: 'string', default: '4096' },
    temperature: { type: 'string', default: '0.6' },
    cycles: { type: 'string', default: '' },
    seed: { type: 'string', default: '' },
    'prompt-space': { type: 'string', default: path.join(here, '..', 'src', 'druid', 'prompt-space.redstring') },
    'sleep-every': { type: 'string', default: '12' },
    fresh: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    speak: { type: 'string', default: process.env.DRUID_SPEAK || 'menu' },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (args.help) {
  process.stdout.write(`The Druid (v2) — a small model living in a Redstring universe.

  --mind openai|afm      model backend [openai]
  --endpoint <url>       chat-completions URL for --mind openai [${args.endpoint}]
  --model <name>         [${args.model}]
  --bridge <path>        afm-bridge executable for --mind afm
  --window <tokens>      the model's window; every call is fit inside it [4096]
  --cycles <n>           stop after n cycles (default: until Ctrl-C)
  --seed <text>          on its mind when it first wakes
  --universe <file>      [${args.universe}]
  --prompt-space <file>  read-only instructions, as a .redstring [src/druid/prompt-space.redstring]
  --sleep-every <n>      cycles between sleeps [12]
  --fresh                ignore saved state (the universe is kept)
  --speak menu|commands  choose from a menu of moves, or write plain commands [menu]
  --verbose              keep the store's and tools' own logging
`);
  process.exit(0);
}

const out = (s) => process.stdout.write(s);
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const accent = (s) => `\x1b[38;5;131m${s}\x1b[0m`;
if (!args.verbose) for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = () => {};

const universePath = path.resolve(args.universe);
const sideDir = universePath.replace(/\.redstring$/, '') + '.druid';
const statePath = path.join(sideDir, 'state.json');
const journalPath = path.join(sideDir, 'life.jsonl');
const epochsDir = path.join(sideDir, 'epochs');
fs.mkdirSync(epochsDir, { recursive: true });

// Shim + store first; everything that imports the store after.
const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { openHeadlessUniverse } = await import('../src/headless/HeadlessUniverse.js');
const { applyToolResultToStore, configureToolResultApplier } = await import('../src/services/toolResultApplier.js');
const { executeTool } = await import('../src/wizard/tools/index.js');
const { createWorld } = await import('../src/druid/world.js');
const { createMind } = await import('../src/druid/mind/createMind.js');
const { openaiCompatible } = await import('../src/druid/mind/backends.js');
const { loadPromptSpace } = await import('../src/druid/promptSpaceFile.js');
const { createDruid } = await import('../src/druid/druid.js');

configureToolResultApplier({});
const universe = await openHeadlessUniverse({
  filePath: universePath,
  useGraphStore,
  log: (msg) => { const line = String(msg); if (/fail|refus|guard|error/i.test(line)) process.stderr.write(`${red(line)}\n`); else if (args.verbose) process.stderr.write(`${line}\n`); }
});

let backend;
if (args.mind === 'afm') {
  const { afmBackend } = await import('../src/druid/mind/afmBackend.js');
  backend = await afmBackend({ executable: args.bridge });
} else {
  backend = openaiCompatible({ endpoint: args.endpoint, model: args.model });
}

const mind = createMind({ backend, window: Number(args.window), temperature: Number(args.temperature) });
const promptSpace = loadPromptSpace(args['prompt-space']);
const world = createWorld({
  store: useGraphStore,
  executeTool,
  applyToolResult: (name, result, id, cid) => applyToolResultToStore(name, result, id, cid, { confirmed: true })
});

let resume = {};
if (!args.fresh && fs.existsSync(statePath)) {
  try { resume = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { resume = {}; }
}

const controller = new AbortController();
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  out(dim('\n(stopping after this cycle — Ctrl-C again to force)\n'));
  controller.abort();
});

out(`${accent('The Druid')} ${dim(`· ${backend.id} · ${args.window}-token calls · ${universePath}`)}\n`);
out(dim(`  ${world.allThings().length} Things · prompt space: ${promptSpace.source}${resume.tick ? ` · waking at cycle ${resume.tick + 1}` : ' · first waking'}\n`));

const life = createDruid({ world, mind, promptSpace }, {
  resume,
  seed: args.seed,
  maxCycles: args.cycles ? Number(args.cycles) : Infinity,
  sleepEvery: Number(args['sleep-every']),
  signal: controller.signal,
  speak: args.speak,
  resumeFromHome: !args.fresh
});

try {
  for await (const r of life) {
    if (r.type === 'stopped') {
      await fsp.writeFile(statePath, JSON.stringify(r.state));
      out(dim(`\n(stopped: ${r.reason})\n`));
      break;
    }
    const where = `${r.locus.webName || '—'}${r.locus.focusName ? ` › ${r.locus.focusName}` : ''}`;
    out(`\n${accent(`── ${r.tick}`)} ${dim(where)}\n`);
    out(`  ${r.result.ok ? '' : red('✗ ')}${r.chose || red('(no valid choice)')}${r.text ? ` ${dim('→')} ${r.text}` : ''}\n`);
    out(`  ${dim(r.result.summary)}\n`);
    if (r.thought) out(`  ${r.thought}\n`);
    if (r.unbacked?.length) out(`  ${red(`(claimed ${r.unbacked.join(', ')} — not in the universe)`)}\n`);
    if (r.slept) out(`  ${accent('☾ slept')} ${dim(JSON.stringify(r.slept).slice(0, 300))}\n`);
    out(dim(`  held: ${r.held.join(', ') || '—'} · ${r.size.things} Things, ${r.size.webs} webs · calls ${mind.stats.calls}, invalid ${mind.stats.invalid}\n`));

    await fsp.writeFile(statePath, JSON.stringify(r.state));
    const { state, ...line } = r;
    await fsp.appendFile(journalPath, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
    if (r.slept) {
      await universe.flush();
      if (fs.existsSync(universePath)) await fsp.copyFile(universePath, path.join(epochsDir, `sleep-${String(r.tick).padStart(5, '0')}.redstring`));
    }
  }
} finally {
  await universe.close();
  backend.close?.();
  const s = mind.stats;
  out(dim(`saved ${universePath} · ${s.calls} calls, ${s.invalid} invalid, ${Math.round(s.ms / Math.max(1, s.calls))} ms/call\n`));
  process.exit(0);
}
