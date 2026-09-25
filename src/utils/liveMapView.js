/**
 * A read-only Map view that reads `getMap()` on every call (P3.01).
 *
 * For a component that must not re-render on every write to a large store Map,
 * but whose callbacks and hooks read entries it doesn't render: they always see
 * the current Map, never a snapshot. The component decides when the view's
 * identity changes (a useMemo keyed on what it actually renders), which is
 * what memos and effects keyed on the view react to.
 * @template K, V
 * @param {() => Map<K, V>} getMap
 */
export function createLiveMapView(getMap) {
  return {
    get: (key) => getMap().get(key),
    has: (key) => getMap().has(key),
    get size() { return getMap().size; },
    forEach: (fn, thisArg) => getMap().forEach(fn, thisArg),
    keys: () => getMap().keys(),
    values: () => getMap().values(),
    entries: () => getMap().entries(),
    [Symbol.iterator]: () => getMap()[Symbol.iterator](),
  };
}
