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
      if (/A person just said to you/.test(req.user)) return { text: 'I will look at how Yeast works on Dough.' };
      if (/what have you been doing lately/.test(req.user)) return { text: 'I have been looking at Yeast and Dough.' };
      if (/what are you thinking now/.test(req.user)) return { text: 'Yeast makes Dough rise.' };
      return { text: 'A plain thing.' };
    }) });
    const inbox = [];
    const out = [];
    let n = 0;
    for await (const r of createDruid({ world, mind }, { maxCycles: 4, resume: { tick: 0, locus: { web: webs.Baking, focus: null, path: [] } }, hear: () => inbox.splice(0) })) {
      if (r.type !== 'cycle') continue;
      out.push(r);
      if (++n === 1) inbox.push({ text: 'think about how yeast raises dough' });
    }
    expect(out[1].heard).toEqual(['think about how yeast raises dough']);
    expect(out[1].reply).toBe('I will look at how Yeast works on Dough.');
    expect(openGoals(world).map(world.nameOf)).toContain('Think about how yeast raises dough');
    const choiceAfter = seen.filter(r => r.schema.name === 'choice').at(-1);
    expect(choiceAfter.user).toMatch(/A person said to you \(\d moments? ago\): "think about how yeast raises dough"/);
    expect(out.at(-1).throughLine).toBe('I have been looking at Yeast and Dough.');
    expect(out.at(-1).state.throughLine).toBe('I have been looking at Yeast and Dough.');
  });
});
