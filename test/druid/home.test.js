// @vitest-environment node
/**
 * Nothing the Druid keeps is lost: every web it starts or keeps for itself
 * hangs off Home, so a person opening Home can reach all of it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, quiet } from './helpers/headlessWorld.js';
import { seedRoles } from '../../src/druid/roles.js';
import { wmWeb } from '../../src/druid/heldInMind.js';
import { writeEpisode } from '../../src/druid/episodes.js';
import { topLevelWebs, buildView } from '../../src/druid/attention.js';
import { newWeb, goWeb } from '../../src/druid/moves/basic.js';
import { createMind } from '../../src/druid/mind/createMind.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { createDruid } from '../../src/druid/druid.js';
import { reachableFromHome } from '../../src/druid/lab/outline.js';

beforeAll(() => quiet());

const ctxAt = (world, web) => {
  const locus = { web, focus: null, path: [] };
  const activation = new Map(world.allThings().map(id => [id, 0]));
  return { world, locus, held: [], activation, view: buildView(world, locus, activation) };
};

describe('Home holds what the Druid keeps', () => {
  it('its own webs sit in Home, and each day of episodes in the Diary inside Home', async () => {
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const wm = wmWeb(world);
    await writeEpisode(world, { tick: 1, summary: 'woke', now: new Date('2026-10-04T10:00:00') });
    const day = [...world.state().graphs.values()].find(g => g.name === 'Episodes 2026-10-04').id;
    const diary = world.systemWeb('diary', 'Diary');
    expect(world.thingsIn(home)).toContain(world.ownerOf(wm));
    expect(world.thingsIn(home)).toContain(world.ownerOf(diary));
    expect(world.thingsIn(diary)).toContain(world.ownerOf(day));
    // The Druid does not look at its own webs as content.
    expect(buildView(world, { web: home, focus: null, path: [] }, new Map()).peers.map(p => p.name)).not.toContain('Working Memory');
  });

  it('a web it starts gets a Thing in Home, stays top-level, and is reached from Home by going inside', async () => {
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const r = await newWeb.run(ctxAt(world, home), null, 'Wooden Floor');
    expect(r.ok).toBe(true);
    const floor = r.locus.web;
    expect(world.thingsIn(home)).toContain(world.ownerOf(floor));
    expect(topLevelWebs(world)).toContain(floor);
    // From Home it is a Thing to go inside, not a second way to the same place.
    expect(goWeb.offer(ctxAt(world, home)).map(o => o.data.web)).not.toContain(floor);
  });

  it('a whole life leaves every web reachable from Home', async () => {
    const { world } = await freshWorld();
    const lines = [
      { verb: 'web', rest: 'Baking' },
      { verb: 'make', rest: 'Dough: flour and water' },
      { verb: 'make', rest: 'Flour inside Dough: ground grain' },
      { verb: 'web', rest: 'Ovens' },
      { verb: 'make', rest: 'Brick Oven: an oven of brick' }
    ];
    const mind = createMind({ backend: scripted((req) => {
      if (req.schema.name === 'command') return lines.shift() || { verb: 'note', rest: 'resting' };
      if (/what are you thinking now\?|what have you been doing lately/.test(req.user)) return { text: 'Dough becomes bread in an oven.' };
      return { text: 'A plain description.' };
    }) });
    for await (const r of createDruid({ world, mind }, { maxCycles: 6, speak: 'commands' })) void r;
    const { unreachable } = reachableFromHome(world);
    expect(unreachable.map(g => g.name)).toEqual([]);
  });

  it('a web from before, sitting nowhere, is shelved as it wakes', async () => {
    const { world } = await freshWorld();
    await seedRoles(world);
    const r = await world.act('createGraph', { name: 'Old Thoughts' });
    expect(r.ok).toBe(true);
    const web = [...world.state().graphs.values()].find(g => g.name === 'Old Thoughts').id;
    world.setDruid(world.ownerOf(web), { topic: true });
    expect(reachableFromHome(world).unreachable.map(g => g.name)).toContain('Old Thoughts');
    expect(world.shelveAll()).toBe(1);
    expect(reachableFromHome(world).unreachable.map(g => g.name)).toEqual([]);
  });
});
