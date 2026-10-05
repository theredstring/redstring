/**
 * Working memory as a web — what the Druid is holding in mind.
 *
 * The context window is only the phonological loop: verbatim, short, cleared
 * freely. What the Druid is actually holding lives here, in a web of its own
 * named "Working Memory", whose instances are the Things in mind. Holding a
 * Thing is placing it there; letting it go is removing the placement. The
 * Thing itself is never touched, because working memory holds pointers into
 * long-term memory, not copies — which is why it cannot hold something that
 * does not exist.
 *
 * Deterministic throughout:
 *   - capacity is counted in items (~4), not tokens: a chunk is one item
 *     however large its inside, which is what chunking buys
 *   - each item's hold fades every cycle; using it refreshes it; below the
 *     floor it falls out
 *   - scratch items are half-formed thoughts, Things that exist only here; one
 *     that falls out without being promoted is deleted
 *   - letting go drops an item now; inhibiting it keeps recall from bringing it
 *     back for a while
 *   - a restart fades everything sharply (waking), except open goals
 *
 * Hold strength lives on the Thing (`druid.wm = { a, since }`).
 */

export const CAPACITY = 4;
export const FADE = 0.75;
export const FLOOR = 0.2;
export const WAKE_FADE = 0.3;

const WM_KEY = 'wm';

/** A copy of an object without one key. */
const without = (obj, key) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => k !== key));

export function wmWeb(world) {
  return world.systemWeb(WM_KEY, 'Working Memory', 'What the Druid is holding in mind right now.');
}

/** Things held, strongest first: [{ id, a, scratch }] */
export function held(world) {
  const web = wmWeb(world);
  return world.thingsIn(web)
    .map(id => ({ id, a: world.druidOf(id).wm?.a ?? 0, scratch: world.druidOf(id).role === 'scratch' }))
    .sort((x, y) => y.a - x.a);
}

function release(world, id) {
  const web = wmWeb(world);
  world.unplace(web, id);
  const d = world.druidOf(id);
  if (d.role === 'scratch') {
    // A half-formed thought that was never promoted is gone.
    world.forget(id);
    return;
  }
  world.setDruid(id, (x) => without(x, 'wm'));
}

/** Hold a Thing (or refresh it). Evicts the weakest if over capacity. Returns ids evicted. */
export function hold(world, id, tick) {
  if (!world.proto(id)) return [];
  const web = wmWeb(world);
  world.place(web, id);
  world.setDruid(id, (d) => ({ ...d, wm: { a: 1, since: d.wm?.since ?? tick } }));
  const items = held(world);
  const evicted = [];
  while (items.length > CAPACITY) {
    const weakest = items.filter(i => i.id !== id).sort((x, y) => x.a - y.a)[0];
    if (!weakest) break;
    release(world, weakest.id);
    evicted.push(weakest.id);
    items.splice(items.indexOf(weakest), 1);
  }
  return evicted;
}

/** One cycle passes: every hold fades; what falls below the floor drops out. Returns ids dropped. */
export function fade(world, factor = FADE) {
  const dropped = [];
  for (const item of held(world)) {
    const a = item.a * factor;
    if (a < FLOOR) {
      release(world, item.id);
      dropped.push(item.id);
    } else {
      world.setDruid(item.id, (d) => ({ ...d, wm: { ...(d.wm || {}), a } }));
    }
  }
  return dropped;
}

/** Let a Thing go now. With `inhibitFor`, recall will not bring it back for that many cycles. */
export function letGo(world, id, tick, inhibitFor = 0) {
  release(world, id);
  if (inhibitFor > 0 && world.proto(id)) world.setDruid(id, { inhibitedUntil: tick + inhibitFor });
}

export function isInhibited(world, id, tick) {
  return (world.druidOf(id).inhibitedUntil ?? -1) > tick;
}

/** A half-formed thought: a Thing that exists only in working memory until promoted. */
export async function scratch(world, text, tick) {
  const web = wmWeb(world);
  const r = await world.createThing(web, text, { description: 'A half-formed thought.' });
  if (!r.ok) return r;
  world.setDruid(r.id, { role: 'scratch', createdAt: tick });
  hold(world, r.id, tick);
  return r;
}

/** Make a scratch thought permanent: place it in a long-term web. */
export function promote(world, id, targetWeb) {
  if (!world.proto(id) || !world.graph(targetWeb)) return false;
  world.place(targetWeb, id);
  world.setDruid(id, (d) => (d.role === 'scratch' ? without(d, 'role') : d));
  return true;
}

/** Waking after a restart: most of what was held fades; open goals stay. */
export function wake(world, isOpenGoal = () => false) {
  for (const item of held(world)) {
    if (isOpenGoal(item.id)) continue;
    const a = item.a * WAKE_FADE;
    if (a < FLOOR) release(world, item.id);
    else world.setDruid(item.id, (d) => ({ ...d, wm: { ...(d.wm || {}), a } }));
  }
}

/** Rendered for the prompt. */
export function renderHeld(world) {
  const items = held(world);
  if (items.length === 0) return 'Held in mind: nothing.';
  return `Held in mind:\n${items.map(i => `- ${world.nameOf(i.id)}${i.scratch ? ' (a half-formed thought)' : ''}`).join('\n')}`;
}
