#!/usr/bin/env node
/**
 * The Druid, headless: a local model thinking to itself in its own universe.
 *
 *   npm run druid -- --model gemma3:12b
 *   npm run druid -- --model qwen3:14b --context 16384 --seed "What is a river?"
 *   npm run druid -- --endpoint http://localhost:1234/v1/chat/completions --model local-model   # LM Studio
 *
 * The graph is a real .redstring file (default ~/.redstring/druid/druid.redstring)
 * that Redstring can open, so you can watch the mind from the app. Give the Druid
 * its own file: the headless writer takes a lock, and two writers on one file fight.
 *
 * Beside the file, in <name>.druid/:
 *   state.json     cycle, epoch, working memory, last thought — a restart resumes here
 *   journal.jsonl  one line per cycle: what it thought, what it ran, what surfaced
 *   epochs/        the universe as it stood at each working-memory rewrite
 *
 * The context window MUST match the server's. Ollama's default is small and it
 * truncates from the front without saying so — which drops the system prompt,
 * and with it the working memory. Start Ollama with OLLAMA_CONTEXT_LENGTH set
 * (e.g. `OLLAMA_CONTEXT_LENGTH=16384 ollama serve`), or set the context length
 * in LM Studio's model load settings, and pass the same number as --context.
 *
 * Ctrl-C stops after saving.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    universe: { type: 'string', default: process.env.DRUID_UNIVERSE || path.join(os.homedir(), '.redstring', 'druid', 'druid.redstring') },
    endpoint: { type: 'string', default: process.env.DRUID_ENDPOINT || 'http://localhost:11434/v1/chat/completions' },
    model: { type: 'string', default: process.env.DRUID_MODEL || '' },
    'api-key': { type: 'string', default: process.env.DRUID_API_KEY || 'local' },
    context: { type: 'string', default: process.env.DRUID_CONTEXT || '8192' },
    'compact-at': { type: 'string', default: '0.7' },
    tier: { type: 'string', default: 'small' },
    steps: { type: 'string', default: '8' },
    cycles: { type: 'string', default: '' },
    pause: { type: 'string', default: '0' },
    temperature: { type: 'string', default: '0.8' },
    'max-output': { type: 'string', default: '2048' },
    seed: { type: 'string', default: '' },
    fresh: { type: 'boolean', default: false },
    thinking: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (args.help || !args.model) {
  process.stdout.write(`The Druid — a local model thinking to itself, with a Redstring graph as its long-term memory.

  --model <name>        model to run (required; or DRUID_MODEL)
  --endpoint <url>      OpenAI-compatible chat endpoint [${args.endpoint}]
  --context <tokens>    the server's context window; must match it [8192]
  --compact-at <0..1>   share of the window that triggers a working-memory rewrite [0.7]
  --universe <file>     the Druid's .redstring file [${args.universe}]
  --seed <text>         something on its mind when a fresh Druid wakes
  --cycles <n>          stop after n cycles (default: run until Ctrl-C)
  --steps <n>           tool steps allowed per cycle [8]
  --pause <ms>          wait between cycles [0]
  --tier small|large    model tier passed to the agent loop [small]
  --temperature <t>     [0.8]
  --max-output <tokens> longest single reply; leaves the rest of the window for the prompt [2048]
  --fresh               ignore saved working memory (the graph is kept)
  --thinking            print the model's reasoning stream
  --verbose             keep the agent loop's own logging
`);
  process.exit(args.help ? 0 : 1);
}

const contextWindow = Number(args.context);
const universePath = path.resolve(args.universe);
const sideDir = universePath.replace(/\.redstring$/, '') + '.druid';
const statePath = path.join(sideDir, 'state.json');
const journalPath = path.join(sideDir, 'journal.jsonl');
const epochsDir = path.join(sideDir, 'epochs');
fs.mkdirSync(epochsDir, { recursive: true });

// The agent loop and the store narrate to the console at length. The Druid's
// own output goes to stdout directly, so silence theirs unless asked.
const out = (s) => process.stdout.write(s);
if (!args.verbose) {
  for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = () => {};
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const accent = (s) => `\x1b[38;5;131m${s}\x1b[0m`;

// ── Boot: shim + store first, everything that imports the store after ──────
const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { openHeadlessUniverse } = await import('../src/headless/HeadlessUniverse.js');
const { applyToolResultToStore, configureToolResultApplier } = await import('../src/services/toolResultApplier.js');
const { runWizardInProcess } = await import('../src/wizard/runWizardInProcess.js');
const { getToolDefinitions } = await import('../src/wizard/tools/schemas.js');
const { buildPolicyToolList, resolveToolPolicy } = await import('../src/wizard/toolPolicy.js');
const { estimateObjectTokens } = await import('../src/wizard/tokenEstimate.js');
const { runDruid } = await import('../src/druid/runDruid.js');
const { graphStateFromStore } = await import('../src/druid/graphStateFromStore.js');

configureToolResultApplier({}); // no network enrichment; the Druid's memories are its own
const universe = await openHeadlessUniverse({ filePath: universePath, useGraphStore, log: args.verbose ? process.stderr.write.bind(process.stderr) : () => {} });

let resume = {};
if (!args.fresh && fs.existsSync(statePath)) {
  try { resume = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { resume = {}; }
}

const apiConfig = {
  provider: 'local',
  endpoint: args.endpoint,
  model: args.model,
  modelTier: args.tier === 'large' ? 'large' : 'small',
  settings: {
    temperature: Number(args.temperature),
    // LLMClient's default for a local server is 8192 — the whole of a typical
    // local window, which a server either rejects or silently shortens.
    max_tokens: Math.min(Number(args['max-output']), Math.floor(contextWindow / 2)),
    maxIterationsLocal: Number(args.steps),
    maxIterationsCloud: Number(args.steps)
  }
};

// What the server reports as prompt tokens includes the tool schemas and the
// graph header; when it reports nothing, the loop estimates from these.
const toolTokens = estimateObjectTokens(buildPolicyToolList(getToolDefinitions(), resolveToolPolicy('druid')));
const overheadTokens = toolTokens + 800;

const controller = new AbortController();
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  out(dim('\n\n(stopping — saving the graph and working memory; Ctrl-C again to force)\n'));
  controller.abort();
});

const st0 = useGraphStore.getState();
out(`${accent('The Druid')} ${dim(`· ${args.model} · ${contextWindow.toLocaleString()} token window · ${universePath}`)}\n`);
out(dim(`  ${st0.nodePrototypes.size} prototypes, ${st0.graphs.size} webs in memory · tools ~${toolTokens.toLocaleString()} tokens of the window${resume.cycle ? ` · resuming at cycle ${resume.cycle + 1}, epoch ${resume.epoch}` : ' · fresh'}\n`));
out(dim('  (the server\'s context length must be at least --context, or it will silently drop the working memory)\n'));

let streamedText = false;
const onEvent = (e) => {
  if (e.type === 'response' && e.content) {
    out(e.content);
    streamedText = true;
  } else if (e.type === 'thinking' && args.thinking && e.content) {
    out(dim(e.content));
  } else if (e.type === 'tool_call') {
    const a = e.args || {};
    const target = a.name || a.query || a.graphName || a.nodeName || '';
    out(dim(`\n  ⚙ ${e.name}${target ? `(${target})` : ''}`));
  } else if (e.type === 'tool_result') {
    const failed = !e.result || e.result.error || e.result.locked;
    out(failed ? red(` ✗ ${String(e.result?.error || e.result?.message || '').slice(0, 120)}`) : dim(' ✓'));
    out('\n');
  }
};

const druid = runDruid({
  runTurn: ({ message, history, systemPrompt, signal }) => runWizardInProcess({
    message,
    graphState: graphStateFromStore(useGraphStore.getState()),
    conversationHistory: history,
    apiKey: args['api-key'],
    apiConfig,
    cid: 'druid',
    systemPrompt,
    toolPolicy: 'druid',
    signal
  }),
  getState: () => useGraphStore.getState(),
  applyToolResult: (name, result, id) => applyToolResultToStore(name, result, id, 'druid', { confirmed: true }),
  onEvent
}, {
  resume,
  seed: args.seed,
  contextWindow,
  compactAt: Number(args['compact-at']),
  overheadTokens,
  maxCycles: args.cycles ? Number(args.cycles) : Infinity,
  pauseMs: Number(args.pause),
  signal: controller.signal
});

const header = (r) => `\n${accent(`── cycle ${r.cycle}`)} ${dim(`· epoch ${r.epoch}`)}`;

try {
  for await (const r of druid) {
    if (r.type === 'stopped') {
      out(dim(`\n(stopped: ${r.reason}${r.error ? ` — ${r.error}` : ''})\n`));
      break;
    }
    if (r.failed) {
      out(`${header(r)} ${red(`model error: ${r.error}`)}\n`);
      continue;
    }

    const surfaced = r.surfaced.map(m => m.name).join(', ');
    out(`${header(r)} ${dim(`· ctx ${Math.round(r.contextFill * 100)}%${surfaced ? ` · surfaced: ${surfaced}` : ''}${r.drifted ? ' (one drifted up)' : ''}`)}\n`);
    if (!streamedText && r.thought) out(`${r.thought}\n`);
    streamedText = false;
    if (r.compaction) {
      const how = r.compaction.fallback ? 'written for it (no note given)' : r.compaction.reason === 'chosen' ? 'rewritten by choice' : `rewritten (${r.compaction.reason})`;
      // A note the model wrote has already streamed past; one written for it has not.
      out(`\n${accent(`⟲ working memory ${how} → epoch ${r.epoch}`)}\n${r.compaction.fallback ? `${dim(r.compaction.memory)}\n` : ''}`);
      await universe.flush();
      if (fs.existsSync(universePath)) {
        await fsp.copyFile(universePath, path.join(epochsDir, `epoch-${String(r.epoch).padStart(4, '0')}.redstring`));
      }
    } else if (r.unchangedNote) {
      out(dim('\n(note rewritten unchanged — context kept)\n'));
    } else if (r.compactionDue) {
      out(dim(`\n(context ${Math.round(r.contextFill * 100)}% — asking for a new note next cycle: ${r.compactionDue})\n`));
    }

    await fsp.writeFile(statePath, JSON.stringify(r.snapshot));
    const { snapshot, message, ...line } = r;
    await fsp.appendFile(journalPath, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
  }
} finally {
  await universe.close();
  out(dim(`saved ${universePath}\n`));
  process.exit(0);
}
