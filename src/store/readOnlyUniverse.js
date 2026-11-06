/**
 * A universe open read-only, from a shared link.
 *
 * While one is open nothing changes the document and nothing is saved:
 * graphStore's middleware keeps the document roots (`withDocumentKept`), and
 * SaveCoordinator and universeBackend refuse to write, the same places that
 * refuse during a load. Looking around still works: switching webs and tabs,
 * panning and zooming.
 *
 * `active` is { slug, name, sourceUrl }. `nudge` counts refused edits, so the
 * read-only bar can answer them. `failure` is a link that couldn't be opened:
 * { message, sourceUrl, atBoot }.
 */

import { create } from 'zustand';
import { PERSISTED_STORE_KEYS } from '../formats/redstringFormat.js';

/** Saved with the universe, but only where you are in it, or a preference. */
const NOT_THE_DOCUMENT = new Set([
  'openGraphIds',
  'activeGraphId',
  'activeDefinitionNodeId',
  'expandedGraphIds',
  'rightPanelTabs',
  'showConnectionNames',
]);

const DOCUMENT_ROOTS = PERSISTED_STORE_KEYS.filter((key) => !NOT_THE_DOCUMENT.has(key));

const useReadOnlyUniverse = create(() => ({ active: null, nudge: 0, failure: null }));

/** For useReadOnlyUniverse(selectReadOnlyOpen). */
export const selectReadOnlyOpen = (state) => state.active !== null;

export const isReadOnlyUniverseOpen = () => useReadOnlyUniverse.getState().active !== null;

export const setReadOnlyUniverse = (active) => {
  useReadOnlyUniverse.setState({ active, ...(active ? { failure: null } : {}) });
};

export const nudgeReadOnlyUniverse = () => {
  useReadOnlyUniverse.setState((state) => ({ nudge: state.nudge + 1 }));
};

export const setReadOnlyFailure = (failure) => useReadOnlyUniverse.setState({ failure });

/**
 * `next` with the document as it is in `prev`.
 * @param {object} prev - The whole state before the write.
 * @param {object} next - What the write returned: a partial or the whole state.
 * @returns {{ state: object, refused: boolean }}
 */
export function withDocumentKept(prev, next) {
  let state = next;
  let refused = false;
  for (const key of DOCUMENT_ROOTS) {
    if (!next || !Object.prototype.hasOwnProperty.call(next, key) || next[key] === prev[key]) continue;
    if (!refused) state = { ...next };
    refused = true;
    state[key] = prev[key];
  }
  return { state, refused };
}

export default useReadOnlyUniverse;
