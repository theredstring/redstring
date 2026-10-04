/**
 * Tidy moves — keeping a universe in order, offered when code sees a need.
 *
 * Checks at the door (world.js) keep new clutter out. What is already there —
 * a universe made before them, or by a person — is found by sleep and by
 * comparing names, and offered here as plain moves, so tidying is something the
 * Druid chooses, not something done to it.
 *
 *   moveOut   a Thing inside another that sleep found is not a part of it
 *   mergeSame two Things in view whose names say they are the same
 */

import { isOwnPlace } from '../attention.js';
import { isObject } from '../roles.js';
import { normalizeName } from '../names.js';

const fail = (error) => ({ ok: false, error, summary: error, touched: [], wrote: false });

export const moveOut = {
  id: 'moveOut',
  prior: 0.9,
  offer(ctx) {
    const { world, locus } = ctx;
    // Here first (standing in the inside, or looking at its Thing), then from
    // anywhere: a Druid that spent a whole run in one web was never offered
    // the fifteen Things sleep had flagged elsewhere.
    const near = new Set([locus.web, locus.focus && world.insideOf(locus.focus)].filter(Boolean));
    const flagged = world.allThings().filter(id => world.druidOf(id).misplaced?.web).map(id => ({ id, web: world.druidOf(id).misplaced.web }))
      .filter(({ id, web }) => world.graph(web) && world.thingsIn(web).includes(id)
        && world.websOf(world.ownerOf(web)).some(w => w !== web && !isOwnPlace(world, w)));
    flagged.sort((a, b) => (near.has(b.web) ? 1 : 0) - (near.has(a.web) ? 1 : 0));
    return flagged.slice(0, 2).map(({ id, web }) => ({
      label: `move ${world.nameOf(id)} out of ${world.nameOf(world.ownerOf(web))} (it is not a part of it)`,
      data: { id, web }, target: id, prior: near.has(web) ? 0.9 : 0.8
    }));
  },
  async run(ctx, data) {
    const { world } = ctx;
    const owner = world.ownerOf(data.web);
    // Never out to Home or a goal's or plan's inside: "moved Electrons out … to Home".
    const outer = owner && world.websOf(owner).find(w => w !== data.web && !isOwnPlace(world, w));
    if (!outer) return fail(`${world.nameOf(owner)} sits in no web to move it out to`);
    const { kept, dropped } = await world.move(data.web, outer, data.id);
    world.setDruid(data.id, (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'misplaced')));
    const links = kept || dropped ? ` (${kept} connection${kept === 1 ? '' : 's'} kept${dropped ? `, ${dropped} left behind` : ''})` : '';
    return { ok: true, summary: `moved ${world.nameOf(data.id)} out of ${world.nameOf(owner)}, to ${world.graph(outer)?.name}${links}`, touched: [data.id, owner], wrote: true };
  }
};

/** Names that say two Things are the same: equal once normalized ("Tomato", "tomatoes"). */
export function sameByName(a, b) {
  return normalizeName(a) === normalizeName(b);
}

export const mergeSame = {
  id: 'mergeSame',
  prior: 0.85,
  offer(ctx) {
    const { world, view } = ctx;
    const f = view.focus;
    if (!f || !isObject(world, f.id)) return [];
    const twins = world.allThings().filter(id => id !== f.id && isObject(world, id) && sameByName(world.nameOf(id), f.name));
    return twins.slice(0, 1).map(id => ({ label: `merge ${world.nameOf(id)} into ${f.name} (the same Thing, written twice)`, data: { from: id, into: f.id }, target: id }));
  },
  async run(ctx, data) {
    const { world } = ctx;
    const name = world.nameOf(data.into);
    const r = await world.act('mergeNodes', { primaryPrototypeId: data.into, secondaryPrototypeId: data.from });
    if (!r.ok) return fail(r.error);
    return { ok: true, summary: `merged the second ${name} into the first`, touched: [data.into], wrote: true };
  }
};

/**
 * Sleep's part of tidying: look over insides for Things that are not parts of
 * what they sit in, a few each sleep, and flag them for moveOut. Only asked
 * through the world's check (a helper call); without one, nothing is flagged.
 *
 * @returns {Promise<string[]>} "X in Y" for each newly flagged Thing
 */
export async function auditInsides(world, { limit = 6 } = {}) {
  if (!world.check && !world.isPart) return [];
  const flagged = [];
  let asked = 0;
  for (const g of world.state().graphs.values()) {
    const owner = world.ownerOf(g.id);
    if (!owner || world.isSystemWeb(g.id) || !isObject(world, owner) || world.druidOf(owner).topic) continue;
    if (!world.websOf(owner).some(w => w !== g.id && !world.isSystemWeb(w))) continue; // a top-level web, not an inside
    for (const id of world.thingsIn(g.id)) {
      if (asked >= limit) return flagged;
      const d = world.druidOf(id);
      if (id === owner || !isObject(world, id) || d.misplaced || d.partOf?.includes(g.id)) continue;
      asked++;
      const v = await world.isPartOf(world.nameOf(id), world.nameOf(owner));
      if (v === false) { world.setDruid(id, { misplaced: { web: g.id } }); flagged.push(`${world.nameOf(id)} in ${world.nameOf(owner)}`); }
      if (v === true) world.setDruid(id, (x) => ({ ...x, partOf: [...new Set([...(x.partOf || []), g.id])] }));
    }
  }
  return flagged;
}

export const TIDY_MOVES = [moveOut, mergeSame];
