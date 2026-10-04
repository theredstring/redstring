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

const THOUGHT_Q = /what are you thinking now\?/;

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
