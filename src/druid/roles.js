/**
 * Roles — goals, beliefs and plans, as furniture with behavior.
 *
 * The earlier Druid made six empty folders (Goals, Beliefs, Plans…) with no
 * behavior; the name was the whole implementation. Here a role is a TYPE: a
 * Thing in the Druid's Home web marked `druid.roleType`. Anything whose is-a
 * chain reaches it has that role, wherever it lives. So:
 *
 *   - the Druid can rename a role type, specialize it (a "Hunch" as a kind of
 *     Belief), move it, or delete it — behavior follows the marker, not the name,
 *     and deleting the type simply turns the behavior off;
 *   - a goal can sit in any web, inside whatever it belongs to.
 *
 * Behavior, all deterministic:
 *
 *   Goal    open until resolved or abandoned. Open goals feed activation every
 *           cycle (top-down attention) and survive waking. Subgoals are its inside.
 *   Plan    a Thing whose inside holds its steps, chained by "then". A cursor
 *           (druid.cursor) marks the next step, and the loop shows it, so the
 *           model never has to remember where it was. A failed step stays next.
 *   Belief  a claim with evidence (druid.evidence). Confidence is COMPUTED from
 *           the evidence — log-odds, latest judgment per source, the Druid's own
 *           inferences weighted at half an observation — never stored.
 */

export const ROLE_TYPES = {
  goal: { name: 'Goal', description: 'Something the Druid is working toward. Open until resolved or abandoned.' },
  belief: { name: 'Belief', description: 'Something the Druid holds to be true, as strongly as its evidence allows.' },
  plan: { name: 'Plan', description: 'Steps toward a goal, in order. Its inside holds the steps.' },
  episode: { name: 'Episode', description: 'Something that happened.' }
};

export const HOME_MARK = 'home';

/** The Home web: an ordinary web (the Druid can visit and reshape it), marked once. */
export async function ensureHome(world) {
  for (const p of world.state().nodePrototypes.values()) {
    if (p.semanticMetadata?.druid?.homeOf === HOME_MARK) {
      const g = (p.definitionGraphIds || []).find(id => world.graph(id));
      if (g) return g;
    }
  }
  const r = await world.act('createGraph', { name: 'Home', description: 'The Druid\'s own place: its goals, its kinds of thought, whatever it keeps here.' });
  if (!r.ok) return null;
  const web = [...world.state().graphs.values()].filter(g => g.name === 'Home').pop()?.id;
  const owner = world.ownerOf(web);
  if (owner) world.setDruid(owner, { homeOf: HOME_MARK });
  return web;
}

/** The role type for a role, if it still exists (found by marker, not name). */
export function roleType(world, role) {
  for (const p of world.state().nodePrototypes.values()) {
    if (p.semanticMetadata?.druid?.roleType === role) return p.id;
  }
  return null;
}

/** Seed the role types into Home, once. Returns { home, types }. */
export async function seedRoles(world) {
  const home = await ensureHome(world);
  const types = {};
  for (const [role, spec] of Object.entries(ROLE_TYPES)) {
    let id = roleType(world, role);
    if (!id && !world.druidOf(world.ownerOf(home) || '').seeded?.includes(role)) {
      const r = await world.createThing(home, spec.name, { description: spec.description });
      if (r.ok) {
        id = r.id;
        world.setDruid(id, { roleType: role });
      }
    }
    types[role] = id;
  }
  // Remember what was seeded, so a role type the Druid deletes stays deleted.
  const owner = world.ownerOf(home);
  if (owner) world.setDruid(owner, (d) => ({ ...d, seeded: [...new Set([...(d.seeded || []), ...Object.keys(types).filter(k => types[k])])] }));
  return { home, types };
}

/** The role of a Thing, from its is-a chain. */
export function roleOf(world, id) {
  const own = world.druidOf(id).roleType;
  if (own) return null; // the type itself has no role
  for (const t of world.typeChain(id)) {
    const role = world.druidOf(t).roleType;
    if (role) return role;
  }
  return null;
}

export const isRole = (world, id, role) => roleOf(world, id) === role;

// ── Goals ────────────────────────────────────────────────────────────────

export function openGoals(world) {
  return world.allThings().filter(id => isRole(world, id, 'goal') && (world.druidOf(id).status || 'open') === 'open');
}

export function setGoalStatus(world, id, status, tick) {
  world.setDruid(id, { status, statusAt: tick });
}

/**
 * Goals kept in bounds. Smaller goals had no cap and were never let go: at
 * moment 2312 a Druid had 90 open goals, nearly all fragments of one process
 * ("Slip before break", "Gap opens, then slips"), each pulling at attention
 * as hard as the goal it set out with, "Understand a snowflake forming in
 * winter". It rebuilt slip, gap and bond at every level, ten insides down.
 */
export const MAX_OPEN_GOALS = 6;
/** Smaller goals under one goal, at most; and only one level of them. */
export const MAX_SUBGOALS = 2;
/** Moments a smaller goal stays open before sleep lets it go. */
export const GOAL_PATIENCE = 60;
/** Goals that pull at attention, at most. */
export const GOALS_ATTENDED = 3;

/** The goal a smaller goal is on the way to (it sits inside it), if any. */
export function parentGoalOf(world, id) {
  for (const w of world.websOf(id)) {
    const owner = world.ownerOf(w);
    if (owner && owner !== id && isRole(world, owner, 'goal')) return owner;
  }
  return null;
}

/** Open smaller goals on the way to a goal. */
export function subgoalsOf(world, goal) {
  const inside = world.insideOf(goal);
  if (!inside) return [];
  const open = new Set(openGoals(world));
  return world.thingsIn(inside).filter(id => id !== goal && open.has(id));
}

/** Open goals, the ones it set out with (or was given) first, then the smaller ones, newest first. */
export function goalsInOrder(world) {
  const open = openGoals(world);
  // What a person asked for comes first.
  const top = open.filter(g => !parentGoalOf(world, g)).sort((a, b) => (world.druidOf(b).fromPerson ? 1 : 0) - (world.druidOf(a).fromPerson ? 1 : 0));
  const smaller = open.filter(g => parentGoalOf(world, g)).sort((a, b) => (world.druidOf(b).statusAt ?? 0) - (world.druidOf(a).statusAt ?? 0));
  return [...top, ...smaller];
}

/**
 * Smaller goals let go in sleep: any open longer than GOAL_PATIENCE, and the
 * oldest while there are more than MAX_OPEN_GOALS. Never one a person gave,
 * never a goal it set out with. Returns their names.
 */
export function lapseStaleGoals(world, tick) {
  const smaller = openGoals(world)
    .filter(g => parentGoalOf(world, g) && !world.druidOf(g).fromPerson)
    .sort((a, b) => (world.druidOf(a).statusAt ?? 0) - (world.druidOf(b).statusAt ?? 0));
  let over = openGoals(world).length - MAX_OPEN_GOALS;
  const dropped = [];
  for (const g of smaller) {
    const stale = tick - (world.druidOf(g).statusAt ?? 0) >= GOAL_PATIENCE;
    if (!stale && over <= 0) continue;
    const name = world.nameOf(g);
    if (world.forget(g)) { dropped.push(name); over--; }
  }
  return dropped;
}

// ── Beliefs ──────────────────────────────────────────────────────────────

/** Log-odds steps per judgment. */
export const JUDGMENT_LOG_ODDS = { 'strong-support': 2, support: 1, unrelated: 0, weaken: -1, 'strong-weaken': -2 };
export const JUDGMENT_SCALE = [
  { key: 'strong-support', label: 'strongly supports it' },
  { key: 'support', label: 'supports it' },
  { key: 'unrelated', label: 'has nothing to do with it' },
  { key: 'weaken', label: 'weakens it' },
  { key: 'strong-weaken', label: 'strongly weakens it' }
];
const KIND_WEIGHT = { observation: 1, inference: 0.5 };

/**
 * Add evidence to a belief. One source counts once: a new judgment from the
 * same source replaces its old one (this is what stops a belief being
 * confirmed by rereading itself).
 */
export function addEvidence(world, beliefId, { source, judgment, kind = 'inference', tick }) {
  if (!(judgment in JUDGMENT_LOG_ODDS)) return false;
  world.setDruid(beliefId, (d) => {
    const rest = (d.evidence || []).filter(e => e.source !== source);
    return { ...d, evidence: [...rest, { source, judgment, kind, tick }] };
  });
  return true;
}

/** Confidence in a belief, 0..1, computed from its evidence. */
export function confidence(world, beliefId) {
  const evidence = world.druidOf(beliefId).evidence || [];
  let logOdds = 0;
  for (const e of evidence) {
    if (e.source === beliefId) continue; // a belief is not evidence for itself
    logOdds += (JUDGMENT_LOG_ODDS[e.judgment] || 0) * (KIND_WEIGHT[e.kind] ?? 0.5);
  }
  return 1 / (1 + Math.exp(-logOdds));
}

export function confidenceWords(c) {
  if (c >= 0.9) return 'you are sure of it';
  if (c >= 0.7) return 'you are fairly sure';
  if (c > 0.55) return 'you lean toward it';
  if (c >= 0.45) return 'undecided';
  if (c >= 0.3) return 'you doubt it';
  return 'you think it is false';
}

/** Whether a source is something observed (made by someone else) or the Druid's own inference. */
export function sourceKind(world, sourceId) {
  return world.druidOf(sourceId).madeBy === 'druid' ? 'inference' : 'observation';
}

/**
 * What a belief claims. Its name is a short handle ("Bread rises from gas");
 * the whole claim is kept beside it, and that is what evidence is weighed
 * against.
 */
export function claimOf(world, beliefId) {
  return world.druidOf(beliefId).claim || world.nameOf(beliefId);
}

/**
 * Beliefs about what is in a web: kept in the Beliefs folder (world.js), found
 * by what they are about and their evidence; and any still placed in the web.
 */
export function beliefsIn(world, webId) {
  const here = new Set(world.thingsIn(webId));
  const about = (id) => {
    const d = world.druidOf(id);
    return here.has(d.about) || (d.evidence || []).some(e => here.has(e.source));
  };
  return world.allThings().filter(id => isRole(world, id, 'belief') && (here.has(id) || about(id)));
}

// ── Plans ────────────────────────────────────────────────────────────────

/** Steps of a plan, in order: follows "then" links from the step nothing points to. */
export function planSteps(world, planId) {
  const inside = world.insideOf(planId);
  if (!inside) return [];
  const things = world.thingsIn(inside);
  const thens = world.linksIn(inside).filter(l => /^then$/i.test(l.relation));
  const next = new Map(thens.map(l => [l.a, l.b]));
  const pointed = new Set(thens.map(l => l.b));
  let cur = things.find(id => !pointed.has(id)) || things[0];
  const out = [];
  const seen = new Set();
  while (cur && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = next.get(cur); }
  for (const id of things) if (!seen.has(id)) out.push(id);
  return out;
}

export function activePlans(world) {
  return world.allThings().filter(id => isRole(world, id, 'plan') && (world.druidOf(id).status || 'open') === 'open');
}

/** The next step of a plan, or null when it is finished. */
export function nextStep(world, planId) {
  const steps = planSteps(world, planId);
  const cursor = world.druidOf(planId).cursor || 0;
  return steps[cursor] || null;
}

/** Rendered for the prompt: open goals, plan cursors. */
export function renderRoles(world, { talking = false } = {}) {
  const lines = [];
  // In a conversation, what the person asked for, and its own goals wait:
  // listed beside a submarine sandwich, "Understand quantum mechanics" had it
  // relating bread to fundamental particles (The Druid 11, 2026-10-06).
  const theirs = talking ? goalsInOrder(world).filter(g => world.druidOf(g).fromPerson) : [];
  if (theirs.length) {
    lines.push(`What you are after: ${theirs.map(id => world.nameOf(id)).join('; ')}. Your own goals wait while you talk with them.`);
    return lines.join('\n');
  }
  const goals = goalsInOrder(world);
  const top = goals.filter(g => !parentGoalOf(world, g));
  const smaller = goals.filter(g => parentGoalOf(world, g));
  if (top.length) lines.push(`What you are after: ${top.slice(0, 3).map(id => world.nameOf(id)).join('; ')}`);
  if (smaller.length) lines.push(`On the way: ${smaller.slice(0, 2).map(id => world.nameOf(id)).join('; ')}`);
  for (const p of activePlans(world).slice(0, 2)) {
    const step = nextStep(world, p);
    if (step) lines.push(`Your plan "${world.nameOf(p)}" — next step: ${world.nameOf(step)}`);
  }
  return lines.join('\n');
}

/**
 * A Druid's own thinking apparatus — a role type, or a goal, plan or episode —
 * as opposed to the Things it thinks about. Beliefs are about Things and sit
 * among them, so they are content; the rest is bookkeeping. Moves that build
 * knowledge leave bookkeeping alone: given goals and plans as ordinary Things,
 * a Druid spent a long run connecting its plan to its goal.
 */
export function isBookkeeping(world, id) {
  if (!id) return true;
  if (world.druidOf(id).roleType || world.druidOf(id).system || world.druidOf(id).step) return true;
  const role = roleOf(world, id);
  return role === 'goal' || role === 'plan' || role === 'episode';
}

/**
 * A Thing to build with: not the Druid's bookkeeping, and not a belief.
 * A belief is a claim about Things, not one of them; treated as a Thing it
 * was connected to ("Floor —Is→ House is a type of Modern Home") and opened
 * up, and a web about pine needles grew inside a belief.
 */
export function isObject(world, id) {
  return !!id && !isBookkeeping(world, id) && roleOf(world, id) !== 'belief';
}
