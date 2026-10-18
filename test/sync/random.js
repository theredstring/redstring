/** Seeded randomness for the shared-universe tests (no store import: plain Node can load it). */

/** mulberry32: a small seeded random source. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (list) => (list.length ? list[Math.floor(next() * list.length)] : undefined),
    chance: (p) => next() < p
  };
}

/** Deterministic new IDs, unique per person (`ana-thing-3`). */
export function idSource(prefix) {
  let n = 0;
  return { next: (kind) => `${prefix}-${kind}-${++n}` };
}
