import { useCallback, useRef, useState } from 'react';

/**
 * useState whose setter does nothing when given the value it was last given.
 *
 * React's own same-value bailout is unreliable: once a component has rendered
 * from an update, setting the value it already holds can still re-run the
 * component (and throw the result away). In NodeCanvas that is a 1,000-hook
 * render, and effects that reset state on every selection change or pointer
 * release paid it each time (render sweep).
 *
 * "Last given" includes updates React hasn't rendered yet, so a skipped set
 * can't be undone by a pending one. Updater functions receive that value too.
 * Every write has to go through the returned setter.
 * @template T
 * @param {T | (() => T)} initial
 * @returns {[T, (next: T | ((prev: T) => T)) => void]}
 */
export function useTrackedState(initial) {
  const [value, setValue] = useState(initial);
  const lastRef = useRef(value);
  const set = useCallback((next) => {
    const v = typeof next === 'function' ? next(lastRef.current) : next;
    if (Object.is(v, lastRef.current)) return;
    lastRef.current = v;
    setValue(v);
  }, []);
  return [value, set];
}

export default useTrackedState;
