// @vitest-environment node
/**
 * Commands: the Druid writes one plain line, the executor does it. Parsing,
 * name resolution, the new tidying verbs, and a life lived in commands.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { COMMANDS, commandByVerb, runCommand, resolveThing, asCommand } from '../../src/druid/commands/commands.js';
import { createMind } from '../../src/druid/mind/createMind.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { createDruid } from '../../src/druid/druid.js';
import { seedRoles, roleOf, activePlans } from '../../src/druid/roles.js';
import { buildView } from '../../src/druid/attention.js';

beforeAll(() => quiet());

const parse = (verb, rest) => commandByVerb(verb).parse(rest);

describe('parsing', () => {
  it('reads each form in plain words', () => {
    expect(parse('make', 'Bone inside Feet: the hard frame of a foot')).toEqual({ name: 'Bone', inside: 'Feet', what: 'the hard frame of a foot' });
    expect(parse('make', 'Sourdough')).toEqual({ name: 'Sourdough', inside: null, what: null });
    expect(parse('connect', 'Floor to Wood as made of')).toEqual({ a: 'Floor', b: 'Wood', relation: 'made of' });
    expect(parse('connect', 'Floor to Wood')).toEqual({ a: 'Floor', b: 'Wood', relation: null });
    expect(parse('move', 'White Oak out')).toEqual({ name: 'White Oak', into: null });
    expect(parse('move', 'Bone into Feet')).toEqual({ name: 'Bone', into: 'Feet' });
    expect(parse('merge', 'Flooring into Floor')).toEqual({ from: 'Flooring', into: 'Floor' });
    expect(parse('rename', '"Web of ideas" to Ideas')).toEqual({ name: 'Web of ideas', to: 'Ideas' });
    expect(parse('both', 'Dog and Cat are kinds of Pet')).toEqual({ a: 'Dog', b: 'Cat', name: 'Pet' });
    expect(parse('group', 'Piston, Crank, Rod as Crank Train')).toEqual({ members: ['Piston', 'Crank', 'Rod'], name: 'Crank Train' });
    expect(parse('go', 'to web Baking')).toEqual({ web: 'Baking' });
    expect(parse('plan', 'then: knead the dough')).toEqual({ then: 'knead the dough' });
    expect(parse('plan', 'step done')).toEqual({ done: true });
    expect(parse('goal', 'reached')).toEqual({ reached: true });
    expect(parse('connect', 'Floor')).toBeNull();
  });

  it('every command has a form the model is shown', () => {
    for (const c of COMMANDS) expect(c.form).toMatch(new RegExp(`^${c.verb}\\b`));
  });
});

async function setup() {
  const { world } = await freshWorld();
  const roles = await seedRoles(world);
  const { webs, ids } = await buildUniverse(world, {
    webs: { Body: { things: { Feet: 'At the ends of the legs.', Floor: 'What you stand on.', Wood: 'Cut trees.', Flooring: 'Boards on a floor.' }, insides: { Feet: { Toe: 'a digit', 'White Oak': 'a tree' } } } }
  });
  world.actor = 'druid';
  const locus = { web: webs.Body, focus: ids.Feet, path: [] };
  const ctx = (extra = {}) => {
    const activation = new Map(world.allThings().map(id => [id, 0]));
    const l = extra.locus || locus;
    return { world, tick: 5, locus: l, roles, activation, held: [], writes: [], view: buildView(world, l, activation, { tick: 5 }), ask: async () => null, release: () => {}, ...extra };
  };
  return { world, roles, webs, ids, ctx };
}

describe('running commands over the real store', () => {
  it('connects by name, bringing a Thing from elsewhere into this web', async () => {
    const { world, webs, ids, ctx } = await setup();
    const r = await runCommand(ctx(), 'connect', 'feet to floor as stand on');
    expect(r).toMatchObject({ ok: true, wrote: true, command: 'connect feet to floor as stand on' });
    expect(world.linksIn(webs.Body).map(l => [world.nameOf(l.a), l.relation.toLowerCase(), world.nameOf(l.b)])).toEqual([['Feet', 'stand on', 'Floor']]);
    expect(resolveThing(ctx(), 'flooring')).toBe(ids.Flooring);
  });

  it('moves a Thing out of an inside it does not belong in', async () => {
    const { world, webs, ids, ctx } = await setup();
    const inside = world.insideOf(ids.Feet);
    const r = await runCommand(ctx({ locus: { web: inside, focus: null, path: [ids.Feet] } }), 'move', 'White Oak out');
    expect(r.ok).toBe(true);
    expect(world.thingsIn(inside).map(world.nameOf)).toEqual(['Toe']);
    expect(world.thingsIn(webs.Body)).toContain(ids['White Oak']);
  });

  it('merges two Things that are the same', async () => {
    const { world, ids, ctx } = await setup();
    const r = await runCommand(ctx(), 'merge', 'Flooring into Floor');
    expect(r.ok).toBe(true);
    expect(world.proto(ids.Flooring)).toBeFalsy();
    expect(world.proto(ids.Floor)).toBeTruthy();
  });

  it('deletes only what it made', async () => {
    const { world, ids, ctx } = await setup();
    expect((await runCommand(ctx(), 'delete', 'Wood')).ok).toBe(false);
    expect(world.proto(ids.Wood)).toBeTruthy();
    const made = await world.createThing(world.websOf(ids.Wood)[0], 'Sawdust');
    expect((await runCommand(ctx(), 'delete', 'Sawdust')).ok).toBe(true);
    expect(world.proto(made.id)).toBeFalsy();
  });

  it('makes a part inside a Thing, with what it is given in the same line', async () => {
    const { world, ids, ctx } = await setup();
    const r = await runCommand(ctx(), 'make', 'Heel inside Feet: the back of a foot');
    expect(r.ok).toBe(true);
    const heel = world.findThing('Heel');
    expect(world.thingsIn(world.insideOf(ids.Feet))).toContain(heel);
    expect(world.proto(heel).description).toBe('the back of a foot');
  });

  it('refuses plainly: unknown Things, beliefs as Things, a step not yet worked on', async () => {
    const { world, roles, webs, ids, ctx } = await setup();
    expect((await runCommand(ctx(), 'connect', 'Feet to Dragon as rides')).error).toMatch(/no Thing named "Dragon"/);
    const b = await world.createThing(webs.Body, 'Feet carry weight', { typeNodeId: roles.types.belief });
    expect(roleOf(world, b.id)).toBe('belief');
    expect((await runCommand(ctx(), 'connect', 'Floor to Feet carry weight as is')).error).toMatch(/only Things are connected/);
    const goal = await world.createThing(roles.home, 'Understand feet', { typeNodeId: roles.types.goal });
    world.setDruid(goal.id, { status: 'open' });
    expect((await runCommand(ctx(), 'plan', 'look at the toes')).ok).toBe(true);
    expect(activePlans(world)).toHaveLength(1);
    expect((await runCommand(ctx(), 'plan', 'step done')).error).toMatch(/not done anything toward/);
    expect((await runCommand(ctx(), 'fly', 'away')).error).toMatch(/not a command/);
    expect(ids.Feet).toBeTruthy();
  });

  it('a line code cannot read is rewritten once by a helper', async () => {
    const { world, ids, ctx } = await setup();
    const rewrite = async (line) => (/stands on/.test(line) ? { verb: 'connect', rest: 'Feet to Floor as stand on' } : null);
    const r = await runCommand(ctx(), 'connect', 'Feet stands on the Floor', { rewrite });
    expect(r).toMatchObject({ ok: true, command: 'connect Feet to Floor as stand on' });
    expect(world.linksIn(world.websOf(ids.Feet)[0])).toHaveLength(1);
  });

  it('going to its own goal is working toward it; an empty "go" becomes a choice among real places', async () => {
    const { world, roles, ids, ctx } = await setup();
    const goal = await world.createThing(roles.home, 'Understand feet', { typeNodeId: roles.types.goal });
    world.setDruid(goal.id, { status: 'open' });
    const toGoal = await runCommand(ctx(), 'go', 'to Understand feet');
    expect(toGoal.summary).toMatch(/went to Feet, toward the goal/);
    const asked = [];
    const r = await runCommand(ctx({ pick: async (q, options) => { asked.push(q, options); return options.indexOf('Floor'); } }), 'go', 'to');
    expect(asked[0]).toMatch(/no Thing named "".*Where do you go\?/);
    expect(r).toMatchObject({ ok: true, locus: { focus: ids.Floor } });
  });

  it('"go to web Home" in a universe with nothing else says to start a web', async () => {
    const { world } = await freshWorld();
    await seedRoles(world);
    const r = await runCommand({ world, locus: { web: null, focus: null, path: [] }, view: { peers: [] } }, 'go', 'to web Home');
    expect(r.error).toMatch(/start a web/);
  });

  it('menu items become suggested commands', async () => {
    const { world, ids, ctx } = await setup();
    const c = ctx();
    const item = (id, data) => ({ move: { id }, data });
    expect(asCommand(item('connect', { a: ids.Feet, b: ids.Floor }), c)).toBe('connect Feet to Floor as RELATION');
    expect(asCommand(item('open', { into: ids.Feet, create: true }), c)).toBe('make PART inside Feet');
    expect(asCommand(item('specialize', { of: ids.Wood }), c)).toBe('kind of Wood: NAME');
    expect(world).toBeTruthy();
  });
});

describe('a life in commands', () => {
  it('lives a few cycles saying commands, every one carried out', async () => {
    const { world } = await freshWorld();
    const lines = [
      { verb: 'web', rest: 'Baking' },
      { verb: 'make', rest: 'Dough: flour and water, worked together' },
      { verb: 'make', rest: 'Yeast: a fungus that makes dough rise' },
      { verb: 'connect', rest: 'Yeast to Dough as raises' },
      { verb: 'make', rest: 'Flour inside Dough: ground grain' }
    ];
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'command') return lines.shift() || { verb: 'note', rest: 'resting' };
      if (/what are you thinking now\?/.test(req.user)) return { text: 'Dough rises because of yeast.' };
      return { text: 'A plain description.' };
    }) });
    const out = [];
    for await (const r of createDruid({ world, mind }, { maxCycles: 5, speak: 'commands' })) if (r.type === 'cycle') out.push(r);
    expect(out.map(r => [r.chose, r.result.ok])).toEqual([
      ['web Baking', true],
      ['make Dough: flour and water, worked together', true],
      ['make Yeast: a fungus that makes dough rise', true],
      ['connect Yeast to Dough as raises', true],
      ['make Flour inside Dough: ground grain', true]
    ]);
    const dough = world.findThing('Dough');
    expect(world.thingsIn(world.insideOf(dough)).map(world.nameOf)).toEqual(['Flour']);
    const commandPrompt = seen.find(r => r.schema.name === 'command').user;
    expect(commandPrompt).toMatch(/connect THING to THING as RELATION/);
  });
});
