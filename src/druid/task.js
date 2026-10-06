/**
 * What it is working on.
 *
 * A goal was a name in a list, and every moment the list was weighed again:
 * taking up what a person asked was one choice in one moment, and the next
 * moment it was as likely to be on its own goal, or on nothing. Asked to make
 * a web of a ham sandwich, it did, and three moments later was in quantum
 * error correction; woken to understand Venus, it started "Atmospheric
 * dynamics" and was in planetary formation by moment eleven (2026-10-06).
 *
 * People hold a task once they take it up: it stays in front of them, what
 * belongs to it stays easy to reach, other aims wait, and drifting away is
 * noticed. Whether to take something up, and when to put it down, is still
 * its own choice: this holds the choice it made, it does not make one.
 *
 *   take up   choosing to turn to what a person asked, to work toward a goal,
 *             or to start a web for one, makes that goal its task
 *   hold      the task pulls attention, is named in the prompt, and, when it
 *             has wandered off, the menu offers the way back
 *   put down  the goal reached or given up, or set aside by choice; or after
 *             TASK_LAPSE moments away from it, it lapses, and it is told so
 */

import { openGoals } from './roles.js';
import { isOwnPlace } from './attention.js';
import { holding, placeOf } from './conversation.js';
import { newWeb } from './moves/basic.js';

/** Moments away from its task before the task lapses. */
export const TASK_LAPSE = 12;

/** What a goal is about: "Understand Venus" is about Venus. */
export function subjectOfGoal(name) {
  const s = String(name || '').trim();
  const m = /^(?:understand|learn about|explore|study|look into|look at|map|work on|think about|figure out|build an understanding of|make a web of|make a web for)\s+(?:the\s+|a\s+|an\s+|how\s+)?(.+)$/i.exec(s);
  const subject = (m ? m[1] : s).replace(/[.!?]+$/, '').trim();
  return subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : null;
}

/** Take a goal up, anchored at the Thing and web it is worked on in. */
export function takeUp(goal, anchor, web, tick) {
  return { goal, anchor: anchor || null, web: web || null, since: tick, lastOn: tick };
}

/** Whether it is at its task: in the task's web, inside it, or on its anchor. */
export function onTask(world, task, locus) {
  if (!task || !locus) return false;
  if (task.anchor && locus.focus === task.anchor) return true;
  if (!task.web || !locus.web) return false;
  return locus.web === task.web || (world.pathUp ? world.pathUp(locus.web).includes(task.web) : false);
}

/** Whether the task still stands: its goal still open, its anchor still there. */
export function stillHeld(world, task) {
  return !!task && openGoals(world).includes(task.goal) && (!task.anchor || !!world.proto(task.anchor));
}

/** The task, for the prompt. */
export function renderTask(world, task, tick) {
  if (!task) return '';
  const at = task.anchor ? world.nameOf(task.anchor) : (task.web ? world.graph(task.web)?.name : null);
  const ago = tick - task.since;
  return `You are working on "${world.nameOf(task.goal)}"${at ? `, at ${at}` : ''}: you took it up ${ago <= 0 ? 'just now' : `${ago} moment${ago === 1 ? '' : 's'} ago`}. Other goals wait until you reach it, give it up, or set it aside.`;
}

/** Where to stand to get back to the task. */
function placeOfTask(world, task) {
  if (task.anchor) {
    const p = placeOf(world, task.anchor);
    if (p) return p;
  }
  return task.web && world.graph(task.web) && !isOwnPlace(world, task.web) ? { web: task.web, focus: null, path: [] } : null;
}

/** Back to the task, when it has wandered off. */
export const backToTask = {
  id: 'backToTask',
  prior: 1.4,
  offer(ctx) {
    const { world, task, locus } = ctx;
    if (!task || onTask(world, task, locus) || !placeOfTask(world, task)) return [];
    const at = task.anchor ? world.nameOf(task.anchor) : world.graph(task.web)?.name;
    return [{ label: `get back to ${at}, what you are working on`, data: {}, target: task.anchor || null }];
  },
  async run(ctx) {
    const at = placeOfTask(ctx.world, ctx.task);
    if (!at) return { ok: false, summary: 'could not find what you were working on', touched: [], wrote: false };
    ctx.world.focusWeb(at.web);
    const name = ctx.task.anchor ? ctx.world.nameOf(ctx.task.anchor) : ctx.world.graph(at.web)?.name;
    return { ok: true, summary: `got back to ${name}, what you are working on`, touched: [ctx.task.anchor].filter(Boolean), locus: at, wrote: false };
  }
};

/** Put the task down, by its own choice. */
export const setAside = {
  id: 'setAside',
  prior: 0.15,
  offer(ctx) {
    const { world, task } = ctx;
    if (!task || ctx.tick - task.since < 2) return [];
    return [{ label: `set aside "${world.nameOf(task.goal)}" for now`, data: {} }];
  },
  async run(ctx) {
    return { ok: true, summary: `set aside "${ctx.world.nameOf(ctx.task.goal)}" for now`, touched: [], wrote: false, setAside: true };
  }
};

/**
 * A goal with nowhere to work on it: a web for what it is about. Woken to
 * understand Venus, asked to name its first web, it named "Atmospheric
 * dynamics", and Venus was in nothing it built.
 */
export const goalWeb = {
  id: 'goalWeb',
  prior: 0.9,
  offer(ctx) {
    const { world } = ctx;
    const built = world.allThings().some(id => world.websOf(id).some(w => !isOwnPlace(world, w) && !world.isSystemWeb?.(w)));
    const goals = ctx.task ? [ctx.task.goal] : openGoals(world).slice(0, 2);
    const items = [];
    for (const g of goals) {
      const subject = subjectOfGoal(world.nameOf(g));
      if (!subject || subject.split(/\s+/).length > 5) continue;
      if (holding(world, subject).filter(id => !openGoals(world).includes(id)).length) continue;
      items.push({ label: `start a web for ${subject}, toward your goal "${world.nameOf(g)}"`, data: { goal: g, subject }, target: g, prior: built ? 0.9 : 3.2 });
    }
    return items.slice(0, 1);
  },
  async run(ctx, data) {
    const r = await newWeb.run({ ...ctx, locus: { web: null, focus: null, path: [] }, view: {} }, null, data.subject);
    if (!r?.ok) return r || { ok: false, summary: `could not start a web for ${data.subject}`, touched: [], wrote: false };
    return { ...r, summary: `${r.summary}, toward the goal "${ctx.world.nameOf(data.goal)}"`, takeUp: data.goal };
  }
};
