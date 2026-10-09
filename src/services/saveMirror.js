/**
 * The save worker's copy of the universe, kept up to date by changes.
 *
 * Structured-cloning a big universe into the save worker on every save was
 * most of what saving cost the main thread (about 0.4 s at 32,000 Things). So
 * the worker keeps a copy: the first message carries the whole state, and
 * later ones carry only the entries of the big collections whose identity
 * changed. The store's objects are immutable (immer), so identity is change.
 *
 * The coordinator builds messages with createSaveMirrorSender(); the worker
 * applies them with applySaveMessage().
 */

/** Collections sent as changes; everything else is sent whole each time (it's small). */
export const MIRRORED_KEYS = ['nodePrototypes', 'graphs', 'edges', 'edgePrototypes'];

/**
 * Apply a message to the worker's copy.
 *
 * @param {Object|null} current - the copy, or null when the worker has none
 * @param {Object} message - { full, state } or { delta, rest }
 * @returns {Object|null} the updated copy, or null when a change list arrived with no copy
 */
export function applySaveMessage(current, { full, state, delta, rest }) {
  if (full) return { ...state };
  if (!current) return null;
  for (const key of MIRRORED_KEYS) {
    const change = delta?.[key];
    if (!change) continue;
    if (!(current[key] instanceof Map)) current[key] = new Map();
    for (const [id, value] of change.set) current[key].set(id, value);
    for (const id of change.del) current[key].delete(id);
  }
  Object.assign(current, rest);
  return current;
}

/**
 * Builds the messages the coordinator posts, remembering what the worker
 * holds. reset() makes the next message whole: call it whenever the worker
 * may have lost or garbled its copy (new worker, error, stall).
 *
 * @param {Function} [prepare] - (key, value) → value as sent (e.g. stripping images)
 */
export function createSaveMirrorSender(prepare = (key, value) => value) {
  let sent = null; // { slug, maps: { key: the store Map last sent } }

  const prepareMap = (key, map) => {
    const out = new Map();
    if (map instanceof Map) for (const [id, value] of map) out.set(id, prepare(key, value));
    return out;
  };

  return {
    /**
     * @param {Object} state - the persisted keys of the store, plus anything
     *   else the export reads (passed through whole)
     * @returns {Object} the message body: { full: true, state } or { full: false, delta, rest }
     */
    build(state) {
      const rest = {};
      for (const key of Object.keys(state)) if (!MIRRORED_KEYS.includes(key)) rest[key] = state[key];

      const slug = state._universeSlug ?? null;
      const canDiff = sent && sent.slug === slug && MIRRORED_KEYS.every((key) => state[key] instanceof Map || state[key] == null);
      if (!canDiff) {
        const whole = { ...rest };
        for (const key of MIRRORED_KEYS) whole[key] = prepareMap(key, state[key]);
        sent = { slug, maps: Object.fromEntries(MIRRORED_KEYS.map((key) => [key, state[key]])) };
        return { full: true, state: whole };
      }

      const delta = {};
      for (const key of MIRRORED_KEYS) {
        const before = sent.maps[key];
        const after = state[key];
        if (before === after) continue;
        const set = [];
        const del = [];
        if (after instanceof Map) {
          for (const [id, value] of after) {
            if (!(before instanceof Map) || before.get(id) !== value) set.push([id, prepare(key, value)]);
          }
        }
        if (before instanceof Map) {
          for (const id of before.keys()) if (!(after instanceof Map) || !after.has(id)) del.push(id);
        }
        delta[key] = { set, del };
      }
      sent = { slug, maps: Object.fromEntries(MIRRORED_KEYS.map((key) => [key, state[key]])) };
      return { full: false, delta, rest };
    },
    reset() { sent = null; },
    get holdsCopy() { return sent !== null; },
  };
}
