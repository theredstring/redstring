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

describe('not about this place itself', () => {
  it('a name made only of words for this place is about the medium; anything in the world is not', async () => {
    const { aboutTheMedium } = await import('../../src/druid/names.js');
    for (const n of ['Home Web', 'New web', 'Web', 'Navigation', 'Contents', 'Web of ideas', 'Web of connections', 'Explore the web']) expect(aboutTheMedium(n)).toBe(true);
    for (const n of ['Spider Web', 'Memory Foam', 'Modern Home', 'Wooden Floor', 'Network Cable', 'Oak']) expect(aboutTheMedium(n)).toBe(false);
    expect(aboutTheMedium('Web', new Set(['web', 'works']))).toBe(false);
  });

  it('refuses to make one while living, unless the person asked about it', async () => {
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    world.actor = 'druid';
    const r = await newWeb.run(ctxAt(world, home), null, 'Home Web');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/about this place itself/);
    const floor = (await newWeb.run(ctxAt(world, home), null, 'Wooden Floor')).locus.web;
    expect((await world.createThing(floor, 'Navigation')).error).toMatch(/about this place itself/);
    world.personWords.add('navigation');
    expect((await world.createThing(floor, 'Navigation')).ok).toBe(true);
  });

  it('its own webs in Home are never offered to wonder about', async () => {
    const { gaps } = await import('../../src/druid/moves/cognitive.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    wmWeb(world);
    expect(gaps(world, home).map(g => world.nameOf(g.id))).not.toContain('Working Memory');
  });
});

describe('a Druid with nothing on its mind', () => {
  it('asks itself, out of context, what in the world it wants to understand, and makes that its first goal', async () => {
    const { openGoals } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const helperAsks = [];
    const answers = ['Navigation', 'How earthquakes happen?'];
    const mind = createMind({ backend: scripted((req) => {
      if (req.schema.name === 'subject') { helperAsks.push(req); return { subject: answers.shift() }; }
      if (req.schema.name === 'choice') return { choice: '1' };
      return { text: 'Earthquakes shake the ground.' };
    }) });
    for await (const r of createDruid({ world, mind }, { maxCycles: 1 })) void r;
    expect(openGoals(world).map(world.nameOf)).toEqual(['Understand how earthquakes happen']);
    // Asked with nothing of this place in view: the medium answer was refused and asked again.
    expect(helperAsks).toHaveLength(2);
    expect(helperAsks[0].user).not.toMatch(/web|Home|Thing/);
  });

  it('is not asked when it was given a seed or already has something built', async () => {
    const { openGoals } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    let asked = 0;
    const mind = createMind({ backend: scripted((req) => {
      if (req.schema.name === 'subject') { asked++; return { subject: 'Volcanoes' }; }
      if (req.schema.name === 'choice') return { choice: '1' };
      return { text: 'Bread rises.' };
    }) });
    for await (const r of createDruid({ world, mind }, { maxCycles: 1, seed: 'how bread rises' })) void r;
    expect(asked).toBe(0);
    expect(openGoals(world).map(world.nameOf)).toEqual(['how bread rises']);
  });
});

describe('subjects, not questions', () => {
  it('a question names its subject; a goal is to understand it', async () => {
    const { asSubject, understandGoal } = await import('../../src/druid/names.js');
    expect(asSubject('What is dark matter?')).toBe('Dark matter');
    expect(asSubject("what's a black hole")).toBe('Black hole');
    expect(asSubject('Is dark matter real?')).toBe('Is dark matter real');
    expect(understandGoal('Dark matter')).toBe('Understand dark matter');
    expect(understandGoal('DNA')).toBe('Understand DNA');
    expect(understandGoal('How plants grow?')).toBe('Understand how plants grow');
  });
});

describe('goals and plans hold steps, not what it learns', () => {
  it('inside a plan, with no web yet, it is offered its first web and not "make a Thing here"', async () => {
    const { make } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { home, types } = await seedRoles(world);
    const goal = await world.createThing(home, 'Understand Mars', { typeNodeId: types.goal });
    world.setDruid(goal.id, { status: 'open' });
    const plan = await world.createThing(home, 'Plan: Understand Mars', { typeNodeId: types.plan });
    world.setDruid(plan.id, { forGoal: goal.id });
    const inside = await world.ensureInside(plan.id);
    await world.createThing(inside, 'Mars geology', { asPart: false });
    expect(topLevelWebs(world)).not.toContain(inside);
    const ctx = ctxAt(world, inside);
    expect(newWeb.offer(ctx)[0]).toMatchObject({ label: 'start your first web, named ___' });
    expect(make.offer(ctx)).toEqual([]);
  });
});
