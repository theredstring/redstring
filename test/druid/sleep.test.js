// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { sleep, splitCandidate, descriptionLength, duplicateGroups, revert, normalizeName } from '../../src/druid/sleep.js';

beforeAll(() => quiet());

/**
 * "Bird" with eight kinds: four that fly and nest in trees, four that swim and
 * dive. One kind describes them badly; two describe them compactly.
 */
async function birds() {
  const { world } = await freshWorld();
  const flyers = ['Robin', 'Sparrow', 'Finch', 'Wren'];
  const swimmers = ['Penguin', 'Puffin', 'Cormorant', 'Gannet'];
  const things = { Bird: 'An animal with feathers.', Tree: 'A tall plant.', Sea: 'Salt water.' };
  for (const n of [...flyers, ...swimmers]) things[n] = `A bird called ${n}.`;
  const links = [
    ...flyers.flatMap(n => [[n, 'Tree', 'nests in'], [n, 'Tree', 'flies to']]),
    ...swimmers.flatMap(n => [[n, 'Sea', 'dives into'], [n, 'Sea', 'swims in']])
  ];
  const { ids, webs } = await buildUniverse(world, { webs: { Birds: { things, links } } });
  for (const n of [...flyers, ...swimmers]) world.state().setNodeType(ids[n], ids.Bird);
  return { world, ids, webs, flyers, swimmers };
}

const scriptedCtx = (world, tick, { judge = 'split', names = ['Perching Bird', 'Seabird'] } = {}) => {
  const q = [...names];
  return { world, tick, judge: async () => judge, ask: async () => q.shift() ?? null };
};

describe('sleep: schema reconstruction', () => {
  it('finds a kind that is really two, and the split describes it more compactly', async () => {
    const { world, ids, flyers, swimmers } = await birds();
    const cand = splitCandidate(world, ids.Bird);
    expect(cand).toBeTruthy();
    const groupNames = cand.groups.map(g => g.map(world.nameOf).sort());
    expect(groupNames).toEqual(expect.arrayContaining([[...flyers].sort(), [...swimmers].sort()]));
    expect(cand.after).toBeLessThan(cand.before);
  });

  it('does not propose on one sighting, proposes on the second, and records a revision', async () => {
    const { world, ids, flyers } = await birds();
    const first = await sleep(scriptedCtx(world, 12));
    expect(first.split).toEqual([]);
    expect(first.misfits).toEqual([expect.objectContaining({ kind: 'Bird', sightings: 1 })]);

    const second = await sleep(scriptedCtx(world, 24));
    expect(second.split).toEqual([expect.objectContaining({ kind: 'Bird', into: ['Perching Bird', 'Seabird'] })]);
    const perching = world.findThing('Perching Bird');
    expect(world.proto(perching).typeNodeId).toBe(ids.Bird);
    expect(world.proto(ids[flyers[0]]).typeNodeId).toBe(perching);

    // Reverting restores every member's kind and removes what the split made.
    expect(revert(world, second.split[0].revision)).toBe(true);
    expect(world.proto(ids[flyers[0]]).typeNodeId).toBe(ids.Bird);
    expect(world.findThing('Perching Bird')).toBeNull();
  });

  it('leaves the kind alone when the model says it is one kind, and cools down', async () => {
    const { world, ids } = await birds();
    await sleep(scriptedCtx(world, 12, { judge: 'keep' }));
    const r = await sleep(scriptedCtx(world, 24, { judge: 'keep' }));
    expect(r.declined).toContain('split of Bird');
    expect(world.proto(ids.Robin).typeNodeId).toBe(ids.Bird);
    const again = await sleep(scriptedCtx(world, 36));
    expect(again.misfits).toEqual([]); // cooling down
  });

  it('puts a half-named split back exactly', async () => {
    const { world, ids } = await birds();
    await sleep(scriptedCtx(world, 12));
    const r = await sleep(scriptedCtx(world, 24, { names: ['Perching Bird'] }));
    expect(r.split).toEqual([]);
    expect(world.proto(ids.Robin).typeNodeId).toBe(ids.Bird);
    expect(world.findThing('Perching Bird')).toBeNull();
  });

  it('merges a Thing written twice when the model agrees', async () => {
    const { world } = await freshWorld();
    await buildUniverse(world, { webs: { A: { things: { River: 'Flowing water.' } }, B: { things: { Rivers: 'Water that flows.' } } } });
    expect(duplicateGroups(world)).toHaveLength(1);
    const r = await sleep({ world, tick: 12, judge: async () => 'same', ask: async () => null });
    expect(r.merged).toHaveLength(1);
    expect(duplicateGroups(world)).toHaveLength(0);
  });

  it('description length: a kind costs one, a member what it does not share', () => {
    const feats = new Map([['a', new Set(['x', 'y'])], ['b', new Set(['x', 'y'])], ['c', new Set(['z'])]]);
    expect(descriptionLength([['a', 'b']], feats)).toBe(1);
    expect(descriptionLength([['a', 'b', 'c']], feats)).toBe(1 + 1 + 2);
  });
});

describe('name normalization for duplicates', () => {
  it('treats English plurals as the same name', () => {
    expect(normalizeName('Processes')).toBe(normalizeName('Process'));
    expect(normalizeName('Berries')).toBe(normalizeName('berry'));
    expect(normalizeName('The Rivers')).toBe(normalizeName('river'));
    expect(normalizeName('Glass')).toBe('glass');
    expect(normalizeName('Boxes')).toBe('box');
    expect(normalizeName('Tomatoes')).toBe(normalizeName('Tomato'));
  });
});

describe('a split that names an existing Thing as one of its kinds', () => {
  it('uses it, and reverting gives it back its old kind without deleting it', async () => {
    const { world, ids, webs, flyers } = await birds();
    const songbird = await world.createThing(webs.Birds, 'Songbird', { description: 'Kept from an earlier thought.' });
    await sleep(scriptedCtx(world, 12));
    const r = await sleep(scriptedCtx(world, 24, { names: ['Songbird', 'Seabird'] }));
    expect(r.split[0].into).toEqual(['Songbird', 'Seabird']);
    expect(world.proto(ids[flyers[0]]).typeNodeId).toBe(songbird.id);
    expect(world.proto(songbird.id).typeNodeId).toBe(ids.Bird);
    revert(world, r.split[0].revision);
    expect(world.proto(songbird.id)).toBeTruthy();
    expect(world.proto(songbird.id).typeNodeId).not.toBe(ids.Bird);
    expect(world.proto(ids[flyers[0]]).typeNodeId).toBe(ids.Bird);
    expect(world.findThing('Seabird')).toBeNull();
  });
});
