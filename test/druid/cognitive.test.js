// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { variant, specialize, chunk, contrast, generalize, analogy, wonder, differences, analogues, gaps } from '../../src/druid/moves/cognitive.js';
import { associate } from '../../src/druid/activation.js';
import { seedRoles, roleOf, confidence } from '../../src/druid/roles.js';
import { buildView } from '../../src/druid/attention.js';

beforeAll(() => quiet());

const answers = (list) => { const q = [...list]; return async () => q.shift() ?? null; };

async function setup(spec, focusName) {
  const { world } = await freshWorld();
  const roles = await seedRoles(world);
  const built = await buildUniverse(world, spec);
  const web = Object.values(built.webs)[0];
  const locus = { web, focus: built.ids[focusName], path: [] };
  const ctx = (extra = {}) => {
    const activation = new Map(world.allThings().map(id => [id, 0]));
    return { world, tick: 5, locus, roles, activation, view: buildView(world, locus, activation, { tick: 5 }), ...extra };
  };
  return { world, ...built, ctx, roles };
}

describe('cognitive moves over the real store', () => {
  it('variant: a new Thing sharing the same parts (placed again, not copied)', async () => {
    const { world, ids, ctx } = await setup({
      webs: { Kitchen: { things: { Bread: 'Baked dough.' }, insides: { Bread: { Flour: 'ground grain', Water: 'water' } } } }
    }, 'Bread');
    const r = await variant.run(ctx({ ask: answers(['It has no yeast.']) }), { of: ids.Bread }, 'Flatbread');
    expect(r.ok).toBe(true);
    const flat = world.findThing('Flatbread');
    expect(world.thingsIn(world.insideOf(flat)).sort()).toEqual([ids.Flour, ids.Water].sort());
    expect(world.proto(flat).description).toMatch(/no yeast/);
  });

  it('specialize: an is-a link, inheriting the inside', async () => {
    const { world, ids, ctx } = await setup({
      webs: { Geology: { things: { Rock: 'A solid mass.' }, insides: { Rock: { Mineral: 'a crystal' } } } }
    }, 'Rock');
    const r = await specialize.run(ctx({ ask: answers(['It forms from cooled lava.']) }), { of: ids.Rock }, 'Basalt');
    expect(r.ok).toBe(true);
    const basalt = world.findThing('Basalt');
    expect(world.proto(basalt).typeNodeId).toBe(ids.Rock);
    expect(world.thingsIn(world.insideOf(basalt))).toEqual([ids.Mineral]);
  });

  it('chunk: offered only for Things that keep being in mind together, and gathers them', async () => {
    const { world, ids, ctx } = await setup({ webs: { Engine: { things: { Piston: 'p', Crank: 'c', Rod: 'r', Valve: 'v' } } } }, 'Piston');
    expect(chunk.offer(ctx())).toEqual([]);
    for (let t = 1; t <= 3; t++) associate(world, [ids.Piston, ids.Crank, ids.Rod], t);
    const items = chunk.offer(ctx({ tick: 3 }));
    expect(items).toHaveLength(1);
    expect(items[0].data.members.sort()).toEqual([ids.Piston, ids.Crank, ids.Rod].sort());
    const r = await chunk.run(ctx(), items[0].data, 'Crank Train');
    expect(r.ok).toBe(true);
    const train = world.findThing('Crank Train');
    expect(world.thingsIn(world.insideOf(train)).sort()).toEqual([ids.Piston, ids.Crank, ids.Rod].sort());
  });

  it('contrast: code lists the differences; the model names the key one, kept as a belief', async () => {
    const { world, ids, ctx } = await setup({
      webs: { Water: { things: { River: 'flowing', Lake: 'still', Sea: 'salty' }, links: [['River', 'Sea', 'flows into']] } }
    }, 'River');
    expect(differences(world, ids.River, ids.Lake, Object.values(world.state().graphs).length ? world.websOf(ids.River)[0] : null)).toEqual([expect.stringMatching(/only River is connected: flows into Sea/i)]);
    const r = await contrast.run(ctx({ ask: answers(['a river moves, a lake does not']) }), { a: ids.River, b: ids.Lake });
    expect(r.ok).toBe(true);
    const belief = world.allThings().find(id => roleOf(world, id) === 'belief');
    expect(world.nameOf(belief)).toMatch(/^River differs from Lake/);
    expect(confidence(world, belief)).toBeGreaterThan(0.5);
  });

  it('generalize: both become kinds of a named parent, never of themselves', async () => {
    const { world, ids, ctx } = await setup({ webs: { Animals: { things: { Dog: 'd', Cat: 'c' } } } }, 'Dog');
    const items = generalize.offer(ctx());
    expect(items[0].data).toEqual({ a: ids.Dog, b: ids.Cat });
    const r = await generalize.run(ctx(), items[0].data, 'Pet');
    expect(r.ok).toBe(true);
    const pet = world.findThing('Pet');
    expect(world.proto(ids.Dog).typeNodeId).toBe(pet);
    expect(world.proto(ids.Cat).typeNodeId).toBe(pet);
    expect(generalize.offer(ctx())).toEqual([]);
    expect((await generalize.run(ctx(), { a: ids.Dog, b: ids.Cat }, 'Dog')).ok).toBe(false);
  });

  it('analogy: code finds the same shape of connections elsewhere; a yes strengthens the link', async () => {
    const { world } = await freshWorld();
    await seedRoles(world);
    const { ids, webs } = await buildUniverse(world, {
      webs: {
        Water: { things: { River: 'r', Rain: 'r', Sea: 's' }, links: [['Rain', 'River', 'feeds'], ['River', 'Sea', 'drains into']] },
        Body: { things: { Vein: 'v', Heart: 'h', Capillary: 'c' }, links: [['Capillary', 'Vein', 'feeds'], ['Vein', 'Heart', 'drains into']] }
      }
    });
    expect(analogues(world, ids.River)).toEqual([{ id: ids.Vein, shared: expect.arrayContaining(['feeds', 'drains into']) }]);
    const r = await analogy.run({ world, tick: 2, judge: async () => 'yes' }, { a: ids.River, b: ids.Vein, shared: ['feeds', 'drains into'] });
    expect(r.ok).toBe(true);
    expect(world.druidOf(ids.River).assoc[ids.Vein].s).toBeGreaterThan(0.3);
    expect(webs.Body).toBeTruthy();
  });

  it('wonder: lists gaps — undescribed, unconnected, connected but never opened', async () => {
    const { world, ids, webs } = await (async () => {
      const { world } = await freshWorld();
      const built = await buildUniverse(world, {
        webs: { W: { things: { Hub: 'A busy central thing.', A: 'A described thing.', B: 'Another described thing.', C: 'A third described thing.', Blank: '' }, links: [['Hub', 'A', 'x'], ['Hub', 'B', 'y'], ['Hub', 'C', 'z']] } }
      });
      return { world, ...built };
    })();
    const g = gaps(world, webs.W);
    expect(g).toEqual(expect.arrayContaining([{ id: ids.Blank, why: 'no description yet' }, { id: ids.Hub, why: 'much connected but never opened up' }]));
    const r = await wonder.run({ world, locus: { web: webs.W, focus: null, path: [] } }, { id: ids.Blank });
    expect(r.locus.focus).toBe(ids.Blank);
  });
});
