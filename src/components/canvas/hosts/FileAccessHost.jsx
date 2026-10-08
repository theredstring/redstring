import { useCallback, useEffect, useRef } from 'react';
import FileAccessModal from '../../modals/FileAccessModal.jsx';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import {
  readFileAccess,
  grantFileAccess,
  fileAccessNeeded,
  isGoogleChrome
} from '../../../services/fileAccessRecovery.js';
import { canOfferDesktopDownload, openDesktopDownload } from '../../../utils/desktopDownload.js';

const ui = () => useCanvasUIStore.getState();

// How long to let a load settle before looking. Boot runs several resolution
// passes back to back, and the handle states only mean something after them.
const SETTLE_MS = 400;

/**
 * Opens FileAccessModal whenever the browser has locked the workspace folder
 * or the active universe's file, whether or not that stopped the load.
 *
 * Looks once each time a load settles. Permission can only be lost by the
 * browser closing Redstring, so that is the only moment it changes under us.
 * Closing the modal is "not now" for the rest of the session; the canvas error
 * card (UniverseScreens) reopens it, as does `redstring:open-file-access`.
 *
 * Lives in UniverseHost, which hides the Git reconnect modal while this one is
 * up and does not offer it at all when the load failed on a locked local file.
 */
function FileAccessHost({ suppressed = false }) {
  const isUniverseLoading = useGraphStore(s => s.isUniverseLoading);
  const isUniverseLoaded = useGraphStore(s => s.isUniverseLoaded);
  const universeLoadingError = useGraphStore(s => s.universeLoadingError);
  const access = useCanvasUIStore(s => s.fileAccess);
  const open = useCanvasUIStore(s => s.fileAccessOpen);
  const dismissedRef = useRef(false);

  const look = useCallback(async ({ force = false } = {}) => {
    const next = await readFileAccess();
    if (fileAccessNeeded(next)) {
      ui().setFileAccess(next);
      if (force || !dismissedRef.current) ui().setFileAccessOpen(true);
    } else if (!ui().fileAccessOpen) {
      // Left up when open, so the rows can be seen flipping to Allowed.
      ui().setFileAccess(null);
    }
  }, []);

  useEffect(() => {
    if (isUniverseLoading) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) look().catch((e) => console.warn('[FileAccess] Check failed:', e));
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isUniverseLoading, isUniverseLoaded, universeLoadingError, look]);

  useEffect(() => {
    const onOpen = () => look({ force: true }).catch(() => {});
    window.addEventListener('redstring:open-file-access', onOpen);
    return () => window.removeEventListener('redstring:open-file-access', onOpen);
  }, [look]);

  // The load failed because of the file only when the file is where the
  // universe loads from. A Git universe that failed with the folder locked
  // gets this modal for the folder and the Git modal for the load.
  const loadFailed = !!universeLoadingError && !!access?.file?.isSourceOfTruth;

  const onGrant = async () => {
    const next = await grantFileAccess();
    ui().setFileAccess(next);
    if (fileAccessNeeded(next)) return; // a second click, or blocked: the modal says which
    if (useGraphStore.getState().universeLoadingError && next.file?.isSourceOfTruth) {
      const { default: universeBackend } = await import('../../../services/universeBackend.js');
      await universeBackend.retryActiveUniverseLoad();
    }
  };

  const close = () => {
    dismissedRef.current = true;
    ui().setFileAccessOpen(false);
  };

  return (
    <FileAccessModal
      isVisible={open && !!access && !suppressed}
      onClose={close}
      onResolved={() => {
        ui().setFileAccessOpen(false);
        ui().setFileAccess(null);
      }}
      access={access}
      loaded={!loadFailed}
      errorMessage={universeLoadingError}
      onGrant={onGrant}
      onOpenUniverses={() => {
        close();
        useGraphStore.getState().setLeftPanelExpanded(true);
        ui().openLeftPanelView('federation');
      }}
      showChromeTip={isGoogleChrome()}
      offerDesktop={canOfferDesktopDownload()}
      onDownloadDesktop={openDesktopDownload}
    />
  );
}

export default FileAccessHost;
