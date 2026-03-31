import React, { useState, useEffect } from 'react';
import { RotateCcw, ExternalLink, X } from 'lucide-react';
import PanelIconButton from './shared/PanelIconButton.jsx';
import './UpdateToast.css';

/**
 * UpdateToast — bottom-right notification shown when an Electron auto-update
 * has been downloaded and is ready to install.
 */
export default function UpdateToast() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);

  useEffect(() => {
    if (!window.electron?.updater) return;

    // Listen for new update-downloaded events
    window.electron.updater.onUpdateReady((info) => {
      setUpdateInfo(info);
      requestAnimationFrame(() => setVisible(true));
    });

    // Listen for updater errors (e.g. code signature validation failure on unsigned builds)
    window.electron.updater.onError?.(() => {
      setInstallFailed(true);
    });

    // Check if an update was already downloaded before this mount (e.g. after page refresh)
    window.electron.updater.checkPending?.().then((info) => {
      if (info) {
        setUpdateInfo(info);
        requestAnimationFrame(() => setVisible(true));
      }
    });
  }, []);

  if (!updateInfo || dismissed) return null;

  const handleRestart = () => {
    if (installFailed) {
      window.electron?.updater?.openReleases?.();
    } else {
      window.electron?.updater?.installUpdate();
    }
  };

  const handleDismiss = () => {
    setDismissing(true);
    setVisible(false);
    setTimeout(() => setDismissed(true), 250);
  };

  const className = [
    'update-toast',
    visible && 'visible',
    dismissing && 'dismissing',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <div className="update-toast-text">
        <div className="update-toast-title">
          Version {updateInfo.version || 'update'} released
        </div>
        <div className="update-toast-subtitle">
          {installFailed ? 'Download from GitHub' : 'Restart to update'}
        </div>
      </div>
      <div className="update-toast-actions">
        <PanelIconButton
          icon={installFailed ? ExternalLink : RotateCcw}
          size={15}
          onClick={handleRestart}
          title={installFailed ? 'Download update' : 'Restart and install update'}
          variant="outline"
        />
        <PanelIconButton
          icon={X}
          size={15}
          onClick={handleDismiss}
          title="Dismiss"
          variant="ghost"
        />
      </div>
    </div>
  );
}
