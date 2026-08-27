import useGraphStore from './graphStore.js';
import useHistoryStore from './historyStore.js';

/**
 * @module historyActions
 * @description The single entry point for undo/redo.
 *
 * The keyboard shortcut, the Edit menu and the history panel each used to call
 * `undo(applyPatches)` directly, which meant every one of them was missing the
 * same two steps: closing an in-progress coalesced edit, and following the change
 * to the graph it actually affects.
 */

/**
 * Closes any edit still being accumulated (a rename mid-typing, a colour drag)
 * so it lands as its own entry before we rewind.
 *
 * Without this, the open batch flushes *after* the rewind, carrying inverse
 * patches generated against state that no longer exists — and its truncation
 * clobbers the redo that was just created.
 */
const flushPending = () => {
  useGraphStore.getState().flushHistory?.();
};

/**
 * Brings the graph an entry belongs to into view before applying it.
 *
 * Undo is a single global timeline, so without this, Cmd+Z while looking at one
 * graph can silently rewrite a different one with no visible feedback — the
 * failure most likely to be experienced as "undo corrupted my data".
 *
 * Global entries (prototypes, cross-graph edits) have no single home, so they
 * are applied wherever the user is.
 */
const navigateToEntry = (entry) => {
  const graphId = entry?.graphId;
  if (!graphId) return;

  const store = useGraphStore.getState();
  if (store.activeGraphId === graphId) return;
  if (!store.graphs.has(graphId)) return; // deleted since; nothing to show

  if (!store.openGraphIds.includes(graphId)) store.openGraphTab(graphId);
  else store.setActiveGraphTab(graphId);
};

/** The entry a plain undo would apply next, or null. */
const peekUndoEntry = () => {
  const { history, currentIndex } = useHistoryStore.getState();
  return history[history.length + currentIndex] ?? null;
};

/** The entry a plain redo would apply next, or null. */
const peekRedoEntry = () => {
  const { history, currentIndex } = useHistoryStore.getState();
  return history[history.length + currentIndex + 1] ?? null;
};

export const performUndo = () => {
  flushPending();
  const { undo, canUndo } = useHistoryStore.getState();
  if (!canUndo()) return false;

  navigateToEntry(peekUndoEntry());
  undo(useGraphStore.getState().applyPatches);
  return true;
};

export const performRedo = () => {
  flushPending();
  const { redo, canRedo } = useHistoryStore.getState();
  if (!canRedo()) return false;

  navigateToEntry(peekRedoEntry());
  redo(useGraphStore.getState().applyPatches);
  return true;
};

/** Steps to an absolute point in the timeline (history panel click). */
export const performJumpTo = (targetIndex) => {
  flushPending();
  const { jumpTo, history } = useHistoryStore.getState();
  navigateToEntry(history[targetIndex]);
  jumpTo(targetIndex, useGraphStore.getState().applyPatches);
};
