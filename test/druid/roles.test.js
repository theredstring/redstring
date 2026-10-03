// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import {
  seedRoles, roleType, roleOf, openGoals, setGoalStatus, addEvidence, confidence, confidenceWords,
  planSteps, nextStep, activePlans, renderRoles, sourceKind
} from '../../src/druid/roles.js';
import { stepDone, addStep, makePlan } from '../../src/druid/moves/roles.js';

beforeAll(() => quiet());

describe('role types are furniture with behavior', () => {
  it('seeds Home with Goal, Belief, Plan and Episode once', async () => {
    const { world } = await freshWorld();
    const a = await seedRoles(world);
    const b = await seedRoles(world);
    expect(a).toEqual(b);
    expect(world.thingsIn(a.home).map(world.nameOf).sort()).toEqual(['Belief', 'Episode', 'Goal', 'Plan']);
  });

  it('follows the marker, not the name: a renamed or specialized type keeps its behavior', async () => {
    const { world } = await freshWorld();
    const { home, types } = await seedRoles(world);
    world.state().updateNodePrototype(types.goal, (p) => { p.name = 'Aim'; });
    const hunch = await world.createThing(home, 'Ambition', { typeNodeId: types.goal });
    const g = await world.createThing(home, 'Understand rivers', { typeNodeId: hunch.id });
    expect(roleOf(world, g.id)).toBe('goal');
    expect(openGoals(world)).toContain(g.id);
    setGoalStatus(world, g.id, 'resolved', 3);
    expect(openGoals(world)).not.toContain(g.id);
  });

  it('a deleted role type stays deleted, and its behavior stops', async () => {
    const { world } = await freshWorld();
    const { types } = await seedRoles(world);
    world.state().deleteNodePrototype(types.plan);
    await seedRoles(world);
    expect(roleType(world, 'plan')).toBeNull();
  });
});

describe('beliefs: confidence computed from evidence', () => {
  it('counts each source once, weighs its own inferences at half, and never itself', async () => {
    const { world } = await freshWorld();
    const { home, types } = await seedRoles(world);
    const { ids } = await buildUniverse(world, { webs: { W: { things: { Flood: 'a flood seen', Dam: 'a dam' } } } });
    const b = await world.createThing(home, 'Rivers shape land', { typeNodeId: types.belief });
    expect(confidence(world, b.id)).toBe(0.5);
    addEvidence(world, b.id, { source: ids.Flood, judgment: 'support', kind: 'observation', tick: 1 });
    const once = confidence(world, b.id);
    addEvidence(world, b.id, { source: ids.Flood, judgment: 'support', kind: 'observation', tick: 2 });
    expect(confidence(world, b.id)).toBe(once); // rereading the same source does not add
    addEvidence(world, b.id, { source: b.id, judgment: 'strong-support', kind: 'inference', tick: 3 });
    expect(confidence(world, b.id)).toBe(once); // not evidence for itself
    addEvidence(world, b.id, { source: ids.Dam, judgment: 'weaken', kind: 'inference', tick: 4 });
    expect(confidence(world, b.id)).toBeCloseTo(1 / (1 + Math.exp(-(1 - 0.5))), 6);
    expect(confidenceWords(0.95)).toBe('you are sure of it');
  });

  it('knows observations from its own inferences by who made the Thing', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { W: { things: { Given: 'made by a person' } } } });
    world.actor = 'druid';
    const mine = await world.createThing(world.websOf(ids.Given)[0], 'Mine');
    expect(sourceKind(world, ids.Given)).toBe('observation');
    expect(sourceKind(world, mine.id)).toBe('inference');
  });
});

describe('plans: the cursor remembers where it was', () => {
  it('chains steps with "then", shows the next one, and advances', async () => {
    const { world } = await freshWorld();
    const { home, types } = await seedRoles(world);
    const goal = await world.createThing(home, 'Map the river', { typeNodeId: types.goal });
    const ctx = (extra = {}) => ({ world, tick: 1, roles: { home, types }, activation: new Map(), ...extra });
    let r = await makePlan.run(ctx(), { goal: goal.id }, 'find the source');
    expect(r.ok).toBe(true);
    const plan = activePlans(world)[0];
    r = await addStep.run(ctx(), { plan }, 'follow it downstream');
    r = await addStep.run(ctx(), { plan }, 'mark the mouth');
    expect(planSteps(world, plan).map(world.nameOf)).toEqual(['Find the source', 'Follow it downstream', 'Mark the mouth']);
    expect(world.nameOf(nextStep(world, plan))).toBe('Find the source');
    await stepDone.run(ctx(), { plan, step: nextStep(world, plan) });
    expect(world.nameOf(nextStep(world, plan))).toBe('Follow it downstream');
    expect(renderRoles(world)).toMatch(/next step: Follow it downstream/);
  });
});
