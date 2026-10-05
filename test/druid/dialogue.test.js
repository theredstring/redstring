// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { throughLineDue, keepThroughLine, stillSaid, renderDialogue, saidSources, asRequest, SAID_FOR, THROUGH_LINE_EVERY } from '../../src/druid/dialogue.js';

beforeAll(() => quiet());

describe('the through line', () => {
  it('is rewritten every few moments, not every one', () => {
    expect(throughLineDue({ throughLine: '', writes: [] }, 1)).toBe(false);
    expect(throughLineDue({ throughLine: '', writes: [{ tick: 1 }] }, 1)).toBe(true);
    expect(throughLineDue({ throughLine: 'x', throughLineAt: 10 }, 10 + THROUGH_LINE_EVERY - 1)).toBe(false);
    expect(throughLineDue({ throughLine: 'x', throughLineAt: 10 }, 10 + THROUGH_LINE_EVERY)).toBe(true);
  });

  it('is kept only when it says something new about what the universe holds', async () => {
    const { world } = await freshWorld();
    await buildUniverse(world, { webs: { Baking: { things: { Dough: 'd', Yeast: 'y' } } } });
    expect(keepThroughLine(world, '', 'I have been working out how yeast makes dough rise.')).toMatch(/yeast/);
    expect(keepThroughLine(world, 'I have been working out how yeast makes dough rise.', 'I have been working out how the yeast makes dough rise.')).toBeNull();
    expect(keepThroughLine(world, '', 'I have been thinking about the nature of thought itself.')).toBeNull();
  });
});

describe('what a person says', () => {
  it('stays in mind for a while, is shown with every choice, and pulls attention to what it names', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { Baking: { things: { Dough: 'd', Yeast: 'y', Oven: 'o' } } } });
    const said = [{ text: 'what does the yeast do to the dough?', tick: 4 }];
    expect(stillSaid(said, 4 + SAID_FOR - 1)).toHaveLength(1);
    expect(stillSaid(said, 4 + SAID_FOR)).toHaveLength(0);
    expect(renderDialogue({ throughLine: 'Working on bread.', said }, 6)).toBe('Lately: Working on bread.\nA person said to you (2 moments ago): "what does the yeast do to the dough?"');
    const sources = saidSources(world, said, 5);
    expect(sources.map(s => s.id).sort()).toEqual([ids.Dough, ids.Yeast].sort());
    expect(sources[0].weight).toBeGreaterThan(0.8);
  });

  it('a request becomes a goal; a question or a remark does not', () => {
    expect(asRequest('think about how bridges stay up')).toBe('Think about how bridges stay up');
    expect(asRequest('Could you tidy up the House web?')).toBeNull();
    expect(asRequest('can you tidy up the House web')).toBe('Tidy up the House web');
    expect(asRequest("let's explore rivers")).toBe('Explore rivers');
    expect(asRequest('nice work')).toBeNull();
    expect(asRequest('why did you connect Floor to Feet?')).toBeNull();
  });
});

describe('talking with a living Druid', () => {
  it('hears, takes a request as its goal, answers, and keeps a through line', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { openGoals } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Baking: { things: { Dough: 'flour and water', Yeast: 'a fungus' } } } });
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'choice') return { choice: '1' };
      if (/They say to you now/.test(req.user)) return { text: 'I will look at how Yeast works on Dough.' };
      if (/what have you been doing lately/.test(req.user)) return { text: 'I have been looking at Yeast and Dough.' };
      if (/what are you thinking now/.test(req.user)) return { text: 'Yeast makes Dough rise.' };
      return { text: 'A plain thing.' };
    }) });
    const inbox = [];
    const out = [];
    const events = [];
    let n = 0;
    const onReply = (text, tick) => events.push(`reply ${tick}`);
    for await (const r of createDruid({ world, mind }, { maxCycles: 4, resume: { tick: 0, locus: { web: webs.Baking, focus: null, path: [] } }, hear: () => inbox.splice(0), onReply })) {
      if (r.type !== 'cycle') continue;
      out.push(r);
      events.push(`moment ${r.tick}`);
      if (++n === 1) inbox.push({ text: 'think about how yeast raises dough' });
    }
    expect(out[1].heard).toEqual(['think about how yeast raises dough']);
    expect(out[1].reply).toBe('I will look at how Yeast works on Dough.');
    // Answered as it hears, before the moment goes on: the reply comes ahead of the moment.
    expect(events.indexOf('reply 2')).toBeLessThan(events.indexOf('moment 2'));
    // Asked as itself, about what the universe holds, not over the web it stands in.
    const asked = seen.find(r => /They say to you now/.test(r.user));
    expect(asked.system).toMatch(/never the Thing you were looking at/);
    expect(asked.user).toMatch(/What your universe holds about what they mention:\n(Yeast|Dough)/);
    expect(out.at(-1).state.talk.map(t => t.who)).toEqual(['person', 'druid']);
    expect(openGoals(world).map(world.nameOf)).toContain('Think about how yeast raises dough');
    const choiceAfter = seen.filter(r => r.schema.name === 'choice').at(-1);
    expect(choiceAfter.user).toMatch(/A person said to you \(\d moments? ago\): "think about how yeast raises dough" You answered: "I will look at how Yeast works on Dough."/);
    expect(out.at(-1).throughLine).toBe('I have been looking at Yeast and Dough.');
    expect(out.at(-1).state.throughLine).toBe('I have been looking at Yeast and Dough.');
  });
});

describe('talking with it', () => {
  it('answers from what its universe holds about what was named, and says so when it holds nothing', async () => {
    const { answer, namedIn, knownAbout } = await import('../../src/druid/talk.js');
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { Baking: { things: { Dough: 'flour and water', Yeast: 'a fungus', Oven: 'o' }, links: [['Yeast', 'Dough', 'raises']] } } });
    expect(namedIn(world, 'what does the yeast do?')).toEqual([ids.Yeast]);
    expect(knownAbout(world, ids.Yeast)).toMatch(/^Yeast \(in Baking\): a fungus\n {2}connections: Yeast raises Dough/);
    const seen = [];
    const mind = createMind({ backend: scripted((req) => { seen.push(req); return { text: 'Yeast raises Dough.' }; }) });
    const r = await answer(world, mind, { text: 'what does the yeast do?', history: [{ who: 'person', text: 'hello' }, { who: 'druid', text: 'Hello.' }] });
    expect(r).toMatchObject({ ok: true, text: 'Yeast raises Dough.', about: ['Yeast'] });
    expect(seen[0].user).toMatch(/Your conversation so far:\nThey: hello\nYou: Hello\./);
    await answer(world, mind, { text: 'tell me about volcanoes' });
    expect(seen[1].user).toMatch(/Your universe holds nothing yet about what they mention\./);
  });

  it('hears what it answered while asleep, without answering it again', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Baking: { things: { Dough: 'd' } } } });
    let answers = 0;
    const mind = createMind({ backend: scripted((req) => {
      if (/They say to you now/.test(req.user)) { answers++; return { text: 'Hello.' }; }
      return req.schema.name === 'choice' ? { choice: '1' } : { text: 'A plain thing.' };
    }) });
    const inbox = [{ text: 'hello', answered: true }];
    const out = [];
    for await (const r of createDruid({ world, mind }, { maxCycles: 1, resume: { tick: 0, locus: { web: webs.Baking, focus: null, path: [] } }, hear: () => inbox.splice(0) })) if (r.type === 'cycle') out.push(r);
    expect(out[0].heard).toEqual(['hello']);
    expect(answers).toBe(0);
    expect(out[0].reply).toBe(null);
  });
});
