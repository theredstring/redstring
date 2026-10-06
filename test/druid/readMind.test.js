// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { readMind } from '../../src/druid/inApp/readMind.js';

beforeAll(() => quiet());

describe("reading the Druid's mind for the panel", () => {
  it('reads where it is, its goals and plans, and its beliefs, and writes nothing', async () => {
    const { world, store } = await freshWorld();
    expect(readMind(store)).toBe(null);
    const { seedRoles, roleType, addEvidence } = await import('../../src/druid/roles.js');
    const { hold } = await import('../../src/druid/heldInMind.js');
    const { webs, ids } = await buildUniverse(world, { webs: { Ice: { things: { Snowflake: 's', Gap: 'g' } } } });
    const { home } = await seedRoles(world);
    world.actor = 'druid';
    const g = await world.createThing(home, 'Look at how snowflakes branch', { typeNodeId: roleType(world, 'goal') });
    world.setDruid(g.id, { status: 'open', fromPerson: true, statusAt: 5 });
    const b = await world.createThing(home, 'Gap lets water in', { typeNodeId: roleType(world, 'belief') });
    world.setDruid(b.id, { about: ids.Gap, claim: 'Gap lets water in, so a snowflake can grow' });
    addEvidence(world, b.id, { source: ids.Snowflake, judgment: 'support', tick: 6 });
    hold(world, ids.Gap, 6);
    world.setDruid(world.ownerOf(home), { life: { tick: 7, locus: { web: webs.Ice, focus: ids.Gap, path: [] }, loop: ['Gap lets water in.', 'Snowflakes branch.'], throughLine: 'Looking at Gap.', conversation: { last: 7, ask: 'Look at how snowflakes branch', topic: [ids.Gap], away: [], promised: [] } } });
    const graphs = store.getState().graphs.size;
    const m = readMind(store);
    expect(store.getState().graphs.size).toBe(graphs);
    expect(m.now).toMatchObject({ web: { name: 'Ice' }, focus: { name: 'Gap', web: webs.Ice }, thoughts: ['Snowflakes branch.', 'Gap lets water in.'], throughLine: 'Looking at Gap.' });
    expect(m.now.held.map(h => h.name)).toEqual(['Gap']);
    expect(m.now.conversation).toMatchObject({ ask: 'Look at how snowflakes branch', topic: [{ name: 'Gap' }] });
    expect(m.goals).toMatchObject([{ name: 'Look at how snowflakes branch', fromPerson: true, since: 5 }]);
    expect(m.beliefs).toMatchObject([{ claim: 'Gap lets water in, so a snowflake can grow', about: { name: 'Gap' }, evidence: 1, words: 'leans toward it' }]);
  });
});
