/**
 * The formats feature: the session's own state, and showing a format.
 *
 * Which groups are shown as a format is saved, on the group (`group.format`,
 * e.g. 'formula'), so it survives a reload, syncs, and undoes like any group
 * edit. A dismissed offer is not saved: it comes back next session.
 */
import { create } from 'zustand';
import useGraphStore from '../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../../constants.js';

const useFormatsStore = create(() => ({
  /** Offer keys the user waved off this session (see formatCandidates). */
  dismissed: new Set(),
  /** The "New Formula" composer: { graphId, at: {x, y} } in canvas coordinates, or null. */
  composing: null,
}));

export const dismissFormatOffer = (key) => useFormatsStore.setState((s) => {
  if (s.dismissed.has(key)) return s;
  const dismissed = new Set(s.dismissed);
  dismissed.add(key);
  return { dismissed };
});

/**
 * Show a candidate as its format, in place. A group is marked; a selection or
 * a whole web first becomes a group (named after its formula), since the
 * format lives on a group.
 */
export function showFormatInPlace(candidate) {
  const store = useGraphStore.getState();
  if (candidate.source === 'group') {
    store.updateGroup(candidate.graphId, candidate.sourceId, (g) => { g.format = candidate.format; });
    return candidate.sourceId;
  }
  return store.createGroup(candidate.graphId, {
    name: candidate.text,
    color: NODE_DEFAULT_COLOR,
    memberInstanceIds: candidate.instanceIds,
    format: candidate.format,
  });
}

/** Show a group as its Things again. */
export function showAsThings(graphId, groupId) {
  useGraphStore.getState().updateGroup(graphId, groupId, (g) => { delete g.format; });
}

export const openFormulaComposer = (graphId, at) => useFormatsStore.setState({ composing: { graphId, at } });
export const closeFormulaComposer = () => useFormatsStore.setState({ composing: null });

export default useFormatsStore;
