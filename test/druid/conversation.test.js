// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { parseSaid, promisedIn, renderConversation, ENGAGED_FOR } from '../../src/druid/conversation.js';

beforeAll(() => quiet());

describe('understanding what was said', () => {
  it('tells a question, a direction and a correction apart, and what each turns toward and away from', () => {
    // Druid Test 10, 2026-10-06: the words it was told to leave were the ones it looked up.
    expect(parseSaid('Stop thinking about nature and ecosystems. Go back to the snowflake: how do its arms branch?'))
      .toMatchObject({ kind: 'correction', away: 'nature and ecosystems' });
    expect(parseSaid('Stop thinking about nature and ecosystems. Go back to the snowflake: how do its arms branch?').toward).toMatch(/^Go back to the snowflake/);
    expect(parseSaid("You're drifting. What does Time have to do with a snowflake? Go look at Branch tip.").toward).toMatch(/^Go look at Branch tip/);
    expect(parseSaid('Go look at Branch tip').kind).toBe('direction');
    expect(parseSaid('can you tidy up the House web').kind).toBe('direction');
    expect(parseSaid('What did you find at Branch tip?').kind).toBe('question');
    expect(parseSaid('Gap means an opening in the ice.').kind).toBe('telling');
    // Asked politely to do some work, question mark and all, it is a request (The Druid 11).
    expect(parseSaid('can you start working on a submarine sandwich? and like building an understanding of that?')).toMatchObject({ kind: 'direction', subject: 'Submarine sandwich' });
    expect(parseSaid('could you look into volcanoes?')).toMatchObject({ kind: 'direction', subject: 'Volcanoes' });
    // Asked to say something, it is a question.
    expect(parseSaid('can you tell me what a qubit is?').kind).toBe('question');
    expect(parseSaid('tell me about bread')).toMatchObject({ kind: 'question', subject: 'Bread' });
    expect(parseSaid('Stop thinking about nature. Go back to the snowflake: how do its arms branch?').subject).toBe('Snowflake');
    // Where it is kept is not part of it; saying again what was meant corrects it (2026-10-06).
    expect(parseSaid('can you work on sub sandwich web?')).toMatchObject({ kind: 'direction', subject: 'Sub sandwich' });
    expect(parseSaid("i'm saying submarine sandwich. do that now.")).toMatchObject({ kind: 'correction', subject: 'Submarine sandwich' });
    expect(parseSaid('what do you believe').kind).toBe('question');
    // A greeting in front hid the request, and it went on with quantum computing (2026-10-05).
    expect(parseSaid('hey make a web of a ham sandwich and tell me everything you think is in it')).toMatchObject({ kind: 'direction', subject: 'Ham sandwich' });
    expect(parseSaid('hi druid, could you look into volcanoes?')).toMatchObject({ kind: 'direction', subject: 'Volcanoes' });
    expect(parseSaid('how about we switch to medieval castles')).toMatchObject({ kind: 'direction', subject: 'Medieval castles' });
    expect(parseSaid('why not look at tide pools')).toMatchObject({ kind: 'direction', away: '', subject: 'Tide pools' });
    expect(parseSaid('hey, that is really cool').kind).toBe('telling');
    // The Druid 12 (2026-10-06): neither of these was heard as pointing at anything.
    expect(parseSaid("hey let's talk about a ham sandwich")).toMatchObject({ kind: 'direction', subject: 'Ham sandwich' });
    expect(parseSaid('ham sandwich')).toMatchObject({ kind: 'direction', subject: 'Ham sandwich' });
    expect(parseSaid('hello there').kind).toBe('telling');
    expect(parseSaid('thanks').kind).toBe('telling');
  });

  it('says a sentence once, however often the model loops on it', async () => {
    const { withoutRepeats } = await import('../../src/druid/talk.js');
    expect(withoutRepeats('I am thinking about the web that connects Sub, Sandwich, and Gathering. I will look at the web that connects Sub, Sandwich, and Gathering. I will look at the web that connects Sub, Sandwich, and Gathering'))
      .toBe('I am thinking about the web that connects Sub, Sandwich, and Gathering.');
    expect(withoutRepeats('Bread holds it together. Lettuce adds crunch.')).toBe('Bread holds it together. Lettuce adds crunch.');
    // Nor what it already told them: asked what was in it so far, it gave its first answer again (2026-10-06).
    expect(withoutRepeats("I'm starting a web for a ham sandwich. So far it holds Bread, Ham and Mustard.", ["I'm starting a web for a ham sandwich. I'll include its ingredients."])).toBe('So far it holds Bread, Ham and Mustard.');
    // But what it is asked again it may say again, in other words.
    expect(withoutRepeats('So far it has Bread and Filling.', ['I just opened the web and found Bread and Filling inside.'])).toBe('So far it has Bread and Filling.');
  });

  it('asks the model about what code took for a remark, so a request put any way steers it', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { understand } = await import('../../src/druid/conversation.js');
    const { world } = await freshWorld();
    await buildUniverse(world, { webs: { Ice: { things: { Gap: 'g' } } } });
    const mind = createMind({ backend: scripted((req) => {
      if (req.schema.name === 'asksForWork') return { answer: /dig into/.test(req.user) ? 'yes' : 'no' };
      if (req.schema.name === 'wants') return { wants: 'look into tide pools' };
      return { text: '' };
    }) });
    expect(await understand(world, mind, 'you should really dig into tide pools')).toMatchObject({ kind: 'direction', ask: 'Look into tide pools', subject: 'Tide pools', newSubject: 'Tide pools' });
    expect(await understand(world, mind, 'that is really cool')).toMatchObject({ kind: 'telling', ask: null });
    // A near name is not the subject: a Sub sandwich is no ham sandwich (2026-10-06).
    await buildUniverse(world, { webs: { Lunch: { things: { 'Sub sandwich web': 's' } } } });
    expect(await understand(world, mind, 'hey make a web of a ham sandwich and tell me everything you think is in it')).toMatchObject({ kind: 'direction', subject: 'Ham sandwich', newSubject: 'Ham sandwich' });
    // And the menu offers it a fresh web for it all the same.
    const { heed } = await import('../../src/druid/conversation.js');
    const offered = heed.offer({ world, tick: 1, locus: { web: null, focus: null }, conversation: { last: 1, kind: 'direction', ask: 'Make a web of a ham sandwich', newSubject: 'Ham sandwich', topic: [], promised: [] } });
    expect(offered[0].label).toBe('start a web for Ham sandwich, as they asked');
  });

  it('does not take a Thing only kept as noticed for holding the subject', async () => {
    // "Ham sandwich", kept from a thought, blocked the web it was asked for, and had nowhere to stand (The Druid 12).
    const { holding } = await import('../../src/druid/conversation.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Venus: { things: { Clouds: 'c' } } } });
    await seedRoles(world);
    world.actor = 'druid';
    const kept = await world.createThing(webs.Venus, 'Ham sandwich', { noticed: true });
    expect(kept.noticed).toBe(true);
    expect(holding(world, 'Ham sandwich')).toEqual([]);
  });

  it('can stand inside a web it started, though the web hangs off Home', async () => {
    const { placeOf } = await import('../../src/druid/conversation.js');
    const { newWeb } = await import('../../src/druid/moves/basic.js');
    const { seedRoles } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    await seedRoles(world);
    const r = await newWeb.run({ world, locus: { web: null, focus: null, path: [] }, view: {} }, null, 'Ham sandwich');
    expect(r.ok).toBe(true);
    expect(placeOf(world, world.ownerOf(r.locus.web))).toEqual({ web: r.locus.web, focus: null, path: [] });
  });

  it('holds it to what it said it would look at', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { Ice: { things: { 'Branch tip': 'b', Growth: 'g' } } } });
    expect(promisedIn(world, 'Growth is slow here. I will look at Branch tip next.')).toEqual([ids['Branch tip']]);
    expect(promisedIn(world, 'Growth is slow here.')).toEqual([]);
  });

  it('keeps the gist, and only while the conversation lasts', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { Ice: { things: { 'Branch tip': 'b', 'Nature\'s cycle': 'n' } } } });
    const conv = { last: 10, ask: 'Look at how snowflake arms branch', topic: [ids['Branch tip']], away: [ids['Nature\'s cycle']], promised: [ids['Branch tip']] };
    expect(renderConversation(world, conv, 12)).toBe([
      'A person is here, talking with you.',
      'They asked you to look at how snowflake arms branch.',
      'You are talking about Branch tip.',
      "They asked you to leave Nature's cycle alone.",
      'You told them you would look at Branch tip.'
    ].join('\n'));
    expect(renderConversation(world, conv, 10 + ENGAGED_FOR)).toBe('');
  });
});

describe('in a conversation with a living Druid', () => {
  const setup = async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const roles = await import('../../src/druid/roles.js');
    return { createMind, scripted, createDruid, ...roles };
  };

  it('takes in what was said, chooses to turn where it is pointed, speaks after acting, and does what it said', async () => {
    const { createMind, scripted, createDruid, seedRoles, openGoals, roleType } = await setup();
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, {
      webs: {
        Snowflake: { things: { 'Branch tip': 'where an arm grows', 'New arm': 'an arm from a tip' } },
        Nature: { things: { 'Nature\'s cycle': 'n', Biosphere: 'b' } }
      }
    });
    const { home } = await seedRoles(world);
    const g = await world.createThing(home, 'Connections in nature', { typeNodeId: roleType(world, 'goal') });
    world.setDruid(g.id, { status: 'open' });
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'wants') return { wants: 'look at how snowflake arms branch' };
      if (req.schema.name === 'choice') {
        const i = (req.user.match(/^(\d+)\. (?:do what you told them|turn to .*, as they asked)/m) || [])[1];
        return { choice: i || '1' };
      }
      if (/They say to you now/.test(req.user)) return { text: 'Branch tip is where an arm grows. I will look at New arm next.' };
      if (/Tell the person/.test(req.user)) return { text: 'I went to New arm: it is an arm from a tip.' };
      if (/what are you thinking now/.test(req.user)) return { text: 'Arms grow from tips.' };
      return { text: 'A plain thing.' };
    }) });
    const inbox = [];
    const out = [];
    const replies = [];
    let n = 0;
    for await (const r of createDruid({ world, mind }, { maxCycles: 4, resume: { tick: 0, locus: { web: webs.Nature, focus: ids.Biosphere, path: [] } }, hear: () => inbox.splice(0), onReply: (t, tick) => replies.push({ t, tick }) })) {
      if (r.type !== 'cycle') continue;
      out.push(r);
      if (++n === 1) inbox.push({ text: 'Stop thinking about nature. Go look at Branch tip.' });
    }
    expect(out[1].heard).toEqual(['Stop thinking about nature. Go look at Branch tip.']);
    // It thought where it was, with their words in front of it and what they named in mind; code did not turn its head.
    const thinking = seen.filter(r => /what are you thinking now/.test(r.user))[1];
    expect(thinking.user).not.toMatch(/In focus: Branch tip/);
    expect(thinking.user).toMatch(/Held in mind:\n- Branch tip/);
    expect(thinking.user).toMatch(/A person said to you: "Stop thinking about nature\. Go look at Branch tip\."/);
    // Turning was on the menu, and it chose it; then it spoke, about having gone.
    expect(out[1].menu).toContain('turn to Branch tip, as they asked');
    expect(out[1].result.summary).toBe('went to Branch tip, as they asked');
    const asked = seen.find(r => /They say to you now/.test(r.user));
    expect(asked.user).toMatch(/Just now you went to Branch tip, as they asked\./);
    // What they asked is held as a goal; its own is still its own.
    expect(openGoals(world).map(world.nameOf).sort()).toEqual(['Connections in nature', 'Look at how snowflake arms branch']);
    // It said it would look at New arm, and the next moment's menu held it to that.
    expect(out[2].menu[0]).toBe('do what you told them: look at New arm');
    expect(out[2].result.summary).toBe('went to New arm, as they asked');
    // Then it told them what it found, unasked, in the moment it found it.
    expect(replies.map(r => r.t)).toEqual(['Branch tip is where an arm grows. I will look at New arm next.', 'I went to New arm: it is an arm from a tip.']);
    expect(replies[1].tick).toBe(3);
    expect(out.at(-1).state.conversation).toMatchObject({ ask: 'Look at how snowflake arms branch', promised: [] });
  });

  it('asked to work on something its universe does not hold, may start a web for it, and having turned, puts the old work down', async () => {
    const { createMind, scripted, createDruid, seedRoles, goalsInOrder, roleType } = await setup();
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { 'Quantum Computing': { things: { Qubit: 'q', Entanglement: 'e' } } } });
    const { home } = await seedRoles(world);
    const g = await world.createThing(home, 'Understand quantum mechanics', { typeNodeId: roleType(world, 'goal') });
    world.setDruid(g.id, { status: 'open' });
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'wants') return { wants: 'build an understanding of a submarine sandwich' };
      if (req.schema.name === 'choice') return { choice: '1' };
      if (/They say to you now/.test(req.user)) return { text: 'Yes. I started a web for it and will begin with what it is made of.' };
      if (/what are you thinking now/.test(req.user)) return { text: 'Qubits hold superposition.' };
      return { text: 'A plain thing.' };
    }) });
    const inbox = [];
    const out = [];
    let n = 0;
    const resume = { tick: 0, locus: { web: webs['Quantum Computing'], focus: ids.Qubit, path: [] }, loop: ['Qubits hold superposition.'], throughLine: 'I have been studying Qubit and Entanglement.', throughLineAt: 0 };
    for await (const r of createDruid({ world, mind }, { maxCycles: 3, resume, hear: () => inbox.splice(0) })) {
      if (r.type !== 'cycle') continue;
      out.push(r);
      if (++n === 1) inbox.push({ text: 'can you start working on a submarine sandwich? and like building an understanding of that?' });
    }
    // Nothing made on hearing it: the web was its choice, from the menu.
    expect(out[1].menu[0]).toBe('start a web for Submarine sandwich, as they asked');
    expect(out[1].result.summary).toBe('started the web Submarine sandwich, as they asked');
    expect(out[1].locus.webName).toBe('Submarine sandwich');
    const asked = seen.find(r => /They say to you now/.test(r.user));
    expect(asked.user).toMatch(/They asked you to understand submarine sandwich\. Just now you started the web Submarine sandwich, as they asked\. Tell them plainly, as yourself/);
    // The next moment it thought in the new web, its head cleared of the old work.
    const thinking = seen.filter(r => /what are you thinking now/.test(r.user))[2];
    expect(thinking.user).toMatch(/You are in the web "Submarine sandwich"/);
    expect(thinking.user).not.toMatch(/What you were just thinking/);
    expect(thinking.user).not.toMatch(/Lately: I have been studying Qubit/);
    // Its goal, the newest, beside its own.
    expect(goalsInOrder(world).map(world.nameOf)).toEqual(['Understand submarine sandwich', 'Understand quantum mechanics']);
  });

  it('may finish what it was doing first, and says so', async () => {
    const { createMind, scripted, createDruid, seedRoles, openGoals, roleType } = await setup();
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { 'Quantum Computing': { things: { Qubit: 'q', Entanglement: 'e' } }, Baking: { things: { Bread: 'b' } } } });
    const { home } = await seedRoles(world);
    const g = await world.createThing(home, 'Understand quantum mechanics', { typeNodeId: roleType(world, 'goal') });
    world.setDruid(g.id, { status: 'open' });
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'wants') return { wants: 'look at bread' };
      // Its choice: not the one they asked for.
      if (req.schema.name === 'choice') return { choice: (req.user.match(/^(\d+)\. (?!turn to|do what you told)/m) || [])[1] || '1' };
      if (/They say to you now/.test(req.user)) return { text: 'I will finish with Qubit, then turn to Bread.' };
      return { text: 'A plain thing.' };
    }) });
    const inbox = [];
    const out = [];
    let n = 0;
    for await (const r of createDruid({ world, mind }, { maxCycles: 2, resume: { tick: 0, locus: { web: webs['Quantum Computing'], focus: ids.Qubit, path: [] } }, hear: () => inbox.splice(0) })) {
      if (r.type !== 'cycle') continue;
      out.push(r);
      if (++n === 1) inbox.push({ text: 'go look at bread' });
    }
    expect(out[1].menu).toContain('turn to Bread, as they asked');
    expect(out[1].locus.webName).not.toBe('Baking');
    const asked = seen.find(r => /They say to you now/.test(r.user));
    expect(asked.user).toMatch(/They asked you to look at bread\. Just now you (?!went to Bread)[^.]+\. You have not done anything about what they asked yet, and must not say you have\./);
    expect(out[1].reply).toBe('I will finish with Qubit, then turn to Bread.');
    expect(openGoals(world).map(world.nameOf).sort()).toEqual(['Look at bread', 'Understand quantum mechanics']);
  });

  it('stops the moment it is in to listen, and hears what was said in the next', async () => {
    const { createMind, scripted, createDruid } = await setup();
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Baking: { things: { Bread: 'b', Yeast: 'y' } } } });
    const inbox = [];
    let thoughts = 0;
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'choice') return { choice: '1' };
      if (/what are you thinking now/.test(req.user)) {
        // Someone speaks while it is thinking, in its second moment.
        if (++thoughts === 2) inbox.push({ text: 'what is yeast?' });
        return { text: 'Bread is baked.' };
      }
      if (/They say to you now/.test(req.user)) return { text: 'Yeast is a fungus that makes bread rise.' };
      return { text: 'A plain thing.' };
    }) });
    const out = [];
    for await (const r of createDruid({ world, mind }, { maxCycles: 3, resume: { tick: 0, locus: { web: webs.Baking, focus: ids.Bread, path: [] } }, hear: () => inbox.splice(0), waiting: () => inbox.length > 0 })) {
      if (r.type === 'cycle') out.push(r);
    }
    // The second moment stopped after its thought: no choosing, nothing done.
    expect(out[1]).toMatchObject({ listened: true, chose: null, result: { summary: 'stopped what you were doing to listen', wrote: false } });
    expect(seen.filter(r => r.schema.name === 'choice')).toHaveLength(2);
    // The third heard it, and answered.
    expect(out[2].heard).toEqual(['what is yeast?']);
    expect(out[2].reply).toBe('Yeast is a fungus that makes bread rise.');
  });
});
