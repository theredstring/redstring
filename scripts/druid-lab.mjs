#!/usr/bin/env node
/**
 * The Druid's usability lab: a small model as the participant.
 *
 *   npm run druid:lab                        every scenario, 5 trials, LM Studio
 *   npm run druid:lab -- --trials 10 --scenario unconnected-peers
 *   npm run druid:lab -- --mind afm          Apple's on-device model
 *
 * Each trial: a fresh in-memory universe, built for the scenario, one cycle of
 * the real Druid, scored (src/druid/lab/scenarios.js). Prints a table and
 * writes the full trial records as JSON (--out).
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    mind: { type: 'string', default: 'openai' },
    endpoint: { type: 'string', default: 'http://localhost:1234/v1/chat/completions' },
    model: { type: 'string', default: 'qwen/qwen3-4b-2507' },
    bridge: { type: 'string', default: path.join(here, '..', 'native', 'afm-bridge', '.build', 'release', 'afm-bridge') },
    trials: { type: 'string', default: '5' },
    scenario: { type: 'string', default: '' },
    temperature: { type: 'string', default: '0.6' },
    out: { type: 'string', default: '' },
    speak: { type: 'string', default: 'menu' }
  }
});

for (const k of ['log', 'info', 'debug', 'warn', 'error']) console[k] = () => {};
const out = (s) => process.stdout.write(s);

const { createHeadlessStore } = await import('../src/headless/createHeadlessStore.js');
const { useGraphStore } = await createHeadlessStore();
const { applyToolResultToStore, configureToolResultApplier } = await import('../src/services/toolResultApplier.js');
const { executeTool } = await import('../src/wizard/tools/index.js');
const { createWorld } = await import('../src/druid/world.js');
const { createMind } = await import('../src/druid/mind/createMind.js');
const { openaiCompatible } = await import('../src/druid/mind/backends.js');
const { createDruid } = await import('../src/druid/druid.js');
const { scratch } = await import('../src/druid/heldInMind.js');
const { seedRoles } = await import('../src/druid/roles.js');
const { SCENARIOS, score } = await import('../src/druid/lab/scenarios.js');
configureToolResultApplier({});

let backend;
if (args.mind === 'afm') {
  const { afmBackend } = await import('../src/druid/mind/afmBackend.js');
  backend = await afmBackend({ executable: args.bridge });
} else {
  backend = openaiCompatible({ endpoint: args.endpoint, model: args.model });
}

const empty = () => ({
  graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
  activeDefinitionNodeId: null, expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
  savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: true
});

const scenarios = SCENARIOS.filter(s => !args.scenario || s.name === args.scenario);
const trials = Number(args.trials);
const rows = [];
const records = [];
const kindMs = {};

out(`Druid lab · ${backend.id} · speaks in ${args.speak} · ${trials} trial(s) × ${scenarios.length} scenario(s)\n\n`);
for (const sc of scenarios) {
  const tally = { valid: 0, sensible: 0, best: 0, landed: 0, moves: {} };
  for (let t = 0; t < trials; t++) {
    useGraphStore.getState().loadUniverseFromFile(empty());
    const world = createWorld({ store: useGraphStore, executeTool, applyToolResult: (n, r, id, cid) => applyToolResultToStore(n, r, id, cid, { confirmed: true }) });
    const { locus } = await sc.build(world, { scratch, seedRoles });
    const mind = createMind({
      backend,
      temperature: Number(args.temperature),
      onCall: (c) => { (kindMs[c.kind] ||= []).push(c.ms); }
    });
    let rec = null;
    for await (const r of createDruid({ world, mind }, { maxCycles: 1, resume: { tick: 0, locus }, speak: args.speak })) {
      if (r.type === 'cycle') rec = r;
    }
    const s = score(sc, rec);
    for (const k of ['valid', 'sensible', 'best', 'landed']) tally[k] += s[k] ? 1 : 0;
    tally.moves[rec.move || '∅'] = (tally.moves[rec.move || '∅'] || 0) + 1;
    records.push({ scenario: sc.name, trial: t, chose: rec.chose, text: rec.text, result: rec.result, thought: rec.thought, menu: rec.menu, score: s });
    out(`  ${sc.name.padEnd(18)} #${t + 1}  ${s.sensible ? '✓' : '✗'}  ${rec.chose || '(invalid)'}${rec.text ? ` → ${rec.text}` : ''}\n`);
  }
  rows.push({ scenario: sc.name, ...tally });
}

const pct = (n) => `${Math.round((100 * n) / trials)}%`.padStart(5);
out(`\n${'scenario'.padEnd(18)} valid sensible  best landed  moves\n`);
for (const r of rows) {
  out(`${r.scenario.padEnd(18)} ${pct(r.valid)} ${pct(r.sensible)}   ${pct(r.best)} ${pct(r.landed)}  ${Object.entries(r.moves).map(([k, v]) => `${k}×${v}`).join(' ')}\n`);
}
const all = rows.reduce((a, r) => ({ valid: a.valid + r.valid, sensible: a.sensible + r.sensible, best: a.best + r.best, landed: a.landed + r.landed }), { valid: 0, sensible: 0, best: 0, landed: 0 });
const n = rows.length * trials;
out(`${'ALL'.padEnd(18)} ${`${Math.round(100 * all.valid / n)}%`.padStart(5)} ${`${Math.round(100 * all.sensible / n)}%`.padStart(5)}   ${`${Math.round(100 * all.best / n)}%`.padStart(5)} ${`${Math.round(100 * all.landed / n)}%`.padStart(5)}\n`);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
out(`\nms per call (median): ${Object.entries(kindMs).map(([k, v]) => `${k} ${med(v)}`).join(' · ')}\n`);

if (args.out) fs.writeFileSync(args.out, JSON.stringify({ backend: backend.id, trials, rows, records, kindMs }, null, 0));
backend.close?.();
process.exit(0);
