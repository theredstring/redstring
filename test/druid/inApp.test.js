// @vitest-environment node
/**
 * The Druid as the app runs it: startDruid over the live store, a backend
 * reached through Electron's preload (faked here), its loop state kept on its
 * Home Thing so it wakes where it left off.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, quiet } from './helpers/headlessWorld.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { DEFAULT_PROMPT_SPACE } from '../../src/druid/promptSpace.js';

// The store and everything that imports it load after the headless shim.
let startDruid, backendFor, executeTool, applyToolResultToStore, ensureHome;
beforeAll(async () => {
  quiet();
  await freshWorld();
  ({ startDruid, backendFor } = await import('../../src/druid/inApp/druidSession.js'));
  ({ executeTool } = await import('../../src/wizard/tools/index.js'));
  ({ applyToolResultToStore } = await import('../../src/services/toolResultApplier.js'));
  ({ ensureHome } = await import('../../src/druid/roles.js'));
});

// The thought, and the through line now and then (dialogue.js): answered without consuming a step.
const THOUGHT_Q = /what are you thinking now\?|what have you been doing lately/;

/** Picks the first option, names things in turn, thinks a fixed thought. */
const simpleMind = () => {
  let n = 0;
  return scripted((req) => {
    if (req.schema.name === 'choice') return { choice: '1' };
    if (req.schema.name === 'fill') return THOUGHT_Q.test(req.user) ? { text: `Rivers carve valleys, moment ${++n}.` } : { text: `River ${++n}` };
    return { key: Object.keys(req.schema.schema.properties)[0] };
  });
};

const deps = (store, backend) => ({
  store,
  executeTool,
  applyToolResult: (name, result, id, cid) => applyToolResultToStore(name, result, id, cid, { confirmed: true }),
  promptSpace: DEFAULT_PROMPT_SPACE,
  backend
});

async function liveFor(store, cycles, opts = {}) {
  const seen = [];
  let session;
  const stopped = new Promise((resolve) => {
    session = startDruid(deps(store, simpleMind()), {
      pauseMs: 0,
      ...opts,
      onCycle: (r) => { seen.push(r); if (seen.length >= cycles) session.stop(); },
      onStop: resolve
    });
  });
  return { seen, end: await stopped, session };
}

describe('the Druid in the app', () => {
  it('lives in the open universe, and the canvas goes to the web it looks at', async () => {
    const { store } = await freshWorld();
    const { seen, end } = await liveFor(store, 4, { seed: 'how rivers shape land' });
    expect(end.error).toBeNull();
    expect(end.reason).toBe('aborted');
    expect(seen).toHaveLength(4);
    const web = seen.at(-1).locus.web;
    expect(web).toBeTruthy();
    expect(store.getState().activeGraphId).toBe(web);
    expect(store.getState().openGraphIds).toContain(web);
  });

  it('keeps its loop state on its Home Thing and wakes where it left off', async () => {
    const { store, world } = await freshWorld();
    await liveFor(store, 3);
    const home = world.ownerOf(await ensureHome(world));
    expect(world.druidOf(home).life.tick).toBe(3);
    const { seen } = await liveFor(store, 2);
    expect(seen[0].tick).toBe(4);
    expect(world.druidOf(home).life.tick).toBe(5);
  });

  it('stops and says why when the model cannot be reached', async () => {
    const { store } = await freshWorld();
    const down = { id: 'down', complete: async () => { throw new Error('fetch failed'); } };
    const end = await new Promise((resolve) => startDruid(deps(store, down), { pauseMs: 0, onStop: resolve, onCycle: () => {} }));
    expect(end.reason).toBe('error');
    expect(end.error).toMatch(/not answering: .*fetch failed/);
  }, 10000);
});

describe('backends in the app', () => {
  it('reaches LM Studio through the main process when there is one', async () => {
    const calls = [];
    const electron = { druid: { chat: async (url, body) => { calls.push({ url, body }); return { ok: true, status: 200, text: JSON.stringify({ choices: [{ message: { content: '{"choice":"1"}' } }] }) }; } } };
    const backend = await backendFor({ mind: 'openai', endpoint: 'http://localhost:1234/v1/chat/completions', model: 'm' }, electron);
    const r = await backend.complete({ system: 's', user: 'u', schema: { name: 'choice', schema: {} }, maxTokens: 10, temperature: 0 });
    expect(r.content).toBe('{"choice":"1"}');
    expect(calls[0].url).toMatch(/localhost:1234/);
    expect(calls[0].body.model).toBe('m');
  });

  it("asks Apple's model through the main process, with the English cue", async () => {
    const sent = [];
    const electron = { druid: { afm: async (req) => { sent.push(req); return req.op === 'health' ? { available: true, contextSize: 4096 } : { ok: true, content: '{}', usage: {} }; } } };
    const backend = await backendFor({ mind: 'afm' }, electron);
    await backend.complete({ system: 's', user: 'u' });
    expect(sent[1].user).toMatch(/^This is written in English\./);
  });

  it("says plainly when Apple's model is unavailable", async () => {
    const electron = { druid: { afm: async () => ({ available: false, reason: 'appleIntelligenceNotEnabled' }) } };
    await expect(backendFor({ mind: 'afm' }, electron)).rejects.toThrow(/unavailable: appleIntelligenceNotEnabled/);
    await expect(backendFor({ mind: 'afm' }, {})).rejects.toThrow(/desktop app/);
  });
});

describe('in the app', () => {
  it('never fetches Wikipedia for what it makes', async () => {
    const { configureToolResultApplier } = await import('../../src/services/toolResultApplier.js');
    const asked = [];
    configureToolResultApplier({ enrich: async (name) => { asked.push(name); return {}; }, enrichMultiple: async (names) => { asked.push(...names); return []; } });
    try {
      const { world } = await freshWorld();
      const { buildUniverse } = await import('./helpers/headlessWorld.js');
      const { webs } = await buildUniverse(world, { webs: { Rivers: { things: { River: 'moving water' } } } });
      asked.length = 0;
      const made = await world.createThing(webs.Rivers, 'Delta');
      expect(made.ok).toBe(true);
      await new Promise(r => setTimeout(r, 0));
      expect(asked).toEqual([]);
    } finally {
      configureToolResultApplier({ enrich: async () => ({ success: false }), enrichMultiple: async () => [] });
    }
  });

  it('copies the whole run as plain text: each moment, what it was asked, and the universe from Home', async () => {
    const { transcriptOf, compactCall } = await import('../../src/components/canvas/druid/druidStore.js');
    const asked = [{ kind: 'fill', question: 'How do Delta and River relate?', ok: true, text: 'River slows into Delta' }, { kind: 'choose', question: 'What do you do?', ok: true, index: 1 }].map(compactCall);
    const text = transcriptOf({
      settings: { mind: 'afm', speak: 'menu' },
      stats: { calls: 4, ms: 2000 },
      throughLine: 'Working out how rivers make deltas.',
      held: ['Delta'],
      stream: [
        { kind: 'you', text: 'think about deltas' },
        { kind: 'moment', tick: 3, size: { webs: 2, things: 5 }, locus: { webName: 'Rivers', focusName: 'Delta' }, thought: 'A delta is where a river slows.', menu: ['look at River', 'connect Delta to River'], chose: 'connect Delta to River', text: 'River slows into Delta', result: { ok: true, summary: 'connected Delta to River' }, asked, slept: { merged: ['Flooring into Floor'], pruned: 0 } },
        { kind: 'moment', tick: 4, locus: { webName: 'Rivers' }, menu: [], chose: 'make Silt', result: { ok: false, summary: 'Silt already exists', error: 'Silt already exists' }, repeating: true },
        { kind: 'reply', text: 'I will look at deltas.' }
      ]
    }, { outline: 'The universe now: 2 webs', now: new Date('2026-10-04T10:30:00Z') });
    expect(text).toBe([
      'The Druid, copied 2026-10-04 10:30',
      "Mind: Apple's model · picks from a menu · quick",
      'Calls: 4, 500 ms each',
      'Lately: Working out how rivers make deltas.',
      'Holding in mind: Delta',
      '',
      'You: think about deltas',
      '',
      '[3] Rivers › Delta  (2 webs, 5 Things)',
      '  thought: A delta is where a river slows.',
      '  offered: 1 look at River | *2 connect Delta to River',
      '  chose: connect Delta to River → "River slows into Delta"',
      '  result: connected Delta to River',
      '  asked (fill): How do Delta and River relate? → "River slows into Delta"',
      '  asked (choose): What do you do? → "2"',
      '  slept: merged 1 (Flooring into Floor)',
      '',
      '[4] Rivers',
      '  chose: make Silt',
      '  FAILED: Silt already exists',
      '  note: repeating itself',
      '',
      'The Druid: I will look at deltas.',
      '',
      'The universe now: 2 webs'
    ].join('\n'));
  });

  it('outlines the universe as a person finds it from Home', async () => {
    const { outline } = await import('../../src/druid/lab/outline.js');
    const { buildUniverse } = await import('./helpers/headlessWorld.js');
    const { world } = await freshWorld();
    await ensureHome(world);
    const { webs } = await buildUniverse(world, { webs: { Rivers: { things: { River: 'moving water', Delta: 'where it slows' }, links: [['River', 'Delta', 'feeds']] } } });
    world.setDruid(world.ownerOf(webs.Rivers), { topic: true });
    expect(outline(world)).toMatch(/Not reachable from Home: Rivers\nRivers — 2 Things, 1 connections\n {2}River, Delta\n {2}River —feeds→ Delta/i);
    world.shelveAll();
    const text = outline(world);
    expect(text).not.toMatch(/Not reachable/);
    expect(text).toMatch(/^Home — 1 Things, 0 connections\n {2}Rivers▸°$/m);
    expect(text).toMatch(/^Rivers \(in Home\) — 2 Things, 1 connections$/m);
  });
});
