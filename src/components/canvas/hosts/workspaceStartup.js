import { getStorageKey } from '../../../utils/storageUtils.js';

/**
 * Start-up when the workspace folder is valid but its config names no active
 * universe (WorkspaceService's SELECT_UNIVERSE).
 *
 * On iOS and Android that is every launch after onboarding: the folder is the
 * app's own Universes/, always there, and nothing writes `activeUniverse` into
 * its config. The universe the person was in lives in universeBackend's
 * registry instead, and the backend opens it on its own. Treating the status as
 * "nothing to open" used to send every mobile launch to the Universes tab and
 * mark the canvas loaded-empty in front of a universe still on its way.
 *
 * So the Universes grid is only forced when the backend has nothing to open.
 *
 * @param {object} deps
 * @param {{ setStorageMode: Function, setUniverseConnected: Function,
 *   setUniverseLoaded: Function, setLeftPanelExpanded: Function }} deps.storeActions
 * @param {(view: string) => void} deps.openLeftPanelView
 * @param {(visible: boolean) => void} deps.setShowStorageSetupModal
 * @param {() => (object|null|Promise<object|null>)} [deps.getActiveUniverse]
 *   The backend's active universe. Its registry is restored synchronously when
 *   the module loads, so this needs no wait for `initialize()`.
 * @returns {Promise<{ openedUniverses: boolean }>}
 */
export async function startSelectUniverse({
  storeActions,
  openLeftPanelView,
  setShowStorageSetupModal,
  getActiveUniverse = defaultGetActiveUniverse,
}) {
  storeActions.setStorageMode('folder');
  storeActions.setUniverseConnected(true);
  setShowStorageSetupModal(false); // Close setup modal if it was accidentally opened

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(getStorageKey('redstring-welcome-seen'), 'true');
    } catch { /* storage unavailable */ }
  }

  let active = null;
  try {
    active = await getActiveUniverse();
  } catch {
    active = null;
  }

  // A universe to reopen: the backend loads it, as on desktop. Marking the
  // canvas loaded-empty here would clear its loading screen (and any load
  // error) before it arrives.
  if (active) return { openedUniverses: false };

  // Nothing to reopen: let them pick one.
  storeActions.setUniverseLoaded(true, false);
  storeActions.setLeftPanelExpanded(true);
  openLeftPanelView('federation');
  return { openedUniverses: true };
}

async function defaultGetActiveUniverse() {
  const { default: universeBackend } = await import('../../../services/universeBackend.js');
  return universeBackend.getActiveUniverse?.() || null;
}
