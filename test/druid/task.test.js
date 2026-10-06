// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { freshWorld, buildUniverse, quiet } from './helpers/headlessWorld.js';
import { subjectOfGoal, goalWeb, backToTask, setAside, takeUp, onTask, renderTask } from '../../src/druid/task.js';

beforeAll(() => quiet());

const goalIn = async (world, name, extra = {}) => {
  const { seedRoles, roleType } = await import('../../src/druid/roles.js');
  const { home } = await seedRoles(world);
  const g = await world.createThing(home, name, { typeNodeId: roleType(world, 'goal') });
  world.setDruid(g.id, { status: 'open', ...extra });
  return g.id;
};

describe('what it is working on', () => {
  it('knows what a goal is about', () => {
    expect(subjectOfGoal('Understand Venus')).toBe('Venus');
    expect(subjectOfGoal('Understand how bread rises')).toBe('Bread rises');
    expect(subjectOfGoal('Make a web of a ham sandwich')).toBe('Ham sandwich');
    expect(subjectOfGoal('Volcanoes')).toBe('Volcanoes');
  });

  it('a goal with nowhere to work on it is offered a web named for it, first of all when nothing is built', async () => {
    // Woken to understand Venus, it named its first web "Atmospheric dynamics" (The Druid 12, 2026-10-06).
    const { world } = await freshWorld();
    const g = await goalIn(world, 'Understand Venus');
    const [item] = goalWeb.offer({ world, locus: { web: null, focus: null }, task: null });
    expect(item).toMatchObject({ label: 'start a web for Venus, toward your goal "Understand Venus"', prior: 3.2 });
    const r = await goalWeb.run({ world, locus: { web: null, focus: null, path: [] }, view: {} }, item.data);
    expect(r).toMatchObject({ ok: true, takeUp: g });
    expect(world.graph(r.locus.web).name).toBe('Venus');
    expect(goalWeb.offer({ world, locus: r.locus, task: null })).toEqual([]);
  });

  it('offers the way back when it has wandered off, and lets it set the task aside', async () => {
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { 'Ham sandwich': { things: { Bread: 'b' } }, Quantum: { things: { Qubit: 'q' } } } });
    const g = await goalIn(world, 'Understand ham sandwich', { fromPerson: true });
    const task = takeUp(g, ids.Bread, webs['Ham sandwich'], 3);
    expect(onTask(world, task, { web: webs['Ham sandwich'], focus: null })).toBe(true);
    expect(onTask(world, task, { web: webs.Quantum, focus: ids.Qubit })).toBe(false);
    expect(backToTask.offer({ world, task, locus: { web: webs['Ham sandwich'], focus: ids.Bread } })).toEqual([]);
    const [back] = backToTask.offer({ world, task, locus: { web: webs.Quantum, focus: ids.Qubit } });
    expect(back.label).toBe('get back to Bread, what you are working on');
    expect(await backToTask.run({ world, task }, back.data)).toMatchObject({ ok: true, locus: { web: webs['Ham sandwich'], focus: ids.Bread } });
    expect(renderTask(world, task, 5)).toBe('You are working on "Understand ham sandwich", at Bread: you took it up 2 moments ago. Other goals wait until you reach it, give it up, or set it aside.');
    const [aside] = setAside.offer({ world, task, tick: 5 });
    expect(await setAside.run({ world, task }, aside.data)).toMatchObject({ ok: true, setAside: true });
  });
});

describe('a living Druid holding a task', () => {
  it('takes up what it turned to, and keeps to it while its own goal waits', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Quantum: { things: { Qubit: 'q', Gate: 'g' } }, Baking: { things: { Bread: 'b', Yeast: 'y' } } } });
    await goalIn(world, 'Understand quantum computing');
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      if (req.schema.name === 'wants') return { wants: 'look at bread' };
      if (req.schema.name === 'choice') {
        const pick = (re) => (req.user.match(re) || [])[1];
        return { choice: pick(/^(\d+)\. turn to Bread/m) || pick(/^(\d+)\. (?:go to|look at) /m) || '1' };
      }
      if (/what are you thinking now/.test(req.user)) return { text: 'Bread is baked.' };
      return { text: 'Fine.' };
    }) });
    const inbox = [];
    const out = [];
    for await (const r of createDruid({ world, mind }, { maxCycles: 4, resume: { tick: 0, locus: { web: webs.Quantum, focus: ids.Qubit, path: [] } }, hear: () => inbox.splice(0) })) {
      if (r.type !== 'cycle') continue;
      out.push(r);
      if (out.length === 1) inbox.push({ text: 'go look at bread' });
    }
    // It turned to Bread, and that is what it is working on.
    expect(out[1].result.summary).toBe('went to Bread, as they asked');
    expect(out[1].task).toMatchObject({ goal: 'Look at bread', at: 'Bread' });
    // Named in its prompt; its own goal waits.
    const choice = seen.filter(r => r.schema.name === 'choice')[2];
    expect(choice.user).toMatch(/You are working on "Look at bread", at Bread/);
    expect(choice.user).not.toMatch(/work toward your goal "Understand quantum computing"/);
  });

  it('lets a task lapse, and says so, once it has been away from it long enough', async () => {
    const { createMind } = await import('../../src/druid/mind/createMind.js');
    const { scripted } = await import('../../src/druid/mind/backends.js');
    const { createDruid } = await import('../../src/druid/druid.js');
    const { TASK_LAPSE } = await import('../../src/druid/task.js');
    const { world } = await freshWorld();
    const { webs, ids } = await buildUniverse(world, { webs: { Quantum: { things: { Qubit: 'q', Gate: 'g' } }, Baking: { things: { Bread: 'b' } } } });
    const g = await goalIn(world, 'Look at bread', { fromPerson: true });
    const seen = [];
    const mind = createMind({ backend: scripted((req) => {
      seen.push(req);
      // Not back to it.
      if (req.schema.name === 'choice') return { choice: (req.user.match(/^(\d+)\. (?!get back|work toward)/m) || [])[1] || '1' };
      return { text: 'Qubit holds a state.' };
    }) });
    const out = [];
    const resume = { tick: 20, locus: { web: webs.Quantum, focus: ids.Qubit, path: [] }, task: { goal: g, anchor: ids.Bread, web: webs.Baking, since: 2, lastOn: 21 - TASK_LAPSE } };
    for await (const r of createDruid({ world, mind }, { maxCycles: 2, resume })) if (r.type === 'cycle') out.push(r);
    expect(out[0].menu).toContain('get back to Bread, what you are working on');
    expect(out[0].task).toBeNull();
    expect(seen.filter(r => r.schema.name === 'choice')[1].user).toMatch(/You drifted away from "Look at bread"; it is no longer what you are working on\./);
  });
});
