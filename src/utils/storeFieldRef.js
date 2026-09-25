/**
 * A ref-shaped view of one store field: `.current` reads the field and writing
 * `.current` sets it. Writing the value it already has does nothing, as writing
 * a ref didn't: no store notification, so no subscriber runs for it. For state that moved from a NodeCanvas ref into a store
 * (P5.02b) while its call sites still read and write `.current`.
 *
 * @param {{ getState: Function, setState: Function }} store  a zustand store
 * @param {string} key
 * @returns {{ current: any }}
 */
export function storeFieldRef(store, key) {
  return {
    get current() { return store.getState()[key]; },
    set current(value) {
      if (Object.is(store.getState()[key], value)) return;
      store.setState({ [key]: value });
    },
  };
}
