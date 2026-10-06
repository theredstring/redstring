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
  });

  it('says a sentence once, however often the model loops on it', async () => {
    const { withoutRepeats } = await import('../../src/druid/talk.js');
    expect(withoutRepeats('I am thinking about the web that connects Sub, Sandwich, and Gathering. I will look at the web that connects Sub, Sandwich, and Gathering. I will look at the web that connects Sub, Sandwich, and Gathering'))
      .toBe('I am thinking about the web that connects Sub, Sandwich, and Gathering.');
    expect(withoutRepeats('Bread holds it together. Lettuce adds crunch.')).toBe('Bread holds it together. Lettuce adds crunch.');
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
      'You are in a conversation with a person. What they ask comes before your own goals.',
      'They asked you to look at how snowflake arms branch.',
      'You are talking about Branch tip.',
      "They asked you to leave Nature's cycle alone.",
      'You told them you would look at Branch tip.'
    ].join('\n'));
    expect(renderConversation(world, conv, 10 + ENGAGED_FOR)).toBe('');
  });
});

describe('in a conversation with a living Druid', () => {
  it('turns where it is pointed, drops what it is told to leave, does what it said, and tells them what it found', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { seedRoles, openGoals, roleType } = await import('../../src/druid/roles.js');
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
        const i = (req.user.match(/^(\d+)\. (?:do what you told them|go to .*, which they are asking about)/m) || [])[1];
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
    // Heard at moment 2: it looked where it was pointed before it thought and answered.
    expect(out[1].heard).toEqual(['Stop thinking about nature. Go look at Branch tip.']);
    const thinking = seen.filter(r => /what are you thinking now/.test(r.user))[1];
    expect(thinking.user).toMatch(/In focus: Branch tip/);
    // What it was told to leave: its goal about it given up; what was asked, its goal.
    expect(world.druidOf(g.id).status).toBe('abandoned');
    expect(openGoals(world).map(world.nameOf)).toEqual(['Look at how snowflake arms branch']);
    // It said it would look at New arm, and the menu held it to that.
    expect(out[1].menu[0]).toBe('do what you told them: look at New arm');
    expect(out[1].result.summary).toBe('went to New arm, as they asked');
    // Then it told them what it found, unasked.
    expect(replies.map(r => r.t)).toEqual(['Branch tip is where an arm grows. I will look at New arm next.', 'I went to New arm: it is an arm from a tip.']);
    expect(replies[1].tick).toBe(3);
    expect(out.at(-1).state.conversation).toMatchObject({ ask: 'Look at how snowflake arms branch', promised: [] });
  });

  it('asked to work on something its universe does not hold, starts a web for it, goes there, says yes, and clears its head', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { seedRoles, goalsInOrder, roleType } = await import('../../src/druid/roles.js');
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
      if (/They say to you now/.test(req.user)) return { text: 'Yes. I will start with what a submarine sandwich is made of.' };
      if (/what are you thinking now/.test(req.user)) return { text: 'Qubits hold superposition.' };
      return { text: 'A plain thing.' };
    }) });
    const inbox = [];
    const out = [];
    let n = 0;
    const resume = { tick: 0, locus: { web: webs['Quantum Computing'], focus: ids.Qubit, path: [] }, loop: ['Qubits hold superposition.'], throughLine: 'I have been studying Qubit and Entanglement.', throughLineAt: 0 };
    for await (const r of createDruid({ world, mind }, { maxCycles: 2, resume, hear: () => inbox.splice(0) })) {
      if (r.type !== 'cycle') continue;
      out.push(r);
      if (++n === 1) inbox.push({ text: 'can you start working on a submarine sandwich? and like building an understanding of that?' });
    }
    const sub = [...world.state().graphs.values()].find(x => x.name === 'Submarine sandwich');
    expect(sub).toBeTruthy();
    // It thought, and answered, from the new web, its head cleared of the old work.
    const thinking = seen.filter(r => /what are you thinking now/.test(r.user))[1];
    expect(thinking.user).toMatch(/You are in the web "Submarine sandwich"/);
    expect(thinking.user).not.toMatch(/What you were just thinking/);
    expect(thinking.user).not.toMatch(/Lately: I have been studying Qubit/);
    const asked = seen.find(r => /They say to you now/.test(r.user));
    expect(asked.user).toMatch(/They are asking you to build an understanding of a submarine sandwich\. It is now your goal, ahead of your own, and you have turned to Submarine sandwich\. Tell them plainly that you will/);
    expect(out[1].locus.webName).toBe('Submarine sandwich');
    // Its goal, ahead of its own.
    expect(goalsInOrder(world).map(world.nameOf)).toEqual(['Understand submarine sandwich', 'Understand quantum mechanics']);
  });
});
