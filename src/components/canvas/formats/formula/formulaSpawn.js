/**
 * Formulas just built (New Formula, the bank), so the canvas plays their
 * entrance: the plus sign's morph into a Thing (PlusSign.jsx), grown into the
 * formula's band instead. A formula opened, loaded or switched to is already
 * there and just drawn. Kept as when it was built, so the object drawing it
 * picks the entrance up where it is, however often it mounts meanwhile; a mark
 * past its entrance (built into a web that isn't showing) lapses.
 */
export const SPAWN_MS = 640;
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
