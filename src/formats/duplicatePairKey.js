/**
 * The key identifying a pair of things in `mergeDismissals`.
 *
 * FROZEN once shipped. These keys are written into .redstring files, so a
 * change to the shape silently un-dismisses every pair a user has already
 * ruled on — they would be asked again about things they said were different,
 * which is the exact complaint dismissal-persistence exists to answer.
 *
 * Ids are sorted so the key does not depend on which side the scan happened to
 * pick as survivor. That choice depends on use counts, which change as the
 * universe is edited, so an unsorted key would not be stable across sessions.
 *
 * It lives in formats/ rather than beside the scanner because it is a
 * persisted-format concern: the scanner is free to change how it finds pairs,
 * but not how a ruled-on pair is named on disk.
 */
export function duplicatePairKey(id1, id2) {
  return String(id1) < String(id2) ? `${id1}|${id2}` : `${id2}|${id1}`;
}

/** Split a key back into its two ids. */
export function splitDuplicatePairKey(key) {
  const parts = String(key || '').split('|');
  return parts.length === 2 ? parts : null;
}
