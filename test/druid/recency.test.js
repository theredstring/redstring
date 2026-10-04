// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { ago, extendTrail, renderTrail, recencyMark, TRAIL_FADES } from '../../src/druid/recency.js';
import { recordUse } from '../../src/druid/activation.js';
import { connectSaying } from '../../src/druid/moves/basic.js';

beforeAll(() => quiet());

describe('recency', () => {
  it('says how long ago, and forgets after a while', () => {
    expect(ago(10, 10)).toBe('just now');
    expect(ago(10, 9)).toBe('just now');
    expect(ago(10, 6)).toBe('4 moments ago');
    expect(ago(10 + TRAIL_FADES + 1, 10)).toBe('');
  });

  it('the trail: places and deeds, newest first, repeated visits collapsed, faded ones gone', () => {
    let t = [];
    t = extendTrail(t, { tick: 1, before: {}, after: { web: 'w1' }, webName: 'Wood', wrote: true, summary: 'started the web Wood' });
    t = extendTrail(t, { tick: 2, before: { web: 'w1' }, after: { web: 'w1', focus: 'b' }, focusName: 'Boards', wrote: false });
    t = extendTrail(t, { tick: 3, before: { web: 'w1', focus: 'b' }, after: { web: 'w1', focus: 's' }, focusName: 'Screw', wrote: true, summary: 'made Screw' });
    expect(renderTrail(t, 4)).toBe('What you did lately, newest first:\n- just now: made Screw\n- 2 moments ago: looked at Boards\n- 3 moments ago: started the web Wood\n- 3 moments ago: went to the web Wood');
    expect(renderTrail(t, 3 + TRAIL_FADES + 1)).toBe('');
  });

  it('marks Things touched lately in the view', async () => {
    const { world } = await freshWorld();
    const { ids } = await buildUniverse(world, { webs: { W: { things: { Boards: 'b', Floor: 'f' } } } });
    recordUse(world, ids.Boards, 7);
    expect(recencyMark(world, ids.Boards, 8)).toBe(' (just now)');
    expect(recencyMark(world, ids.Boards, 12)).toBe(' (5 moments ago)');
    expect(recencyMark(world, ids.Floor, 12)).toBe('');
  });

  it('a sentence naming the two the other way round connects them that way; a sentence that is not one relation is refused', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Boards: 'b', Screwdriver: 's' } } } });
    const ctx = { world, locus: { web: webs.W }, ask: async () => null };
    const r = await connectSaying(ctx, ids.Boards, ids.Screwdriver, 'Screwdrivers drive screws into boards.');
    expect(r).toMatchObject({ ok: true, reversed: true });
    expect(world.linksIn(webs.W).map(l => `${world.nameOf(l.a)} ${l.relation.toLowerCase()} ${world.nameOf(l.b)}`)).toEqual(['Screwdriver drive screws into Boards']);
    expect((await connectSaying(ctx, ids.Boards, ids.Screwdriver, 'You need tools to build a floor.')).ok).toBe(false);
  });
});
