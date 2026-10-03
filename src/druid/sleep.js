/**
 * Sleep — consolidation, and the reconstruction of schemas.
 *
 * New information is mostly ASSIMILATED: a Thing is added, a belief weighed,
 * the structure stays. Sometimes it should be ACCOMMODATED: the structure
 * itself is wrong and has to change. Sleep is where that happens, offline,
 * between stretches of thought:
 *
 *   1. DUPLICATES  Things whose names normalize to the same word are put to the
 *                  model as "the same thing?"; a yes merges them.
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
 * The model only judges and names. Detection, scoring and the restructure are
 * code.
 */

const MIN_MEMBERS = 6;
const MIN_GAIN = 2;
const SIGHTINGS = 2;
const COOLDOWN = 36;

/** The singular of a final English word, roughly: processes → process, berries → berry, rivers → river. */
const singular = (w) => (/(ss|x|z|ch|sh|o)es$/.test(w) ? w.slice(0, -2) : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /[^s]s$/.test(w) ? w.slice(0, -1) : w);

const norm = (s) => {
  const words = String(s || '').toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/);
  if (words.length) words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
};

/** Things that look like the same Thing twice, by name. */
export { norm as normalizeName };

export function duplicateGroups(world) {
  const groups = new Map();
  for (const id of world.allThings()) {
    if (world.druidOf(id).roleType || world.druidOf(id).role) continue;
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
    for (const id of rev.created) if (world.proto(id)) world.state().deleteNodePrototype(id);
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

  // 1. Duplicates.
  for (const group of duplicateGroups(world).slice(0, 2)) {
    const [a, b] = group;
    const key = await ctx.judge(`Are these the same thing? "${world.nameOf(a)}" — ${world.proto(a)?.description || 'no description'}; and "${world.nameOf(b)}" — ${world.proto(b)?.description || 'no description'}.`, [
      { key: 'same', label: 'the same thing, written twice' },
      { key: 'different', label: 'different things' }
    ]);
    if (key !== 'same') { report.declined.push(`${world.nameOf(a)} ≠ ${world.nameOf(b)}`); continue; }
    const linkCount = (id) => world.websOf(id).reduce((n, w) => n + world.linksIn(w).filter(l => l.a === id || l.b === id).length, 0);
    const [keep, drop] = linkCount(a) >= linkCount(b) ? [a, b] : [b, a];
    const name = world.nameOf(keep);
    const r = await world.act('mergeNodes', { primaryPrototypeId: keep, secondaryPrototypeId: drop });
    if (r.ok) report.merged.push(name);
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
        const r = await world.createThing(home, kindName, { description: `A kind of ${T}.`, typeNodeId: typeId });
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
      for (const id of created) world.state().deleteNodePrototype(id);
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

  return report;
}
