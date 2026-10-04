/**
 * Attention — where the Druid stands, and what it can see from there.
 *
 * The model never sees "the graph". It sees a bounded VIEW from its LOCUS:
 *
 *   locus = { web, focus, path }   the web it is in, the Thing in focus, and
 *                                  the Things it went inside of to get here
 *
 *   view  = the focus (name, description, what it is a kind of),
 *           the top of its inside, its connections here, its strongest learned
 *           associations, a few other Things in this web, and what this web is
 *           the inside of
 *
 * Everything in a view is chosen by activation and capped, so the view is the
 * same size in a ten-Thing universe and a ten-thousand-Thing one. That is what
 * lets a 4K mind live in a web of any size: it moves (open, close, follow) and
 * the view moves with it.
 */

import { recencyMark, ago, recentWebs, MARK_WITHIN } from './recency.js';
import { assocStrength } from './activation.js';

export const emptyLocus = () => ({ web: null, focus: null, path: [] });

const clip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t; };

const byActivation = (activation) => (a, b) => (activation.get(b) ?? -9) - (activation.get(a) ?? -9);

/** Repair a locus whose web or focus no longer exists, preferring the most active web. */
export function settleLocus(world, locus, activation) {
  const l = { ...emptyLocus(), ...(locus || {}) };
  if (l.web && (!world.graph(l.web) || world.isSystemWeb(l.web))) l.web = null;
  if (!l.web) {
    const webs = userWebs(world).sort((a, b) => (activation.get(world.ownerOf(b)) ?? -9) - (activation.get(world.ownerOf(a)) ?? -9));
    l.web = webs[0] || null;
    l.focus = null;
    l.path = [];
  }
  if (l.focus && (!world.proto(l.focus) || !world.thingsIn(l.web).includes(l.focus))) l.focus = null;
  l.path = (l.path || []).filter(id => world.proto(id));
  return l;
}

/** Webs that are long-term memory (not the Druid's own system webs). */
export function userWebs(world) {
  return [...world.state().graphs.values()].map(g => g.id).filter(id => !world.isSystemWeb(id));
}

/** Top-level webs: not the inside of a Thing that is itself placed in a web. */
export function topLevelWebs(world) {
  return userWebs(world).filter(id => {
    const owner = world.ownerOf(id);
    return !owner || world.websOf(owner).filter(w => !world.isSystemWeb(w)).length === 0;
  });
}

/** Whether a web is the Druid's Home. */
export const isHome = (world, webId) => !!world.druidOf(world.ownerOf(webId) || '').homeOf;

/**
 * @returns {Object} the view, as data
 */
export function buildView(world, locus, activation, { tick = 0, insideK = 6, neighbourK = 6, peersK = 6 } = {}) {
  const sort = byActivation(activation);
  const view = { web: null, container: null, focus: null, inside: [], insideMore: 0, links: [], associated: [], peers: [], webs: [] };

  if (!locus.web) {
    view.webs = userWebs(world).map(id => ({ id, name: world.graph(id)?.name || '?' })).slice(0, 8);
    return view;
  }

  const web = world.graph(locus.web);
  view.web = { id: locus.web, name: web?.name || '?' };
  const owner = world.ownerOf(locus.web);
  if (owner) view.container = { id: owner, name: world.nameOf(owner) };

  // Role types (Goal, Belief, Plan, Episode) are the Druid's furniture: their
  // behavior works through the role moves, but they are not content to look
  // at or connect. Shown as ordinary Things, a fresh Druid spent its first
  // dozen cycles connecting a "Dream" to its own Belief, Goal and Episode.
  const isFurniture = (id) => !!world.druidOf(id).roleType;
  const here = world.thingsIn(locus.web).filter(id => !isFurniture(id));
  const links = world.linksIn(locus.web).filter(l => !isFurniture(l.a) && !isFurniture(l.b));

  if (locus.focus) {
    const f = world.proto(locus.focus);
    const inside = world.insideOf(locus.focus);
    const insideThings = inside ? world.thingsIn(inside).sort(sort) : [];
    view.focus = {
      id: f.id,
      name: f.name,
      description: clip(f.description, 220),
      kinds: world.typeChain(f.id).slice(0, 2).map(id => world.nameOf(id)).filter(n => n && n !== 'Thing'),
      inside,
      insideCount: insideThings.length
    };
    view.inside = insideThings.slice(0, insideK).map(id => ({ id, name: world.nameOf(id) }));
    view.insideMore = Math.max(0, insideThings.length - insideK);
    view.links = links
      .filter(l => l.a === f.id || l.b === f.id)
      .map(l => ({ id: l.a === f.id ? l.b : l.a, name: world.nameOf(l.a === f.id ? l.b : l.a), relation: l.relation, out: l.a === f.id }))
      .sort((x, y) => sort(x.id, y.id))
      .slice(0, neighbourK);
    const linked = new Set(view.links.map(l => l.id));
    view.associated = Object.entries(world.druidOf(f.id).assoc || {})
      .map(([id, e]) => ({ id, s: assocStrength(e, tick) }))
      .filter(x => world.proto(x.id) && !linked.has(x.id) && x.s >= 0.15)
      .sort((x, y) => y.s - x.s)
      .slice(0, 3)
      .map(x => ({ id: x.id, name: world.nameOf(x.id) }));
  }

  const shown = new Set([locus.focus, ...view.links.map(l => l.id)]);
  view.peers = here.filter(id => !shown.has(id)).sort(sort).slice(0, peersK).map(id => ({ id, name: world.nameOf(id) }));
  view.peersMore = Math.max(0, here.filter(id => !shown.has(id)).length - peersK);
  view.webs = userWebs(world).filter(id => id !== locus.web)
    .sort((a, b) => sort(world.ownerOf(a), world.ownerOf(b)))
    .slice(0, 4)
    .map(id => ({ id, name: world.graph(id)?.name || '?' }));
  return view;
}

/** The view in plain words. */
/**
 * @param {Object} view
 * @param {Object} [recency]  { world, tick, writes, trail }: marks what was touched lately
 *   ("just now", "3 moments ago") on Things, connections and webs (recency.js)
 */
export function renderView(view, recency = null) {
  const mark = (id) => (recency ? recencyMark(recency.world, id, recency.tick) : '');
  // A connection is recent when one write touched both its ends lately.
  const linkMark = (a, b) => {
    if (!recency) return '';
    const w = [...(recency.writes || [])].reverse().find(x => (x.touched || []).includes(a) && (x.touched || []).includes(b));
    const t = w ? ago(recency.tick, w.tick, MARK_WITHIN) : '';
    return t ? ` (${t})` : '';
  };
  const visited = recency ? recentWebs(recency.trail, recency.tick) : new Map();
  const webMark = (id) => (visited.has(id) ? ` (${ago(recency.tick, visited.get(id))})` : '');
  if (!view.web) {
    return view.webs.length === 0
      ? 'Your universe is empty. There are no webs yet.'
      : `You are not in any web. Your webs: ${view.webs.map(w => w.name).join(', ')}.`;
  }
  const lines = [`You are in the web "${view.web.name}"${view.container ? ` — the inside of ${view.container.name}` : ''}.`];
  if (view.focus) {
    const f = view.focus;
    lines.push(`In focus: ${f.name}${mark(f.id)}${f.description ? ` — ${f.description}` : ' (no description yet)'}${f.kinds.length ? ` (a kind of ${f.kinds.join(', a kind of ')})` : ''}`);
    if (view.inside.length) lines.push(`Inside ${f.name}: ${view.inside.map(t => t.name).join(', ')}${view.insideMore ? ` (+${view.insideMore} more)` : ''}`);
    else lines.push(`${f.name} has nothing inside it yet.`);
    if (view.links.length) {
      lines.push(`${f.name}'s connections: ${view.links.map(l => (l.out ? `${l.relation} → ${l.name}` : `${l.name} ${l.relation} → ${f.name}`) + linkMark(f.id, l.id)).join('; ')}`);
    } else {
      lines.push(`${f.name} is not connected to anything here.`);
    }
    if (view.associated.length) lines.push(`Often in mind with ${f.name}: ${view.associated.map(a => a.name).join(', ')}`);
  } else {
    lines.push('Nothing is in focus.');
  }
  if (view.peers.length) lines.push(`${view.focus ? 'Also here' : 'Things here'}: ${view.peers.map(p => p.name + mark(p.id)).join(', ')}${view.peersMore ? ` (+${view.peersMore} more)` : ''}`);
  else if (!view.focus) lines.push('This web is empty.');
  if (view.webs.length) lines.push(`Other webs: ${view.webs.map(w => w.name + webMark(w.id)).join(', ')}`);
  return lines.join('\n');
}
