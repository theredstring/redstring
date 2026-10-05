// @vitest-environment node
/**
 * Structure before sentences: a Thing with nothing inside is opened up into
 * its parts, several at once, and its parts are opened in turn; while that
 * gap is open, moves that only write sentences rank lower.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { buildView } from '../../src/druid/attention.js';
import { open, deepen, describe as describeMove } from '../../src/druid/moves/basic.js';
import { buildMenu, structureGap } from '../../src/druid/moves/menu.js';
import { druidMoves } from '../../src/druid/druid.js';

beforeAll(() => quiet());

const ctxAt = (world, locus) => {
  const activation = new Map(world.allThings().map(id => [id, 0]));
  return { world, locus, activation, held: [], writes: [], ask: async () => null, view: buildView(world, locus, activation) };
};

describe('structure before sentences', () => {
  it('opening up asks for the parts as a list, and makes them all', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Mind: { things: { Consciousness: 'Being aware.' } } } });
    const ctx = ctxAt(world, { web: webs.Mind, focus: ids.Consciousness, path: [] });
    const [item] = open.offer(ctx);
    expect(item.blank.question).toBe('What are the main parts of Consciousness? Name the parts you could point to on Consciousness itself, not the materials it is made of. Separate them with commas.');
    const r = await open.run(ctx, item.data, 'Perception, Attention, Memory, Thoughts');
    expect(r.ok).toBe(true);
    expect(world.thingsIn(world.insideOf(ids.Consciousness)).map(world.nameOf)).toEqual(['Perception', 'Attention', 'Memory', 'Thoughts']);
  });

  it('inside a Thing, its parts without parts are offered to open up in turn', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { Mind: { things: { Consciousness: 'Being aware.' }, insides: { Consciousness: { Perception: 'p', Attention: 'a' } } } } });
    const inside = world.insideOf(ids.Consciousness);
    const ctx = ctxAt(world, { web: inside, focus: null, path: [ids.Consciousness] });
    const items = deepen.offer(ctx);
    expect(items.map(i => i.label)).toEqual(expect.arrayContaining([expect.stringMatching(/^open up (Perception|Attention), a part of Consciousness: name its parts/)]));
    const r = await deepen.run(ctx, items[0].data, 'Sight, Hearing');
    expect(r.ok).toBe(true);
    expect(r.locus.path).toEqual([ids.Consciousness, items[0].data.into]);
  });

  it('while the focus has no parts, sentence moves rank below building', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Mind: { things: { Consciousness: 'Being aware.', Dreams: 'Sleep stories.' } } } });
    const ctx = ctxAt(world, { web: webs.Mind, focus: ids.Consciousness, path: [] });
    expect(structureGap(ctx)).toBe(true);
    const menu = buildMenu(druidMoves(), ctx, { explore: 0 });
    const rank = (re) => menu.findIndex(m => re.test(m.label));
    expect(rank(/^open up Consciousness/)).toBe(0);
    expect(describeMove.id).toBe('describe');
  });
});

describe('a thought that only says the question back', () => {
  it('is not kept as a thought', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Mind: { things: { Consciousness: 'Being aware.' } } } });
    const mind = createMind({ backend: scripted((req) => {
      if (req.schema.name === 'choice') return { choice: '1' };
      if (/what are you thinking now/.test(req.user)) return { text: 'What are you thinking now? Name the Things you mean.' };
      return { text: 'Perception' };
    }) });
    const out = [];
    for await (const r of createDruid({ world, mind }, { maxCycles: 2, resume: { tick: 0, locus: { web: webs.Mind, focus: null, path: [] } } })) if (r.type === 'cycle') out.push(r);
    expect(out.map(r => r.thought)).toEqual([null, null]);
    expect(out.at(-1).state.loop).toEqual([]);
  });
});

describe('the same name is the same Thing', () => {
  it('a part named like a Thing already made is that Thing, placed here too; nothing goes inside what it holds', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Sky: { things: { Clouds: 'c', Ice: 'i' }, insides: { Clouds: { 'Water droplets': 'w' } } } } });
    world.actor = 'druid';
    const droplets = world.findThing('Water droplets');
    const ice = world.ensureInside(ids.Ice);
    const r = await world.createThing(ice, 'water droplet');
    expect(r).toMatchObject({ ok: true, id: droplets, reused: true });
    expect(world.thingsIn(ice)).toContain(droplets);
    // Clouds holds Water droplets: Clouds cannot go inside Water droplets.
    const inDroplets = world.ensureInside(droplets);
    expect((await world.createThing(inDroplets, 'Clouds')).error).toMatch(/already inside it/);
    expect(webs.Sky).toBeTruthy();
  });
});

describe('sentences that are structure', () => {
  it('a list given as a sentence is still the list', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Physics: { things: { Time: 't' } } } });
    const ctx = ctxAt(world, { web: webs.Physics, focus: ids.Time, path: [] });
    await open.run(ctx, { into: ids.Time, create: true }, 'Time is made of past, present, and future.');
    expect(world.thingsIn(world.insideOf(ids.Time)).map(world.nameOf)).toEqual(['Past', 'Present', 'Future']);
  });

  it('"is a kind of" gives a kind and "is a part of" puts it inside, when the checks agree', async () => {
    const { connect } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Physics: { things: { Electron: 'e', Proton: 'p', Particle: 'q', Atom: 'a' } } } });
    world.check = async (s) => !/Electron is a kind of Proton/.test(s);
    world.isPart = async (part, whole) => part === 'Electron' && whole === 'Atom';
    const at = (focus) => ctxAt(world, { web: webs.Physics, focus, path: [] });
    expect((await connect.run(at(ids.Electron), { a: ids.Electron, b: ids.Proton }, 'Electron is a kind of Proton')).error).toMatch(/not a kind of Proton/);
    expect((await connect.run(at(ids.Electron), { a: ids.Electron, b: ids.Particle }, 'Electron is a kind of particle')).summary).toBe('Electron is a kind of Particle');
    expect(world.typeChain(ids.Electron)).toContain(ids.Particle);
    expect((await connect.run(at(ids.Atom), { a: ids.Atom, b: ids.Electron }, 'Electrons are parts of atoms')).summary).toBe('Electron is a part of Atom');
    expect(world.thingsIn(world.insideOf(ids.Atom))).toContain(ids.Electron);
    expect(world.linksIn(webs.Physics)).toEqual([]);
  });

  it('opening up stops at a depth', async () => {
    const { MAX_DEPTH } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Physics: { things: { Time: 't' } } } });
    const deep = ctxAt(world, { web: webs.Physics, focus: ids.Time, path: Array(MAX_DEPTH).fill(ids.Time) });
    expect(open.offer(deep)).toEqual([]);
  });
});

describe('small things that kept it from building', () => {
  it('names are subjects, a web is not started twice, a relation does not repeat the names', async () => {
    const { make, newWeb, connect } = await import('../../src/druid/moves/basic.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const first = await newWeb.run(ctxAt(world, { web: home, focus: null, path: [] }), null, 'Crying');
    const web = first.locus.web;
    const again = await newWeb.run(ctxAt(world, { web: home, focus: null, path: [] }), null, 'crying');
    expect(again).toMatchObject({ ok: true, locus: { web } });
    expect([...world.state().graphs.values()].filter(g => g.name === 'Crying')).toHaveLength(1);
    await make.run(ctxAt(world, { web, focus: null, path: [] }), {}, 'What is a person?');
    expect(world.thingsIn(web).map(world.nameOf)).toContain('Person');
    await make.run(ctxAt(world, { web, focus: null, path: [] }), {}, 'Tears');
    const [person, tears] = ['Person', 'Tears'].map(n => world.findThing(n));
    const r = await connect.run(ctxAt(world, { web, focus: tears, path: [] }), { a: tears, b: person }, 'comfort');
    expect(r.summary).toBe('Tears comfort Person');
    // A fragment naming only one of them is about that one: "Energy is matter", asked about Mass and Energy.
    expect((await connect.run(ctxAt(world, { web, focus: tears, path: [] }), { a: tears, b: person }, 'Person is matter')).error).toMatch(/is not how Tears and Person relate/);
  });

  it('working toward a goal is offered only when something points to it', async () => {
    const { pursueGoal } = await import('../../src/druid/moves/roles.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { home, types } = await seedRoles(world);
    const g = await world.createThing(home, 'Why do people cry', { typeNodeId: types.goal });
    world.setDruid(g.id, { status: 'open' });
    const ctx = () => ({ ...ctxAt(world, { web: home, focus: null, path: [] }), roles: { home, types } });
    expect(pursueGoal.offer(ctx())).toEqual([]);
    await buildUniverse(world, { webs: { Body: { things: { People: 'humans' } } } });
    expect(pursueGoal.offer(ctx()).map(i => i.label)).toEqual(['work toward your goal "Why do people cry"']);
  });
});

describe('a web it started, still empty', () => {
  it('is filled from its subject: the parts that make it up', async () => {
    const { newWeb } = await import('../../src/druid/moves/basic.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const web = (await newWeb.run(ctxAt(world, { web: home, focus: null, path: [] }), null, 'Space')).locus.web;
    const ctx = ctxAt(world, { web, focus: null, path: [] });
    const [item] = open.offer(ctx);
    expect(item.label).toBe('open up Space: name its parts, ___');
    const r = await open.run(ctx, item.data, 'Stars, Galaxies, Gravity');
    expect(r.ok).toBe(true);
    expect(world.thingsIn(web).map(world.nameOf)).toEqual(['Stars', 'Galaxies', 'Gravity']);
    expect(r.locus).toMatchObject({ web, path: [] });
  });

  it('keeps to its subject: a Thing about knowing in general is refused there', async () => {
    const { newWeb } = await import('../../src/druid/moves/basic.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const web = (await newWeb.run(ctxAt(world, { web: home, focus: null, path: [] }), null, 'Space')).locus.web;
    world.actor = 'druid';
    world.aboutKnowing = async (term, subject) => subject === 'Space' && /Confusion|Curiosity/.test(term);
    expect((await world.createThing(web, 'Confusion')).error).toMatch(/about knowing in general, not about Space/);
    const stars = await world.createThing(web, 'Stars');
    expect(stars.ok).toBe(true);
    // Inside a part, the subject is still the web it hangs from.
    expect(world.topicOf(world.ensureInside(stars.id))).toBe('Space');
    expect((await world.createThing(world.insideOf(stars.id), 'Curiosity')).error).toMatch(/not about Space/);
  });
});

describe('plans hold steps, and nothing is put away into Home', () => {
  it('a step is never the content it names, and a plan is not gone into', async () => {
    const { makePlan } = await import('../../src/druid/moves/roles.js');
    const { seedRoles, isBookkeeping } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { home, types } = await seedRoles(world);
    const { webs, ids } = await buildUniverse(world, { webs: { Physics: { things: { 'Dark matter particle': 'd' } } } });
    world.actor = 'druid';
    const g = await world.createThing(home, 'Understand dark matter', { typeNodeId: types.goal });
    world.setDruid(g.id, { status: 'open' });
    const ctx = { ...ctxAt(world, { web: home, focus: g.id, path: [] }), roles: { home, types }, tick: 1 };
    expect((await makePlan.run(ctx, { goal: g.id }, 'Dark matter particle')).ok).toBe(true);
    const plan = world.allThings().find(id => world.druidOf(id).forGoal === g.id);
    const [step] = world.thingsIn(world.insideOf(plan));
    expect(step).not.toBe(ids['Dark matter particle']);
    expect(isBookkeeping(world, step)).toBe(true);
    expect(open.offer(ctxAt(world, { web: home, focus: plan, path: [] }))).toEqual([]);
    expect(webs.Physics).toBeTruthy();
  });

  it('what is named into an inside stays there, and nothing is put in Home', async () => {
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { newWeb } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const web = (await newWeb.run(ctxAt(world, { web: home, focus: null, path: [] }), null, 'Particles')).locus.web;
    world.actor = 'druid';
    world.isPart = async () => false;
    // The web's own Thing sits only in Home: an inside of a Thing in it is fine, but this web's
    // Thing has no web of content around it.
    const r = await world.createThing(web, 'Electrons');
    expect(r.ok).toBe(true);
    const inner = world.ensureInside(r.id);
    const bad = await world.createThing(inner, 'Galaxies');
    expect(bad.ok).toBe(true);
    expect(bad.web).toBe(inner);
    expect(world.thingsIn(home).map(world.nameOf)).not.toContain('Galaxies');
  });
});

describe('reading parts out of what it says', () => {
  it('"made of" and "composed of" are parts; a plain "and" list splits; vague parts are dropped; a web does not hold itself', async () => {
    const { connect, newWeb } = await import('../../src/druid/moves/basic.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const web = (await newWeb.run(ctxAt(world, { web: home, focus: null, path: [] }), null, 'Galaxy')).locus.web;
    const fill = ctxAt(world, { web, focus: null, path: [] });
    await open.run(fill, open.offer(fill)[0].data, 'galaxies, stars, dark matter');
    expect(world.thingsIn(web).map(world.nameOf)).toEqual(['Stars', 'Dark matter']);
    const dm = world.findThing('Dark matter');
    await open.run(ctxAt(world, { web, focus: dm, path: [] }), { into: dm, create: true }, 'Dark matter is composed of dark energy and unknown particles.');
    expect(world.thingsIn(world.insideOf(dm)).map(world.nameOf)).toEqual(['Dark energy', 'Unknown particles']);
    await open.run(ctxAt(world, { web, focus: world.findThing('Stars'), path: [] }), { into: world.findThing('Stars'), create: true }, 'Unknown, gas');
    expect(world.thingsIn(world.insideOf(world.findThing('Stars'))).map(world.nameOf)).toEqual(['Gas']);
    world.isPart = async (part, whole) => part === 'Stars' && whole === 'Dark matter' ? false : true;
    const stars = world.findThing('Stars');
    const r = await connect.run(ctxAt(world, { web, focus: dm, path: [] }), { a: dm, b: stars }, 'Dark matter is made of Stars');
    expect(r.error).toMatch(/Stars is not a part of Dark matter/);
  });
});

describe('things, not qualities', () => {
  it('a one-word name that looks like a quality is asked about, and refused when it is one', async () => {
    const { looksLikeQuality } = await import('../../src/druid/names.js');
    expect(['Dark', 'Gravitational', 'Mysterious'].every(looksLikeQuality)).toBe(true);
    expect(['Gravity', 'Light', 'Feelings', 'Dark matter'].some(looksLikeQuality)).toBe(false);
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Space: { things: { Stars: 's' } } } });
    world.actor = 'druid';
    world.isQuality = async (w) => w !== 'Animal';
    expect((await world.createThing(webs.Space, 'Gravitational')).error).toMatch(/describes a quality/);
    expect((await world.createThing(webs.Space, 'Animal')).ok).toBe(true);
  });
});

describe('answers taken the right way round', () => {
  it('asked for a kind of Argon and told "noble gas", Argon becomes a kind of Noble gas', async () => {
    const { specialize } = await import('../../src/druid/moves/cognitive.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Air: { things: { Argon: 'a gas' } } } });
    world.check = async (s) => s === 'Argon is a kind of Noble gas';
    const r = await specialize.run({ ...ctxAt(world, { web: webs.Air, focus: ids.Argon, path: [] }), tick: 1 }, { of: ids.Argon }, 'noble gas');
    expect(r.summary).toBe('saw that Argon is a kind of Noble gas');
    expect(world.typeChain(ids.Argon).map(world.nameOf)).toContain('Noble gas');
  });

  it('gathered under the name of one of them, the others become its parts', async () => {
    const { chunk } = await import('../../src/druid/moves/cognitive.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Sky: { things: { Atmosphere: 'a', Air: 'b', Gas: 'c' } } } });
    world.isPart = async () => true;
    const r = await chunk.run(ctxAt(world, { web: webs.Sky, focus: ids.Air, path: [] }), { members: [ids.Atmosphere, ids.Air, ids.Gas] }, 'Atmosphere');
    expect(r.summary).toBe('put Air, Gas inside Atmosphere, as its parts');
    expect(world.thingsIn(world.insideOf(ids.Atmosphere)).map(world.nameOf)).toEqual(['Air', 'Gas']);
  });
});

describe('"A and B are both C"', () => {
  it('makes both kinds of C, and a pair already related as a kind is not offered to connect', async () => {
    const { connect } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Tree: { things: { Glucose: 'g', Fructose: 'f' } } } });
    world.check = async () => true;
    const at = ctxAt(world, { web: webs.Tree, focus: ids.Glucose, path: [] });
    const r = await connect.run(at, { a: ids.Glucose, b: ids.Fructose }, 'Glucose and fructose are both simple sugars that are building blocks.');
    expect(r.summary).toBe('Glucose and Fructose are both kinds of Simple sugars');
    const sugars = world.findThing('Simple sugars');
    expect(world.typeChain(ids.Glucose)).toContain(sugars);
    expect(world.typeChain(ids.Fructose)).toContain(sugars);
    world.state().setNodeType(ids.Fructose, ids.Glucose);
    const offered = connect.offer(ctxAt(world, { web: webs.Tree, focus: ids.Glucose, path: [] })).map(i => i.label);
    expect(offered).not.toContain('connect Glucose to Fructose');
  });
});

describe('kinds as ladders, for the carousel', () => {
  it('a more general kind goes above, a more specific one between, and the carousel shows the whole ladder', async () => {
    const { resolveChain, DEFAULT_ABSTRACTION_DIMENSION, THING_PROTOTYPE_ID } = await import('../../src/wizard/tools/utils/abstractionSpec.js');
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { Physics: { things: { 'Up quark': 'u', Quarks: 'q', Particles: 'p', Fermions: 'f', Colour: 'c' } } } });
    const truths = new Set(['Up quark is a kind of Quarks', 'Quarks is a kind of Particles', 'Up quark is a kind of Particles', 'Quarks is a kind of Fermions', 'Fermions is a kind of Particles']);
    world.check = async (s) => truths.has(s);
    expect((await world.addKind(ids['Up quark'], ids.Quarks)).ok).toBe(true);
    // Particles is above Quarks: it goes above, and Up quark keeps Quarks.
    expect((await world.addKind(ids['Up quark'], ids.Particles)).ok).toBe(true);
    expect(world.typeChain(ids['Up quark']).map(world.nameOf)).toEqual(['Quarks', 'Particles']);
    // Fermions sits between Quarks and Particles.
    expect((await world.addKind(ids.Quarks, ids.Fermions)).ok).toBe(true);
    expect(world.typeChain(ids['Up quark']).map(world.nameOf)).toEqual(['Quarks', 'Fermions', 'Particles']);
    // Unrelated: refused, not overwritten.
    expect((await world.addKind(ids['Up quark'], ids.Colour)).ok).toBe(false);
    expect(world.proto(ids['Up quark']).typeNodeId).toBe(ids.Quarks);
    const protos = [...world.state().nodePrototypes.values()];
    const ladder = [ids['Up quark'], ids.Quarks, ids.Fermions, ids.Particles, THING_PROTOTYPE_ID];
    expect(resolveChain(ids['Up quark'], DEFAULT_ABSTRACTION_DIMENSION, protos).chain).toEqual(ladder);
    // From a rung in the middle, the carousel shows the same ladder.
    expect(resolveChain(ids.Quarks, DEFAULT_ABSTRACTION_DIMENSION, protos).chain).toEqual(ladder);
  });
});

describe('nothing new is no success', () => {
  it('saying again that two are both kinds of something is refused; a sentence as a name goes to the name gate', async () => {
    const { connect } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Air: { things: { Nitrogen: 'n', Oxygen: 'o' } } } });
    world.check = async () => true;
    const at = ctxAt(world, { web: webs.Air, focus: ids.Nitrogen, path: [] });
    expect((await connect.run(at, { a: ids.Nitrogen, b: ids.Oxygen }, 'Nitrogen and Oxygen are both gases')).ok).toBe(true);
    expect((await connect.run(at, { a: ids.Nitrogen, b: ids.Oxygen }, 'Nitrogen and Oxygen are gases.')).error).toMatch(/already both kinds of Gases/);
    world.nameGate = async () => ({ kind: 'sentence', short: 'Volcano vents' });
    const r = await world.createThing(webs.Air, 'Volcanoes are fireholes in the earth.');
    expect(world.nameOf(r.id)).toBe('Volcano vents');
  });
});

describe('parts and kinds from "both"', () => {
  it('"both parts of X" puts both inside X; a generic kind is refused; a relation about this place is refused', async () => {
    const { connect } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Brain: { things: { Neurons: 'n', 'Cell body': 'c', Dendrites: 'd', Ocean: 'o', Fish: 'f' } } } });
    world.check = async () => true;
    world.isPart = async () => true;
    const at = (f) => ctxAt(world, { web: webs.Brain, focus: f, path: [] });
    const r = await connect.run(at(ids['Cell body']), { a: ids['Cell body'], b: ids.Dendrites }, 'Cell body and Dendrites are both parts of Neurons.');
    expect(r.summary).toBe('Cell body and Dendrites are parts of Neurons');
    expect(world.thingsIn(world.insideOf(ids.Neurons)).map(world.nameOf)).toEqual(['Cell body', 'Dendrites']);
    expect((await connect.run(at(ids.Ocean), { a: ids.Ocean, b: ids.Fish }, 'Ocean and Fish are both things')).error).toMatch(/too general/);
    expect((await connect.run(at(ids.Ocean), { a: ids.Ocean, b: ids.Fish }, 'Ocean is a web about Fish')).error).toMatch(/about this place itself/);
    expect((await connect.run(at(ids.Ocean), { a: ids.Ocean, b: ids.Fish }, 'Ocean is home to Fish')).summary).toBe('Ocean is home to Fish');
  });
});

describe('names and relations that are not', () => {
  it('a label before a colon is not a part, a relation naming a third Thing is refused, a short sentence goes to the gate', async () => {
    const { connect } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Atom: { things: { Hydrogen: 'h', Electrons: 'e', Protons: 'p', Quarks: 'q' } } } });
    await open.run(ctxAt(world, { web: webs.Atom, focus: ids.Hydrogen, path: [] }), { into: ids.Hydrogen, create: true }, 'Main parts of Hydrogen: Protons, Electrons');
    expect(world.thingsIn(world.insideOf(ids.Hydrogen)).map(world.nameOf)).toEqual(['Protons', 'Electrons']);
    const r = await connect.run(ctxAt(world, { web: webs.Atom, focus: ids.Electrons, path: [] }), { a: ids.Electrons, b: ids.Quarks }, 'Electrons orbit protons in Quarks');
    expect(r.error).toMatch(/names another Thing/);
    world.actor = 'druid';
    world.nameGate = async () => ({ kind: 'sentence', short: 'Gluon particles' });
    expect(world.nameOf((await world.createThing(webs.Atom, 'Gluons are particles')).id)).toBe('Gluon particles');
    world.nameGate = async () => { throw new Error('not asked'); };
    expect(world.nameOf((await world.createThing(webs.Atom, 'Nuclear fusion reaction')).id)).toBe('Nuclear fusion reaction');
  });
});

describe('depth is how deep a web sits', () => {
  it('counts insides below the web it hangs from, however it got there; "Understanding X" names X', async () => {
    const { MAX_DEPTH } = await import('../../src/druid/moves/basic.js');
    const { asSubject } = await import('../../src/druid/names.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Trees: { things: { Cellulose: 'c' } } } });
    world.setDruid(world.ownerOf(webs.Trees), { topic: true });
    let web = webs.Trees; let id = ids.Cellulose;
    for (const name of ['Glucose', 'Sugar', 'Carbon', 'Protons']) {
      const inside = world.ensureInside(id);
      id = (await world.createThing(inside, name)).id;
      web = inside;
    }
    expect(world.depthOf(webs.Trees)).toBe(0);
    expect(world.depthOf(web)).toBe(4);
    // Arrived by "go to", with no path: still too deep to open further.
    expect(open.offer(ctxAt(world, { web, focus: id, path: [] }))).toEqual([]);
    expect(MAX_DEPTH).toBe(4);
    expect(asSubject('Understanding Black Hole')).toBe('Black Hole');
  });
});

describe('aspects and building blocks', () => {
  it('an aspect is not a Thing; "the building blocks of" is a part', async () => {
    const { connect } = await import('../../src/druid/moves/basic.js');
    const { isAspect } = await import('../../src/druid/names.js');
    expect(['Composition', 'Origin', 'Role of outer layers', 'Empty'].every(isAspect)).toBe(true);
    expect(['Rocks', 'Structural steel', 'Origin story'].some(isAspect)).toBe(false);
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Atom: { things: { Protons: 'p', Nucleus: 'n', Sand: 's', Minerals: 'm', Dunes: 'd' } } } });
    world.actor = 'druid';
    expect((await world.createThing(webs.Atom, 'Composition')).error).toMatch(/an aspect of something/);
    world.isPart = async () => true;
    world.check = async () => true;
    const at = (f) => ctxAt(world, { web: webs.Atom, focus: f, path: [] });
    expect((await connect.run(at(ids.Nucleus), { a: ids.Nucleus, b: ids.Protons }, 'Protons are the building blocks of Nucleus')).summary).toBe('Protons is a part of Nucleus');
    expect((await connect.run(at(ids.Sand), { a: ids.Sand, b: ids.Minerals }, 'Sand and Minerals are the building blocks of Dunes')).summary).toBe('Sand and Minerals are parts of Dunes');
  });
});

describe('the subject stays on top', () => {
  it('a web\'s subject never goes inside its parts; make takes one Thing; "both composed of" is no kind', async () => {
    const { newWeb, make, connect } = await import('../../src/druid/moves/basic.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    const web = (await newWeb.run(ctxAt(world, { web: home, focus: null, path: [] }), null, 'Pluto')).locus.web;
    world.actor = 'druid';
    const ice = (await world.createThing(web, 'Ice')).id;
    expect((await world.createThing(world.ensureInside(ice), 'Pluto')).error).toMatch(/what this whole web is about/);
    await make.run(ctxAt(world, { web, focus: null, path: [] }), {}, 'Nitrogen and Methane');
    expect(world.thingsIn(web).map(world.nameOf)).toEqual(['Ice', 'Nitrogen']);
    world.check = async () => true;
    const water = (await world.createThing(web, 'Water')).id;
    const r = await connect.run(ctxAt(world, { web, focus: ice, path: [] }), { a: ice, b: water }, 'Ice and Water are both composed of molecules.');
    expect(r.ok).toBe(false);
    expect(world.findThing('Composed')).toBeFalsy();
  });
});

describe('kinds are not parts', () => {
  it('a kind named in the parts goes on the ladder and is noticed, not placed in any web of content; properties and comparatives are not parts', async () => {
    const { sameHead, isAspect, isPlainlyQuality, looksLikeQuality } = await import('../../src/druid/names.js');
    expect(sameHead('Up quark', 'Quarks')).toBe(true);
    expect(sameHead('Cell membrane', 'Cell')).toBe(false);
    expect(['Causes', 'Location', 'Depth', 'Kind of', 'Factors'].every(isAspect)).toBe(true);
    expect(['Outermost', 'Less dense'].every(isPlainlyQuality)).toBe(true);
    expect(looksLikeQuality('Cooler')).toBe(true);
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Physics: { things: { Quarks: 'q', Particle: 'p' } } } });
    world.actor = 'druid';
    world.isPart = async () => true;
    world.check = async () => true;
    const quarks = world.ensureInside(ids.Quarks);
    const r = await world.createThing(quarks, 'Up quark');
    expect(r).toMatchObject({ ok: true, kindOf: ids.Quarks, noticed: true });
    expect(world.thingsIn(webs.Physics)).not.toContain(r.id);
    expect(world.typeChain(r.id)).toContain(ids.Quarks);
    expect(world.thingsIn(quarks)).not.toContain(r.id);
    const ctx = ctxAt(world, { web: webs.Physics, focus: ids.Particle, path: [] });
    const o = await open.run(ctx, { into: ids.Particle, create: true }, 'Quarks, Fundamental particle, Outermost');
    expect(o.ok).toBe(true);
    expect(o.summary).toBe('opened up Particle and found Quarks inside; Fundamental particle is a kind of Particle, not a part of it');
    expect(world.findThing('Outermost')).toBeFalsy();
    // Inside a Thing, what sits beside the one opened is not its part.
    const sun = (await world.createThing(webs.Physics, 'Sun')).id;
    const layers = world.ensureInside(sun);
    for (const n of ['Core', 'Radiative zone', 'Photosphere']) await world.createThing(layers, n);
    const zone = world.findThing('Radiative zone');
    const z = await open.run(ctxAt(world, { web: layers, focus: zone, path: [sun] }), { into: zone, create: true }, 'Hydrogen, Photosphere');
    expect(z.summary).toBe('opened up Radiative zone and found Hydrogen inside; Photosphere sits beside it already');
    expect(world.thingsIn(world.insideOf(zone)).map(world.nameOf)).toEqual(['Hydrogen']);
  });

  it('a merge never leaves a Thing inside itself', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Quarks: 'q' } } } });
    const inside = world.ensureInside(ids.Quarks);
    const q = await world.createThing(inside, 'Quark');
    expect(q.ok).toBe(true);
    await world.act('mergeNodes', { primaryPrototypeId: ids.Quarks, secondaryPrototypeId: q.id });
    world.unnest(ids.Quarks);
    expect(world.thingsIn(world.insideOf(ids.Quarks))).not.toContain(ids.Quarks);
    expect(world.thingsIn(webs.W)).toContain(ids.Quarks);
  });
});

describe('relations that say something', () => {
  it('"is about" and a relation that repeats a name are refused; a sentence with no relation is asked again as a blank', async () => {
    const { connectSaying, emptyRelation } = await import('../../src/druid/moves/basic.js');
    expect(emptyRelation('is about', 'Quantum field', 'Superposition')).toMatch(/does not say how/);
    expect(emptyRelation('interact with', 'Interaction', 'Quarks')).toMatch(/only repeats a name/);
    expect(emptyRelation('cause', 'Causes', 'Magnitude')).toMatch(/only repeats a name/);
    expect(emptyRelation('drive screws into', 'Screwdriver', 'Boards')).toBe(null);
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Particles: 'p', Energy: 'e', Field: 'f' } } } });
    world.check = async () => true;
    const asked = [];
    const ctx = { world, locus: { web: webs.W }, ask: async (q) => { asked.push(q); return 'carry'; } };
    const r = await connectSaying(ctx, ids.Particles, ids.Energy, 'Particles and Energy are fundamental to quantum mechanics.');
    expect(r.ok).toBe(true);
    expect(asked[0]).toMatch(/"Particles ___ Energy"/);
    expect(world.linksIn(webs.W).map(l => `${world.nameOf(l.a)} ${l.relation.toLowerCase()} ${world.nameOf(l.b)}`)).toEqual(['Particles carry Energy']);
    expect((await connectSaying({ ...ctx, ask: async () => 'none' }, ids.Field, ids.Energy, 'Field and Energy are fundamental to quantum mechanics.')).ok).toBe(false);
    // "impacts" is kept only when nothing sharper comes back.
    const sharp = await connectSaying({ ...ctx, ask: async () => 'stores' }, ids.Field, ids.Energy, 'Field impacts Energy');
    expect(sharp).toMatchObject({ ok: true, relation: 'stores' });
    const vague = await connectSaying({ ...ctx, ask: async () => 'none' }, ids.Field, ids.Particles, 'Field impacts Particles');
    expect(vague).toMatchObject({ ok: true, relation: 'impacts' });
    const { isAspect, asSubject, normalizeName } = await import('../../src/druid/names.js');
    expect(isAspect("Sun's Role")).toBe(true);
    expect(asSubject('Sometimes chromium')).toBe('Chromium');
    expect(normalizeName('Gases')).toBe(normalizeName('Gas'));
  });
});

describe('not straight back', () => {
  it('going back to a Thing it just left ranks lower', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Causes: 'c', Magnitude: 'm' }, links: [['Causes', 'Magnitude', 'shape']] } } });
    const ctx = ctxAt(world, { web: webs.W, focus: ids.Magnitude, path: [] });
    const score = (left) => buildMenu(druidMoves(), ctx, { explore: 0, left, size: 40 }).find(m => /^go to Causes/.test(m.label))?.score;
    expect(score([ids.Causes])).toBeLessThan(score([]) - 0.4);
  });
});

describe('one Thing, once', () => {
  it('a part listed twice is made once; a kind each way is no kind; a gathered name is not their names run together', async () => {
    const { chunk } = await import('../../src/druid/moves/cognitive.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Volcano: { things: { Magma: 'm', Water: 'w', Gases: 'g' } } } });
    world.actor = 'druid';
    world.isPart = async () => true;
    world.check = async () => true;
    world.isKind = async () => true;
    const o = await open.run(ctxAt(world, { web: webs.Volcano, focus: ids.Magma, path: [] }), { into: ids.Magma, create: true }, 'Minerals, Molten rock, Minerals');
    expect(world.thingsIn(world.insideOf(ids.Magma)).map(world.nameOf)).toEqual(['Minerals', 'Molten rock']);
    expect(o.summary).toBe('opened up Magma and found Minerals, Molten rock inside');
    const r = await chunk.run(ctxAt(world, { web: webs.Volcano, focus: ids.Water, path: [] }), { members: [ids.Magma, ids.Water] }, 'Magma-Water');
    expect(r.error).toMatch(/only puts their names together/);
    expect((await world.createThing(webs.Volcano, 'Magma-Water')).error).toMatch(/only puts names together/);
    expect((await world.createThing(webs.Volcano, 'Magma structure')).error).toMatch(/an aspect of Magma/);
  });
});

describe('gathering nests; it does not repeat', () => {
  it('the same Things gathered again are refused; more than a gathering gathers its Thing, so the groups nest', async () => {
    const { chunk, gatherable, gatheredIn } = await import('../../src/druid/moves/cognitive.js');
    const { isGroupInsideGroup } = await import('../../src/services/groupLayout.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Contact: { things: { 'Temporary bond': 't', 'Weak attraction': 'w', Surface: 's' } } } });
    world.actor = 'druid';
    world.focusWeb(webs.Contact);
    const ctx = { world, locus: { web: webs.Contact, focus: ids['Temporary bond'], path: [] } };
    const pair = [ids['Temporary bond'], ids['Weak attraction']];
    const first = await chunk.run(ctx, { members: pair }, 'Temporary attachment');
    expect(first.ok).toBe(true);
    const attachment = world.findThing('Temporary attachment');
    expect(gatheredIn(world, webs.Contact).map(g => g.thing)).toEqual([attachment]);

    // The same two again, by another name: refused, and not offered.
    expect(gatherable(world, webs.Contact, pair)).toBe(null);
    const again = await chunk.run(ctx, { members: pair }, 'Stick-slip event');
    expect(again.ok).toBe(false);
    expect(again.summary || again.error).toMatch(/already make up Temporary attachment/);

    // The two and one more: the gathering's Thing and the one more, so it nests.
    const three = gatherable(world, webs.Contact, [...pair, ids.Surface]);
    expect(three).toEqual([attachment, ids.Surface]);
    const second = await chunk.run(ctx, { members: three }, 'Stick-slip event');
    expect(second.ok).toBe(true);
    const groups = [...world.graph(webs.Contact).groups.values()];
    const inner = groups.find(g => g.linkedNodePrototypeId === attachment);
    const outer = groups.find(g => g.linkedNodePrototypeId === world.findThing('Stick-slip event'));
    expect(isGroupInsideGroup(inner, outer)).toBe(true);
    expect(isGroupInsideGroup(outer, inner)).toBe(false);
  });
});

describe('what is missing is not a Thing', () => {
  it('"No signal" is refused as a part; a hyphened name is a Thing', async () => {
    const { isAbsence } = await import('../../src/druid/names.js');
    expect(['No signal', 'No vibration', 'Without light', 'Lack of water', 'Absence of sound', 'Non living'].every(isAbsence)).toBe(true);
    expect(['No-fly zone', 'Non-Newtonian fluid', 'Absence', 'Nothingness', 'Noise', 'North'].some(isAbsence)).toBe(false);
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Absence: { things: { Silence: 's' } } } });
    world.actor = 'druid';
    expect((await world.createThing(webs.Absence, 'No signal')).error).toMatch(/names something missing/);
    expect((await world.createThing(webs.Absence, 'No-fly zone')).ok).toBe(true);
  });
});

describe('what it does is not a Thing', () => {
  it('"Find" is refused; a refused "both kinds of" is asked again as a blank', async () => {
    const { connectSaying } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Moon: { things: { Dust: 'd', Rock: 'r', Minerals: 'm' } } } });
    world.actor = 'druid';
    expect((await world.createThing(webs.Moon, 'find')).error).toMatch(/something you do/);
    world.check = async () => true;
    world.isKind = async () => false;
    const ctx = { world, locus: { web: webs.Moon }, ask: async () => 'covers' };
    const r = await connectSaying(ctx, ids.Dust, ids.Rock, 'Dust and Rock are both minerals.');
    expect(r).toMatchObject({ ok: true, relation: 'covers' });
  });
});

describe('the first moments', () => {
  it('no second goal before there is a web; the same goal is refused; an aspect is no web', async () => {
    const { seedRoles, roleType } = await import('../../src/druid/roles.js');
    const { commitGoal } = await import('../../src/druid/moves/roles.js');
    const { newWeb } = await import('../../src/druid/moves/basic.js');
    const { world } = await freshWorld();
    const { home } = await seedRoles(world);
    world.actor = 'druid';
    const types = { goal: roleType(world, 'goal') };
    const g = await world.createThing(home, 'Understand dark matter', { typeNodeId: types.goal });
    world.setDruid(g.id, { status: 'open' });
    const ctx = { ...ctxAt(world, { web: home, focus: null, path: [] }), roles: { home, types } };
    expect(commitGoal.offer(ctx)).toEqual([]);
    expect((await commitGoal.run(ctx, {}, 'Dark Matter')).error).toMatch(/already your goal/);
    expect((await newWeb.run(ctx, {}, 'Structure')).error).toMatch(/no subject of its own/);
  });
});

describe('an inside by the sort of composition it is', () => {
  it('an object by its parts at its scale, a process by its stages leading to each other, an idea by what makes it up', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Sky: { things: {} } } });
    world.actor = 'druid';
    world.category = async (name) => ({ Rain: 'process', Love: 'idea' })[name] || 'thing';
    world.isQuality = async (w) => /^(Romantic|Platonic)$/.test(w);
    const rain = (await world.createThing(webs.Sky, 'Rain')).id;
    const love = (await world.createThing(webs.Sky, 'Love')).id;
    expect(world.druidOf(rain).category).toBe('process');
    const at = (f) => ctxAt(world, { web: webs.Sky, focus: f, path: [] });
    const [r] = open.offer(at(rain));
    expect(r.label).toBe('open up Rain: name its stages in order, ___');
    const s = await open.run(at(rain), r.data, 'Evaporation, Condensation, Precipitation');
    expect(s.summary).toBe('opened up Rain into its stages: Evaporation, then Condensation, then Precipitation');
    expect(world.linksIn(world.insideOf(rain)).map(l => `${world.nameOf(l.a)} ${l.relation.toLowerCase()} ${world.nameOf(l.b)}`))
      .toEqual(['Evaporation leads to Condensation', 'Condensation leads to Precipitation']);
    const { stageName } = await import('../../src/druid/moves/basic.js');
    expect(['Then Freezing', 'Step 2: Osmosis', 'Intestines. Then', 'First'].map(stageName)).toEqual(['Freezing', 'Osmosis', 'Intestines', '']);
    const [k] = open.offer(at(love));
    expect(k.label).toBe('open up Love: name what makes it up, ___');
    const o = await open.run(at(love), k.data, 'Intimacy, Commitment, Trust');
    expect(o.ok).toBe(true);
    expect(world.thingsIn(world.insideOf(love)).map(world.nameOf)).toEqual(['Intimacy', 'Commitment', 'Trust']);
  });
});

describe('where structures meet', () => {
  it('the view says what else the focus sits inside', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Earth: { things: { Water: 'w', Rock: 'r' }, insides: { Water: { Oxygen: 'o' } } } } });
    const inWater = world.insideOf(ids.Water);
    const oxygen = world.thingsIn(inWater)[0];
    world.place(world.ensureInside(ids.Rock), oxygen);
    const ctx = ctxAt(world, { web: inWater, focus: oxygen, path: [ids.Water] });
    expect(ctx.view.focus.alsoIn).toEqual(['Rock']);
    expect(webs.Earth).toBeTruthy();
  });
});

describe('its memory is not an edit', () => {
  it('rewriting a Thing\'s Druid memory adds nothing to undo history; making the Thing does', async () => {
    const { default: useHistoryStore } = await import('../../src/store/historyStore.js');
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { W: { things: {} } } });
    world.actor = 'druid';
    await new Promise(r => setTimeout(r, 80));
    const before = useHistoryStore.getState().history.length;
    const made = await world.createThing(webs.W, 'Granite');
    await new Promise(r => setTimeout(r, 80));
    const afterMake = useHistoryStore.getState().history.length;
    expect(afterMake).toBeGreaterThan(before);
    for (let i = 0; i < 20; i++) world.setDruid(made.id, (d) => ({ ...d, uses: (d.uses || 0) + 1 }));
    await new Promise(r => setTimeout(r, 80));
    expect(useHistoryStore.getState().history.length).toBe(afterMake);
    expect(world.druidOf(made.id).uses).toBe(20);
  });
});

describe('a long run stays whole', () => {
  it('forgetting removes every placement; sleep repairs placements left behind, folds a second inside, merges exact twins and stray steps', async () => {
    const { sleep } = await import('../../src/druid/sleep.js');
    const { stepName } = await import('../../src/druid/moves/roles.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Earth: { things: { Ice: 'i', Rock: 'r', Moss: 'm' } } } });
    world.actor = 'druid';
    // Forgotten, out of every web.
    world.place(world.ensureInside(ids.Rock), ids.Moss);
    world.forget(ids.Moss);
    expect([...world.state().graphs.values()].flatMap(g => [...(g.instances?.values?.() || Object.values(g.instances || {}))]).some(i => i.prototypeId === ids.Moss)).toBe(false);
    // A placement left by an older deletion is repaired.
    world.place(webs.Earth, ids.Rock);
    world.state().deleteNodePrototype(ids.Rock);
    expect(world.repairDangling()).toBe(1);
    // Two insides become one.
    world.setDruid(ids.Ice, { madeBy: 'druid' });
    const first = world.ensureInside(ids.Ice);
    world.place(first, (await world.createThing(first, 'Water', { asPart: false })).id);
    const second = world.state().createAndAssignGraphDefinitionWithoutActivation(ids.Ice);
    world.place(second, (await world.createThing(second, 'Crystals', { asPart: false })).id);
    expect(await world.foldInsides(ids.Ice)).toBe(1);
    expect(world.thingsIn(world.insideOf(ids.Ice)).map(world.nameOf).sort()).toEqual(['Crystals', 'Water']);
    // A step is never named like a Thing, and a name finds the Thing, not the step.
    expect(stepName(world, 'Water')).toBe('Water (step)');
    const step = (await world.createThing(webs.Earth, 'Granite', { reuse: false, fresh: true })).id;
    world.setDruid(step, { step: true });
    const granite = (await world.createThing(world.insideOf(ids.Ice), 'Granite', { asPart: false, reuse: false })).id;
    world.place(webs.Earth, granite);
    world.setDruid(granite, { madeBy: 'druid' });
    expect(world.findThing('Granite')).toBe(granite);
    // Sleep: the stray step merges into its twin, without asking.
    const report = await sleep({ world, tick: 1, judge: async () => 'different', held: [] });
    expect(world.proto(step)).toBeFalsy();
    expect(world.proto(granite)).toBeTruthy();
    expect(world.druidOf(granite).step).toBeFalsy();
    expect(report.repaired).toBeGreaterThanOrEqual(1);
  });
});

describe('sleep keeps the parts of things', () => {
  it('an unconnected part of something is not forgotten; an unused noticed Thing is', async () => {
    const { pruneDead, PRUNE_AFTER } = await import('../../src/druid/sleep.js');
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { Body: { things: { Brain: 'b' } } } });
    world.actor = 'druid';
    const pons = (await world.createThing(world.ensureInside(ids.Brain), 'Pons')).id;
    const noticed = (await world.createThing(world.ensureInside(ids.Brain), 'Curiosity', { noticed: true })).id;
    for (const id of [pons, noticed]) world.setDruid(id, { madeBy: 'druid', uses: [1] });
    pruneDead(world, 1 + PRUNE_AFTER + 1);
    expect(world.proto(pons)).toBeTruthy();
    expect(world.proto(noticed)).toBeFalsy();
  });
});
