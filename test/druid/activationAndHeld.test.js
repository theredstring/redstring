// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { baseLevel, recordUse, associate, assocStrength, computeActivation, mostActive, NO_USE } from '../../src/druid/activation.js';
import { hold, held, fade, letGo, isInhibited, scratch, promote, wake, CAPACITY, wmWeb } from '../../src/druid/heldInMind.js';

beforeAll(() => quiet());

describe('base level', () => {
  it('rises with use and falls with time', () => {
    expect(baseLevel([], 10)).toBe(NO_USE);
    expect(baseLevel([10], 10)).toBeGreaterThan(baseLevel([5], 10));
    expect(baseLevel([8, 9, 10], 10)).toBeGreaterThan(baseLevel([10], 10));
  });
});

describe('activation over the real store', () => {
  it('spreads from what is in mind along connections and learned associations', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, {
      webs: {
        Water: { things: { River: 'w', Valley: 'v', Delta: 'd' }, links: [['River', 'Valley', 'carves']] },
        Sea: { things: { Lighthouse: 'l', Tide: 't' } }
      }
    });
    let { activation } = computeActivation(world, { tick: 5, sources: [{ id: ids.River, weight: 1 }] });
    expect(activation.get(ids.Valley)).toBeGreaterThan(activation.get(ids.Lighthouse));

    associate(world, [ids.River, ids.Tide], 5);
    ({ activation } = computeActivation(world, { tick: 5, sources: [{ id: ids.River, weight: 1 }] }));
    expect(activation.get(ids.Tide)).toBeGreaterThan(activation.get(ids.Lighthouse));
    expect(mostActive(activation, [ids.Tide, ids.Lighthouse], 1)).toEqual([ids.Tide]);
  });

  it('associations strengthen together and fade apart', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { W: { things: { A: 'a', B: 'b' } } } });
    associate(world, [ids.A, ids.B], 1);
    associate(world, [ids.A, ids.B], 2);
    const e = world.druidOf(ids.A).assoc[ids.B];
    expect(assocStrength(e, 2)).toBeCloseTo(0.2 * 0.97 + 0.2, 5);
    expect(assocStrength(e, 50)).toBeLessThan(0.1);
  });

  it('records uses on the Thing, once per cycle', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { W: { things: { A: 'a' } } } });
    recordUse(world, ids.A, 3); recordUse(world, ids.A, 3); recordUse(world, ids.A, 4);
    expect(world.druidOf(ids.A).uses).toEqual([3, 4]);
  });
});

describe('working memory web', () => {
  const four = { webs: { W: { things: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' } } } };

  it('holds pointers to Things, up to its capacity, evicting the weakest', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, four);
    hold(world, ids.A, 1); fade(world);
    hold(world, ids.B, 2); hold(world, ids.C, 2); hold(world, ids.D, 2);
    const evicted = hold(world, ids.E, 2);
    expect(evicted).toEqual([ids.A]);
    expect(held(world)).toHaveLength(CAPACITY);
    expect(world.proto(ids.A)).toBeTruthy(); // letting go never deletes a real Thing
  });

  it('fades what is not used, and keeps what is', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, four);
    hold(world, ids.A, 1); hold(world, ids.B, 1);
    for (let t = 2; t < 9; t++) { fade(world); hold(world, ids.A, t); }
    expect(held(world).map(i => i.id)).toEqual([ids.A]);
  });

  it('lets go on purpose, and can keep a Thing from coming back', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, four);
    hold(world, ids.A, 1);
    letGo(world, ids.A, 1, 5);
    expect(held(world)).toEqual([]);
    expect(isInhibited(world, ids.A, 3)).toBe(true);
    expect(isInhibited(world, ids.A, 7)).toBe(false);
  });

  it('deletes a half-formed thought that fades without being promoted, keeps a promoted one', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, four);
    const s1 = await scratch(world, 'Rivers remember', 1);
    const s2 = await scratch(world, 'Stone dreams', 1);
    expect(s1.ok && s2.ok).toBe(true);
    promote(world, s2.id, webs.W);
    for (let i = 0; i < 8; i++) fade(world);
    expect(world.proto(s1.id)).toBeNull();
    expect(world.proto(s2.id)).toBeTruthy();
    expect(world.thingsIn(webs.W)).toContain(s2.id);
  });

  it('wakes with most of its hold gone, except open goals', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, four);
    hold(world, ids.A, 1); hold(world, ids.B, 1);
    fade(world); fade(world);
    wake(world, (id) => id === ids.B);
    expect(held(world).map(i => i.id)).toEqual([ids.B]);
    expect(world.thingsIn(wmWeb(world))).toEqual([ids.B]);
  });
});
