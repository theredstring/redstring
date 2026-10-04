/**
 * The universe as a person would find it by opening Home: each web reached by
 * going inside, its Things and its connections, in plain text. Copied with the
 * transcript from the Wizard's Druid view, so a run can be read without the
 * file, and used by the tests to check that nothing the Druid keeps is lost.
 */
import { roleOf } from '../roles.js';

/** Webs reached from Home by going inside Things, and the webs that are not. */
export function reachableFromHome(world) {
  const home = world.homeWeb?.() || null;
  const reached = [];
  const seen = new Set();
  const queue = home ? [{ id: home, from: null }] : [];
  while (queue.length) {
    const { id, from } = queue.shift();
    if (seen.has(id) || !world.graph(id)) continue;
    seen.add(id);
    reached.push({ id, from });
    // Through its own webs only to its own webs (the Diary to a day): Working
    // Memory holds Things for a moment, and is not where their insides live.
    const own = world.isSystemWeb(id);
    for (const t of world.thingsIn(id)) {
      for (const d of world.proto(t)?.definitionGraphIds || []) {
        if (!seen.has(d) && (!own || world.isSystemWeb(d))) queue.push({ id: d, from: id });
      }
    }
  }
  const unreachable = [...world.state().graphs.values()].filter(g => !seen.has(g.id)).map(g => ({ id: g.id, name: g.name }));
  return { home, reached, unreachable };
}

/**
 * @param {Object} world
 * @param {Object} [opts]
 * @param {number} [opts.things]  Things listed per web
 * @param {number} [opts.links]   connections listed per web
 * @returns {string}
 */
export function outline(world, { things: thingsK = 24, links: linksK = 16 } = {}) {
  const { reached, unreachable } = reachableFromHome(world);
  const lines = [];
  const thingLabel = (id, linked) => {
    const role = roleOf(world, id);
    return `${world.nameOf(id)}${role ? ` [${role}]` : ''}${world.insideOf(id) ? '▸' : ''}${linked.has(id) ? '' : '°'}`;
  };
  const describeWeb = (id, from) => {
    const name = world.graph(id)?.name || '?';
    const owner = world.ownerOf(id);
    const here = world.thingsIn(id);
    if (world.isSystemWeb(id)) {
      lines.push(`${name} (the Druid's own) — ${here.length} Things`);
      return;
    }
    const links = world.linksIn(id);
    const linked = new Set(links.flatMap(l => [l.a, l.b]));
    const where = from ? ` (in ${world.graph(from)?.name || '?'}${owner && world.nameOf(owner) !== name ? `, inside ${world.nameOf(owner)}` : ''})` : '';
    lines.push(`${name}${where} — ${here.length} Things, ${links.length} connections`);
    if (here.length) lines.push(`  ${here.slice(0, thingsK).map(t => thingLabel(t, linked)).join(', ')}${here.length > thingsK ? `, and ${here.length - thingsK} more` : ''}`);
    for (const l of links.slice(0, linksK)) lines.push(`  ${world.nameOf(l.a)} —${l.relation}→ ${world.nameOf(l.b)}`);
    if (links.length > linksK) lines.push(`  and ${links.length - linksK} more connections`);
  };
  const things = world.allThings().length;
  lines.push(`The universe now: ${world.state().graphs.size} webs, ${things} Things (▸ has an inside, ° not connected)`);
  for (const { id, from } of reached) describeWeb(id, from);
  if (unreachable.length) {
    lines.push('', `Not reachable from Home: ${unreachable.map(g => g.name).join(', ')}`);
    for (const g of unreachable) if (!world.isSystemWeb(g.id)) describeWeb(g.id, null);
  }
  return lines.join('\n');
}
