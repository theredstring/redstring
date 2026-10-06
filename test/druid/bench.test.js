// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { measure, benchSubject, summarize, DAYDREAM } from '../../src/druid/lab/bench.js';

beforeAll(() => quiet());

describe('the benchmark', () => {
  it('counts what was built off the subject, and names that are only positions', async () => {
    const { world } = await freshWorld();
    // The Druid 12, in small: Venus, and a Middle holding a Trunk; a forest web of its own.
    const { webs, ids } = await buildUniverse(world, { webs: { Venus: { things: { Clouds: 'c', Surface: 's' } }, Forest: { things: { Trunk: 't', River: 'r' } } } });
    const inside = world.ensureInside(ids.Clouds);
    world.actor = null;
    await world.createThing(inside, 'Middle');
    const trace = [
      { tick: 1, web: webs.Venus, ok: true, wrote: true, thought: 'Clouds cover the Surface.', grounded: true },
      { tick: 2, web: webs.Forest, ok: false, summary: 'open: left the blank empty', thought: 'The trees whisper in the forest.', grounded: false }
    ];
    const m = measure(world, { subject: 'Venus', trace, replies: [{ text: 'I found Clouds and a Dragon.', tick: 2 }], events: [] });
    expect(m.things).toBe(5);
    expect(m.onSubject).toBe(60);
    expect(m.drift.sort()).toEqual(['River', 'Trunk']);
    expect(m.positions).toEqual(['Middle']);
    expect(m).toMatchObject({ breadth: 2, depth: 1, failedPct: 50, emptyPct: 50, ungroundedThoughtsPct: 50, daydreamPct: 50 });
    expect(m.unknownClaims).toEqual([{ tick: 2, names: ['Dragon'] }]);
    expect(DAYDREAM.test('a living tapestry')).toBe(true);
    expect(DAYDREAM.test('Clouds of sulfuric acid')).toBe(false);
  });

  it('runs a subject with what a person says, and measures whether it turned', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { world } = await freshWorld();
    const calls = [];
    const mind = createMind({
      backend: scripted((req) => {
        if (req.schema.name === 'choice') return { choice: (req.user.match(/^(\d+)\. start a web for/m) || [])[1] || '1' };
        if (req.schema.name === 'wants') return { wants: 'make a web of a teapot' };
        if (/separated by commas/.test(req.user)) return { text: /Teapot/.test(req.user) ? 'Spout, Handle, Lid' : 'Wick, Wax' };
        if (/what are you thinking now/.test(req.user)) return { text: 'Thinking about the Teapot.' };
        return { text: 'Plain thing' };
      }),
      onCall: (c) => calls.push(c)
    });
    const events = [{ at: 3, text: 'hey make a web of a teapot', request: 'Teapot' }];
    const r = await benchSubject({ world, mind, createDruid }, { subject: 'Candle', moments: 6, events });
    expect(r.trace).toHaveLength(6);
    expect(r.metrics.steering).toEqual([{ request: 'Teapot', turned: true, latency: 0, held: expect.any(Number) }]);
    // Every call carries what asked it, for training.
    expect(calls.every(c => c.system && c.user && c.schema)).toBe(true);
    expect(calls.some(c => c.meta?.phase === 'thought')).toBe(true);
    expect(calls.some(c => c.meta?.phase === 'choose' && Array.isArray(c.meta.options))).toBe(true);
    expect(summarize([r])).toMatchObject({ subjects: 1, turnedPct: 100, turnLatency: 0 });
  });
});
