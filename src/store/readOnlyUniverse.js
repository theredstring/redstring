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
 * While a universe is open read-only, the only load it takes is its own: stamped
 * for it by the switch that opened it. A file, a late reload of the universe left
 * behind, anything unstamped: none of them lands under the read-only flag.
 */
export const readOnlyRefusesLoad = (data) => {
  const { active } = useReadOnlyUniverse.getState();
  return active !== null && data?._universeSlug !== active.slug;
};

/**
 * What a write comes to while the document is kept. One that would change the
 * document is refused whole: the rest of it (going to the web it would have
 * made, say) only makes sense if the edit happened.
 * @param {object} prev - The whole state before the write.
 * @param {object} next - What the write returned: a partial or the whole state.
 * @returns {{ state: object, refused: boolean }}
 */
export function withDocumentKept(prev, next) {
  const refused = !!next && DOCUMENT_ROOTS.some((key) => (
    Object.prototype.hasOwnProperty.call(next, key) && next[key] !== prev[key]
  ));
  return { state: refused ? prev : next, refused };
}

export default useReadOnlyUniverse;
