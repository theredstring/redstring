/**
 * The Druid's mind, read out of its universe for the panel's views
 * (DruidMind.jsx): where it is and what that is part of, what it is thinking
 * and holding, the conversation, its goals and plans, its beliefs, its days.
 *
 * All of it lives in the universe, as Things and on its Home Thing (life.js
 * snapshot), so it is there asleep as awake, and from one waking to the next.
 * Read only: nothing here makes a web or writes a field. (world.wmWeb,
 * noticedWeb and the like make their web when it is missing; they are not
 * used here.)
 */

import { createWorld } from '../world.js';
import { goalsInOrder, parentGoalOf, subgoalsOf, planSteps, isRole, claimOf, confidence, HOME_MARK } from '../roles.js';
import { engaged } from '../conversation.js';

/** Days in the diary, at most, and moments shown in each. */
export const DAYS_SHOWN = 7;
export const MOMENTS_PER_DAY = 60;
/** Goals reached or given up, the most recent few. */
export const CLOSED_SHOWN = 6;

const noop = async () => ({ ok: false });

/** How sure it is, said of it (roles.js confidenceWords says it to it). */
export function sureness(c) {
  if (c >= 0.9) return 'sure';
  if (c >= 0.7) return 'fairly sure';
  if (c > 0.55) return 'leans toward it';
  if (c >= 0.45) return 'undecided';
  if (c >= 0.3) return 'doubts it';
  return 'thinks it false';
}

/** A Thing as the views show it: its id, its name, and a web it is in (a content web first), to look at it there. */
const thing = (world, id) => {
  if (!id || !world.proto(id)) return null;
  const webs = world.websOf(id);
  return { id, name: world.nameOf(id), web: webs.find(w => !world.isSystemWeb(w)) || webs[0] || null };
};

/** The web a system marker names, if it is there. */
function systemWebOf(world, key) {
  for (const p of world.state().nodePrototypes.values()) {
    if (p.semanticMetadata?.druid?.system !== key) continue;
    const g = (p.definitionGraphIds || []).find(id => world.graph(id));
    if (g) return g;
  }
  return null;
}

/**
 * @param {Object} store  the graph store (getState)
 * @returns {Object|null} null when the universe has no Druid in it
 */
export function readMind(store) {
  const world = createWorld({ store, executeTool: noop, applyToolResult: () => {} });
  const st = store.getState();
  const homeProto = [...st.nodePrototypes.values()].find(p => p.semanticMetadata?.druid?.homeOf === HOME_MARK);
  if (!homeProto) return null;
  const life = homeProto.semanticMetadata.druid.life || {};
  const tick = life.tick || 0;
  const all = world.allThingsIncludingSystem();

  // ── Now ──
  const locus = life.locus || {};
  const web = locus.web && world.graph(locus.web) ? { id: locus.web, name: world.graph(locus.web).name } : null;
  const above = web ? world.pathUp(web.id).map(id => ({ id, name: world.graph(id)?.name })).filter(w => w.name) : [];
  const held = all
    .filter(id => world.druidOf(id).wm)
    .map(id => ({ ...thing(world, id), a: world.druidOf(id).wm?.a ?? 0, scratch: world.druidOf(id).role === 'scratch' }))
    .sort((x, y) => y.a - x.a);
  const conv = life.conversation && engaged(life.conversation, tick) ? life.conversation : null;
  const noticedWeb = systemWebOf(world, 'noticed');

  // ── Goals and plans ──
  const goalIds = all.filter(id => isRole(world, id, 'goal'));
  const plans = all.filter(id => isRole(world, id, 'plan'));
  const plansFor = (g) => plans.filter(p => world.druidOf(p).forGoal === g && (world.druidOf(p).status || 'open') === 'open').map(p => {
    const cursor = world.druidOf(p).cursor || 0;
    return { ...thing(world, p), steps: planSteps(world, p).map((x, i) => ({ ...thing(world, x), done: i < cursor, next: i === cursor })) };
  });
  const goal = (g) => {
    const d = world.druidOf(g);
    return { ...thing(world, g), fromPerson: !!d.fromPerson, setOutWith: !!(d.seeded || d.curious), since: d.statusAt ?? null, plans: plansFor(g) };
  };
  const top = goalsInOrder(world).filter(g => !parentGoalOf(world, g));
  const goals = top.map(g => ({ ...goal(g), smaller: subgoalsOf(world, g).map(goal) }));
  const closed = goalIds
    .filter(g => ['reached', 'abandoned', 'dropped'].includes(world.druidOf(g).status))
    .sort((a, b) => (world.druidOf(b).statusAt ?? 0) - (world.druidOf(a).statusAt ?? 0))
    .slice(0, CLOSED_SHOWN)
    .map(g => ({ ...thing(world, g), status: world.druidOf(g).status, at: world.druidOf(g).statusAt ?? null }));

  // ── Beliefs ──
  const beliefs = all.filter(id => isRole(world, id, 'belief')).map(b => {
    const d = world.druidOf(b);
    const c = confidence(world, b);
    return { ...thing(world, b), claim: claimOf(world, b), c, words: sureness(c), about: thing(world, d.about), evidence: (d.evidence || []).filter(e => e.source !== b).length };
  }).sort((a, b) => b.evidence - a.evidence || b.c - a.c);

  // ── Days ──
  // Each day is an episode web: the moments not yet folded, and the one Thing
  // sleep folds the older ones into, with how many and what about (sleep.js).
  const dayWebs = [...st.graphs.values()].filter(g => /^episodes-\d{4}-\d{2}-\d{2}$/.test(world.druidOf(world.ownerOf(g.id) || '').system || ''));
  const days = dayWebs.map(g => {
    const date = world.druidOf(world.ownerOf(g.id)).system.slice(9);
    const inWeb = world.thingsIn(g.id);
    const folded = inWeb.find(id => world.druidOf(id).role === 'day');
    const f = folded ? world.druidOf(folded) : {};
    const moments = inWeb.filter(id => world.druidOf(id).role === 'episode')
      .map(id => ({ id, tick: world.druidOf(id).tick ?? 0, text: world.proto(id)?.description || world.nameOf(id), touched: (world.druidOf(id).touched || []).map(t => thing(world, t)).filter(Boolean) }))
      .sort((x, y) => y.tick - x.tick);
    const about = Object.entries(f.about || {}).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([name, n]) => ({ ...(thing(world, world.findThing(name)) || { id: null, name, web: null }), n }));
    return { date, web: g.id, count: (f.moments || 0) + moments.length, about, moments: moments.slice(0, MOMENTS_PER_DAY) };
  }).sort((x, y) => y.date.localeCompare(x.date)).slice(0, DAYS_SHOWN);

  return {
    tick,
    now: {
      web,
      focus: thing(world, locus.focus),
      above,
      thoughts: [...(life.loop || [])].reverse(),
      throughLine: life.throughLine || '',
      lastDid: life.lastDid || '',
      held,
      trail: [...(life.trail || [])].reverse().slice(0, 8).map(t => ({ tick: t.tick, text: t.text || '', web: t.web || null })).filter(t => t.text),
      conversation: conv && {
        ask: conv.ask || null,
        topic: (conv.topic || []).map(id => thing(world, id)).filter(Boolean),
        away: (conv.away || []).map(id => thing(world, id)).filter(Boolean),
        promised: (conv.promised || []).map(id => thing(world, id)).filter(Boolean)
      },
      noticed: noticedWeb ? world.thingsIn(noticedWeb).map(id => thing(world, id)).filter(Boolean) : [],
      // What it is working on (task.js), while its goal is still open.
      task: life.task && world.proto(life.task.goal) && world.druidOf(life.task.goal).status === 'open'
        ? { goal: thing(world, life.task.goal), at: life.task.anchor ? thing(world, life.task.anchor) : null, since: life.task.since }
        : null
    },
    goals,
    closed,
    beliefs,
    days
  };
}
