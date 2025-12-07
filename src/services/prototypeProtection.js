import useGraphStore from '../store/graphStore.jsx';

/**
 * Mark a set of prototype IDs as protected from cleanup.
 */
export function markPrototypesProtected(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  useGraphStore.setState((state) => {
    const next = new Set(state.protectedPrototypeIds || []);
    ids.forEach((id) => next.add(id));
    return { protectedPrototypeIds: next };
  });
}
