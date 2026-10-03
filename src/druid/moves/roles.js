/**
 * Moves for goals, plans and beliefs (see roles.js for their behavior).
 *
 * ctx additionally carries `roles`: { home, types: { goal, belief, plan } },
 * refreshed each cycle, so a role type the Druid deleted is simply absent and
 * its moves stop being offered.
 */

import { recall, buildMemoryIndex } from '../recall.js';
import {
  openGoals, setGoalStatus, activePlans, nextStep, planSteps,
  addEvidence, confidence, confidenceWords, sourceKind, beliefsIn, JUDGMENT_SCALE
} from '../roles.js';

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });
const titleish = (s) => String(s || '').trim().replace(/[.!?]+$/, '').replace(/^\w/, c => c.toUpperCase());
const topGoals = (ctx, k) => openGoals(ctx.world).sort((a, b) => (ctx.activation.get(b) ?? -9) - (ctx.activation.get(a) ?? -9)).slice(0, k);

export const commitGoal = {
  id: 'commitGoal',
  prior: 0.45,
  offer(ctx) {
    if (!ctx.roles?.types.goal || openGoals(ctx.world).length >= 3) return [];
    return [{ label: 'set yourself a goal: ___', blank: { question: 'Your goal, in a few plain words (what you want to understand or build).', maxWords: 10 }, prior: openGoals(ctx.world).length === 0 ? 0.7 : 0.4 }];
  },
  async run(ctx, _data, text) {
    const name = titleish(text);
    if (!name) return fail('no goal');
    const r = await ctx.world.createThing(ctx.roles.home, name, { description: 'A goal.', typeNodeId: ctx.roles.types.goal });
    if (!r.ok) return fail(r.error);
    setGoalStatus(ctx.world, r.id, 'open', ctx.tick);
    return { ok: true, summary: `set the goal: ${name}`, touched: [r.id], wrote: true };
  }
};

export const pursueGoal = {
  id: 'pursueGoal',
  prior: 0.75,
  offer(ctx) {
    return topGoals(ctx, 2).map(g => ({ label: `work toward your goal "${ctx.world.nameOf(g)}"`, data: { goal: g }, target: g }));
  },
  async run(ctx, data) {
    const { world } = ctx;
    // Go where the goal's words point; if nothing matches yet, say so.
    const hits = recall(buildMemoryIndex(world.state()), world.nameOf(data.goal), { k: 6 })
      .filter(h => !world.druidOf(h.id).roleType && h.id !== data.goal);
    for (const h of hits) {
      const web = world.websOf(h.id).find(w => !world.isSystemWeb(w));
      if (web) {
        world.focusWeb(web);
        return { ok: true, summary: `went to ${h.name}, toward the goal "${world.nameOf(data.goal)}"`, touched: [h.id, data.goal], locus: { web, focus: h.id, path: [] }, wrote: false };
      }
    }
    return { ok: true, summary: `looked for something toward "${world.nameOf(data.goal)}" and found nothing yet — something new has to be made`, touched: [data.goal], wrote: false };
  }
};

export const resolveGoal = {
  id: 'resolveGoal',
  prior: 0.3,
  offer(ctx) {
    return topGoals(ctx, 2).map(g => ({ label: `mark your goal "${ctx.world.nameOf(g)}" as reached`, data: { goal: g }, target: g }));
  },
  async run(ctx, data) {
    setGoalStatus(ctx.world, data.goal, 'resolved', ctx.tick);
    return { ok: true, summary: `reached the goal "${ctx.world.nameOf(data.goal)}"`, touched: [data.goal], wrote: true };
  }
};

export const abandonGoal = {
  id: 'abandonGoal',
  prior: 0.12,
  offer(ctx) {
    return topGoals(ctx, 1).map(g => ({ label: `give up on your goal "${ctx.world.nameOf(g)}"`, data: { goal: g }, target: g }));
  },
  async run(ctx, data) {
    setGoalStatus(ctx.world, data.goal, 'abandoned', ctx.tick);
    return { ok: true, summary: `gave up on "${ctx.world.nameOf(data.goal)}"`, touched: [], wrote: true };
  }
};

export const breakDownGoal = {
  id: 'breakDownGoal',
  prior: 0.35,
  offer(ctx) {
    if (!ctx.roles?.types.goal) return [];
    return topGoals(ctx, 1).map(g => ({ label: `break your goal "${ctx.world.nameOf(g)}" into a smaller goal: ___`, blank: { question: `One smaller goal on the way to "${ctx.world.nameOf(g)}".`, maxWords: 10 }, data: { goal: g }, target: g }));
  },
  async run(ctx, data, text) {
    const name = titleish(text);
    if (!name) return fail('no subgoal');
    const inside = ctx.world.ensureInside(data.goal);
    const r = await ctx.world.createThing(inside, name, { description: `On the way to: ${ctx.world.nameOf(data.goal)}.`, typeNodeId: ctx.roles.types.goal });
    if (!r.ok) return fail(r.error);
    setGoalStatus(ctx.world, r.id, 'open', ctx.tick);
    return { ok: true, summary: `broke "${ctx.world.nameOf(data.goal)}" down: ${name}`, touched: [r.id, data.goal], wrote: true };
  }
};

export const makePlan = {
  id: 'makePlan',
  prior: 0.4,
  offer(ctx) {
    if (!ctx.roles?.types.plan) return [];
    const planned = new Set(activePlans(ctx.world).map(p => ctx.world.druidOf(p).forGoal));
    return topGoals(ctx, 2).filter(g => !planned.has(g)).slice(0, 1).map(g => ({
      label: `plan how to reach "${ctx.world.nameOf(g)}" — the first step: ___`,
      blank: { question: `The first step toward "${ctx.world.nameOf(g)}", in a few plain words.`, maxWords: 10 },
      data: { goal: g }, target: g
    }));
  },
  async run(ctx, data, text) {
    const step = titleish(text);
    if (!step) return fail('no step');
    const { world } = ctx;
    const r = await world.createThing(ctx.roles.home, `Plan: ${world.nameOf(data.goal)}`, { description: `Steps toward ${world.nameOf(data.goal)}.`, typeNodeId: ctx.roles.types.plan });
    if (!r.ok) return fail(r.error);
    world.setDruid(r.id, { forGoal: data.goal, cursor: 0, status: 'open' });
    const inside = world.ensureInside(r.id);
    const s = await world.createThing(inside, step, { description: 'A step.' });
    if (!s.ok) return fail(s.error);
    return { ok: true, summary: `planned "${world.nameOf(data.goal)}", starting with: ${step}`, touched: [r.id, data.goal], wrote: true };
  }
};

export const addStep = {
  id: 'addStep',
  prior: 0.35,
  offer(ctx) {
    return activePlans(ctx.world).slice(0, 1).map(p => ({
      label: `add the next step to "${ctx.world.nameOf(p)}": ___`,
      blank: { question: `The step after "${ctx.world.nameOf(planSteps(ctx.world, p).at(-1) || '')}", in a few plain words.`, maxWords: 10 },
      data: { plan: p }, target: p
    }));
  },
  async run(ctx, data, text) {
    const step = titleish(text);
    if (!step) return fail('no step');
    const { world } = ctx;
    const inside = world.ensureInside(data.plan);
    const last = planSteps(world, data.plan).at(-1);
    const s = await world.createThing(inside, step, { description: 'A step.' });
    if (!s.ok) return fail(s.error);
    if (last && last !== s.id) await world.connect(inside, last, s.id, 'then');
    return { ok: true, summary: `added a step to "${world.nameOf(data.plan)}": ${step}`, touched: [data.plan], wrote: true };
  }
};

export const stepDone = {
  id: 'stepDone',
  prior: 0.55,
  offer(ctx) {
    return activePlans(ctx.world).slice(0, 2).map(p => {
      const step = nextStep(ctx.world, p);
      return step ? { label: `mark the step "${ctx.world.nameOf(step)}" done`, data: { plan: p, step }, target: p } : null;
    }).filter(Boolean);
  },
  async run(ctx, data) {
    const { world } = ctx;
    const cursor = (world.druidOf(data.plan).cursor || 0) + 1;
    world.setDruid(data.plan, { cursor });
    const finished = cursor >= planSteps(world, data.plan).length;
    return { ok: true, summary: `did "${world.nameOf(data.step)}"${finished ? ` — that was the last step of "${world.nameOf(data.plan)}"` : ''}`, touched: [data.plan], wrote: true };
  }
};

export const believe = {
  id: 'believe',
  prior: 0.5,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !ctx.roles?.types.belief || !ctx.locus.web) return [];
    return [{ label: `say something you believe about ${f.name}: ___`, blank: { question: `One thing you believe about ${f.name}, as a short plain statement.`, maxWords: 12 }, data: { about: f.id }, target: f.id }];
  },
  async run(ctx, data, text) {
    const claim = titleish(text);
    if (!claim) return fail('no claim');
    const { world } = ctx;
    const r = await world.createThing(ctx.locus.web, claim, { description: `A belief about ${world.nameOf(data.about)}.`, typeNodeId: ctx.roles.types.belief });
    if (!r.ok) return fail(r.error);
    addEvidence(world, r.id, { source: data.about, judgment: 'support', kind: sourceKind(world, data.about), tick: ctx.tick });
    await world.connect(ctx.locus.web, r.id, data.about, 'is about');
    return { ok: true, summary: `came to believe: ${claim}`, touched: [r.id, data.about], wrote: true };
  }
};

export const weighBelief = {
  id: 'weighBelief',
  prior: 0.55,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !ctx.locus.web) return [];
    // Beliefs here that this Thing has not yet been weighed against.
    return beliefsIn(ctx.world, ctx.locus.web)
      .filter(b => b !== f.id && !(ctx.world.druidOf(b).evidence || []).some(e => e.source === f.id))
      .slice(0, 2)
      .map(b => ({ label: `weigh whether ${f.name} supports the belief "${ctx.world.nameOf(b)}"`, data: { belief: b, source: f.id }, target: b }));
  },
  async run(ctx, data) {
    const { world } = ctx;
    const key = await ctx.judge(`Belief: "${world.nameOf(data.belief)}". Consider ${world.nameOf(data.source)}: ${world.proto(data.source)?.description || '(no description)'}. How does ${world.nameOf(data.source)} bear on the belief?`, JUDGMENT_SCALE);
    if (!key) return fail('no judgment');
    addEvidence(world, data.belief, { source: data.source, judgment: key, kind: sourceKind(world, data.source), tick: ctx.tick });
    const c = confidence(world, data.belief);
    return { ok: true, summary: `weighed ${world.nameOf(data.source)} against "${world.nameOf(data.belief)}": it ${JUDGMENT_SCALE.find(s => s.key === key).label} (${confidenceWords(c)})`, touched: [data.belief, data.source], wrote: true };
  }
};

export const ROLE_MOVES = [commitGoal, pursueGoal, resolveGoal, abandonGoal, breakDownGoal, makePlan, addStep, stepDone, believe, weighBelief];
