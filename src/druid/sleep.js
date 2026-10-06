/**
 * Sleep — consolidation, and the reconstruction of schemas.
 *
 * New information is mostly ASSIMILATED: a Thing is added, a belief weighed,
 * the structure stays. Sometimes it should be ACCOMMODATED: the structure
 * itself is wrong and has to change. Sleep is where that happens, offline,
 * between stretches of thought:
 *
 *   1. DUPLICATES  Things with the same name are merged (the same name is the
 *                  same Thing); names that differ more than in capitals
 *                  ("Cause", "Causes") are put to the model first.
 *   2. SPLITS      for every kind with enough members, code clusters the members
 *                  by what they are connected to, made of and placed among, and
 *                  scores the split by DESCRIPTION LENGTH: a kind costs one, and
 *                  each member costs the features it does not share with its
 *                  kind's core. A split that describes the same Things more
 *                  compactly is the more probable structure (minimum description
 *                  length ≈ Bayesian model comparison). The misfit must show up in
 *                  two sleeps before it is proposed — hysteresis, so one odd fact
 *                  does not reorganize a worldview — and a kind just restructured
 *                  is left alone for a while.
 *   3. REVISIONS   an accepted split is recorded as a revision in the Druid's
 *                  "Revisions" web: what every member was before, what was
 *                  created, the scores. `revert` restores it exactly.
 *
 *   4. LETTING GO  plans stuck on one step are let go; old moments are folded
 *                  into their day; what it made and never used is forgotten.
 *   5. REPAIRS     placements of Things already gone, plan steps loose among
 *                  content, beliefs placed in webs of content, a Thing with two
 *                  insides: put right.
 *
 * The model only judges and names. Detection, scoring and the restructure are
 * code.
 */

import { normalizeName as norm } from './names.js';
import { activePlans, roleType, roleOf, isBookkeeping, lapseStaleGoals } from './roles.js';
import { isOwnPlace } from './attention.js';

const MIN_MEMBERS = 6;
const MIN_GAIN = 2;
const SIGHTINGS = 2;
const COOLDOWN = 36;

export { norm as normalizeName };

/** Things that look like the same Thing twice, by name. */
export function duplicateGroups(world) {
  const groups = new Map();
  for (const id of world.allThings()) {
    // Never a goal, plan or step with a Thing named like it: "Why do people
    // cry" the goal was merged into "Why do people cry" the web.
    if (world.druidOf(id).roleType || world.druidOf(id).role || isBookkeeping(world, id) || roleOf(world, id)) continue;
    const k = norm(world.nameOf(id));
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

/** What a Thing is: the webs it is in, how it connects, what it is made of. */
export function features(world, id) {
  const f = new Set();
  for (const w of world.websOf(id)) {
    if (world.isSystemWeb(w)) continue;
    f.add(`in:${world.graph(w)?.name}`);
    for (const l of world.linksIn(w)) {
      if (l.a === id) f.add(`out:${l.relation.toLowerCase()}`);
      if (l.b === id) f.add(`in-rel:${l.relation.toLowerCase()}`);
    }
  }
  const inside = world.insideOf(id);
  if (inside) for (const p of world.thingsIn(inside)) f.add(`part:${world.nameOf(p).toLowerCase()}`);
  return f;
}

const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Description length of a grouping: a kind costs 1, a member the features it does not share with its kind's core. */
export function descriptionLength(groups, feats) {
  let dl = 0;
  for (const g of groups) {
    if (g.length === 0) continue;
    dl += 1;
    const counts = new Map();
    for (const m of g) for (const x of feats.get(m)) counts.set(x, (counts.get(x) || 0) + 1);
    const core = new Set([...counts].filter(([, c]) => c >= g.length / 2).map(([x]) => x));
    for (const m of g) {
      const fm = feats.get(m);
      for (const x of fm) if (!core.has(x)) dl++;
      for (const x of core) if (!fm.has(x)) dl++;
    }
  }
  return dl;
}

/** Two-way split of members by feature similarity. */
export function twoMeans(members, feats, iterations = 6) {
  let best = [members[0], members[1]];
  let worst = Infinity;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const s = jaccard(feats.get(members[i]), feats.get(members[j]));
      if (s < worst) { worst = s; best = [members[i], members[j]]; }
    }
  }
  let seeds = best.map(id => feats.get(id));
  let groups = [[], []];
  for (let it = 0; it < iterations; it++) {
    groups = [[], []];
    for (const m of members) {
      const s0 = jaccard(feats.get(m), seeds[0]);
      const s1 = jaccard(feats.get(m), seeds[1]);
      groups[s1 > s0 ? 1 : 0].push(m);
    }
    // New seeds: the features at least half of each group shares.
    seeds = groups.map(g => {
      const counts = new Map();
      for (const m of g) for (const x of feats.get(m)) counts.set(x, (counts.get(x) || 0) + 1);
      return new Set([...counts].filter(([, c]) => c >= g.length / 2).map(([x]) => x));
    });
  }
  return groups;
}

/**
 * Look at one kind: is it really two?
 * @returns {null | { type, groups, before, after, gain }}
 */
export function splitCandidate(world, typeId) {
  const members = world.membersOf(typeId).filter(id => world.proto(id) && !world.druidOf(id).roleType);
  if (members.length < MIN_MEMBERS) return null;
  const feats = new Map(members.map(m => [m, features(world, m)]));
  const groups = twoMeans(members, feats);
  if (groups.some(g => g.length < 2)) return null;
  const before = descriptionLength([members], feats);
  const after = descriptionLength(groups, feats) + 1; // the new level of structure costs one
  const gain = before - after;
  return gain >= MIN_GAIN ? { type: typeId, groups, before, after, gain } : null;
}

function revisionsWeb(world) {
  return world.systemWeb('revisions', 'Revisions', 'How the Druid has reorganized what it knows, and why.');
}

/** Record a revision as a Thing in the Revisions web. */
async function recordRevision(world, title, revision) {
  const web = revisionsWeb(world);
  const r = await world.createThing(web, title, { description: revision.why || '' });
  if (r.ok) world.setDruid(r.id, { role: 'revision', revision });
  return r.ok ? r.id : null;
}

/** Undo a split exactly: members get their old kind back, the kinds it made are removed. */
export function revert(world, revisionId) {
  const rev = world.druidOf(revisionId).revision;
  if (!rev || rev.reverted) return false;
  if (rev.kind === 'split') {
    for (const [member, oldType] of Object.entries(rev.before)) {
      if (world.proto(member)) world.state().setNodeType(member, oldType);
    }
    for (const id of rev.created) if (world.proto(id)) world.forget(id);
  }
  world.setDruid(revisionId, (d) => ({ ...d, revision: { ...d.revision, reverted: true } }));
  return true;
}

/**
 * One sleep.
 * @param {Object} ctx   the cycle's ctx: world, tick, judge, ask
 */
export async function sleep(ctx) {
  const { world, tick } = ctx;
  const report = { merged: [], misfits: [], split: [], declined: [] };

  // 1. Duplicates. The same name is the same Thing (world.js createThing), so
  // one written twice exactly is merged without asking: asked, a judge kept two
  // Molecules and two Minerals apart for a whole run. Only names that differ
  // more than in capitals ("Cause", "Causes") are asked, two a sleep.
  const exact = (g) => new Set(g.map(id => world.nameOf(id).trim().toLowerCase())).size === 1;
  const groups = duplicateGroups(world);
  for (const group of [...groups.filter(exact), ...groups.filter(g => !exact(g)).slice(0, 2)]) {
    const [a, b] = group;
    const key = exact(group) ? 'same' : await ctx.judge(`Are these the same thing? "${world.nameOf(a)}" — ${world.proto(a)?.description || 'no description'}; and "${world.nameOf(b)}" — ${world.proto(b)?.description || 'no description'}.`, [
      { key: 'same', label: 'the same thing, written twice' },
      { key: 'different', label: 'different things' }
    ]);
    if (key !== 'same') { report.declined.push(`${world.nameOf(a)} ≠ ${world.nameOf(b)}`); continue; }
    const linkCount = (id) => world.websOf(id).reduce((n, w) => n + world.linksIn(w).filter(l => l.a === id || l.b === id).length, 0);
    const [keep, drop] = linkCount(a) >= linkCount(b) ? [a, b] : [b, a];
    const name = world.nameOf(keep);
    const r = await world.act('mergeNodes', { primaryPrototypeId: keep, secondaryPrototypeId: drop });
    if (r.ok) { world.unnest?.(keep); await world.foldInsides?.(keep); report.merged.push(name); }
  }

  // 2. Splits.
  const types = new Set(world.allThings().map(id => world.proto(id)?.typeNodeId).filter(Boolean));
  for (const typeId of types) {
    if (!world.proto(typeId) || world.druidOf(typeId).roleType) continue;
    const d = world.druidOf(typeId);
    if ((d.restructuredAt ?? -Infinity) + COOLDOWN > tick) continue;
    const cand = splitCandidate(world, typeId);
    if (!cand) {
      if (d.misfit) world.setDruid(typeId, (x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'misfit')));
      continue;
    }
    const sightings = (d.misfit?.count || 0) + 1;
    world.setDruid(typeId, { misfit: { count: sightings, at: tick, gain: cand.gain } });
    report.misfits.push({ kind: world.nameOf(typeId), sightings, gain: cand.gain });
    if (sightings < SIGHTINGS) continue;

    const names = (g) => g.map(id => world.nameOf(id)).join(', ');
    const T = world.nameOf(typeId);
    const key = await ctx.judge(`Your kinds of ${T} seem to fall into two groups: [${names(cand.groups[0])}] and [${names(cand.groups[1])}]. Should ${T} be split into two kinds?`, [
      { key: 'split', label: 'yes, they are really two kinds' },
      { key: 'keep', label: 'no, they are one kind' }
    ]);
    if (key !== 'split') {
      world.setDruid(typeId, { misfit: null, restructuredAt: tick });
      report.declined.push(`split of ${T}`);
      continue;
    }
    const before = {};
    const created = [];   // kinds this split made — revert deletes these
    const reused = [];    // Things that already existed and became the kinds — revert keeps these
    const kinds = [];
    const home = world.websOf(typeId).find(w => !world.isSystemWeb(w)) || world.websOf(cand.groups[0][0])[0];
    for (const g of cand.groups) {
      const label = await ctx.ask(`Name the kind of ${T} that ${names(g)} are.`, 4);
      const kindName = String(label || '').trim().replace(/^\w/, c => c.toUpperCase());
      if (!kindName) break;
      // A Thing by that name may already exist ("Herbs", kept from an earlier
      // thought). It becomes the kind — but it is not the split's to delete.
      const existing = world.findThing(kindName);
      if (existing && (existing === typeId || g.includes(existing))) break;
      let kindId = existing;
      if (existing) {
        reused.push(existing);
        before[existing] = world.proto(existing)?.typeNodeId ?? null;
        world.state().setNodeType(existing, typeId);
      } else {
        const r = await world.createThing(home, kindName, { description: `A kind of ${T}.`, typeNodeId: typeId, asPart: false });
        if (!r.ok) break;
        kindId = r.id;
        created.push(r.id);
      }
      kinds.push(kindId);
      for (const m of g) { before[m] = world.proto(m)?.typeNodeId || typeId; world.state().setNodeType(m, kindId); }
    }
    if (kinds.length !== 2) {
      // Half a split is no split: put it back.
      for (const [m, t] of Object.entries(before)) world.state().setNodeType(m, t);
      for (const id of created) world.forget(id);
      report.declined.push(`split of ${T} (unnamed)`);
      continue;
    }
    const revisionId = await recordRevision(world, `Split ${T}`, {
      kind: 'split', type: typeId, before, created, reused, dl: { before: cand.before, after: cand.after }, tick,
      why: `${T} was really two kinds: ${kinds.map(id => world.nameOf(id)).join(' and ')}. Described more compactly that way (${cand.before} → ${cand.after}).`
    });
    world.setDruid(typeId, { misfit: null, restructuredAt: tick });
    report.split.push({ kind: T, into: kinds.map(id => world.nameOf(id)), revision: revisionId, gain: cand.gain });
  }

  // 3. Letting go: plans that stalled, smaller goals long open, episodes that are old, what is dead.
  // Kinds sleep changed are kept as ladders in the carousel too (world.js addKind).
  world.writeLadders?.();
  report.lapsed = lapseStalledPlans(world, tick);
  report.dropped = lapseStaleGoals(world, tick);
  report.condensed = await condenseEpisodes(world, tick);
  const keep = new Set([ctx.locus?.focus, ...(ctx.held || []).map(h => h.id)].filter(Boolean));
  report.pruned = pruneDead(world, tick, keep);
  // No audit of insides by a yes or no: Apple's model answers "is X a part of
  // Y?" yes both ways, and the made-of check turned true parts away (a Summit
  // from Mount Everest). What enters an inside enters by the question that
  // asked for it (moves/basic.js openAsk).
  // Placements of Things already gone (world.js repairDangling).
  report.repaired = world.repairDangling?.() || 0;
  // A plan's steps live in the plan: steps taken for Things of the same name
  // were placed in content webs.
  // One whose plan is gone and that lives only among content has become the
  // Thing it names: merged into that Thing, its connections kept, or kept as it.
  for (const id of world.allThings()) {
    if (!world.druidOf(id).step || !world.proto(id)) continue;
    const webs = world.websOf(id);
    const loose = webs.filter(w => !isOwnPlace(world, w));
    if (!loose.length) continue;
    if (loose.length < webs.length) { for (const w of loose) world.unplace(w, id); report.repaired++; continue; }
    const twin = world.allThings().find(t => t !== id && !world.druidOf(t).step && !isBookkeeping(world, t) && norm(world.nameOf(t)) === norm(world.nameOf(id)));
    if (twin) {
      const r = await world.act('mergeNodes', { primaryPrototypeId: twin, secondaryPrototypeId: id });
      // The merge brings the step's metadata along; the Thing is no step.
      if (r.ok) { world.setDruid(twin, (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'step'))); world.unnest?.(twin); await world.foldInsides?.(twin); }
    } else {
      world.setDruid(id, (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'step')));
    }
    report.repaired++;
  }
  // Beliefs and contrasts are kept with the beliefs, not among the parts of
  // what they are about: one long run's largest web was more than half claims.
  const beliefType = roleType(world, 'belief');
  for (const id of world.allThings()) {
    if (!beliefType || roleOf(world, id) !== 'belief' || !world.beliefsWeb) continue;
    const loose = world.websOf(id).filter(w => !isOwnPlace(world, w));
    if (!loose.length) continue;
    const aboutLink = loose.flatMap(w => world.linksIn(w)).find(l => l.a === id && /^is about$/i.test(l.relation));
    if (aboutLink && !world.druidOf(id).about) world.setDruid(id, { about: aboutLink.b });
    world.place(world.beliefsWeb(), id);
    for (const w of loose) world.unplace(w, id);
    report.repaired++;
  }
  // Things merged before merges folded their insides.
  for (const id of world.allThings()) report.repaired += await world.foldInsides?.(id) || 0;

  return report;
}

/** Cycles a plan may sit on one step before it is let go. */
export const PLAN_PATIENCE = 36;
/** Cycles an episode is kept as itself before it is folded into its day. */
export const EPISODE_KEEP = 24;

/**
 * Plans whose current step has not moved in PLAN_PATIENCE cycles are let go,
 * steps and all. A plan nobody is following is not a plan; kept, it is clutter
 * that still looks like an intention. The goal stays.
 */
export function lapseStalledPlans(world, tick) {
  const lapsed = [];
  for (const p of activePlans(world)) {
    const since = world.druidOf(p).stepSince ?? world.druidOf(p).statusAt ?? 0;
    if (tick - since < PLAN_PATIENCE) continue;
    const name = world.nameOf(p);
    if (world.forget(p)) lapsed.push(name);
  }
  return lapsed;
}

/**
 * Episodes older than EPISODE_KEEP cycles are folded into one Thing for their
 * day: how many moments, and what they were mostly about. Most of what happens
 * is forgotten; what it was about stays. One Thing per write, kept forever,
 * was more than half of a 30-cycle Druid's universe.
 */
export async function condenseEpisodes(world, tick) {
  const old = world.allThingsIncludingSystem().filter(id => world.druidOf(id).role === 'episode' && (world.druidOf(id).tick ?? tick) < tick - EPISODE_KEEP);
  const byDay = new Map();
  for (const id of old) {
    const web = world.websOf(id)[0];
    if (!web) continue;
    if (!byDay.has(web)) byDay.set(web, []);
    byDay.get(web).push(id);
  }
  let condensed = 0;
  for (const [web, moments] of byDay) {
    const day = (world.graph(web)?.name || '').replace(/^Episodes\s*/, '') || 'earlier';
    let summary = world.thingsIn(web).find(id => world.druidOf(id).role === 'day');
    if (!summary) {
      const r = await world.createThing(web, `Day ${day}`, { description: '', typeNodeId: roleType(world, 'episode') });
      if (!r.ok) continue;
      summary = r.id;
      world.setDruid(summary, { role: 'day', moments: 0, about: {} });
    }
    const d = world.druidOf(summary);
    const about = { ...(d.about || {}) };
    for (const m of moments) {
      for (const t of world.druidOf(m).touched || []) {
        const n = world.nameOf(t);
        if (n) about[n] = (about[n] || 0) + 1;
      }
    }
    for (const m of moments) if (world.forget(m)) condensed++;
    const total = (d.moments || 0) + moments.length;
    const top = Object.entries(about).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
    world.setDruid(summary, { moments: total, about: Object.fromEntries(Object.entries(about).sort((a, b) => b[1] - a[1]).slice(0, 40)) });
    world.state().updateNodePrototype(summary, (p) => {
      p.description = `${total} moment${total === 1 ? '' : 's'}${top.length ? `, mostly about ${top.join(', ')}` : ''}.`;
    });
  }
  return condensed;
}

/** Cycles a Thing the Druid made may sit unconnected and unused before it is pruned. */
export const PRUNE_AFTER = 48;

/**
 * Prune what the Druid made and nothing holds: a Thing with no connection, no
 * inside, no members, not held in mind, unused for PRUNE_AFTER cycles; a
 * relation type no connection uses any more. Only its own making — never what
 * a person made — and never its goals, plans, beliefs or kinds of thought.
 */
export function pruneDead(world, tick, keep = new Set()) {
  const pruned = [];
  const relationTypes = world.relationTypeIds();
  const kinds = new Set(world.allThingsIncludingSystem().map(id => world.proto(id)?.typeNodeId).filter(Boolean));
  const linked = new Set();
  for (const g of world.state().graphs.values()) for (const l of world.linksIn(g.id)) { linked.add(l.a); linked.add(l.b); }
  for (const id of world.allThings()) {
    const d = world.druidOf(id);
    if (relationTypes.has(id) || kinds.has(id) || world.insideOf(id) || keep.has(id)) continue;
    // A relation type its own connecting made, which no connection uses now.
    if (d.relation) { const name = world.nameOf(id); if (world.forget(id)) pruned.push(name); continue; }
    if (d.madeBy !== 'druid' || d.roleType || d.system || d.homeOf || roleOf(world, id)) continue;
    if (linked.has(id)) continue;
    // A part of something is held by the composition it is in: only what sits
    // in its own places alone (Noticed, Working Memory) is forgotten unused.
    if (world.websOf(id).some(w => !isOwnPlace(world, w))) continue;
    const lastUse = Math.max(-Infinity, ...(d.uses || []));
    if (!Number.isFinite(lastUse) || tick - lastUse < PRUNE_AFTER) continue;
    const name = world.nameOf(id);
    if (world.forget(id)) pruned.push(name);
  }
  return pruned;
}
