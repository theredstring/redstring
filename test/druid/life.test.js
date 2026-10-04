// @vitest-environment node
/**
 * The v2 loop over the real store and the real wizard tools, with a scripted
 * mind. The script answers in the same shapes a model does under the schema:
 * a choice by option number, a fill as text. Choices are scripted by matching
 * an option's wording, so the tests read as "it picks 'make a new Thing'".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { createMind } from '../../src/druid/mind/createMind.js';
import { scripted } from '../../src/druid/mind/backends.js';
import { runLife } from '../../src/druid/life.js';
import { held } from '../../src/druid/heldInMind.js';

beforeAll(() => quiet());

const THOUGHT_Q = /what are you thinking now\?/;

/**
 * steps: [{ choose: /label/ } | { fill: 'text' }] consumed in order.
 * Thought questions are answered from `thoughts` (or a default) without
 * consuming a step, so a script lists only the decisions.
 */
function planMind(steps, thoughts = []) {
  const queue = [...steps];
  const seen = [];
  const backend = scripted((req) => {
    seen.push(req);
    if (req.schema.name === 'fill' && THOUGHT_Q.test(req.user)) return { text: thoughts.shift() || 'I keep going.' };
    const step = queue.shift();
    if (!step) return req.schema.name === 'choice' ? { choice: '1' } : { text: 'nothing more' };
    if (req.schema.name === 'choice') {
      const options = [...req.user.matchAll(/^(\d+)\. (.*)$/gm)].map(m => ({ n: m[1], label: m[2] }));
      const hit = options.find(o => step.choose.test(o.label));
      if (!hit) throw new Error(`no option matching ${step.choose} in:\n${options.map(o => o.label).join('\n')}`);
      return { choice: hit.n };
    }
    return { text: step.fill };
  });
  return { mind: createMind({ backend }), seen, left: () => queue.length };
}

async function live(world, mind, cycles, opts = {}) {
  const out = [];
  for await (const r of runLife({ world, mind }, { maxCycles: cycles, ...opts })) out.push(r);
  return { cycles: out.filter(r => r.type === 'cycle'), end: out.at(-1) };
}

describe('runLife over the real store', () => {
  it('starts from nothing: makes its first web, then a Thing, then a connected Thing — every write landing', async () => {
    const { world } = await freshWorld();
    const { mind, seen } = planMind([
      { choose: /^start your first web/ }, { fill: 'Rivers' },
      { choose: /^make a new Thing here, named/ }, { fill: 'River' }, { fill: 'Water moving in a channel.' },
      { choose: /^make a new Thing here, connected to River/ }, { fill: 'Valley' }, { fill: 'carves' }, { fill: 'Low land between hills.' }
    ], ['A web for rivers.', 'A river.', 'Rivers carve valleys.']);
    const { cycles } = await live(world, mind, 3);

    expect(cycles.map(c => c.result.ok)).toEqual([true, true, true]);
    const web = [...world.state().graphs.values()].find(g => g.name === 'Rivers');
    expect(world.thingsIn(web.id).map(world.nameOf).sort()).toEqual(['River', 'Valley']);
    expect(world.linksIn(web.id).map(l => `${world.nameOf(l.a)} ${l.relation.toLowerCase()} ${world.nameOf(l.b)}`)).toEqual(['River carves Valley']);
    expect(world.proto(world.findThing('River')).description).toBe('Water moving in a channel.');

    // What it sees: its view, what it holds, and its own last thoughts.
    const lastChoice = seen.filter(r => r.schema.name === 'choice').at(-1);
    expect(lastChoice.user).toMatch(/In focus: River — Water moving in a channel\./);
    expect(lastChoice.user).toMatch(/Held in mind:\n- River/);
    expect(lastChoice.user).toMatch(/What you were just thinking:\n- A web for rivers\.\n- A river\./);
    expect(cycles[2].locus.focusName).toBe('Valley');
    // Every write became an episode, written by the loop.
    expect(cycles.every(c => c.episode)).toBe(true);
    // Each call fits Apple's window.
    expect(seen.every(r => r.user.length / 4 < 4096)).toBe(true);
  });

  it('opens a Thing up, goes inside it, and steps back out', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Geology: { things: { Rock: 'A solid mass of minerals.' } } } });
    const { mind } = planMind([
      { choose: /^look at Rock/ },
      { choose: /^open up Rock/ }, { fill: 'Quartz' }, { fill: 'A hard mineral in many rocks.' },
      { choose: /^step back out to Rock/ }
    ]);
    const { cycles } = await live(world, mind, 3, { resume: { tick: 0, locus: { web: webs.Geology, focus: null, path: [] } } });
    expect(cycles.map(c => c.result.ok)).toEqual([true, true, true]);
    const inside = world.insideOf(ids.Rock);
    expect(world.thingsIn(inside).map(world.nameOf)).toEqual(['Quartz']);
    expect(cycles[1].locus).toMatchObject({ web: inside, focusName: 'Quartz', path: [ids.Rock] });
    expect(cycles[2].locus).toMatchObject({ web: webs.Geology, focusName: 'Rock', path: [] });
  });

  it('carries out "something else" written as a command', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { Flooring: 'boards', Floor: 'what you stand on' } } } });
    const { mind } = planMind([{ choose: /^something else/ }, { fill: 'merge Flooring into Floor' }]);
    const { cycles } = await live(world, mind, 1, { resume: { tick: 0, locus: { web: webs.W, focus: null, path: [] } } });
    expect(cycles[0]).toMatchObject({ chose: 'merge Flooring into Floor', move: 'merge', result: { ok: true } });
    expect(world.proto(ids.Flooring)).toBeFalsy();
  });

  it('never makes a Thing a part of itself', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Baking: { things: { Flour: 'Ground grain.' } } } });
    const { mind } = planMind([
      { choose: /^look at Flour/ },
      { choose: /^open up Flour/ }, { fill: 'Flour, wheat grains' }, { fill: 'Seeds of wheat.' }
    ]);
    const { cycles } = await live(world, mind, 2, { resume: { tick: 0, locus: { web: webs.Baking, focus: null, path: [] } } });
    expect(world.thingsIn(world.insideOf(ids.Flour)).map(world.nameOf)).toEqual(['Wheat grains']);
    expect(cycles[1].result.ok).toBe(true);
  });

  it('keeps "something else" it has no move for as a report, and maps what it can', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { W: { things: { A: 'a thing' } } } });
    const { mind } = planMind([
      { choose: /^something else/ }, { fill: 'compose a song about it' },
      { choose: /^something else/ }, { fill: 'make another thing' }, { fill: 'B' }, { fill: 'b thing' }
    ]);
    const { cycles, end } = await live(world, mind, 2, { resume: { tick: 0, locus: { web: webs.W, focus: null, path: [] } } });
    expect(cycles[0].result.ok).toBe(false);
    expect(end.state.missing).toEqual([{ tick: 1, text: 'compose a song about it' }]);
    expect(cycles[1].move).toBe('make');
    expect(world.thingsIn(webs.W).map(world.nameOf).sort()).toEqual(['A', 'B']);
  });

  it('does nothing on an invalid choice, and says when a thought claims a write that did not happen', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { W: { things: { A: 'a thing' } } } });
    let n = 0;
    const mind = createMind({
      backend: scripted((req) => {
        n++;
        if (req.schema.name === 'choice') return n === 1 ? { choice: '99' } : { choice: '1' };
        return THOUGHT_Q.test(req.user) ? { text: 'I created the Soul and connected it.' } : { text: 'x' };
      })
    });
    const { cycles } = await live(world, mind, 2, { resume: { tick: 0, locus: { web: webs.W, focus: null, path: [] } } });
    expect(cycles[0].result).toMatchObject({ ok: false, summary: 'did not choose' });
    expect(cycles[0].unbacked).toEqual(['Soul']);
    expect(mind.stats.invalid).toBe(1);
  });

  it('holds what it touches and lets go on request', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { W: { things: { A: 'a', B: 'b' } } } });
    const { mind } = planMind([{ choose: /^look at A/ }, { choose: /^look at B/ }, { choose: /^let go of A/ }]);
    await live(world, mind, 3, { resume: { tick: 0, locus: { web: webs.W, focus: null, path: [] } } });
    expect(held(world).map(h => h.id)).toEqual([ids.B]);
  });

  it('resumes from saved state, waking with its working memory faded', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { W: { things: { A: 'a' } } } });
    const first = planMind([{ choose: /^look at A/ }]);
    const { end } = await live(world, first.mind, 1, { resume: { tick: 0, locus: { web: webs.W, focus: null, path: [] } } });
    const second = planMind([{ choose: /^describe A/ }, { fill: 'The first letter.' }]);
    const { cycles } = await live(world, second.mind, 1, { resume: end.state });
    expect(cycles[0].tick).toBe(2);
    expect(cycles[0].locus.focusName).toBe('A');
    expect(world.proto(world.findThing('A')).description).toBe('The first letter.');
  });
});

describe('createDruid at birth', () => {
  it('turns what is on its mind into its first open goal', async () => {
    const { createDruid } = await import('../../src/druid/druid.js');
    const { openGoals } = await import('../../src/druid/roles.js');
    const { world } = await freshWorld();
    const { mind } = planMind([{ choose: /^work toward your goal/ }]);
    for await (const r of createDruid({ world, mind }, { maxCycles: 1, seed: 'How do rivers shape the land?' })) void r;
    expect(openGoals(world).map(world.nameOf)).toEqual(['How do rivers shape the land']);
  });

  it('will not make a "new" Thing that is already here under that name', async () => {
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { W: { things: { Creative: 'c' } } } });
    expect((await world.createThing(webs.W, 'creative', { fresh: true })).ok).toBe(false);
    expect((await world.createThing(webs.W, 'creative')).ok).toBe(true); // reuse is fine when meant
  });
});

describe('keeping a thought (phonological loop → long-term memory)', () => {
  it('offers back what a thought named that the universe lacks, and keeps it in the content web, not Home', async () => {
    const { createDruid } = await import('../../src/druid/druid.js');
    const { world } = await freshWorld();
    const { webs } = await buildUniverse(world, { webs: { Water: { things: { River: 'Water flowing in a channel.' } } } });
    const { mind } = planMind([
      { choose: /^look at River/ },
      { choose: /^keep what you just thought/ }, { fill: 'Valley, Erosion, Sediment' },
      { fill: 'Low land a river cuts.' }, { fill: 'The wearing away of rock.' }, { fill: 'Grains carried by water.' }
    ], ['Rivers carve valleys by erosion and carry sediment downstream.']);
    const out = [];
    for await (const r of createDruid({ world, mind }, { maxCycles: 2, resume: { tick: 0, locus: { web: webs.Water, focus: null, path: [] } } })) out.push(r);
    const second = out.filter(r => r.type === 'cycle')[1];
    expect(second.move).toBe('remember');
    expect(world.thingsIn(webs.Water).map(world.nameOf).sort()).toEqual(['Erosion', 'River', 'Sediment', 'Valley']);
    expect(world.proto(world.findThing('Erosion')).description).toBe('The wearing away of rock.');
  });
});
