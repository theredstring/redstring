/**
 * createDruid — the whole Druid, assembled.
 *
 * runLife is the loop; this decides what lives in it: which moves are on
 * offer, what else feeds activation (open goals), what survives waking, what
 * it is shown about its goals and beliefs, when it sleeps and what sleep does.
 * One place, so the CLI, the lab and the tests all run the same Druid.
 */

import { runLife } from './life.js';
import { BASIC_MOVES, newWeb } from './moves/basic.js';
import { ROLE_MOVES } from './moves/roles.js';
import { COGNITIVE_MOVES } from './moves/cognitive.js';
import { TIDY_MOVES } from './moves/tidy.js';
import { heed } from './conversation.js';
import { tokenize } from './recall.js';
import { seedRoles, roleType, openGoals, goalsInOrder, GOALS_ATTENDED, renderRoles, isRole, confidence, confidenceWords, setGoalStatus } from './roles.js';
import { asRequest } from './dialogue.js';
import { sleep as sleepCycle } from './sleep.js';
import { nameGate, plausible, sameRelation, curiosity, madeOf, aboutKnowing, onSubject, isQuality, kindOf, category } from './mind/helpers.js';
import { topLevelWebs, isHome } from './attention.js';
import { understandGoal, wordsIn, MAX_NAME_WORDS } from './names.js';

export function druidMoves() {
  return [heed, ...BASIC_MOVES, ...ROLE_MOVES, ...COGNITIVE_MOVES, ...TIDY_MOVES];
}

/** What the Druid is shown about its goals, plans and the belief in focus. */
function extrasFor(world, locus, { talking = false } = {}) {
  const lines = [renderRoles(world, { talking })];
  if (locus?.focus && isRole(world, locus.focus, 'belief')) {
    const n = (world.druidOf(locus.focus).evidence || []).length;
    lines.push(`About the belief in focus: ${confidenceWords(confidence(world, locus.focus))} (${n} piece${n === 1 ? '' : 's'} of evidence).`);
  }
  return lines.filter(Boolean).join('\n');
}

/**
 * @param {Object} deps   { world, mind, promptSpace }
 * @param {Object} opts   passed to runLife (resume, seed, maxCycles, sleepEvery, signal)
 * @param {boolean} [opts.roles=true]   seed and use goals, beliefs and plans
 * @param {boolean} [opts.sleeps=true]  consolidate every `sleepEvery` cycles
 */
export async function* createDruid(deps, { roles = true, sleeps = true, resumeFromHome = false, ...opts } = {}) {
  const { world, mind } = deps;
  // A universe carries its Druid's loop state on its Home Thing (the app keeps
  // it there), so whatever opens the universe can wake it where it left off.
  if (resumeFromHome && !(opts.resume?.tick > 0)) {
    const home = world.allThingsIncludingSystem().find(id => world.druidOf(id).homeOf);
    const life = home && world.druidOf(home).life;
    if (life?.tick > 0) opts = { ...opts, resume: JSON.parse(JSON.stringify(life)) };
  }
  // Language judgments at the edges, each one contextless question (mind/helpers.js).
  if (mind?.helper) {
    world.nameGate ||= nameGate(mind);
    world.check ||= plausible(mind);
    world.isPart ||= madeOf(mind);
    world.aboutKnowing ||= aboutKnowing(mind);
    world.onSubject ||= onSubject(mind);
    world.isQuality ||= isQuality(mind);
    world.category ||= category(mind);
    world.isKind ||= kindOf(mind, world.check);
    world.sameRelationAs ||= sameRelation(mind);
  }
  if (roles) {
    const { home, types } = await seedRoles(world);
    // Every web it keeps or started hangs off Home, so none is lost (world.js
    // shelve); a universe from before that is tidied as it wakes.
    world.shelveAll?.();
    // Something on its mind at birth becomes its first open goal, so attention
    // has somewhere to go. With nothing, a Druid thinks about its own medium:
    // a first long run produced "Web of ideas", "Web of connections",
    // "Creative network" and asked itself what connections to build.
    if (opts.seed && types.goal && openGoals(world).length === 0 && !(opts.resume?.tick > 0)) {
      const name = String(opts.seed).trim().replace(/[.!?]+$/, '').slice(0, 120);
      const g = await world.createThing(home, name, { description: 'What was on its mind when it first woke.', typeNodeId: types.goal });
      if (g.ok) world.setDruid(g.id, { status: 'open', seeded: true });
    }
    // Nothing on its mind and nothing built: it asks itself, out of context,
    // what in the world it wants to understand, and that is its first goal.
    const fresh = !opts.seed && !(opts.resume?.tick > 0) && types.goal && openGoals(world).length === 0
      && topLevelWebs(world).every(id => isHome(world, id));
    if (fresh && mind?.helper) {
      const subject = await curiosity(mind)();
      if (subject) {
        const g = await world.createThing(home, understandGoal(subject), { description: 'What it wondered about when it first woke.', typeNodeId: types.goal });
        if (g.ok) world.setDruid(g.id, { status: 'open', curious: true });
      }
    }
  }
  // What the person seeded or said is never refused as being about this place
  // (names.js aboutTheMedium): asked to think about webs, it may.
  const personWords = (text) => { for (const w of String(text || '').toLowerCase().match(/[a-z'-]+/g) || []) world.personWords?.add(w); };
  personWords(opts.seed);
  for (const id of world.allThings()) if (world.druidOf(id).seeded === true || world.druidOf(id).fromPerson) personWords(world.nameOf(id));
  yield* runLife(deps, {
    moves: druidMoves(),
    // The goals it set out with pull at attention, not every smaller goal on the way.
    // In a conversation, only what the person asked for pulls (conversation.js).
    sources: (w, _tick, { talking = false } = {}) => goalsInOrder(w).filter(g => !talking || w.druidOf(g).fromPerson).slice(0, GOALS_ATTENDED).map(id => ({ id, weight: 0.6 })),
    isOpenGoal: (id) => openGoals(world).includes(id),
    episodeType: (w) => roleType(w, 'episode'),
    extendCtx: async (w) => ({ roles: roles ? { home: await seedRoles(w).then(r => r.home), types: { goal: roleType(w, 'goal'), belief: roleType(w, 'belief'), plan: roleType(w, 'plan') } } : null }),
    extras: extrasFor,
    // What a person asks for becomes its goal, ahead of its own: the one they
    // asked for last replaces the one they asked for before. What they turn it
    // away from, its own goals about that are given up (conversation.js).
    onHeard: roles ? async (w, text, tick, understood = null) => {
      personWords(text);
      const notes = [];
      const awayWords = new Set(tokenize(understood?.awayText || ''));
      if (awayWords.size) {
        for (const g of openGoals(w)) {
          if (w.druidOf(g).fromPerson || !tokenize(w.nameOf(g)).some(t => awayWords.has(t))) continue;
          setGoalStatus(w, g, 'abandoned', tick);
          notes.push(`They asked you to leave ${understood.awayText} alone, so you gave up your goal "${w.nameOf(g)}".`);
        }
      }
      const asked = understood && (understood.kind === 'direction' || understood.kind === 'correction');
      // A goal is a name, and long names are cut: "Build an understanding of a
      // submarine sandwich" was kept as "Build an understanding". Too long, and
      // naming a subject, it is named for the subject.
      let wanted = understood?.ask || asRequest(text) || (asked && understood.subject ? understandGoal(understood.subject) : null);
      if (wanted && wordsIn(wanted).length > MAX_NAME_WORDS && understood?.subject) wanted = understandGoal(understood.subject);
      const goalType = roleType(w, 'goal');
      if (wanted && goalType) {
        for (const g of openGoals(w)) if (w.druidOf(g).fromPerson) setGoalStatus(w, g, 'abandoned', tick);
        const home = (await seedRoles(w)).home;
        const r = await w.createThing(home, wanted, { description: 'Asked of it by a person.', typeNodeId: goalType });
        if (r.ok) {
          w.setDruid(r.id, { status: 'open', fromPerson: true, statusAt: tick });
          personWords(wanted);
          notes.push(`They asked you to ${wanted.charAt(0).toLowerCase()}${wanted.slice(1)}; it is now your goal.`);
        }
      }
      // Asked to work on something its universe does not hold yet, it starts a
      // web for it and stands there, as a person opens a fresh page: asked to
      // work on a submarine sandwich, it had nowhere to turn (The Druid 11).
      let orient = null;
      let topic = [];
      if (asked && understood.newSubject) {
        const r = await newWeb.run({ world: w, locus: { web: null, focus: null, path: [] }, view: {} }, null, understood.newSubject).catch(() => null);
        if (r?.ok && r.locus?.web) {
          orient = r.locus;
          topic = [w.ownerOf(r.locus.web)].filter(Boolean);
          notes.push(`You started the web ${w.graph(r.locus.web)?.name} for it.`);
        }
      }
      return { notice: notes.join('\n') || null, ask: wanted || null, orient, topic };
    } : null,
    sleep: sleeps ? (ctx) => sleepCycle(ctx) : null,
    ...opts
  });
}

export default createDruid;
