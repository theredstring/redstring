import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../hooks/useTheme.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import FileAccessModal from '../modals/FileAccessModal.jsx';

/**
 * The full-screen modals, openable on demand with stand-in data.
 *
 * DialogGallery's sibling. Those are the small decision dialogs on the shared
 * Dialog shell, and its tests hold every entry to that shell; these are the
 * larger CanvasModal frames (the same family as Settings, onboarding and
 * GitReconnectModal) that stand between someone and their universe. They only
 * appear when access has already been lost, so this is the way to look at one
 * without losing it.
 *
 * Nothing here touches a store, a file or the browser's permissions: every
 * handler closes the preview and notes which one fired.
 */

const FILE = { name: 'nerd.redstring', state: 'prompt', isSourceOfTruth: true };
const FOLDER = { name: 'Redstring', state: 'prompt' };
const LOAD_ERROR = 'Permission denied for local file access.';

/**
 * FileAccessModal with the Chrome tip and the desktop offer forced on, since
 * this page is often open in the desktop app, where neither would show.
 */
const fileAccess = (fire, { folder, file, loaded = false, errorMessage = null }) => (
  <FileAccessModal
    isVisible
    access={{ universeName: 'Nerd', folder, file }}
    loaded={loaded}
    errorMessage={errorMessage}
    onGrant={() => fire('onGrant')}
    onClose={() => fire('onClose')}
    onResolved={() => fire('onResolved')}
    onOpenUniverses={() => fire('onOpenUniverses')}
    showChromeTip
    offerDesktop
    onDownloadDesktop={() => fire('onDownloadDesktop')}
  />
);

const MODALS = [
  {
    key: 'file-access-load',
    name: 'File Access — couldn’t load',
    note: 'The browser closed and took back the workspace folder and the file this universe loads from.',
    render: (fire) => fileAccess(fire, { folder: FOLDER, file: FILE, errorMessage: LOAD_ERROR })
  },
  {
    key: 'file-access-second',
    name: 'File Access — one more click',
    note: 'The folder came back, but the browser wants its own answer for the file.',
    render: (fire) => fileAccess(fire, {
      folder: { ...FOLDER, state: 'granted' },
      file: FILE,
      errorMessage: LOAD_ERROR
    })
  },
  {
    key: 'file-access-saving',
    name: 'File Access — saving paused',
    note: 'Loaded from GitHub, but its local copy is locked, so nothing is being saved to it.',
    render: (fire) => fileAccess(fire, { folder: null, file: { ...FILE, isSourceOfTruth: false }, loaded: true })
  },
  {
    key: 'file-access-folder',
    name: 'File Access — folder only',
    note: 'The universe is fine, but the workspace folder new universes go into is locked.',
    render: (fire) => fileAccess(fire, { folder: FOLDER, file: null, loaded: true })
  },
  {
    key: 'file-access-blocked',
    name: 'File Access — blocked',
    note: 'Someone once told the browser no, so it refuses without asking.',
    render: (fire) => fileAccess(fire, {
      folder: { ...FOLDER, state: 'denied' },
      file: FILE,
      errorMessage: LOAD_ERROR
    })
  }
];

const ModalGallery = () => {
  const theme = useTheme();
  const [openKey, setOpenKey] = useState(null);
  const [lastAction, setLastAction] = useState({});

  const open = useMemo(() => MODALS.find((m) => m.key === openKey) || null, [openKey]);

  const fire = (handlerName) => {
    setLastAction((prev) => ({ ...prev, [openKey]: handlerName }));
    setOpenKey(null);
  };

  return (
    <div>
      {MODALS.map((modal) => (
        <div className="settings-row" key={modal.key}>
          <div className="settings-row-label">
            {modal.name}
            <div className="settings-row-description">
              {modal.note}
              {lastAction[modal.key] && (
                <span style={{ color: theme.canvas.textPrimary }}>
                  {' '}Last pressed: <strong>{lastAction[modal.key]}</strong>
                </span>
              )}
            </div>
          </div>
          <PanelIconButton
            label="Show"
            labelFontSize={11}
            variant="outline"
            onClick={() => setOpenKey(modal.key)}
            style={{ padding: '5px 12px', flexShrink: 0 }}
          />
        </div>
      ))}

      {open && typeof document !== 'undefined' && createPortal(
        // Settings is itself a full-screen CanvasModal at the same z-index
        // these use, so the preview takes a stacking context above it.
        <div style={{ position: 'relative', zIndex: 30000 }}>
          {open.render(fire)}
        </div>,
        document.body
      )}
    </div>
  );
};

export default ModalGallery;
