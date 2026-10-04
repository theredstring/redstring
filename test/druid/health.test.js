// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { health, renderHealth } from '../../src/druid/lab/health.js';
import { seedRoles, roleType } from '../../src/druid/roles.js';
import { writeEpisode } from '../../src/druid/episodes.js';

beforeAll(() => quiet());

describe('health', () => {
  it('counts what a person would notice: bookkeeping, sentence names, near-duplicate relations, beliefs treated as Things, parts that are not parts', async () => {
    const { world } = await freshWorld();
    const roles = await seedRoles(world);
    const { webs, ids } = await buildUniverse(world, {
      webs: { House: { things: { Floor: 'f', Wood: 'w', Feet: 'feet', Material: 'm' }, links: [['Floor', 'Wood', 'made of'], ['Floor', 'Material', 'is made of'], ['Feet', 'Floor', 'sit']], insides: { Floor: { Board: 'a plank', Footwear: 'shoes' } } } }
    });
    const belief = await world.createThing(webs.House, 'Pine wood is a soft and flexible type of wood', { typeNodeId: roles.types.belief });
    await world.connect(webs.House, ids.Floor, belief.id, 'is');
    for (let t = 1; t <= 6; t++) await writeEpisode(world, { tick: t, summary: 'x', touched: [ids.Floor], episodeTypeId: roleType(world, 'episode') });

    const judge = async (s) => !/Footwear is a part|Feet sit Floor/.test(s);
    const r = await health(world, { judge });
    expect(r.kinds.episode).toBe(6);
    expect(r.sentenceNames).toBe(0); // shortened on the way in
    expect(r.nearDuplicateRelations).toEqual([['made of', 'is made of']]);
    expect(r.claimsAsThings).toBe(1);
    expect(r.parts).toBe(2);
    expect(r.partsJudged).toMatchObject({ judged: 2, sensiblePct: 50, examples: ['Footwear is a part of Floor'] });
    expect(r.linksJudged.examples).toContain('Feet sit Floor');
    expect(renderHealth(r)).toMatch(/near-duplicate relations: made of \/ is made of/);
  });
});
