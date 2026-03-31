import React, { useState, useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
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

  useEffect(() => {
    if (!window.electron?.updater?.onUpdateReady) return;
    window.electron.updater.onUpdateReady((info) => {
      setUpdateInfo(info);
      requestAnimationFrame(() => setVisible(true));
    });
  }, []);

  if (!updateInfo || dismissed) return null;

  const handleRestart = () => {
    window.electron?.updater?.installUpdate();
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
          Restart to update
        </div>
      </div>
      <div className="update-toast-actions">
        <PanelIconButton
          icon={RotateCcw}
          size={15}
          onClick={handleRestart}
          title="Restart and install update"
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
