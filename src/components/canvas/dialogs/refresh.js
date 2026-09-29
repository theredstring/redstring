/**
 * Refreshing Redstring, from anywhere that offers it: the header's hamburger
 * column, the Redstring menu's File → Refresh and the canvas menu. Every one of
 * them asks first (`requestRefresh`); the dialog in CanvasOverlaysHost reloads
 * on confirm.
 */
import useGraphStore from '../../../store/graphStore.js';
import saveCoordinator from '../../../services/SaveCoordinator.js';
import { setRefreshDialog } from './canvasDialogs.js';

/** Open the "refresh Redstring?" confirmation. */
export function requestRefresh() {
  setRefreshDialog({ requestedAt: Date.now() });
}

/** Same rule as the header's bookmark button: the web's defining Thing is saved. */
const isWebBookmarked = (state, graph) => {
  const definingNodeId = graph?.definingNodeIds?.[0];
  return definingNodeId ? state.savedNodeIds.has(definingNodeId) : false;
};

/**
 * What the dialog says: the open webs that aren't bookmarked (kept only while
 * their tab is open, so the cleanup that follows a tab closing can remove
 * them), and whether changes are still on their way to storage.
 */
export function describeRefresh() {
  const state = useGraphStore.getState();
  const unbookmarkedWebs = [];
  for (const graphId of state.openGraphIds || []) {
    const graph = state.graphs.get(graphId);
    if (!graph || isWebBookmarked(state, graph)) continue;
    unbookmarkedWebs.push(graph.name?.trim() || 'Untitled web');
  }
  let stillSaving = false;
  try {
    stillSaving = saveCoordinator.isSaving === true || saveCoordinator.hasUnsavedChanges() === true;
  } catch { /* no coordinator yet: nothing to lose */ }
  return { unbookmarkedWebs, stillSaving };
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function listWebNames(names, max = 3) {
  const quoted = names.map((n) => `"${n}"`);
  if (quoted.length <= 1) return quoted.join('');
  if (quoted.length <= max) return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  const rest = quoted.length - max;
  return `${quoted.slice(0, max).join(', ')} and ${rest} more`;
}

/** Reload the app. The dialog's confirm. */
export function refreshNow() {
  window.location.reload();
}
