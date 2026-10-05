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
    // It goes on with the code it woke with, and the view says so.
    expect(second.getState().behind).toBe(true);
    const seen = second.getState().stream.length;
    expect(seen).toBeGreaterThanOrEqual(1);
    await until(() => second.getState().stream.length > seen);

    await second.getState().start();
    expect(globalThis.__redstringDruid.session).toBeTruthy();
    second.getState().stop();
    await until(() => second.getState().status === 'idle');
    expect(globalThis.__redstringDruid.session).toBe(null);
    expect(second.getState().behind).toBe(false);
  }, 30000);
});

describe("each universe's run, kept until it is cleared", () => {
  // The panel's module, run again as a reload runs it; the graph store stays (its universe is reloaded from file).
  let runs = 0;
  const STORE = new URL('../../src/components/canvas/druid/druidStore.js', import.meta.url).pathname;
  const panel = () => import(/* @vite-ignore */ `${STORE}?run=${++runs}`);
  const things = (graphs) => graphs.getState().nodePrototypes.size;

  async function universe(slug) {
    await freshWorld(); // the node shims the store needs
    vi.stubGlobal('fetch', fakeFetch);
    const { memoryRecord } = await import('../../src/components/canvas/druid/druidRecord.js');
    globalThis.__redstringDruid?.unwatch?.();
    globalThis.__redstringDruid = { session: null, store: null, stopNote: null, record: memoryRecord() };
    const graphs = (await import('../../src/store/graphStore.js')).default;
    (await import('../../src/services/toolResultApplier.js')).configureToolResultApplier({});
    graphs.getState().loadUniverseFromFile({
      graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
      activeDefinitionNodeId: null, expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
      savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: true, _universeSlug: slug
    });
    return graphs;
  }
  const wake = async (druid) => {
    druid.getState().setSetting('mind', 'openai');
    druid.getState().setSetting('follow', false);
    await druid.getState().start();
  };

  it('comes back after a reload, follows the universe that is open, and goes when cleared', async () => {
    const graphs = await universe('rivers');
    let mod = await panel();
    let druid = mod.useDruidStore;
    druid.getState().say('Think about rivers');
    await wake(druid);
    await until(() => druid.getState().stream.filter(e => e.kind === 'moment').length >= 2);
    druid.getState().stop();
    await until(() => druid.getState().status === 'idle');
    const kept = druid.getState().stream;
    expect(kept.map(e => e.kind)).toContain('woke');
    expect(kept.find(e => e.kind === 'you')).toMatchObject({ text: 'Think about rivers', pending: false });
    expect(kept.find(e => e.kind === 'moment').asked.length).toBeGreaterThan(0);

    // A reload: the module runs again with nothing in memory but the record.
    mod = await panel();
    druid = mod.useDruidStore;
    expect(druid.getState().stream).toEqual([]);
    await mod.watchUniverse();
    expect(druid.getState().universe).toBe('rivers');
    expect(druid.getState().stream).toEqual(kept);

    // Another universe has its own run (none yet). Back again, this one's.
    graphs.setState({ _universeSlug: 'stones' });
    await until(() => druid.getState().universe === 'stones');
    expect(druid.getState().stream).toEqual([]);
    druid.getState().say('Think about stones');
    graphs.setState({ _universeSlug: 'rivers' });
    await until(() => druid.getState().stream.length === kept.length);
    graphs.setState({ _universeSlug: 'stones' });
    await until(() => druid.getState().stream.length === 1);
    expect(druid.getState().stream[0]).toMatchObject({ kind: 'you', text: 'Think about stones', pending: true });

    // Cleared, it stays cleared; the other universe's run is untouched.
    graphs.setState({ _universeSlug: 'rivers' });
    await until(() => druid.getState().stream.length === kept.length);
    druid.getState().clear();
    mod = await panel();
    await mod.watchUniverse();
    expect(mod.useDruidStore.getState().stream).toEqual([]);
    graphs.setState({ _universeSlug: 'stones' });
    await until(() => mod.useDruidStore.getState().stream.length === 1);
    globalThis.__redstringDruid.unwatch?.();
  }, 30000);

  it('answers while asleep, keeps the exchange, and does not answer it again on waking', async () => {
    const graphs = await universe('rivers');
    const mod = await panel();
    const druid = mod.useDruidStore;
    druid.getState().setSetting('mind', 'openai');
    druid.getState().setSetting('follow', false);
    await mod.watchUniverse();
    druid.getState().say('what do you know about rivers?');
    expect(druid.getState().answering).toBe(true);
    await until(() => druid.getState().stream.some(e => e.kind === 'reply'));
    expect(druid.getState().answering).toBe(false);
    expect(druid.getState().stream.map(e => e.kind)).toEqual(['you', 'reply']);
    expect(druid.getState().stream[0]).toMatchObject({ pending: true, answered: true });
    const home = [...graphs.getState().nodePrototypes.values()].find(p => p.semanticMetadata?.druid?.homeOf);
    if (home) expect(home.semanticMetadata.druid.life.talk.map(t => t.who)).toEqual(['person', 'druid']);

    await druid.getState().start();
    await until(() => druid.getState().stream.filter(e => e.kind === 'moment').length >= 2);
    druid.getState().stop();
    await until(() => druid.getState().status === 'idle');
    expect(druid.getState().stream.filter(e => e.kind === 'reply')).toHaveLength(1);
    expect(druid.getState().stream[0].pending).toBe(false);
    globalThis.__redstringDruid.unwatch?.();
  }, 30000);

  it('goes to sleep when another universe is opened, and writes nothing there', async () => {
    const graphs = await universe('rivers');
    const mod = await panel();
    const druid = mod.useDruidStore;
    await wake(druid);
    await until(() => druid.getState().stream.filter(e => e.kind === 'moment').length >= 1);

    // Opened under it, mid-moment: the store now holds the other universe.
    graphs.setState({ _universeSlug: 'stones' });
    const before = things(graphs);
    await until(() => druid.getState().status === 'idle');
    expect(globalThis.__redstringDruid.session).toBe(null);
    expect(druid.getState().error).toMatch(/another universe was opened/);
    expect(druid.getState().stream).toEqual([]);
    expect(things(graphs)).toBe(before);
    globalThis.__redstringDruid.unwatch?.();
  }, 30000);
});

describe('a run shown before runs were kept', () => {
  it('is kept with the universe that is open, not lost on the next waking', async () => {
    await freshWorld();
    const { memoryRecord } = await import('../../src/components/canvas/druid/druidRecord.js');
    globalThis.__redstringDruid?.unwatch?.();
    const record = memoryRecord();
    globalThis.__redstringDruid = { session: null, store: null, stopNote: null, record };
    const graphs = (await import('../../src/store/graphStore.js')).default;
    graphs.setState({ _universeSlug: 'old' });
    const STORE = new URL('../../src/components/canvas/druid/druidStore.js', import.meta.url).pathname;
    const mod = await import(/* @vite-ignore */ `${STORE}?old=1`);
    // What an older panel had on screen: entries without a place in a run.
    mod.useDruidStore.setState({ stream: [{ kind: 'moment', tick: 7, chose: 'look at Rivers' }, { kind: 'reply', text: 'Rivers.' }], throughLine: 'Rivers.' });
    await mod.watchUniverse();
    expect(mod.useDruidStore.getState().stream.map(e => e.tick ?? e.text)).toEqual([7, 'Rivers.']);
    expect(mod.useDruidStore.getState().throughLine).toBe('Rivers.');
    const kept = await record.load('old');
    expect(kept.stream.map(e => e.kind)).toEqual(['moment', 'reply']);
    expect(kept.stream.every(e => e.seq > 0)).toBe(true);
    globalThis.__redstringDruid.unwatch?.();
  });
});
