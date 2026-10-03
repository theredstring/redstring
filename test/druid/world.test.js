// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';

beforeAll(() => quiet());

describe('world — the Druid\'s hands on the real store', () => {
  it('creates Things and connections through the wizard tools, verified', async () => {
    const { world } = await freshWorld();
    const { ids, webs } = await buildUniverse(world, {
      webs: { Water: { things: { River: 'Moving water.', Valley: 'Low land.' }, links: [['River', 'Valley', 'carves']] } }
    });
    expect(world.thingsIn(webs.Water).map(world.nameOf).sort()).toEqual(['River', 'Valley']);
    expect(world.linksIn(webs.Water)).toEqual([expect.objectContaining({ a: ids.River, b: ids.Valley })]);
    expect(world.linksIn(webs.Water)[0].relation.toLowerCase()).toBe('carves');
  });

  it('reports a failed write as a failure', async () => {
    const { world } = await freshWorld();
    const r = await world.act('createNode', { name: 'Soul', targetGraphId: 'Nowhere' });
    expect(r.ok).toBe(false);
  });

  it('keeps bookkeeping on the Thing itself, merged', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { W: { things: { A: 'a' } } } });
    world.setDruid(ids.A, { uses: [1] });
    world.setDruid(ids.A, { role: 'goal' });
    expect(world.druidOf(ids.A)).toEqual({ uses: [1], role: 'goal' });
    world.setDruid(ids.A, (d) => ({ ...d, uses: [...d.uses, 2] }));
    expect(world.druidOf(ids.A).uses).toEqual([1, 2]);
  });

  it('makes a system web once, without changing which web is active', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { W: { things: { A: 'a' } } } });
    world.focusWeb(webs.W);
    const wm = world.systemWeb('wm', 'Working Memory');
    expect(world.systemWeb('wm', 'Working Memory')).toBe(wm);
    expect(world.state().activeGraphId).toBe(webs.W);
    expect(world.isSystemWeb(wm)).toBe(true);
    expect(world.isSystemWeb(webs.W)).toBe(false);
    expect(world.allThings().map(world.nameOf)).not.toContain('Working Memory');
  });

  it('places and unplaces a Thing in a second web without touching the Thing', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { W: { things: { A: 'a' } } } });
    const wm = world.systemWeb('wm', 'Working Memory');
    world.place(wm, ids.A);
    world.place(wm, ids.A);
    expect(world.thingsIn(wm)).toEqual([ids.A]);
    world.unplace(wm, ids.A);
    expect(world.thingsIn(wm)).toEqual([]);
    expect(world.proto(ids.A)).toBeTruthy();
  });

  it('gives a Thing an inside, and knows inside from owner', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { W: { things: { Rock: 'a stone' } } } });
    const inside = world.ensureInside(ids.Rock);
    expect(world.insideOf(ids.Rock)).toBe(inside);
    expect(world.ownerOf(inside)).toBe(ids.Rock);
    const q = await world.createThing(inside, 'Quartz', { description: 'a mineral' });
    expect(q.ok).toBe(true);
    expect(world.thingsIn(inside).map(world.nameOf)).toEqual(['Quartz']);
  });
});
