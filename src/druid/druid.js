/**
 * createDruid — the whole Druid, assembled.
 *
 * runLife is the loop; this decides what lives in it: which moves are on
 * offer, what else feeds activation (open goals), what survives waking, what
 * it is shown about its goals and beliefs, when it sleeps and what sleep does.
 * One place, so the CLI, the lab and the tests all run the same Druid.
 */

import { runLife } from './life.js';
import { BASIC_MOVES } from './moves/basic.js';
import { ROLE_MOVES } from './moves/roles.js';
import { COGNITIVE_MOVES } from './moves/cognitive.js';
import { seedRoles, roleType, openGoals, renderRoles, isRole, confidence, confidenceWords } from './roles.js';
import { sleep as sleepCycle } from './sleep.js';

export function druidMoves() {
  return [...BASIC_MOVES, ...ROLE_MOVES, ...COGNITIVE_MOVES];
}

/** What the Druid is shown about its goals, plans and the belief in focus. */
function extrasFor(world, locus) {
  const lines = [renderRoles(world)];
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
export async function* createDruid(deps, { roles = true, sleeps = true, ...opts } = {}) {
  const { world } = deps;
  if (roles) {
    const { home, types } = await seedRoles(world);
    // Something on its mind at birth becomes its first open goal, so attention
    // has somewhere to go. With nothing, a Druid thinks about its own medium:
    // a first long run produced "Web of ideas", "Web of connections",
    // "Creative network" and asked itself what connections to build.
    if (opts.seed && types.goal && openGoals(world).length === 0 && !(opts.resume?.tick > 0)) {
      const name = String(opts.seed).trim().replace(/[.!?]+$/, '').slice(0, 120);
      const g = await world.createThing(home, name, { description: 'What was on its mind when it first woke.', typeNodeId: types.goal });
      if (g.ok) world.setDruid(g.id, { status: 'open', seeded: true });
    }
  }
  yield* runLife(deps, {
    moves: druidMoves(),
    sources: (w) => openGoals(w).map(id => ({ id, weight: 0.6 })),
    isOpenGoal: (id) => openGoals(world).includes(id),
    episodeType: (w) => roleType(w, 'episode'),
    extendCtx: async (w) => ({ roles: roles ? { home: await seedRoles(w).then(r => r.home), types: { goal: roleType(w, 'goal'), belief: roleType(w, 'belief'), plan: roleType(w, 'plan') } } : null }),
    extras: extrasFor,
    sleep: sleeps ? (ctx) => sleepCycle(ctx) : null,
    ...opts
  });
}

export default createDruid;
