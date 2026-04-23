import React, { useState, useEffect } from 'react';
import { RotateCcw, ExternalLink, X } from 'lucide-react';
import PanelIconButton from './shared/PanelIconButton.jsx';
import './UpdateToast.css';

/**
 * UpdateToast — bottom-right notification for Electron auto-update lifecycle.
 * Shows as soon as a release is detected (not just when fully downloaded), so
 * a stalled download doesn't silently hide the fact that an update exists.
 */
export default function UpdateToast() {
  const [updateInfo, setUpdateInfo] = useState(null);
  // 'available' | 'downloading' | 'downloaded' | 'install-failed'
  const [downloadStatus, setDownloadStatus] = useState('available');
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!window.electron?.updater) return;

    const show = () => requestAnimationFrame(() => setVisible(true));

    window.electron.updater.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
      setDownloadStatus((prev) => (prev === 'downloaded' ? prev : 'available'));
      show();
    });

    window.electron.updater.onDownloadProgress?.((data) => {
      setProgress(typeof data?.percent === 'number' ? data.percent : 0);
      setDownloadStatus((prev) => (prev === 'downloaded' ? prev : 'downloading'));
    });

    window.electron.updater.onUpdateReady((info) => {
      setUpdateInfo(info);
      setDownloadStatus('downloaded');
      show();
    });

    // Error payload is { phase: 'download' | 'install', message }. Only
    // install-phase errors change the UI — download errors are treated as
    // transient and ignored so a fresh retry can still produce a working
    // refresh button.
    window.electron.updater.onError?.((payload) => {
      const phase = typeof payload === 'object' && payload ? payload.phase : 'install';
      if (phase === 'install') {
        setDownloadStatus('install-failed');
      }
    });

    window.electron.updater.checkPending?.().then((info) => {
      if (!info) return;
      setUpdateInfo({ version: info.version, releaseName: info.releaseName });
      setDownloadStatus(info.status === 'downloaded' ? 'downloaded' : 'available');
      show();
    });
  }, []);

  if (!updateInfo || dismissed) return null;

  const isInstallFailed = downloadStatus === 'install-failed';
  const isReady = downloadStatus === 'downloaded';

  const handleAction = () => {
    if (isInstallFailed) {
      window.electron?.updater?.openReleases?.();
    } else if (isReady) {
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

  let subtitle;
  if (isInstallFailed) {
    subtitle = 'Download from GitHub';
  } else if (isReady) {
    subtitle = 'Restart to update';
  } else if (downloadStatus === 'downloading' && progress > 0) {
    subtitle = `Downloading… ${Math.round(progress)}%`;
  } else {
    subtitle = 'Downloading…';
  }

  return (
    <div className={className}>
      <div className="update-toast-text">
        <div className="update-toast-title">
          Version {updateInfo.version || 'update'} released
        </div>
        <div className="update-toast-subtitle">
          {subtitle}
        </div>
      </div>
      <div className="update-toast-actions">
        <PanelIconButton
          icon={isInstallFailed ? ExternalLink : RotateCcw}
          size={15}
          color="#DEDADA"
          onClick={handleAction}
          disabled={!isReady && !isInstallFailed}
          title={
            isInstallFailed
              ? 'Download update'
              : isReady
                ? 'Restart and install update'
                : 'Downloading update…'
          }
          variant="outline"
          style={{ borderColor: 'rgba(222, 218, 218, 0.4)' }}
        />
        <PanelIconButton
          icon={X}
          size={15}
          color="#DEDADA"
          onClick={handleDismiss}
          title="Dismiss"
          variant="ghost"
        />
      </div>
    </div>
  );
}
