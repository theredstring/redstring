/**
 * The Druid's benchmark: one subject, a run of moments, what a person says
 * along the way, and numbers for what went right and wrong.
 *
 * What it measures is what went wrong in real runs (The Druid 11 and 12,
 * 2026-10-06), in numbers instead of by reading the moments:
 *
 *   drift      Things built away from what it was after: forests and rivers
 *              in a web about Venus
 *   positions  Things that are only where something is: Middle, Upper, Layers
 *   thoughts   thoughts naming nothing it has built; thoughts in the
 *              daydream vocabulary (tapestries, whispers, forests)
 *   refusals   moves its own checks turned away, blanks it left empty
 *   steering   whether it turned to what a person asked, how many moments
 *              that took, and how long it stayed
 *   replies    what it said that names Things its universe does not hold,
 *              and replies said again
 *   shape      how wide the subject is before it goes deep, how deep it goes
 *
 * The numbers are the benchmark a trained model has to beat, on subjects it
 * never trained on (lab/subjects.js EVAL), before it is used.
 */

import { isOwnPlace, topLevelWebs } from '../attention.js';
import { isBookkeeping } from '../roles.js';
import { isAspect, understandGoal } from '../names.js';
import { buildMemoryIndex, ungroundedNames } from '../recall.js';
import { thoughtSimilarity } from '../runDruid.js';
import { holding } from '../conversation.js';

/** The daydream vocabulary: thoughts that drifted from what it was building. */
export const DAYDREAM = /\b(tapestr\w*|weav\w*|whisper\w*|danc\w*|forest\w*|rivers?|trees?|cosmos|cosmic|vibrant|beaut\w*|soul\w*|essence|journey\w*|harmon\w*|interconnected\w*|ancient|wisdom|existence|realms?|the universe around)\b/i;

const REFUSED = /: left the blank empty$|safety filter would not answer$/;

/**
 * Run the Druid on one subject and measure it.
 *
 * @param {Object} deps   { world, mind, promptSpace, createDruid }
 * @param {Object} run    { subject, moments, events: [{ at, text, request?, question? }] }
 * @returns {Promise<{ subject, metrics, trace }>}
 */
export async function benchSubject({ world, mind, promptSpace, createDruid }, { subject, moments = 40, events = [] }) {
  const inbox = [];
  const trace = [];
  const replies = [];
  const said = new Map(events.map(e => [e.at, e]));
  const t0 = Date.now();
  for await (const r of createDruid({ world, mind, promptSpace }, {
    maxCycles: moments,
    seed: understandGoal(subject),
    hear: () => inbox.splice(0),
    onReply: (text, tick) => replies.push({ text, tick })
  })) {
    if (r.type !== 'cycle') continue;
    trace.push({
      tick: r.tick, web: r.locus.web, webName: r.locus.webName, focusName: r.locus.focusName,
      move: r.move, chose: r.chose, ok: r.result.ok, wrote: r.result.wrote, summary: r.result.summary,
      thought: r.thought, grounded: r.grounded !== false, task: r.task, heard: r.heard, listened: !!r.listened
    });
    const next = said.get(r.tick + 1);
    if (next) inbox.push({ text: typeof next.text === 'function' ? next.text(world) : next.text });
  }
  return { subject, metrics: measure(world, { subject, trace, replies, events }), trace, replies, ms: Date.now() - t0 };
}

/** The numbers, from the run's moments and the universe it left. */
export function measure(world, { subject, trace, replies, events }) {
  const n = trace.length || 1;
  const pct = (k) => Math.round((1000 * k) / n) / 10;

  // ── what it built, and where ─────────────────────────────────────────────
  const content = topLevelWebs(world).filter(w => !isOwnPlace(world, w) && !world.isSystemWeb(w));
  const under = (root) => {
    const out = new Set();
    const walk = (web) => {
      for (const id of world.thingsIn(web)) {
        if (isBookkeeping(world, id) || out.has(id)) continue;
        out.add(id);
        const inside = world.insideOf(id);
        if (inside && !isOwnPlace(world, inside)) walk(inside);
      }
    };
    walk(root);
    return out;
  };
  // What it was after: its subject, and what it was asked for.
  const wanted = [subject, ...events.filter(e => e.request).map(e => e.request)];
  const rootFor = (s) => content.find(w => holding(world, s).some(id => world.insideOf(id) === w)) || content.find(w => world.graph(w)?.name?.toLowerCase() === s.toLowerCase()) || null;
  const roots = new Map(wanted.map(s => [s, rootFor(s)]));
  const onSubject = new Set([...roots.values()].filter(Boolean).flatMap(w => [...under(w)]));
  const all = new Set(content.flatMap(w => [...under(w)]));
  const offSubject = [...all].filter(id => !onSubject.has(id));
  const positions = [...all].filter(id => isAspect(world.nameOf(id)));
  const depth = (web, d = 0, seen = new Set()) => {
    if (seen.has(web)) return d;
    seen.add(web);
    let max = d;
    for (const id of world.thingsIn(web)) {
      const inside = world.insideOf(id);
      if (inside && !isOwnPlace(world, inside)) max = Math.max(max, depth(inside, d + 1, seen));
    }
    return max;
  };
  const home = roots.get(subject);

  // ── thoughts and moves ───────────────────────────────────────────────────
  const thoughts = trace.filter(t => t.thought);
  const failed = trace.filter(t => !t.ok);
  const empty = failed.filter(t => REFUSED.test(t.summary || ''));

  // ── steering: did it turn to what was asked, how soon, for how long ─────
  const requests = events.filter(e => e.request && !events.some(p => p.request === e.request && p.at < e.at));
  const steering = requests.map(e => {
    const root = roots.get(e.request);
    const there = (t) => !!root && (t.web === root || (world.pathUp ? world.pathUp(t.web).includes(root) : false));
    const after = trace.filter(t => t.tick > e.at);
    const turned = after.find(there);
    const window = turned ? after.filter(t => t.tick >= turned.tick).slice(0, 20) : [];
    return {
      request: e.request,
      turned: !!turned,
      latency: turned ? turned.tick - (e.at + 1) : null,
      held: window.length ? Math.round((100 * window.filter(there).length) / window.length) : 0
    };
  });

  // ── what it said ─────────────────────────────────────────────────────────
  const index = buildMemoryIndex(world.state());
  const claims = replies.map(r => ({ ...r, unknown: ungroundedNames(index, r.text) }));
  const repeats = replies.filter((r, i) => replies.slice(0, i).some(p => thoughtSimilarity(r.text, p.text) >= 0.9));
  const heard = events.length;
  const answered = events.filter(e => replies.some(r => r.tick >= e.at + 1 && r.tick <= e.at + 3)).length;

  return {
    moments: trace.length,
    things: all.size,
    onSubject: all.size ? Math.round((100 * onSubject.size) / all.size) : 100,
    drift: offSubject.map(id => world.nameOf(id)).slice(0, 20),
    driftCount: offSubject.length,
    positions: positions.map(id => world.nameOf(id)),
    breadth: home ? world.thingsIn(home).filter(id => !isBookkeeping(world, id)).length : 0,
    depth: home ? depth(home) : 0,
    writes: trace.filter(t => t.ok && t.wrote).length,
    failedPct: pct(failed.length),
    emptyPct: pct(empty.length),
    ungroundedThoughtsPct: thoughts.length ? Math.round((1000 * thoughts.filter(t => !t.grounded).length) / thoughts.length) / 10 : 0,
    daydreamPct: thoughts.length ? Math.round((1000 * thoughts.filter(t => DAYDREAM.test(t.thought)).length) / thoughts.length) / 10 : 0,
    steering,
    replies: replies.length,
    answeredPct: heard ? Math.round((100 * answered) / heard) : null,
    unknownClaims: claims.filter(c => c.unknown.length).map(c => ({ tick: c.tick, names: c.unknown })),
    repeats: repeats.length
  };
}

/** Totals over many subjects: the numbers to beat. */
export function summarize(results) {
  const m = results.map(r => r.metrics);
  const avg = (f) => (m.length ? Math.round((10 * m.reduce((a, x) => a + (f(x) ?? 0), 0)) / m.length) / 10 : 0);
  const steer = m.flatMap(x => x.steering);
  return {
    subjects: m.length,
    onSubjectPct: avg(x => x.onSubject),
    driftPerRun: avg(x => x.driftCount),
    positionsPerRun: avg(x => x.positions.length),
    thingsPerRun: avg(x => x.things),
    breadth: avg(x => x.breadth),
    depth: avg(x => x.depth),
    failedPct: avg(x => x.failedPct),
    emptyPct: avg(x => x.emptyPct),
    ungroundedThoughtsPct: avg(x => x.ungroundedThoughtsPct),
    daydreamPct: avg(x => x.daydreamPct),
    turnedPct: steer.length ? Math.round((100 * steer.filter(s => s.turned).length) / steer.length) : null,
    turnLatency: steer.filter(s => s.turned).length ? Math.round((10 * steer.filter(s => s.turned).reduce((a, s) => a + s.latency, 0)) / steer.filter(s => s.turned).length) / 10 : null,
    heldPct: steer.length ? Math.round(steer.reduce((a, s) => a + s.held, 0) / steer.length) : null,
    answeredPct: m.filter(x => x.answeredPct != null).length ? Math.round(m.filter(x => x.answeredPct != null).reduce((a, x) => a + x.answeredPct, 0) / m.filter(x => x.answeredPct != null).length) : null,
    unknownClaimsPerRun: avg(x => x.unknownClaims.length),
    repeatsPerRun: avg(x => x.repeats)
  };
}
