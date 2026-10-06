// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { echoes, rewardFor, classify, badName } from '../../src/druid/lab/rewards.js';

const fill = (question, maxWords, where = { web: 'Clouds', topic: 'Venus', things: ['Cloud tops', 'Cloud base'] }) => ({
  kind: 'fill', meta: { phase: 'blank', question, maxWords }, user: question, schema: { name: 'fill' }, where
});
const said = (text) => JSON.stringify({ text });

describe('rewards for what the Druid asks', () => {
  it('scores a list of parts by its valid, new names, and pays nothing for one safe name or none', () => {
    const q = 'What are the main parts of Clouds, as part of Venus? Name the parts you could point to on Clouds itself, not the materials it is made of. Separate them with commas.';
    const rec = fill(q, 16);
    expect(classify(rec).type).toBe('list');
    const good = rewardFor(rec, said('Sulfuric acid droplets, Haze layer, Cloud deck, Updrafts'));
    const one = rewardFor(rec, said('Haze layer'));
    const positions = rewardFor(rec, said('Upper, Middle, Lower'));
    const copied = rewardFor(rec, said('Cloud tops, Cloud base'));
    const none = rewardFor(rec, said('none'));
    expect(good.reward).toBeGreaterThan(0.9);
    expect(one.reward).toBeLessThan(0.3);
    expect(positions.reward).toBeLessThan(0);
    expect(copied.reward).toBeLessThan(0);
    expect(none.reward).toBeLessThan(0);
    expect(good.judge).toEqual({ kind: 'list', names: ['Sulfuric acid droplets', 'Haze layer', 'Cloud deck', 'Updrafts'] });
  });

  it('gates on format, length and saying the question back', () => {
    const rec = fill('Name another part of Clouds, one you could point to on Clouds itself.', 4);
    expect(rewardFor(rec, 'not json').reward).toBe(-1);
    expect(rewardFor(rec, said('a very long answer that goes on and on')).reward).toBe(-1);
    expect(rewardFor(rec, said('Haze layer')).reward).toBe(0.5);
    expect(rewardFor(rec, said('Middle')).reward).toBeLessThan(0);
    expect(rewardFor(rec, said('Cloud tops')).reasons).toContain('Cloud tops: already here');
    const roomy = fill('Name another part of Clouds, one you could point to on Clouds itself.', 16);
    expect(rewardFor(roomy, said('Name another part of Clouds, one you could point to on Clouds itself.')).reasons).toContain('says the question back');
    expect(rewardFor(roomy, said('one you could point to on it')).reasons).toContain('says the question back');
  });

  it('does not call an answer an echo for using what the question shows', () => {
    // Picking names out of a quoted thought, and speaking from what the universe holds (2026-10-06).
    expect(echoes('Tube, Lens, Mirror', 'You just thought: "Tube holds Lens at the front and runs straight to Mirror.". Name up to three Things in that thought worth keeping, separated by commas.')).toBe(false);
    const speech = 'What your universe holds about what they mention:\nBell (in Bicycle bell): A thin, cold metal ring, hanging at the bicycle\'s end.\n\nAnswer them as yourself, in two or three plain sentences of your own.';
    expect(echoes('I found the Bicycle bell. It is a thin, cold metal ring at the end of the bike.', speech)).toBe(false);
    expect(echoes('Answer them as yourself, in two or three plain sentences.', speech)).toBe(true);
  });

  it('wants a relation that says how, and a thought about what is here', () => {
    const rel = fill('How do Clouds and Surface relate? Say it as one short plain sentence that names both.', 12);
    expect(rewardFor(rel, said('Clouds hide the Surface from sunlight.')).reward).toBeGreaterThan(0.5);
    expect(rewardFor(rel, said('Clouds and Surface are interconnected parts of Venus.')).reward).toBeLessThanOrEqual(0);
    const words = fill('Give the words that make "Clouds ___ Surface" a true plain sentence saying what one does to or has of the other, or "none" if neither does anything to the other.', 6);
    expect(rewardFor(words, said('relates to')).reward).toBeLessThan(0);
    expect(rewardFor(words, said('hide')).reward).toBe(0.6);
    const thought = { kind: 'fill', meta: { phase: 'thought', question: 'In one plain sentence: what are you thinking now? Name the Things you mean.', maxWords: 30 }, user: '', where: { web: 'Clouds', things: ['Cloud tops', 'Cloud base'] } };
    expect(rewardFor(thought, said('Cloud tops sit far above the Cloud base.')).reward).toBe(0.6);
    expect(rewardFor(thought, said('The trees whisper of the forest and its ancient wisdom.')).reward).toBe(-1);
  });

  it('takes away for claiming work it did not do, and for saying again what it said', () => {
    const rec = { kind: 'fill', meta: { phase: 'answer', onIt: false, maxWords: 60 }, user: 'Your conversation so far:\nYou: I started a web for the ham sandwich.' };
    expect(rewardFor(rec, said("I've started a web for the ham sandwich and found Bread.")).reward).toBeLessThan(0);
    expect(rewardFor({ ...rec, meta: { ...rec.meta, onIt: true } }, said('It holds Bread and Filling so far.')).reward).toBe(0.5);
  });

  it('leaves a choice and a yes or no to the judge, after the format', () => {
    const choose = { kind: 'choose', meta: { phase: 'choose', options: ['a', 'b', 'c'] } };
    expect(rewardFor(choose, '{"choice":"4"}').reward).toBe(-1);
    expect(rewardFor(choose, '{"choice":"2"}')).toMatchObject({ reward: 0, judge: { kind: 'choose', picked: 2 } });
    const yes = { kind: 'helper:onSubject', meta: { phase: 'helper', helper: 'onSubject' }, schema: { schema: { properties: { answer: { enum: ['yes', 'no'] } } } } };
    expect(rewardFor(yes, '{"answer":"maybe"}').reward).toBe(-1);
    expect(rewardFor(yes, '{"answer":"no"}')).toMatchObject({ reward: 0, judge: { kind: 'helper', answer: 'no' } });
  });

  it('knows a position, a quality and a non-answer from a name', () => {
    expect(badName('Middle')).toMatch(/position/);
    expect(badName('none')).toBe('no name');
    expect(badName('Haze layer')).toBeNull();
  });
});
