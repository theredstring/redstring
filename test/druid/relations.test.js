// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { relationFromSentence } from '../../src/druid/relations.js';
import { readText } from '../../src/druid/mind/createMind.js';
import { connectSaying } from '../../src/druid/moves/basic.js';

beforeAll(() => quiet());

describe('relations from sentences', () => {
  it('takes what lies between the names, from the sentences Apple\'s model wrote', () => {
    expect(relationFromSentence('River flows into Delta.', 'River', 'Delta')).toBe('flows into');
    expect(relationFromSentence('Yeast makes dough rise.', 'Yeast', 'Dough')).toBe('makes');
    expect(relationFromSentence('Bone is the foundation of the feet.', 'Bone', 'Feet')).toBe('is the foundation of');
    expect(relationFromSentence('Wood is used to make floors.', 'Wood', 'Floor')).toBe('is used to make');
    expect(relationFromSentence('Bones support the feet', 'Bone', 'Feet')).toBe('support');
  });

  it('refuses what is not one relation', () => {
    expect(relationFromSentence('Floor is underfoot, so footwear is worn on the floor.', 'Floor', 'Footwear')).toBeNull();
    expect(relationFromSentence('Dog is a mammal, Cat is a mammal', 'Dog', 'Cat')).toBeNull();
    expect(relationFromSentence('Comfortable shoes make walking easier.', 'Comfort', 'Feet')).toBeNull();
    expect(relationFromSentence('Attach flooring to the wall.', 'Attach', 'Flooring')).toBeNull();
  });

  it('a label before an answer is not part of it', () => {
    expect(readText('{"text":"Relation: Attach"}', 3)).toBe('Attach');
  });

  it('a relation from a whole sentence is trusted; a fragment is checked', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Bone: 'b', Feet: 'f', Floor: 'fl', Footwear: 'fw' } } } });
    world.check = async () => false; // the check says no to everything
    const ctx = { world, locus: { web: webs.W }, ask: async () => null };
    expect((await connectSaying(ctx, ids.Bone, ids.Feet, 'Bones support the feet.')).ok).toBe(true);
    expect((await connectSaying(ctx, ids.Floor, ids.Footwear, 'sit')).ok).toBe(false);
  });
});
