/**
 * Recency — what the Druid did and where it was, lately, the way a person
 * remembers the last few minutes better than the last hour.
 *
 * Two through lines run alongside each other:
 *
 *   the phonological loop   the last few thoughts, verbatim (life.js)
 *   the recency trail       the last few places and deeds, built by code from
 *                           what actually happened: went to a web, looked at a
 *                           Thing, made it, connected it. Newest first, each
 *                           with how long ago, fading out after a while.
 *
 * And the view carries recency on the graph itself: Things and connections
 * touched lately are marked "just now" or "3 moments ago". The trail cannot go
 * stale and cannot be parroted into a false summary: a prose through line once
 * said "I am after the wood to build the floor" for 22 moments while the Druid
 * was working on screwdrivers.
 */

/** Moments after which a trail entry or a recency mark has faded. */
export const TRAIL_FADES = 24;
/** Moments within which a Thing or connection is marked as recent in the view. */
export const MARK_WITHIN = 12;
/** Trail entries kept, and shown. */
export const TRAIL_KEEP = 12;
export const TRAIL_SHOW = 6;

export const lastUse = (world, id) => Math.max(-Infinity, ...(world.druidOf(id).uses || []));

/** "just now", "3 moments ago", or '' once faded. */
export function ago(tick, t, within = TRAIL_FADES) {
  const n = tick - t;
  if (!Number.isFinite(n) || n < 0 || n > within) return '';
  if (n <= 1) return 'just now';
  return `${n} moments ago`;
}

/** A Thing's recency mark for the view: " (just now)", " (4 moments ago)", or ''. */
export function recencyMark(world, id, tick) {
  const a = ago(tick, lastUse(world, id), MARK_WITHIN);
  return a ? ` (${a})` : '';
}

/**
 * Add what a moment did to the trail: where it went (a new web, a new focus)
 * and, if it changed the universe, what it did. Consecutive visits to the same
 * place collapse into one.
 */
export function extendTrail(trail, { tick, before, after, webName, focusName, wrote, summary }) {
  const out = [...(trail || [])];
  const push = (e) => {
    const last = out[out.length - 1];
    if (last && last.kind === 'went' && e.kind === 'went' && last.text === e.text) { last.tick = e.tick; return; }
    out.push(e);
  };
  if (after?.web && after.web !== before?.web && webName) push({ tick, kind: 'went', text: `went to the web ${webName}`, web: after.web });
  else if (after?.focus && after.focus !== before?.focus && focusName && !wrote) push({ tick, kind: 'went', text: `looked at ${focusName}`, web: after.web });
  if (wrote && summary) push({ tick, kind: 'did', text: summary, web: after?.web });
  return out.slice(-TRAIL_KEEP);
}

/** The trail for the prompt: newest first, with how long ago, faded entries left out. */
export function renderTrail(trail, tick) {
  const shown = (trail || []).filter(e => ago(tick, e.tick) !== '').slice(-TRAIL_SHOW).reverse();
  if (!shown.length) return '';
  return `What you did lately, newest first:\n${shown.map(e => `- ${ago(tick, e.tick)}: ${e.text}`).join('\n')}`;
}

/** Webs visited lately, newest first: for marking "Other webs" in the view. */
export function recentWebs(trail, tick) {
  const out = new Map();
  for (const e of [...(trail || [])].reverse()) {
    if (e.web && !out.has(e.web) && ago(tick, e.tick) !== '') out.set(e.web, e.tick);
  }
  return out;
}
