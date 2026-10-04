/**
 * Commands — the Druid says what it wants in a plain line; this carries it out.
 *
 * The menu (moves/menu.js) lets a model choose only what code thought to
 * offer. Here the model writes one command, a verb and plain words:
 *
 *   connect Floor to Wood as made of
 *   make Bone inside Feet
 *   move White Oak out
 *   merge Flooring into Floor
 *
 * and an executor parses it, finds the Things it names, checks it, and does
 * it, reporting back in plain words. The model never sees ids or JSON; code
 * never guesses intent. What code cannot parse is rewritten once by a
 * contextless helper call; what still fails is reported, and the Druid sees
 * why on the next cycle.
 *
 * Most commands run the same moves the menu offers (their checks and their
 * combined steps come along); rename, move, merge and delete are new — the
 * tidying a menu never offered, so pruning is something the Druid can choose.
 *
 * The verb comes from a fixed list (guided generation enforces it); the rest
 * is free words parsed by the forms below.
 */

import { make, connect, open, close, describe, newWeb, note, remember, letGoMove, namesIn } from '../moves/basic.js';
import { commitGoal, pursueGoal, resolveGoal, abandonGoal, makePlan, addStep, stepDone, pursueStep, believe, weighBelief } from '../moves/roles.js';
import { variant, specialize, generalize, contrast, chunk } from '../moves/cognitive.js';
import { openGoals, activePlans, nextStep, isObject, roleOf } from '../roles.js';
import { normalizeName } from '../names.js';

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });
const lower = (s) => String(s || '').trim().toLowerCase();
const clean = (s) => String(s || '').trim().replace(/^["'“]|["'”.]$/g, '').trim();

/**
 * Find the Thing a name means: here first, then anywhere; exact, then by
 * normalized name ("tomatoes" → Tomato). The latest match wins, as elsewhere.
 */
export function resolveThing(ctx, name) {
  const { world, locus } = ctx;
  const want = lower(clean(name));
  if (!want) return null;
  const norm = normalizeName(want);
  const here = locus?.web ? world.thingsIn(locus.web) : [];
  const everywhere = world.allThings().filter(id => !world.isOwnThinking(id) || here.includes(id));
  for (const pool of [here, everywhere]) {
    const exact = pool.filter(id => lower(world.nameOf(id)) === want).pop();
    if (exact) return exact;
    const near = pool.filter(id => normalizeName(world.nameOf(id)) === norm).pop();
    if (near) return near;
  }
  return null;
}

/** A web by its name (not one of the Druid's system webs). */
const webNamed = (world, name) => [...world.state().graphs.values()].filter(g => !world.isSystemWeb(g.id) && lower(g.name) === lower(clean(name))).pop() || null;

const needs = (ctx, names) => {
  const ids = names.map(n => resolveThing(ctx, n));
  const missing = names.filter((n, i) => !ids[i]);
  return missing.length ? { error: `there is no Thing named ${missing.map(m => `"${clean(m)}"`).join(' or ')}` } : { ids };
};

/** Bring a Thing into the current web (placing it again, not copying), so it can be connected here. */
const bringHere = (ctx, id) => {
  if (ctx.locus.web && !ctx.world.thingsIn(ctx.locus.web).includes(id)) ctx.world.place(ctx.locus.web, id);
};

const topGoal = (ctx) => openGoals(ctx.world).sort((a, b) => (ctx.activation?.get(b) ?? -9) - (ctx.activation?.get(a) ?? -9))[0] || null;

/**
 * Each command: its verb, the form shown to the model, a parser over the
 * words after the verb (→ args, or null when they do not fit), and a run.
 */
export const COMMANDS = [
  {
    verb: 'make', form: 'make NAME [inside THING] [: what it is]',
    as: (a) => ({ move: a.inside ? 'open' : 'make', text: a.name }),
    parse: (rest) => {
      const m = /^(.+?)(?:\s+inside\s+(.+?))?(?:\s*:\s*(.+))?$/i.exec(rest);
      return m ? { name: clean(m[1]), inside: m[2] ? clean(m[2]) : null, what: m[3] ? clean(m[3]) : null } : null;
    },
    async run(ctx, a) {
      if (a.inside) {
        const { ids, error } = needs(ctx, [a.inside]);
        if (error) return fail(error);
        if (!isObject(ctx.world, ids[0])) return fail(`${ctx.world.nameOf(ids[0])} is not a Thing that has parts`);
        return open.run(withAnswers(ctx, [a.what]), { into: ids[0], create: true }, a.name);
      }
      if (!ctx.locus.web) return fail('you are in no web yet: start one with "web NAME"');
      // Making what is already here means saying what it is, or looking at
      // it: "make Rock: a solid natural substance" was most of the failed
      // commands in the first lab.
      const existing = resolveThing(ctx, a.name);
      if (existing && ctx.world.thingsIn(ctx.locus.web).includes(existing)) {
        if (a.what) return describe.run(ctx, { id: existing }, a.what);
        return { ok: true, summary: `${ctx.world.nameOf(existing)} is already here; looked at it`, touched: [existing], locus: { ...ctx.locus, focus: existing }, wrote: false };
      }
      const focus = ctx.locus.focus && isObject(ctx.world, ctx.locus.focus) ? ctx.locus.focus : null;
      return make.run(withAnswers(ctx, [focus ? null : undefined, a.what].filter(x => x !== undefined)), { connectTo: focus }, a.name);
    }
  },
  {
    verb: 'connect', form: 'connect THING to THING as RELATION',
    as: (a) => ({ move: 'connect', text: a.relation }),
    parse: (rest) => {
      const m = /^(.+?)\s+(?:to|with|and)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(rest);
      return m ? { a: clean(m[1]), b: clean(m[2]), relation: m[3] ? clean(m[3]) : null } : null;
    },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.a, a.b]);
      if (error) return fail(error);
      if (ids[0] === ids[1]) return fail('a Thing is not connected to itself');
      if (!ids.every(id => isObject(ctx.world, id))) return fail('only Things are connected; a belief or a goal is not one');
      if (!ctx.locus.web) return fail('you are in no web');
      for (const id of ids) bringHere(ctx, id);
      const relation = a.relation || await ctx.ask(`${ctx.world.nameOf(ids[0])} ___ ${ctx.world.nameOf(ids[1])}. What is the relation? (a verb or short phrase)`, 3);
      return connect.run(ctx, { a: ids[0], b: ids[1] }, relation);
    }
  },
  {
    verb: 'describe', form: 'describe THING: what it is',
    as: (a) => ({ move: 'describe', text: a.text }),
    parse: (rest) => { const m = /^(.+?)\s*:\s*(.+)$/.exec(rest); return m ? { name: clean(m[1]), text: clean(m[2]) } : (rest ? { name: clean(rest), text: null } : null); },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.name]);
      if (error) return fail(error);
      const text = a.text || await ctx.ask(`Describe ${ctx.world.nameOf(ids[0])} in one sentence.`, 20);
      if (!text) return fail('no description');
      return describe.run({ ...ctx, locus: { ...ctx.locus, web: ctx.world.websOf(ids[0])[0] || ctx.locus.web } }, { id: ids[0] }, text);
    }
  },
  {
    verb: 'go', form: 'go to THING | go to web NAME',
    as: (a) => ({ move: a.web ? 'goWeb' : 'look', text: null }),
    parse: (rest) => {
      const web = /^(?:to\s+)?(?:the\s+)?web\s+(.+)$/i.exec(rest);
      if (web) return { web: clean(web[1]) };
      const m = /^(?:to\b\s*)?(.+)$/i.exec(rest);
      return m && clean(m[1]) ? { name: clean(m[1]) } : null;
    },
    async run(ctx, a) {
      const { world } = ctx;
      if (a.web) {
        const web = webNamed(world, a.web);
        if (!web) return fail(`there is no web named "${a.web}"`);
        world.focusWeb(web.id);
        return { ok: true, summary: `went to the web ${web.name}`, touched: [world.ownerOf(web.id)].filter(Boolean), locus: { web: web.id, focus: null, path: [] }, wrote: false };
      }
      const { ids, error } = needs(ctx, [a.name]);
      if (error) {
        const w = webNamed(world, a.name);
        if (w) { world.focusWeb(w.id); return { ok: true, summary: `went to the web ${w.name}`, touched: [world.ownerOf(w.id)].filter(Boolean), locus: { web: w.id, focus: null, path: [] }, wrote: false }; }
        return fail(error);
      }
      const id = ids[0];
      const web = world.thingsIn(ctx.locus.web || '').includes(id) ? ctx.locus.web : world.websOf(id).find(w => !world.isSystemWeb(w));
      if (!web) return fail(`${world.nameOf(id)} is in no web you can go to`);
      world.focusWeb(web);
      return { ok: true, summary: `went to ${world.nameOf(id)}`, touched: [id], locus: web === ctx.locus.web ? { ...ctx.locus, focus: id } : { web, focus: id, path: [] }, wrote: false };
    }
  },
  {
    verb: 'open', form: 'open THING (go inside it)',
    as: () => ({ move: 'open', text: null }),
    parse: (rest) => (rest ? { name: clean(rest) } : null),
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.name]);
      if (error) {
        const w = webNamed(ctx.world, a.name);
        if (w) { ctx.world.focusWeb(w.id); return { ok: true, summary: `went to the web ${w.name}`, touched: [], locus: { web: w.id, focus: null, path: [] }, wrote: false }; }
        return fail(error);
      }
      if (!ctx.world.insideOf(ids[0]) || ctx.world.thingsIn(ctx.world.insideOf(ids[0])).length === 0) return fail(`${ctx.world.nameOf(ids[0])} has nothing inside yet: "make NAME inside ${ctx.world.nameOf(ids[0])}"`);
      return open.run(ctx, { into: ids[0] });
    }
  },
  {
    verb: 'out', form: 'out (step back out of this inside)',
    as: () => ({ move: 'close', text: null }),
    parse: () => ({}),
    async run(ctx) {
      const owner = ctx.world.ownerOf(ctx.locus.web);
      const outer = owner ? ctx.world.websOf(owner).filter(w => w !== ctx.locus.web && !ctx.world.isSystemWeb(w)) : [];
      if (!outer.length) return fail('you are not inside a Thing');
      return close.run(ctx, { to: owner, web: outer[0] });
    }
  },
  {
    verb: 'rename', form: 'rename THING to NAME',
    as: (a) => ({ move: 'rename', text: a.to }),
    parse: (rest) => { const m = /^(.+?)\s+to\s+(.+)$/i.exec(rest); return m ? { name: clean(m[1]), to: clean(m[2]) } : null; },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.name]);
      if (error) return fail(error);
      const before = ctx.world.nameOf(ids[0]);
      const clash = resolveThing(ctx, a.to);
      if (clash && clash !== ids[0]) return fail(`${ctx.world.nameOf(clash)} already exists: "merge ${before} into ${ctx.world.nameOf(clash)}" if they are the same`);
      ctx.world.state().updateNodePrototype(ids[0], (p) => { p.name = a.to; });
      return { ok: true, summary: `renamed ${before} to ${a.to}`, touched: [ids[0]], wrote: true };
    }
  },
  {
    verb: 'move', form: 'move THING out | move THING into THING',
    as: () => ({ move: 'move', text: null }),
    parse: (rest) => {
      const out = /^(.+?)\s+out$/i.exec(rest);
      if (out) return { name: clean(out[1]), into: null };
      const m = /^(.+?)\s+(?:into|inside|to)\s+(.+)$/i.exec(rest);
      return m ? { name: clean(m[1]), into: clean(m[2]) } : null;
    },
    async run(ctx, a) {
      const { world, locus } = ctx;
      const { ids, error } = needs(ctx, [a.name]);
      if (error) return fail(error);
      const id = ids[0];
      if (!locus.web || !world.thingsIn(locus.web).includes(id)) return fail(`${world.nameOf(id)} is not in this web`);
      let to;
      if (a.into) {
        const t = needs(ctx, [a.into]);
        if (t.error) return fail(t.error);
        if (!isObject(world, t.ids[0]) || t.ids[0] === id) return fail(`${world.nameOf(id)} cannot go inside ${world.nameOf(t.ids[0])}`);
        to = world.ensureInside(t.ids[0]);
      } else {
        const owner = world.ownerOf(locus.web);
        to = owner ? world.websOf(owner).find(w => w !== locus.web && !world.isSystemWeb(w)) : null;
        if (!to) return fail('this web is not inside anything, so there is no "out"');
      }
      world.place(to, id);
      world.unplace(locus.web, id);
      return { ok: true, summary: `moved ${world.nameOf(id)} ${a.into ? `inside ${a.into}` : `out to ${world.graph(to)?.name}`}`, touched: [id], locus: { ...locus, focus: null }, wrote: true };
    }
  },
  {
    verb: 'merge', form: 'merge THING into THING (they are the same)',
    as: () => ({ move: 'merge', text: null }),
    parse: (rest) => { const m = /^(.+?)\s+(?:into|with)\s+(.+)$/i.exec(rest); return m ? { from: clean(m[1]), into: clean(m[2]) } : null; },
    async run(ctx, a) {
      const { world } = ctx;
      const { ids, error } = needs(ctx, [a.from, a.into]);
      if (error) return fail(error);
      if (ids[0] === ids[1]) return fail('that is one Thing already');
      if (!ids.every(id => isObject(world, id))) return fail('only Things are merged');
      const name = world.nameOf(ids[1]);
      const r = await world.act('mergeNodes', { primaryPrototypeId: ids[1], secondaryPrototypeId: ids[0] });
      if (!r.ok) return fail(r.error);
      return { ok: true, summary: `merged ${a.from} into ${name}`, touched: [ids[1]], locus: { ...ctx.locus, focus: ids[1] }, wrote: true };
    }
  },
  {
    verb: 'delete', form: 'delete THING (only what you made)',
    as: () => ({ move: 'delete', text: null }),
    parse: (rest) => (rest ? { name: clean(rest) } : null),
    async run(ctx, a) {
      const { world } = ctx;
      const { ids, error } = needs(ctx, [a.name]);
      if (error) return fail(error);
      // What someone else made is theirs; the Druid can move it or merge it,
      // not delete it.
      if (world.druidOf(ids[0]).madeBy !== 'druid') return fail(`you did not make ${world.nameOf(ids[0])}, so you cannot delete it; you can move it or merge it`);
      const name = world.nameOf(ids[0]);
      if (!world.forget(ids[0])) return fail(`could not delete ${name}`);
      return { ok: true, summary: `deleted ${name}`, touched: [], locus: { ...ctx.locus, focus: ctx.locus.focus === ids[0] ? null : ctx.locus.focus }, wrote: true };
    }
  },
  {
    verb: 'kind', form: 'kind of THING: NAME (a new kind of it)',
    as: (a) => ({ move: 'specialize', text: a.name }),
    parse: (rest) => { const m = /^(?:of\s+)?(.+?)\s*:\s*(.+)$/i.exec(rest); return m ? { of: clean(m[1]), name: clean(m[2]) } : null; },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.of]);
      if (error) return fail(error);
      bringHere(ctx, ids[0]);
      return specialize.run(ctx, { of: ids[0] }, a.name);
    }
  },
  {
    verb: 'variant', form: 'variant of THING: NAME (a version that differs in one way)',
    as: (a) => ({ move: 'variant', text: a.name }),
    parse: (rest) => { const m = /^(?:of\s+)?(.+?)\s*:\s*(.+)$/i.exec(rest); return m ? { of: clean(m[1]), name: clean(m[2]) } : null; },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.of]);
      if (error) return fail(error);
      bringHere(ctx, ids[0]);
      return variant.run(ctx, { of: ids[0] }, a.name);
    }
  },
  {
    verb: 'both', form: 'both THING and THING are kinds of NAME',
    as: (a) => ({ move: 'generalize', text: a.name }),
    parse: (rest) => { const m = /^(.+?)\s+and\s+(.+?)\s+are\s+(?:both\s+)?(?:kinds?\s+of\s+)?(.+)$/i.exec(rest); return m ? { a: clean(m[1]), b: clean(m[2]), name: clean(m[3]) } : null; },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.a, a.b]);
      if (error) return fail(error);
      return generalize.run(ctx, { a: ids[0], b: ids[1] }, a.name);
    }
  },
  {
    verb: 'group', form: 'group THING, THING, THING as NAME',
    as: (a) => ({ move: 'chunk', text: a.name }),
    parse: (rest) => { const m = /^(.+?)\s+as\s+(.+)$/i.exec(rest); return m ? { members: namesIn(m[1]), name: clean(m[2]) } : null; },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, a.members);
      if (error) return fail(error);
      if (ids.length < 2) return fail('a group needs at least two Things');
      return chunk.run(ctx, { members: ids }, a.name);
    }
  },
  {
    verb: 'contrast', form: 'contrast THING with THING',
    as: () => ({ move: 'contrast', text: null }),
    parse: (rest) => { const m = /^(.+?)\s+(?:with|and|to)\s+(.+)$/i.exec(rest); return m ? { a: clean(m[1]), b: clean(m[2]) } : null; },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.a, a.b]);
      if (error) return fail(error);
      if (!ctx.roles?.types.belief) return fail('you keep no beliefs');
      return contrast.run(ctx, { a: ids[0], b: ids[1] });
    }
  },
  {
    verb: 'believe', form: 'believe: CLAIM (about what you are looking at)',
    as: (a) => ({ move: 'believe', text: a.claim }),
    parse: (rest) => (rest ? { claim: clean(rest.replace(/^:\s*/, '')) } : null),
    async run(ctx, a) {
      if (!ctx.locus.focus || !isObject(ctx.world, ctx.locus.focus)) return fail('look at a Thing first: a belief is about something');
      if (!ctx.roles?.types.belief) return fail('you keep no beliefs');
      return believe.run(ctx, { about: ctx.locus.focus }, a.claim);
    }
  },
  {
    verb: 'weigh', form: 'weigh THING against BELIEF',
    as: () => ({ move: 'weighBelief', text: null }),
    parse: (rest) => { const m = /^(.+?)\s+against\s+(.+)$/i.exec(rest); return m ? { source: clean(m[1]), belief: clean(m[2]) } : null; },
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.source, a.belief]);
      if (error) return fail(error);
      if (roleOf(ctx.world, ids[1]) !== 'belief') return fail(`${ctx.world.nameOf(ids[1])} is not one of your beliefs`);
      return weighBelief.run(ctx, { source: ids[0], belief: ids[1] });
    }
  },
  {
    verb: 'remember', form: 'remember THING, THING (keep them from your thought)',
    as: (a) => ({ move: 'remember', text: a.names }),
    parse: (rest) => (rest ? { names: rest } : null),
    async run(ctx, a) {
      const web = ctx.locus.web;
      if (!web) return fail('you are in no web');
      return remember.run(ctx, { web }, a.names);
    }
  },
  {
    verb: 'web', form: 'web NAME (start a new web)',
    as: (a) => ({ move: 'newWeb', text: a.name }),
    parse: (rest) => (rest ? { name: clean(rest) } : null),
    async run(ctx, a) { return newWeb.run(ctx, {}, a.name); }
  },
  {
    verb: 'goal', form: 'goal: WHAT YOU WANT | goal reached | give up goal',
    as: (a) => ({ move: a.reached ? 'resolveGoal' : a.abandon ? 'abandonGoal' : 'commitGoal', text: a.text || null }),
    parse: (rest) => {
      if (/^reached/i.test(rest)) return { reached: true };
      if (/^(give up|abandon|drop)/i.test(rest)) return { abandon: true };
      return rest ? { text: clean(rest.replace(/^:\s*/, '')) } : null;
    },
    async run(ctx, a) {
      const g = topGoal(ctx);
      if (a.reached || a.abandon) {
        if (!g) return fail('you have no open goal');
        return (a.reached ? resolveGoal : abandonGoal).run(ctx, { goal: g });
      }
      if (!ctx.roles?.types.goal) return fail('you keep no goals');
      if (openGoals(ctx.world).length >= 3) return fail('you already have three open goals: reach one or give one up');
      return commitGoal.run(ctx, {}, a.text);
    }
  },
  {
    verb: 'pursue', form: 'pursue (go toward your goal, or your plan\'s next step)',
    as: () => ({ move: 'pursueGoal', text: null }),
    parse: () => ({}),
    async run(ctx) {
      const plan = activePlans(ctx.world)[0];
      const step = plan && nextStep(ctx.world, plan);
      if (step) return pursueStep.run(ctx, { plan, step });
      const g = topGoal(ctx);
      if (!g) return fail('you have no open goal: "goal: WHAT YOU WANT"');
      return pursueGoal.run(ctx, { goal: g });
    }
  },
  {
    verb: 'plan', form: 'plan: FIRST STEP | then: NEXT STEP | step done',
    as: (a) => ({ move: a.done ? 'stepDone' : a.then ? 'addStep' : 'makePlan', text: a.then || a.first || null }),
    parse: (rest) => {
      if (/^(step\s+)?done/i.test(rest)) return { done: true };
      const then = /^then\s*:?\s*(.+)$/i.exec(rest);
      if (then) return { then: clean(then[1]) };
      return rest ? { first: clean(rest.replace(/^:\s*/, '')) } : null;
    },
    async run(ctx, a) {
      const plan = activePlans(ctx.world)[0];
      if (a.done) {
        if (!plan || !nextStep(ctx.world, plan)) return fail('you have no step to finish');
        if (!stepDone.offer(ctx).length) return fail(`you have not done anything toward "${ctx.world.nameOf(nextStep(ctx.world, plan))}" yet`);
        return stepDone.run(ctx, { plan, step: nextStep(ctx.world, plan) });
      }
      if (a.then) {
        if (!plan) return fail('you have no plan: "plan: FIRST STEP"');
        return addStep.run(ctx, { plan }, a.then);
      }
      if (plan) return fail(`you are already following "${ctx.world.nameOf(plan)}": "plan then: NEXT STEP", or finish it`);
      const g = topGoal(ctx);
      if (!g) return fail('a plan is for a goal: "goal: WHAT YOU WANT" first');
      if (!ctx.roles?.types.plan) return fail('you keep no plans');
      return makePlan.run(ctx, { goal: g }, a.first);
    }
  },
  {
    verb: 'note', form: 'note: A HALF-FORMED THOUGHT',
    as: (a) => ({ move: 'note', text: a.text }),
    parse: (rest) => (rest ? { text: clean(rest.replace(/^:\s*/, '')) } : null),
    async run(ctx, a) { return note.run(ctx, {}, a.text); }
  },
  {
    verb: 'forget', form: 'forget THING (let it go from your mind)',
    as: () => ({ move: 'letGo', text: null }),
    parse: (rest) => (rest ? { name: clean(rest) } : null),
    async run(ctx, a) {
      const { ids, error } = needs(ctx, [a.name]);
      if (error) return fail(error);
      return letGoMove.run(ctx, { id: ids[0] });
    }
  }
];

export const VERBS = COMMANDS.map(c => c.verb);
export const commandByVerb = (verb) => COMMANDS.find(c => c.verb === lower(verb)) || null;

/** The command forms, one per line, as the model is shown them. */
export function renderCommands() {
  return COMMANDS.map(c => `- ${c.form}`).join('\n');
}

/**
 * Answers queued for the next ctx.ask calls (a command that carried its own
 * description need not be asked for one). `null` means "ask as usual".
 */
function withAnswers(ctx, answers) {
  const queue = [...answers];
  return { ...ctx, ask: async (q, n) => { const a = queue.shift(); return a ? a : ctx.ask(q, n); } };
}

/**
 * Parse and run one command.
 * @param {Object} ctx      the cycle's ctx (as moves get it)
 * @param {string} verb
 * @param {string} rest     the words after the verb
 * @param {Object} [opts]
 * @param {Function} [opts.rewrite]  async (line) → { verb, rest } | null — a helper call, when code cannot parse
 * @returns {Promise<Object>} a move result, plus { command } — the line as understood
 */
export async function runCommand(ctx, verb, rest, { rewrite = null } = {}) {
  let cmd = commandByVerb(verb);
  let words = String(rest || '').trim().replace(/[.]$/, '');
  let args = cmd ? cmd.parse(words) : null;
  if ((!cmd || !args) && rewrite) {
    const r = await rewrite(`${verb} ${words}`.trim()).catch(() => null);
    const again = r && commandByVerb(r.verb);
    const reargs = again && again.parse(String(r.rest || '').trim().replace(/[.]$/, ''));
    if (reargs) { cmd = again; words = String(r.rest).trim(); args = reargs; }
  }
  const line = `${cmd?.verb || verb} ${words}`.trim();
  if (!cmd) return { ...fail(`"${verb}" is not a command you have`), command: line };
  if (!args) return { ...fail(`could not read "${line}" — the form is: ${cmd.form}`), command: line };
  try {
    const r = await cmd.run(ctx, args);
    // Which move it amounts to, and its words: for the lab's scoring and the record.
    return { ...r, command: line, as: cmd.as ? cmd.as(args) : { move: cmd.verb, text: null } };
  } catch (err) {
    return { ...fail(`${cmd.verb} failed: ${err?.message || err}`), command: line };
  }
}

/**
 * A menu item as the command that does it, so what the moves offer from here
 * is shown as suggestions: the same guidance, in the language of commands.
 * Blanks stay as capitals for the model to fill.
 */
export function asCommand(item, ctx) {
  const n = (id) => ctx.world.nameOf(id);
  const d = item.data || {};
  switch (item.move.id) {
    case 'newWeb': return 'web NAME';
    case 'make': return d.connectTo ? `make NAME : what it is (it will be connected to ${n(d.connectTo)})` : 'make NAME : what it is';
    case 'connect': return `connect ${n(d.a)} to ${n(d.b)} as RELATION`;
    case 'follow': return `go to ${n(d.to)}`;
    case 'look': return `go to ${n(d.at)}`;
    case 'open': return d.create ? `make PART inside ${n(d.into)}` : `open ${n(d.into)}`;
    case 'close': return 'out';
    case 'describe': return `describe ${n(d.id)}: WHAT IT IS`;
    case 'goWeb': return `go to web ${ctx.world.graph(d.web)?.name}`;
    case 'letGo': return `forget ${n(d.id)}`;
    case 'note': return 'note: A THOUGHT';
    case 'remember': return 'remember THING, THING';
    case 'commitGoal': return 'goal: WHAT YOU WANT';
    case 'pursueGoal': case 'pursueStep': return 'pursue';
    case 'resolveGoal': return 'goal reached';
    case 'abandonGoal': return 'goal give up';
    case 'makePlan': return 'plan: FIRST STEP';
    case 'addStep': return 'plan then: NEXT STEP';
    case 'stepDone': return 'plan step done';
    case 'believe': return 'believe: CLAIM';
    case 'weighBelief': return `weigh ${n(d.source)} against ${n(d.belief)}`;
    case 'variant': return `variant of ${n(d.of)}: NAME`;
    case 'specialize': return `kind of ${n(d.of)}: NAME`;
    case 'generalize': return `both ${n(d.a)} and ${n(d.b)} are kinds of NAME`;
    case 'chunk': return `group ${(d.members || []).map(n).join(', ')} as NAME`;
    case 'contrast': return `contrast ${n(d.a)} with ${n(d.b)}`;
    case 'moveOut': return `move ${n(d.id)} out`;
    case 'mergeSame': return `merge ${n(d.from)} into ${n(d.into)}`;
    default: return null;
  }
}
