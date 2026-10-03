/**
 * Activation — how likely each Thing is to be needed now.
 *
 * Borrowed from ACT-R's declarative memory, whose activation equation was
 * derived as an estimate of exactly this (Anderson's rational analysis): a
 * memory's odds of being needed follow how often and how recently it was used.
 *
 *   base level   B = ln Σ (now − t_j + 1)^−d      over its uses t_j, d = 0.5
 *   spread       S = Σ_sources W · s_link / fan    from what is in mind
 *   activation   A = B + S
 *
 * Time is counted in cycles, not seconds, so a paused Druid does not forget
 * and a test is deterministic. Uses are written onto the Thing itself
 * (`semanticMetadata.druid.uses`) and activation is always computed, never
 * stored: the record of use is the evidence, the number is derived.
 *
 * Hebbian association lives here too. Things that are in mind together get a
 * stronger link (`druid.assoc`), which spreads activation like a connection
 * does; unused links fade. A strong association is what later proposes a
 * chunk.
 */

import { buildMemoryIndex } from './recall.js';

export const DECAY = 0.5;
export const MAX_USES = 20;
export const NO_USE = -3;          // base level of a Thing never used

export const ASSOC_STEP = 0.2;      // gain per co-activation
export const ASSOC_FADE = 0.97;     // per cycle since last reinforced
export const ASSOC_FLOOR = 0.05;    // below this a link is forgotten
export const MAX_ASSOC = 12;        // strongest links kept per Thing

/** Record that a Thing was used this cycle. */
export function recordUse(world, protoId, tick) {
  world.setDruid(protoId, (d) => {
    const uses = Array.isArray(d.uses) ? d.uses : [];
    if (uses[uses.length - 1] === tick) return d;
    return { ...d, uses: [...uses, tick].slice(-MAX_USES) };
  });
}

/** Base-level activation from use times. */
export function baseLevel(uses, tick, d = DECAY) {
  if (!Array.isArray(uses) || uses.length === 0) return NO_USE;
  let sum = 0;
  for (const t of uses) sum += Math.pow(Math.max(1, tick - t + 1), -d);
  return Math.log(sum);
}

/** An association's strength now, faded since it was last reinforced. */
export function assocStrength(entry, tick) {
  if (!entry) return 0;
  return entry.s * Math.pow(ASSOC_FADE, Math.max(0, tick - (entry.t ?? tick)));
}

/**
 * Strengthen the links between Things that were in mind together.
 * @param {string[]} ids
 */
export function associate(world, ids, tick) {
  const unique = [...new Set(ids)].filter(id => world.proto(id));
  if (unique.length < 2) return;
  for (const id of unique) {
    world.setDruid(id, (d) => {
      const assoc = { ...(d.assoc || {}) };
      for (const other of unique) {
        if (other === id) continue;
        const now = assocStrength(assoc[other], tick);
        assoc[other] = { s: Math.min(1, now + ASSOC_STEP), t: tick };
      }
      const kept = Object.entries(assoc)
        .map(([k, v]) => [k, v, assocStrength(v, tick)])
        .filter(([, , s]) => s >= ASSOC_FLOOR)
        .sort((a, b) => b[2] - a[2])
        .slice(0, MAX_ASSOC);
      return { ...d, assoc: Object.fromEntries(kept.map(([k, v]) => [k, v])) };
    });
  }
}

/**
 * Activation of every Thing.
 *
 * @param {Object} world
 * @param {Object} opts
 * @param {number} opts.tick
 * @param {Array<{ id: string, weight: number }>} opts.sources   what is in mind (focus, held, goals)
 * @param {Object} [opts.index]   a memory index, if already built this cycle
 * @returns {{ activation: Map<string, number>, index: Object }}
 */
export function computeActivation(world, { tick, sources = [], index = null }) {
  const idx = index || buildMemoryIndex(world.state());
  const activation = new Map();
  for (const id of world.allThings()) {
    activation.set(id, baseLevel(world.druidOf(id).uses, tick));
  }

  for (const { id, weight } of sources) {
    if (!world.proto(id)) continue;
    const graphLinks = [...(idx.links.get(id) || new Map()).keys()].map(other => [other, 1]);
    const assoc = Object.entries(world.druidOf(id).assoc || {}).map(([other, e]) => [other, assocStrength(e, tick)]);
    const all = [...graphLinks, ...assoc].filter(([other]) => activation.has(other) && other !== id);
    const fan = Math.max(1, all.length);
    for (const [other, s] of all) {
      activation.set(other, activation.get(other) + (weight * s * 2) / Math.sqrt(fan));
    }
  }
  return { activation, index: idx };
}

/** The `k` most active of the given ids. */
export function mostActive(activation, ids, k) {
  return [...ids]
    .filter(id => activation.has(id))
    .sort((a, b) => activation.get(b) - activation.get(a))
    .slice(0, k);
}
