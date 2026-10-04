// @vitest-environment node
/**
 * What keeps a long-lived Druid's universe from bloating: names that are
 * names, one relation per meaning, plans that close or lapse, episodes folded
 * into their day. Each was measured in a real run before it was fixed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { shortName, readsAsName } from '../../src/druid/names.js';
import { nameGate } from '../../src/druid/mind/helpers.js';
import { createMind } from '../../src/druid/mind/createMind.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { seedRoles, activePlans, nextStep, roleType, openGoals } from '../../src/druid/roles.js';
import { makePlan, addStep, stepDone, pursueStep } from '../../src/druid/moves/roles.js';
import { lapseStalledPlans, condenseEpisodes, pruneDead, PLAN_PATIENCE, EPISODE_KEEP, PRUNE_AFTER } from '../../src/druid/sleep.js';
import { writeEpisode } from '../../src/druid/episodes.js';
import { auditInsides, moveOut, mergeSame } from '../../src/druid/moves/tidy.js';

beforeAll(() => quiet());

/** Things placed in no web at all: what a careless delete leaves behind. */
const stranded = (world) => {
  // Connection types are never placed; they are what connections are made of.
  const relationTypes = new Set([...world.state().edges.values()].flatMap(e => e.definitionNodeIds || []));
  return world.allThingsIncludingSystem().filter(id => world.websOf(id).length === 0 && !world.insideOf(id) && !relationTypes.has(id));
};

describe('names', () => {
  it('shortens a sentence and keeps a long name', () => {
    expect(shortName('Web of connections is a network of ideas and concepts')).toBe('Web of connections');
    expect(shortName('Gas bubbles push dough up, held by cell walls, making bread rise')).toBe('Gas bubbles push dough up');
    expect(shortName("The Hitchhiker's Guide to the Galaxy")).toBe("The Hitchhiker's Guide to the Galaxy");
    expect(shortName('United Nations Educational, Scientific and Cultural Organization')).toBe('United Nations Educational, Scientific and Cultural Organization');
    expect(readsAsName('"Do not go gentle into that good night"')).toBe(true);
    expect(shortName('Yeast in flour')).toBe('Yeast in flour');
  });

  it('a Thing given a sentence for a name keeps the sentence as its description', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Baking: { things: {} } } });
    const r = await world.createThing(webs.Baking, 'Yeast ferments sugars to produce carbon dioxide gas, causing the dough to rise', { description: 'A step.' });
    expect(r.ok).toBe(true);
    expect(world.nameOf(r.id)).toBe('Yeast ferments sugars to produce');
    expect(world.proto(r.id).description).toBe('Yeast ferments sugars to produce carbon dioxide gas, causing the dough to rise. A step.');
  });

  it('asks the name gate about a long name when there is one, and falls back to code when it says nothing', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { W: { things: {} } } });
    world.nameGate = async (t) => (/yeast/i.test(t) ? { kind: 'sentence', short: 'Yeast and rising' } : /galaxy/i.test(t) ? { kind: 'name' } : null);
    const a = await world.createThing(webs.W, 'Yeast makes the dough rise by making gas bubbles');
    const b = await world.createThing(webs.W, 'the restaurant at the end of the galaxy cookbook');
    const c = await world.createThing(webs.W, 'Rivers carve valleys by eroding hills and depositing sediment');
    expect([a, b, c].map(r => world.nameOf(r.id))).toEqual(['Yeast and rising', 'the restaurant at the end of the galaxy cookbook', 'Rivers carve valleys by eroding']);
  });

  it('the name gate: code first, then one question per call, read strictly, asked once per name', async () => {
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      const input = req.user.split('\n\n').pop().trim();
      if (req.schema.name === 'nameKind') return { answer: /dough/i.test(input) ? 'statement' : /odd/i.test(input) ? 'statement' : 'title' };
      if (req.schema.name === 'shortName') return { name: /dough/i.test(input) ? 'Rising dough' : 'name' };
      return {};
    }) });
    const gate = nameGate(mind);
    expect(await gate('Second Law of Thermodynamics as Taught')).toEqual({ kind: 'name' }); // Title Case, no verb: code decides
    expect(seen).toHaveLength(0);
    expect(await gate('Yeast makes the dough rise by trapping gas')).toEqual({ kind: 'sentence', short: 'Rising dough' });
    expect(await gate('Yeast makes the dough rise by trapping gas')).toEqual({ kind: 'sentence', short: 'Rising dough' });
    expect(seen).toHaveLength(2); // asked once: what it is, then a short name
    expect(await gate('the restaurant at the end of the universe')).toEqual({ kind: 'name' });
    expect(await gate('something odd and long here today')).toBeNull(); // "name" is a placeholder, not a name
    expect(seen.every(r => !/Redstring universe/.test(r.system) && r.temperature < 0.3)).toBe(true);
  });

  it('a Thing that is not a part of what an inside belongs to goes one level out', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Body: { things: { Feet: 'At the ends of the legs.' } } } });
    const inside = world.ensureInside(ids.Feet);
    world.check = async (s) => (/^Bone is a part of Feet$/.test(s) ? true : /is a part of/.test(s) ? false : null);
    const bone = await world.createThing(inside, 'Bone');
    const oak = await world.createThing(inside, 'White Oak');
    expect(bone).toMatchObject({ ok: true, web: inside, movedOut: false });
    expect(oak).toMatchObject({ ok: true, web: webs.Body, movedOut: true });
    expect(world.thingsIn(inside).map(world.nameOf)).toEqual(['Bone']);
  });

});

describe('relations', () => {
  it('a connection that does not make sense is not written; one meaning an existing relation uses it', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Floor: 'f', Footwear: 'shoes', Material: 'm', Wood: 'w' } } } });
    world.check = async (s) => !/Floor sit Footwear/.test(s);
    world.sameRelationAs = async (rel, known) => (rel === 'composed of' && known.some(k => k.toLowerCase() === 'made of') ? 'made of' : null);
    expect((await world.connect(webs.W, ids.Floor, ids.Footwear, 'sit')).ok).toBe(false);
    await world.connect(webs.W, ids.Floor, ids.Wood, 'made of');
    const c = await world.connect(webs.W, ids.Floor, ids.Material, 'composed of');
    expect(c.ok).toBe(true);
    expect(c.relation.toLowerCase()).toBe('made of');
    expect(world.linksIn(webs.W).map(l => l.relation.toLowerCase()).sort()).toEqual(['made of', 'made of']);
  });

  it('reuses a relation already in use under another spelling', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { A: 'a', B: 'b', C: 'c' } } } });
    await world.connect(webs.W, ids.A, ids.B, 'contains');
    await world.connect(webs.W, ids.A, ids.C, 'Contains');
    expect(world.linksIn(webs.W).map(l => l.relation.toLowerCase())).toEqual(['contains', 'contains']);
    expect(world.relationsInUse().filter(r => /contain/i.test(r))).toHaveLength(1);
  });
});

describe('plans', () => {
  async function planned() {
    const { world } = await freshWorld();
    const roles = await seedRoles(world);
    const { webs, ids } = await buildUniverse(world, { webs: { Baking: { things: { Dough: 'Flour and water.', Yeast: 'A fungus.' } } } });
    const goal = await world.createThing(roles.home, 'Bake bread', { typeNodeId: roles.types.goal });
    world.setDruid(goal.id, { status: 'open' });
    const ctx = (extra = {}) => ({ world, tick: 10, roles, activation: new Map(), writes: [], ...extra });
    await makePlan.run(ctx(), { goal: goal.id }, 'mix the dough');
    const plan = activePlans(world)[0];
    return { world, roles, webs, ids, goal: goal.id, plan, ctx };
  }

  it('one plan at a time', async () => {
    const { ctx } = await planned();
    expect(makePlan.offer(ctx())).toEqual([]);
  });

  it('a step is marked done only after real work since it became next', async () => {
    const { world, ids, plan, ctx } = await planned();
    expect(stepDone.offer(ctx({ writes: [{ tick: 10, touched: [plan] }] }))).toEqual([]);           // planning is not work
    expect(stepDone.offer(ctx({ writes: [{ tick: 11, touched: [plan] }] }))).toEqual([]);           // nor is more planning
    const items = stepDone.offer(ctx({ writes: [{ tick: 12, touched: [ids.Dough] }] }));
    expect(items).toHaveLength(1);
    expect(world.nameOf(items[0].data.step)).toBe('Mix the dough');
  });

  it('finishing the last step closes the plan, so a new one can be made', async () => {
    const { world, plan, ctx } = await planned();
    await stepDone.run(ctx({ tick: 12 }), { plan, step: nextStep(world, plan) });
    expect(world.druidOf(plan).status).toBe('done');
    expect(activePlans(world)).toEqual([]);
    expect(makePlan.offer(ctx())).toHaveLength(1);
  });

  it('working on the next step goes to the content it names', async () => {
    const { world, webs, ids, plan, ctx } = await planned();
    const r = await pursueStep.run(ctx(), { plan, step: nextStep(world, plan) });
    expect(r.locus).toEqual({ web: webs.Baking, focus: ids.Dough, path: [] });
  });

  it('a plan stalled on one step is let go in sleep, steps and all; the goal stays', async () => {
    const { world, goal, plan, ctx } = await planned();
    await addStep.run(ctx(), { plan }, 'let it rise');
    expect(lapseStalledPlans(world, 10 + PLAN_PATIENCE - 1)).toEqual([]);
    expect(lapseStalledPlans(world, 10 + PLAN_PATIENCE)).toEqual(['Plan: Bake bread']);
    pruneDead(world, 10 + PLAN_PATIENCE); // the "then" relation nothing uses now
    expect(world.proto(plan)).toBeFalsy();
    expect(world.findThing('Mix the dough')).toBeNull();
    expect(world.findThing('Let it rise')).toBeNull();
    expect(openGoals(world)).toContain(goal);
    expect(stranded(world)).toEqual([]);
  });
});

describe('episodes', () => {
  it('old episodes fold into one Thing for their day; recent ones stay', async () => {
    const { world } = await freshWorld();
    await seedRoles(world);
    const { ids } = await buildUniverse(world, { webs: { Baking: { things: { Dough: 'd', Yeast: 'y' } } } });
    const now = new Date('2026-10-04T12:00:00Z');
    for (let t = 1; t <= 30; t++) {
      await writeEpisode(world, { tick: t, summary: `did ${t}`, touched: t % 3 ? [ids.Dough] : [ids.Yeast], episodeTypeId: roleType(world, 'episode'), now });
    }
    const moments = () => world.allThingsIncludingSystem().filter(id => world.druidOf(id).role === 'episode');
    expect(moments()).toHaveLength(30);
    const tick = 30;
    const folded = await condenseEpisodes(world, tick);
    expect(folded).toBe(30 - EPISODE_KEEP - 1);
    expect(moments()).toHaveLength(EPISODE_KEEP + 1);
    const day = world.allThingsIncludingSystem().find(id => world.druidOf(id).role === 'day');
    expect(world.nameOf(day)).toBe('Day 2026-10-04');
    expect(world.proto(day).description).toMatch(/^5 moments, mostly about Dough, Yeast\.$/);
    // Folding more later adds to the same day.
    await condenseEpisodes(world, tick + 10);
    expect(world.proto(world.allThingsIncludingSystem().find(id => world.druidOf(id).role === 'day')).description).toMatch(/^15 moments/);
    expect(stranded(world)).toEqual([]);
  });
});

describe('pruning', () => {
  it('prunes what the Druid made and nothing holds; never what a person made, or what is connected or in mind', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Given: 'made by a person', Anchor: 'a' } } } });
    world.actor = 'druid';
    const lonely = await world.createThing(webs.W, 'Lonely');
    const held = await world.createThing(webs.W, 'Held');
    const linkedOne = await world.createThing(webs.W, 'Linked');
    await world.connect(webs.W, linkedOne.id, ids.Anchor, 'leans on');
    for (const r of [lonely, held, linkedOne]) world.setDruid(r.id, { uses: [1] });
    expect(pruneDead(world, PRUNE_AFTER - 1)).toEqual([]);
    expect(pruneDead(world, PRUNE_AFTER + 1, new Set([held.id]))).toEqual(['Lonely']);
    expect(world.proto(ids.Given)).toBeTruthy();
    expect(world.proto(linkedOne.id)).toBeTruthy();
    expect(world.proto(held.id)).toBeTruthy();
    expect(stranded(world)).toEqual([]);
  });
});

describe('tidying what is already there', () => {
  it('sleep flags Things inside another that are not parts of it; the Druid is offered to move them out', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Body: { things: { Feet: 'feet' }, insides: { Feet: { Toe: 'a digit', 'White Oak': 'a tree' } } } } });
    world.check = async (s) => !/White Oak is a part/.test(s);
    const inside = world.insideOf(ids.Feet);
    expect(await auditInsides(world)).toEqual(['White Oak in Feet']);
    expect(await auditInsides(world)).toEqual([]); // asked once
    const ctx = { world, locus: { web: inside, focus: null, path: [ids.Feet] } };
    const items = moveOut.offer(ctx);
    expect(items.map(i => i.label)).toEqual(['move White Oak out of Feet (it is not a part of it)']);
    expect((await moveOut.run(ctx, items[0].data)).ok).toBe(true);
    expect(world.thingsIn(inside).map(world.nameOf)).toEqual(['Toe']);
    expect(world.thingsIn(webs.Body)).toContain(ids['White Oak']);
    expect(moveOut.offer(ctx)).toEqual([]);
  });

  it('offers to merge a Thing written twice', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { A: { things: { Tomato: 'red' } }, B: { things: { Tomatoes: 'red fruits' } } } });
    const ctx = { world, view: { focus: { id: ids.Tomato, name: 'Tomato' } } };
    const items = mergeSame.offer(ctx);
    expect(items[0].label).toBe('merge Tomatoes into Tomato (the same Thing, written twice)');
    expect((await mergeSame.run(ctx, items[0].data)).ok).toBe(true);
    expect(world.proto(ids.Tomatoes)).toBeFalsy();
  });
});
