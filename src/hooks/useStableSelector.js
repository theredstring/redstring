import { useCallback, useRef } from 'react';

/**
 * Select a derived value from a zustand store, keeping the previous result
 * while `isEqual(previous, next)` holds (P2.08, P2.10).
 *
 * For values derived from Maps that get replaced on unrelated writes: graphs is
 * a new Map on every node move, so a selector that builds a list from it would
 * otherwise return a new array, and re-render its component, every frame.
 * (zustand/traditional's useStoreWithEqualityFn does this too, but needs the
 * use-sync-external-store package, which this project doesn't install.)
 *
 * Pass a module-level `selector` and `isEqual` so they are stable.
 * @template S, T
 * @param {(selector: (state: S) => T) => T} useStore
 * @param {(state: S) => T} selector
 * @param {(a: T, b: T) => boolean} isEqual
 * @returns {T}
 */
export function useStableSelector(useStore, selector, isEqual) {
  const last = useRef(null);
  return useStore(useCallback((state) => {
    const next = selector(state);
    if (last.current && isEqual(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  }, [selector, isEqual]));
}

const shallowRecordEqual = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
};

/**
 * `state[field]` (a plain object keyed by id) narrowed to `ids`, keeping its
 * identity while those entries are unchanged (P3.01). A write for any other id
 * doesn't re-render the caller.
 * @param {Function} useStore
 * @param {string} field
 * @param {Iterable<string>} ids  memoize it; a new iterable re-runs the pick
 */
export function usePickedEntries(useStore, field, ids) {
  const last = useRef(null);
  return useStore(useCallback((state) => {
    const src = state[field] || {};
    const next = {};
    for (const id of ids) if (src[id] !== undefined) next[id] = src[id];
    if (last.current && shallowRecordEqual(last.current, next)) return last.current;
    last.current = next;
    return next;
  }, [field, ids]));
}

/** Same length and the same elements, by identity. */
export const shallowArrayEqual = (a, b) => a === b
  || (a.length === b.length && a.every((x, i) => Object.is(x, b[i])));

/** Same length, and each pair of elements equal on `keys`. */
export const arrayOfRecordsEqual = (keys) => (a, b) => a === b
  || (a.length === b.length && a.every((x, i) => keys.every((k) => Object.is(x[k], b[i][k]))));
