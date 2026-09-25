/**
 * Restoring the last universe when the canvas mounts (moved verbatim from
 * NodeCanvas).
 */
import useGraphStore from '../../../store/graphStore.js';

/** Try to restore the universe; returns the effect's cleanup, if any. */
export function restoreUniverseOnMount(ctx) {
  const { storeActions } = ctx;
  const tryUniverseRestore = async () => {
    try {
      // Wait for backend to finish loading if it's in progress
      // Check if backend has already loaded data
      const currentState = useGraphStore.getState();
      const hasBackendLoadedData = currentState.nodePrototypes &&
        (currentState.nodePrototypes instanceof Map ? currentState.nodePrototypes.size > 0 : Object.keys(currentState.nodePrototypes).length > 0);

      if (hasBackendLoadedData) {
        // console.log('[NodeCanvas] Backend already loaded universe data, skipping old fileStorage restore');
        // Backend has loaded data, don't try old restore path
        return;
      }

      // Wait a moment for backend to load if universe-backend-ready event hasn't fired yet
      if (typeof window !== 'undefined' && !window._universeBackendReady) {
        // console.log('[NodeCanvas] Waiting for universe backend to finish loading...');
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 2000); // Max wait 2 seconds
          const handler = () => {
            clearTimeout(timeout);
            window.removeEventListener('universe-backend-ready', handler);
            resolve();
          };
          window.addEventListener('universe-backend-ready', handler);
        });
      }

      // Check again after waiting
      const stateAfterWait = useGraphStore.getState();
      const hasDataAfterWait = stateAfterWait.nodePrototypes &&
        (stateAfterWait.nodePrototypes instanceof Map ? stateAfterWait.nodePrototypes.size > 0 : Object.keys(stateAfterWait.nodePrototypes).length > 0);

      if (hasDataAfterWait) {
        // console.log('[NodeCanvas] Backend loaded universe data while waiting, skipping old restore');
        return;
      }

      // Do not run legacy restore fallback here; allow backend to finalize hydration.
      // Onboarding modal will appear if no universe is loaded.
    } catch (error) {

      storeActions.setUniverseError(`Universe restore failed: ${error.message}`);
    }
  };

  tryUniverseRestore();
}
