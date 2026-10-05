/**
 * Moves for goals, plans and beliefs (see roles.js for their behavior).
 *
 * ctx additionally carries `roles`: { home, types: { goal, belief, plan } },
 * refreshed each cycle, so a role type the Druid deleted is simply absent and
 * its moves stop being offered.
 */

import { recall, buildMemoryIndex, tokenize } from '../recall.js';
import { isOwnPlace } from '../attention.js';
import {
  isBookkeeping,
  openGoals, setGoalStatus, activePlans, nextStep, planSteps,
  addEvidence, confidence, confidenceWords, sourceKind, beliefsIn, claimOf, JUDGMENT_SCALE
} from '../roles.js';
import { wordsIn, shortName, normalizeName, understandGoal, MAX_NAME_WORDS } from '../names.js';

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });
const titleish = (s) => String(s || '').trim().replace(/[.!?]+$/, '').replace(/^\w/, c => c.toUpperCase());
const topGoals = (ctx, k) => openGoals(ctx.world).sort((a, b) => (ctx.activation.get(b) ?? -9) - (ctx.activation.get(a) ?? -9)).slice(0, k);

export const commitGoal = {
  id: 'commitGoal',
  prior: 0.45,
  offer(ctx) {
    if (!ctx.roles?.types.goal || openGoals(ctx.world).length >= 3) return [];
    // With a goal and nowhere to work on it yet, the web comes first: woken
    // wondering about dark matter, a Druid set "Dark Matter" as a second goal.
    if (openGoals(ctx.world).length && !hasContentWeb(ctx.world)) return [];
    return [{ label: 'set yourself a goal: ___', blank: { question: 'Your goal, in a few plain words (what you want to understand or build), like "understand how bread rises".', maxWords: 5 }, prior: openGoals(ctx.world).length === 0 ? 0.7 : 0.4 }];
  },
  async run(ctx, _data, text) {
    const name = titleish(text);
    if (!name) return fail('no goal');
    // The same goal again, in other words: "Dark Matter" beside "Understand dark matter".
    const key = normalizeName(understandGoal(name));
    const again = openGoals(ctx.world).find(g => normalizeName(understandGoal(ctx.world.nameOf(g))) === key);
    if (again) return fail(`"${ctx.world.nameOf(again)}" is already your goal`);
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
    // Only toward something that is there: with nothing to go to it "looked
    // and found nothing" three times in a Druid's first eight moments.
    return topGoals(ctx, 2).filter(g => elsewhere(ctx, towardTarget(ctx, ctx.world.nameOf(g), [g])))
      .map(g => ({ label: `work toward your goal "${ctx.world.nameOf(g)}"`, data: { goal: g }, target: g }));
  },
  async run(ctx, data) {
    const r = goToward(ctx, ctx.world.nameOf(data.goal), [data.goal]);
    if (r) return { ...r, summary: `${r.summary}, toward the goal "${ctx.world.nameOf(data.goal)}"`, touched: [...r.touched, data.goal] };
    return { ok: true, summary: `looked for something toward "${ctx.world.nameOf(data.goal)}" and found nothing yet — something new has to be made`, touched: [data.goal], wrote: false };
  }
};

/**
 * Go to the Thing a phrase points at, in a web of real content. Content only:
 * a goal's own plan repeats its words, and pursuing a goal by visiting its
 * plan is going in a circle. Nor inside a goal's or plan's own web.
 */
function goToward(ctx, phrase, exclude = []) {
  const hit = towardTarget(ctx, phrase, exclude);
  if (!hit) return null;
  ctx.world.focusWeb(hit.web);
  return { ok: true, summary: `went to ${hit.name}`, touched: [hit.id], locus: { web: hit.web, focus: hit.id, path: [] }, wrote: false };
}

/**
 * Planning waits until there is a web to build in: a Druid with nothing yet
 * spent its first eight moments breaking its goal down, planning, and looking
 * at the plan.
 */
const hasContentWeb = (world) => [...world.state().graphs.keys()].some(g => !isOwnPlace(world, g));

/** A place to go that is not where it already is: "went to Dark matter particle" four times, toward the same step. */
const elsewhere = (ctx, hit) => !!hit && hit.id !== ctx.locus.focus && !(ctx.locus.path || []).includes(hit.id);

/** What goToward would go to, without going: { id, name, web } | null. */
function towardTarget(ctx, phrase, exclude = []) {
  const { world } = ctx;
  const skip = new Set(exclude);
  const usable = (id) => !skip.has(id) && !isBookkeeping(world, id);
  // What the phrase names comes first ("mix the dough" → Dough); recall
  // leaves out what its cue already names, so it only supplies what is
  // associated, after that.
  const words = new Set(tokenize(phrase));
  const named = world.allThings()
    .filter(usable)
    .map(id => ({ id, name: world.nameOf(id), n: tokenize(world.nameOf(id)).filter(t => words.has(t)).length }))
    .filter(h => h.n > 0)
    .sort((a, b) => b.n - a.n);
  const hits = [...named, ...recall(buildMemoryIndex(world.state()), phrase, { k: 8 }).filter(h => usable(h.id))];
  // Not Home, its own webs, or a goal's or plan's inside (attention.js isOwnPlace).
  // Not where it just was, when anywhere else will do: pursuing one goal went
  // to Causes four times, and back and forth from there.
  const left = new Set(ctx.left || []);
  for (const pass of [true, false]) {
    for (const h of hits) {
      if (pass && left.has(h.id)) continue;
      const web = world.websOf(h.id).find(w => !isOwnPlace(world, w));
      if (web) return { id: h.id, name: h.name || world.nameOf(h.id), web };
    }
  }
  return null;
}

/** Things built toward a goal: content Things its writes touched since the goal opened. */
export const REACHED_AFTER = 8;
const builtToward = (ctx, g) => {
  const since = ctx.world.druidOf(g).statusAt ?? -Infinity;
  const ids = new Set();
  for (const w of ctx.writes || []) {
    if (w.tick <= since) continue;
    for (const id of w.touched || []) if (ctx.world.proto(id) && !isBookkeeping(ctx.world, id)) ids.add(id);
  }
  return ids.size;
};

export const resolveGoal = {
  id: 'resolveGoal',
  prior: 0.3,
  offer(ctx) {
    const planDone = (g) => ctx.world.allThings().some(p => ctx.world.druidOf(p).forGoal === g && ctx.world.druidOf(p).status === 'done');
    // Only once something has been built toward it: a seedless Druid declared
    // "Dark matter" reached after one description, its web still empty.
    return topGoals(ctx, 2).filter(g => builtToward(ctx, g) >= REACHED_AFTER)
      .map(g => ({ label: `mark your goal "${ctx.world.nameOf(g)}" as reached`, data: { goal: g }, target: g, ...(planDone(g) ? { prior: 0.8 } : {}) }));
  },
  async run(ctx, data) {
    if (ctx.writes && builtToward(ctx, data.goal) < REACHED_AFTER) {
      return { ok: false, error: `you have built too little toward "${ctx.world.nameOf(data.goal)}" yet: make and connect what it needs first`, touched: [], wrote: false };
    }
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
    if (!ctx.roles?.types.goal || !hasContentWeb(ctx.world)) return [];
    return topGoals(ctx, 1).map(g => ({ label: `break your goal "${ctx.world.nameOf(g)}" into a smaller goal: ___`, blank: { question: `One smaller goal on the way to "${ctx.world.nameOf(g)}", in a few words.`, maxWords: 5 }, data: { goal: g }, target: g }));
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
    // One plan at a time: plans made while another was open were dropped and
    // never looked at again.
    if (!ctx.roles?.types.plan || activePlans(ctx.world).length > 0 || !hasContentWeb(ctx.world)) return [];
    return topGoals(ctx, 1).map(g => ({
      label: `plan how to reach "${ctx.world.nameOf(g)}" — the first step: ___`,
      // What to find out, not a chore: a step written as a to-do ("Find
      // tutorial") turned a run about wooden floors into one about tutorials.
      blank: { question: `The first thing to find out on the way to "${ctx.world.nameOf(g)}", in a few words.`, maxWords: 5 },
      data: { goal: g }, target: g
    }));
  },
  async run(ctx, data, text) {
    const step = titleish(text);
    if (!step) return fail('no step');
    const { world } = ctx;
    const r = await world.createThing(ctx.roles.home, `Plan: ${world.nameOf(data.goal)}`, { description: `Steps toward ${world.nameOf(data.goal)}.`, typeNodeId: ctx.roles.types.plan });
    if (!r.ok) return fail(r.error);
    world.setDruid(r.id, { forGoal: data.goal, cursor: 0, status: 'open', stepSince: ctx.tick });
    const inside = world.ensureInside(r.id);
    // A step is its own Thing, never the content it names: reused, the step
    // "Dark matter particle" was the Thing Dark matter particle, and building
    // it filled the plan.
    const s = await world.createThing(inside, stepName(world, step), { description: 'A step.', fresh: true, reuse: false });
    if (!s.ok) return fail(s.error);
    world.setDruid(s.id, { step: true });
    return { ok: true, summary: `planned "${world.nameOf(data.goal)}", starting with: ${step}`, touched: [r.id, data.goal], wrote: true };
  }
};

/**
 * A step's name, never another Thing's: tools find Things by name and take the
 * last made, so a step "Minerals" was taken for the Thing Minerals and placed
 * in Ice and Ice cube. Named like a Thing that exists, it is "Minerals (step)".
 */
export function stepName(world, step) {
  const taken = world.allThings().some(id => normalizeName(world.nameOf(id)) === normalizeName(step));
  return taken ? `${step} (step)` : step;
}

export const addStep = {
  id: 'addStep',
  prior: 0.35,
  offer(ctx) {
    return activePlans(ctx.world).slice(0, 1).map(p => ({
      label: `add the next step to "${ctx.world.nameOf(p)}": ___`,
      blank: { question: `The next thing to find out, after "${ctx.world.nameOf(planSteps(ctx.world, p).at(-1) || '')}", in a few words.`, maxWords: 5 },
      data: { plan: p }, target: p
    }));
  },
  async run(ctx, data, text) {
    const step = titleish(text);
    if (!step) return fail('no step');
    const { world } = ctx;
    const inside = world.ensureInside(data.plan);
    const last = planSteps(world, data.plan).at(-1);
    const s = await world.createThing(inside, stepName(world, step), { description: 'A step.', fresh: true, reuse: false });
    if (!s.ok) return fail(s.error);
    world.setDruid(s.id, { step: true });
    if (last && last !== s.id) await world.connect(inside, last, s.id, 'then');
    return { ok: true, summary: `added a step to "${world.nameOf(data.plan)}": ${step}`, touched: [data.plan], wrote: true };
  }
};

/**
 * Work done since a plan's current step became next: a write that touched a
 * Thing of substance, not more planning. Without this, "mark the step done"
 * was a free claim — one run ticked a step off the moment after writing it.
 */
const workedSince = (ctx, plan) => {
  const since = ctx.world.druidOf(plan).stepSince ?? -Infinity;
  return (ctx.writes || []).some(w => w.tick > since && (w.touched || []).some(id => ctx.world.proto(id) && !isBookkeeping(ctx.world, id)));
};

export const stepDone = {
  id: 'stepDone',
  prior: 0.55,
  offer(ctx) {
    return activePlans(ctx.world).slice(0, 1).map(p => {
      const step = nextStep(ctx.world, p);
      return step && workedSince(ctx, p) ? { label: `mark the step "${ctx.world.nameOf(step)}" done`, data: { plan: p, step }, target: p } : null;
    }).filter(Boolean);
  },
  async run(ctx, data) {
    const { world } = ctx;
    const cursor = (world.druidOf(data.plan).cursor || 0) + 1;
    const finished = cursor >= planSteps(world, data.plan).length;
    world.setDruid(data.plan, { cursor, stepSince: ctx.tick, ...(finished ? { status: 'done', statusAt: ctx.tick } : {}) });
    return { ok: true, summary: `did "${world.nameOf(data.step)}"${finished ? ` — that was the last step of "${world.nameOf(data.plan)}"` : ''}`, touched: [data.plan], wrote: true };
  }
};

/** Go where the next step points, the way pursuing a goal goes where the goal points. */
export const pursueStep = {
  id: 'pursueStep',
  prior: 0.7,
  offer(ctx) {
    return activePlans(ctx.world).slice(0, 1).map(p => {
      const step = nextStep(ctx.world, p);
      return step && elsewhere(ctx, towardTarget(ctx, ctx.world.nameOf(step), [step, p])) ? { label: `work on the next step of your plan: "${ctx.world.nameOf(step)}"`, data: { plan: p, step }, target: step } : null;
    }).filter(Boolean);
  },
  async run(ctx, data) {
    const r = goToward(ctx, ctx.world.nameOf(data.step), [data.step, data.plan]);
    return r || { ok: true, summary: `looked for what "${ctx.world.nameOf(data.step)}" needs and found nothing yet — something new has to be made`, touched: [data.plan], wrote: false };
  }
};

export const believe = {
  id: 'believe',
  prior: 0.5,
  offer(ctx) {
    const f = ctx.view.focus;
    if (!f || !ctx.roles?.types.belief || !ctx.locus.web || isBookkeeping(ctx.world, f.id)) return [];
    return [{ label: `say something you believe about ${f.name}: ___`, blank: { question: `One thing you believe about ${f.name}, as one short plain sentence.`, maxWords: 18 }, data: { about: f.id }, target: f.id }];
  },
  async run(ctx, data, text) {
    // One sentence: a claim cut off mid-phrase ("…shaping the") is no claim.
    const claim = titleish(String(text || '').split(/(?<=[.!?])\s/)[0]);
    if (!claim) return fail('no claim');
    const { world } = ctx;
    // The claim is a sentence; the belief is named by a handle for it.
    // Named by the contextless name helper first: cut at five words, a belief
    // was named "Dark energy is the mysterious".
    let name = claim;
    if (wordsIn(claim).length > MAX_NAME_WORDS) {
      const verdict = await world.nameGate?.(claim).catch(() => null);
      name = titleish((verdict?.kind === 'sentence' && verdict.short)
        || await ctx.ask(`Give that belief a short name, at most 4 words: "${claim}"`, 4)
        || shortName(claim));
    }
    // Not the name of a Thing: a belief about Dark matter named "Dark matter"
    // was refused as already here, and one about Air was named "Atmosphere".
    if (world.findThing(name) || normalizeName(name) === normalizeName(world.nameOf(data.about))) {
      name = titleish(await ctx.ask(`Give the belief "${claim}" a short name of at most 4 words that says what is believed, not only "${world.nameOf(data.about)}".`, 4) || shortName(claim));
      if (world.findThing(name)) name = shortName(claim);
    }
    const r = await world.createThing(ctx.locus.web, name, { description: `${claim.replace(/[.!?]*$/, '.')} A belief about ${world.nameOf(data.about)}.`, typeNodeId: ctx.roles.types.belief, fresh: true });
    if (!r.ok) return fail(r.error);
    world.setDruid(r.id, { claim });
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
      .map(b => ({ label: `weigh whether ${f.name} supports the belief "${claimOf(ctx.world, b)}"`, data: { belief: b, source: f.id }, target: b }));
  },
  async run(ctx, data) {
    const { world } = ctx;
    const key = await ctx.judge(`Belief: "${claimOf(world, data.belief)}". Consider ${world.nameOf(data.source)}: ${world.proto(data.source)?.description || '(no description)'}. How does ${world.nameOf(data.source)} bear on the belief?`, JUDGMENT_SCALE);
    if (!key) return fail('no judgment');
    addEvidence(world, data.belief, { source: data.source, judgment: key, kind: sourceKind(world, data.source), tick: ctx.tick });
    const c = confidence(world, data.belief);
    return { ok: true, summary: `weighed ${world.nameOf(data.source)} against "${world.nameOf(data.belief)}": it ${JUDGMENT_SCALE.find(s => s.key === key).label} (${confidenceWords(c)})`, touched: [data.belief, data.source], wrote: true };
  }
};

export const ROLE_MOVES = [commitGoal, pursueGoal, resolveGoal, abandonGoal, breakDownGoal, makePlan, addStep, stepDone, pursueStep, believe, weighBelief];
