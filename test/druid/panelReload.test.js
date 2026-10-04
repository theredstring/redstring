// @vitest-environment node
/**
 * The Druid's panel across a hot reload: re-run in dev, the panel's store
 * module made a new store that said "Wake" while the old session went on
 * writing, out of reach, and Wake started a second Druid beside it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { freshWorld, quiet } from './helpers/headlessWorld.js';

beforeAll(() => quiet());

// A model server that answers at once: the first option, a name, a thought.
let n = 0;
const fakeFetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const name = body.response_format?.json_schema?.name;
  const props = body.response_format?.json_schema?.schema?.properties || {};
  const user = (body.messages || []).map(m => m.content).join('\n');
  let out;
  if (name === 'choice') out = { choice: '1' };
  else if (name === 'fill') out = { text: /thinking now|lately/i.test(user) ? 'Rivers keep coming up.' : `River ${++n}` };
  else { const k = Object.keys(props)[0] || 'answer'; out = { [k]: props[k]?.enum ? props[k].enum[0] : 'River' }; }
  const text = JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
};

afterAll(() => { vi.unstubAllGlobals(); delete globalThis.__redstringDruid; });

const until = async (test, ms = 15000) => {
  const t0 = Date.now();
  while (!test()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); }
};

describe('the panel across a hot reload', () => {
  it('a re-run store shows the living Druid, keeps receiving its moments, will not start a second, and can stop it', async () => {
    await freshWorld();
    vi.stubGlobal('fetch', fakeFetch);
    const first = (await import('../../src/components/canvas/druid/druidStore.js')).useDruidStore;
    first.getState().setSetting('mind', 'openai');
    first.getState().setSetting('endpoint', 'http://localhost:1/v1/chat/completions');
    first.getState().setSetting('follow', false);
    await first.getState().start();
    expect(first.getState().status).toBe('living');
    await until(() => first.getState().stream.length >= 1);

    // What Vite does when a file changes: the module runs again.
    vi.resetModules();
    const second = (await import('../../src/components/canvas/druid/druidStore.js')).useDruidStore;
    expect(second).not.toBe(first);
    expect(second.getState().status).toBe('living');
    const seen = second.getState().stream.length;
    expect(seen).toBeGreaterThanOrEqual(1);
    await until(() => second.getState().stream.length > seen);

    await second.getState().start();
    expect(globalThis.__redstringDruid.session).toBeTruthy();
    second.getState().stop();
    await until(() => second.getState().status === 'idle');
    expect(globalThis.__redstringDruid.session).toBe(null);
  }, 30000);
});
