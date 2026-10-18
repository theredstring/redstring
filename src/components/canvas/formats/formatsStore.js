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

const NOTATION_KEY = 'redstring_formula_notation';
const CONVENTION_KEY = 'redstring_formula_convention';
const READING_KEY = 'redstring_formula_reading';
const readPref = (key, allowed, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
};
const writePref = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* the choice still holds for this session */ }
};

const useFormatsStore = create(() => ({
  /**
   * How formulas are shown: 'standard' math (mc², 4ac: multiplication side by
   * side and exponents raised, the default) or 'explicit' (m × c ^ 2, every
   * operation a token). A display preference of this browser's, not part of
   * the universe.
   */
  notation: readPref(NOTATION_KEY, ['standard', 'explicit'], 'standard'),
  /**
   * What a formula's terms are written as: 'symbols' (P V = n R T, the default)
   * or 'names' (Pressure × Volume = Amount of Substance × ...), each Thing by its
   * real name. Also a preference of this browser's.
   */
  reading: readPref(READING_KEY, ['symbols', 'names'], 'symbols'),
  /** How New Formula reads what is typed: 'math' (the default) or 'programming'. */
  convention: readPref(CONVENTION_KEY, ['math', 'programming'], 'math'),
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

export const setNotation = (notation) => {
  writePref(NOTATION_KEY, notation);
  useFormatsStore.setState({ notation });
};

export const setConvention = (convention) => {
  writePref(CONVENTION_KEY, convention);
  useFormatsStore.setState({ convention });
};

export const setReading = (reading) => {
  writePref(READING_KEY, reading);
  useFormatsStore.setState({ reading });
};

/** Whether formulas show in standard notation (a selector). */
export const selectStandard = (s) => s.notation !== 'explicit';
/** Whether formulas show their Things by name instead of by symbol (a selector). */
export const selectWords = (s) => s.reading === 'names';
/** How formulas are shown now, for code outside React. */
export const formulaDisplayNow = () => {
  const s = useFormatsStore.getState();
  return { standard: selectStandard(s), words: selectWords(s) };
};

export const openFormulaComposer = (graphId, at) => useFormatsStore.setState({ composing: { graphId, at } });
export const closeFormulaComposer = () => useFormatsStore.setState({ composing: null });

export default useFormatsStore;
