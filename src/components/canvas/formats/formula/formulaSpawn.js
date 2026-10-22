/**
 * Formulas coming in and going out.
 *
 * Just built (New Formula, the bank): the canvas plays their entrance, the
 * plus sign's morph into a Thing (PlusSign.jsx), grown into the formula's band
 * instead. A formula opened, loaded or switched to is already there and just
 * drawn. Kept as when it was built, so the object drawing it picks the
 * entrance up where it is, however often it mounts meanwhile; a mark past its
 * entrance (built into a web that isn't showing) lapses.
 *
 * Just deleted: what was drawn is kept a moment, to play the entrance
 * backwards (its tokens leaving right to left, then its band shrinking away),
 * since the store no longer has it to draw. Combined into its Thing, the band
 * shrinks onto that node instead (condenseFormula).
 */
export const SPAWN_MS = 640;
export const LEAVE_MS = 480;
const marks = new Map();

/** Say a formula's group was just built. */
export function markFormulaSpawn(groupId) {
  if (groupId) marks.set(groupId, performance.now());
}

/** When a formula's group was built, while its entrance is still playing; else null. */
export function formulaSpawnStart(groupId) {
  const at = marks.get(groupId);
  if (at === undefined) return null;
  if (performance.now() - at > SPAWN_MS) { marks.delete(groupId); return null; }
  return at;
}

const NONE = [];
let leaving = NONE;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());

/**
 * Keep a formula's drawing (a formulaObjects object) to play its exit, from
 * now. Gone again once it has played. Returns `{ into(rect) }`, to aim the
 * exit at a node's painted background ({ x, y, w, h, r, color }, world
 * coordinates) rather than at nothing.
 */
export function markFormulaLeaving(obj) {
  if (!obj) return null;
  const start = performance.now();
  const mine = (l) => l.obj === obj && l.start === start;
  leaving = [...leaving.filter(l => l.obj.groupId !== obj.groupId), { obj, start, into: null }];
  emit();
  setTimeout(() => {
    if (!leaving.some(mine)) return;
    const rest = leaving.filter(l => !mine(l));
    leaving = rest.length ? rest : NONE;
    emit();
  }, LEAVE_MS + 40);
  return {
    into(rect) {
      leaving = leaving.map(l => (mine(l) ? { ...l, into: rect } : l));
      emit();
    },
  };
}

/** The formulas playing their exit: { obj, start, into }[]. */
export const leavingFormulasNow = () => leaving;

export function subscribeLeavingFormulas(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
