/**
 * The menu — what the model is offered each cycle.
 *
 * Every move offers its items from the current view; the menu ranks them and
 * keeps a handful. Ranking is design, not decoration: small models favour the
 * first and last options, so the order has to mean something.
 *
 *   score = item prior (or the move's) + a little for an active target
 *           − a penalty for what was just done (so it does not circle)
 *
 * At most two items per move keep any one move from crowding the rest out.
 * The last option is always "something else", the escape hatch: its answer is
 * matched to a move when it can be, and otherwise kept as a report of a move
 * that does not exist yet.
 */

export const MENU_SIZE = 7;
export const PER_MOVE = 2;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export const OTHER = {
  id: 'other',
  label: 'something else, as a command: ___',
  blank: {
    // Forms, not examples with real names: an answer that matched an example
    // read as the question said back.
    question: 'Write one command for what you want to do, in one of these forms: "merge THING into THING", "move THING out", "rename THING to NAME", "connect THING to THING as RELATION", "delete THING" (only what you made).',
    maxWords: 12
  }
};

/** Cycles an item a check refused stays off the menu. */
export const REFUSED_FOR = 24;

/** What identifies a menu item: its move and the Things it is about, in any order ("Dog and Cat" is "Cat and Dog"). */
export const itemKey = (move, it) => `${move.id}:${[...new Set([it.target, it.data?.id, it.data?.to, it.data?.at, it.data?.a, it.data?.b, it.data?.of].filter(Boolean))].sort().join(',')}`;

/** Slots kept for moves not shown lately, so the whole repertoire comes round. */
export const EXPLORE = 2;

/**
 * @param {Array} moves
 * @param {Object} ctx
 * @param {Object} [opts]
 * @param {string[]} [opts.recent]  keys of recently chosen items, newest last
 * @param {Object}   [opts.shown]   moveId → the tick it was last on the menu
 * @param {number}   [opts.tick]
 * @returns {Array<{ move, label, blank, data, key, score }>}
 */
export function buildMenu(moves, ctx, { recent = [], shown = {}, refused = {}, tick = 0, size = MENU_SIZE, explore = EXPLORE } = {}) {
  const items = [];
  for (const move of moves) {
    let offered = [];
    // A move that cannot offer from here is left out, but never silently:
    // a missing import once took weighing beliefs off every menu unnoticed.
    try { offered = move.offer(ctx) || []; } catch (err) { offered = []; (ctx.offerErrors ||= []).push(`${move.id}: ${err?.message || err}`); }
    for (const it of offered) {
      const key = itemKey(move, it);
      // A check said no to this, on these Things, lately: not offered again
      // yet. A Druid asked eight times in one run what Oak and Plank are both
      // kinds of, refused each time.
      if (refused[key] != null && tick - refused[key] < REFUSED_FOR) continue;
      const recency = recent.lastIndexOf(key);
      const penalty = recency < 0 ? 0 : 0.6 * (1 - (recent.length - 1 - recency) / Math.max(1, recent.length));
      // An item with no target gets little from activation. Scored as if its
      // target were half-active, "note a thought" sat on every menu.
      const act = it.target ? sigmoid(ctx.activation?.get(it.target) ?? -3) : 0.1;
      items.push({ move, label: it.label, blank: it.blank || null, data: it.data || {}, key, score: (it.prior ?? move.prior ?? 0.5) + 0.4 * act - penalty });
    }
  }
  const byScore = (a, b) => b.score - a.score || a.label.localeCompare(b.label);
  items.sort(byScore);

  const count = new Map();
  const menu = [];
  const take = (it) => { count.set(it.move.id, (count.get(it.move.id) || 0) + 1); menu.push(it); };
  const room = size - 1;
  const ranked = Math.max(1, room - explore);

  // Ranked slots: the best items, at most PER_MOVE per move.
  for (const it of items) {
    if (menu.length >= ranked) break;
    if ((count.get(it.move.id) || 0) >= PER_MOVE) continue;
    take(it);
  }
  // Exploration slots: moves not on the menu, least recently shown first.
  const lastShown = (id) => shown[id] ?? -Infinity;
  const fresh = items
    .filter(it => !count.has(it.move.id))
    .sort((a, b) => lastShown(a.move.id) - lastShown(b.move.id) || byScore(a, b));
  for (const it of fresh) {
    if (menu.length >= room) break;
    if (count.has(it.move.id)) continue;
    take(it);
  }
  // Anything left over fills by score.
  for (const it of items) {
    if (menu.length >= room) break;
    if (menu.includes(it) || (count.get(it.move.id) || 0) >= PER_MOVE) continue;
    take(it);
  }
  for (const it of menu) shown[it.move.id] = tick;
  menu.push({ move: OTHER, label: OTHER.label, blank: OTHER.blank, data: {}, key: 'other', score: -1 });
  return menu;
}

/** Words that point at a move, for the escape hatch. */
const HINTS = [
  [/\b(new web|start (a )?web|another web)\b/i, 'newWeb'],
  [/\b(describe|explain|define)\b/i, 'describe'],
  [/\b(connect|link|relate)\b/i, 'connect'],
  [/\b(open|inside|made of|parts?|break (it )?down)\b/i, 'open'],
  [/\b(go back|step out|outside|zoom out)\b/i, 'close'],
  [/\b(make|create|add)\b/i, 'make'],
  [/\b(forget|let go|drop)\b/i, 'letGo'],
  [/\b(note|remember|hold onto)\b/i, 'note']
];

/** Match free text from "something else" to an offered item, if one fits. */
export function matchOther(text, menu) {
  const t = String(text || '');
  for (const [re, moveId] of HINTS) {
    if (!re.test(t)) continue;
    const named = menu.find(m => m.move.id === moveId && t.toLowerCase().includes(String(m.label).split(' ').slice(-1)[0].toLowerCase()));
    const any = menu.find(m => m.move.id === moveId);
    if (named || any) return named || any;
  }
  return null;
}
