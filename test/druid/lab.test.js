// @vitest-environment node
/**
 * The lab's scenarios build cleanly over the real store, and its scoring says
 * what it should — checked with a scripted participant that always takes the
 * best move with good words.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, quiet } from './helpers/headlessWorld.js';
import { SCENARIOS, score, goodName, goodRelation } from '../../src/druid/lab/scenarios.js';
import { scratch } from '../../src/druid/heldInMind.js';
import { seedRoles } from '../../src/druid/roles.js';
import { createMind } from '../../src/druid/mind/createMind.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { createDruid } from '../../src/druid/druid.js';

beforeAll(() => quiet());

const GOOD_WORDS = { newWeb: 'Rivers', make: 'Spoon', describe: 'A hard lump of minerals.', connect: 'carves', open: 'Grain', commitGoal: 'Understand how weather works', generalize: 'Pet' };

function idealParticipant(best) {
  let chosenMove = null;
  return scripted((req) => {
    if (req.schema.name === 'choice') {
      const options = [...req.user.matchAll(/^(\d+)\. (.*)$/gm)].map(m => ({ n: m[1], label: m[2] }));
      const patterns = { newWeb: /^start/, make: /^make a new Thing/, describe: /^describe|^redescribe/, connect: /^connect/, open: /^go inside|^open up/, promote: /^make ".*" a lasting/, close: /^step back out/, commitGoal: /^set yourself a goal/, pursueGoal: /^work toward/, weighBelief: /^weigh whether/, generalize: /^say what .* are both kinds of/ };
      const hit = options.find(o => patterns[best]?.test(o.label)) || options[0];
      chosenMove = best;
      return { choice: hit.n };
    }
    if (/what are you thinking now\?|what have you been doing lately/.test(req.user)) return { text: 'Thinking about it plainly.' };
    if (req.schema.name === 'judgment') return { answer: req.schema.schema.properties.answer.enum[1] };
    if (/one short sentence/.test(req.user)) return { text: 'A plain description.' };
    return { text: GOOD_WORDS[chosenMove] || 'Thing' };
  });
}

describe('lab scenarios', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name}: builds, and an ideal participant scores sensible and landed`, async () => {
      const { world } = await freshWorld();
      const { locus } = await sc.build(world, { scratch, seedRoles });
      const mind = createMind({ backend: idealParticipant(sc.best) });
      let rec = null;
      for await (const r of createDruid({ world, mind }, { maxCycles: 1, resume: { tick: 0, locus } })) if (r.type === 'cycle') rec = r;
      const s = score(sc, rec);
      expect(rec.offerErrors).toEqual([]);
      expect(rec.move).toBe(sc.best);
      expect(s).toMatchObject({ valid: true, sensible: true, best: true, landed: true });
    });
  }

  it('judges filled-in words', () => {
    expect(goodName('Desert Rock')).toBe(true);
    expect(goodName('This is a sentence about rocks.')).toBe(false);
    expect(goodName('...')).toBe(false);
    expect(goodRelation('carves', 'River', 'Valley')).toBe(true);
    expect(goodRelation('River carves Valley', 'River', 'Valley')).toBe(false);
  });
});
