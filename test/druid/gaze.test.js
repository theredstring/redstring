// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';

beforeAll(() => quiet());

describe('a gaze of its own', () => {
  it('looks, makes webs and writes where it looks, and leaves the person where they are', async () => {
    const looked = [];
    const { world, store } = await freshWorld({ onLook: (g) => looked.push(g) });
    const { webs } = await buildUniverse(world, { webs: { Mine: { things: { Chair: 'c' } }, Ice: { things: { Snowflake: 's' } } } });
    // The person is in Mine, with only that tab open.
    store.getState().openGraphTab?.(webs.Mine);
    store.getState().setActiveGraph(webs.Mine);
    for (const id of [...(store.getState().openGraphIds || [])]) if (id !== webs.Mine) store.getState().closeGraphTab(id);
    const tabs = [...store.getState().openGraphIds];
    world.actor = 'druid';
    world.focusWeb(webs.Ice);
    expect(looked.at(-1)).toBe(webs.Ice);
    expect(store.getState().activeGraphId).toBe(webs.Mine);
    // A new web it starts does not open on the person (moves/basic.js newWeb).
    const { newWeb } = await import('../../src/druid/moves/basic.js');
    const r = await newWeb.run({ world, locus: { web: webs.Ice, focus: null, path: [] }, view: {} }, null, 'Glaciers');
    expect(r.ok).toBe(true);
    expect(looked.at(-1)).toBe(r.locus.web);
    expect(store.getState().activeGraphId).toBe(webs.Mine);
    expect([...store.getState().openGraphIds]).toEqual(tabs);
    // What it makes goes where it looks.
    const made = await world.createThing(r.locus.web, 'Ice sheet');
    expect(made.ok).toBe(true);
    expect(world.thingsIn(r.locus.web).map(world.nameOf)).toContain('Ice sheet');
    expect(world.thingsIn(webs.Mine).map(world.nameOf)).toEqual(['Chair']);
    expect(store.getState().activeGraphId).toBe(webs.Mine);
  });
});
