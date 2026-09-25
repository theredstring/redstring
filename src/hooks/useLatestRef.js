import { useLayoutEffect, useRef } from 'react';

/**
 * A ref that always holds the latest committed `value` (P3.02). For handlers
 * handed to memoized children that ignore function props (Node's comparator
 * does): the child keeps its first closure, and that closure reads through this
 * ref, so it never runs a stale render's function (B-05).
 * @template T
 * @param {T} value
 * @returns {{ current: T }}
 */
export function useLatestRef(value) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
