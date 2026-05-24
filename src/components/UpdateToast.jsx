import React, { useState, useEffect, useRef } from 'react';
import { RotateCcw, ExternalLink, X, Info } from 'lucide-react';
import PanelIconButton from './shared/PanelIconButton.jsx';
import UpdateDiagnosticsCard from './UpdateDiagnosticsCard.jsx';
import './UpdateToast.css';

const MAX_DOWNLOAD_FAILS_BEFORE_ESCALATE = 3;
const FAILED_INSTALL_THRESHOLD = 2;

/**
 * UpdateToast — bottom-right notification for Electron auto-update lifecycle.
 * Shows as soon as a release is detected (not just when fully downloaded), so
 * a stalled download doesn't silently hide the fact that an update exists.
 */
export default function UpdateToast() {
  const [updateInfo, setUpdateInfo] = useState(null);
  // 'available' | 'downloading' | 'downloaded' | 'download-failed-retrying' | 'install-failed' | 'install-failed-multi'
  const [downloadStatus, setDownloadStatus] = useState('available');
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [toastHeight, setToastHeight] = useState(0);
  const toastRef = useRef(null);

  useEffect(() => {
    if (!window.electron?.updater) return;

    const show = () => requestAnimationFrame(() => setVisible(true));

    window.electron.updater.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
      setDownloadStatus((prev) => (prev === 'downloaded' ? prev : 'available'));
      setDismissed(false);
      show();
    });

    window.electron.updater.onDownloadProgress?.((data) => {
      setProgress(typeof data?.percent === 'number' ? data.percent : 0);
      setDownloadStatus((prev) => (prev === 'downloaded' ? prev : 'downloading'));
    });

    window.electron.updater.onUpdateReady?.((info) => {
      setUpdateInfo({ version: info.version, releaseName: info.releaseName });
      const failedCount = info.failedInstallCount || 0;
      if (failedCount >= FAILED_INSTALL_THRESHOLD) {
        setDownloadStatus('install-failed-multi');
      } else {
        setDownloadStatus('downloaded');
      }
      show();
    });

    // Receive ALL error phases now. Download errors used to be silently
    // discarded; we now surface them so a wedged updater is visible.
    window.electron.updater.onError?.((payload) => {
      const phase = typeof payload === 'object' && payload ? payload.phase : 'install';
      if (phase === 'install') {
        setDownloadStatus('install-failed');
      } else if (phase === 'download') {
        const escalated = payload?.escalated || payload?.downloadFails >= MAX_DOWNLOAD_FAILS_BEFORE_ESCALATE;
        setDownloadStatus(escalated ? 'install-failed-multi' : 'download-failed-retrying');
      }
    });

    window.electron.updater.onOpenDiagnostics?.(() => {
      // Menu-triggered: ensure toast is visible so the card has its anchor.
      setDismissed(false);
      show();
      setDiagnosticsOpen(true);
    });

    window.electron.updater.checkPending?.().then((info) => {
      if (!info) return;
      setUpdateInfo({ version: info.version, releaseName: info.releaseName });
      const failedCount = info.failedInstallCount || 0;
      if (info.status === 'downloaded' && failedCount >= FAILED_INSTALL_THRESHOLD) {
        setDownloadStatus('install-failed-multi');
      } else if (info.status === 'downloaded') {
        setDownloadStatus('downloaded');
      } else {
        setDownloadStatus('available');
      }
      show();
    });
  }, []);

  // Track toast height so the diagnostics card can position above it.
  useEffect(() => {
    if (!toastRef.current) {
      setToastHeight(0);
      return;
    }
    setToastHeight(toastRef.current.offsetHeight);
  }, [updateInfo, downloadStatus, visible]);

  if (!updateInfo || dismissed) {
    // Standalone diagnostics (menu-triggered with no active update info)
    if (diagnosticsOpen) {
      return (
        <UpdateDiagnosticsCard
          isOpen
          anchorBottom={16}
          onClose={() => setDiagnosticsOpen(false)}
        />
      );
    }
    return null;
  }

  const isInstallFailed = downloadStatus === 'install-failed' || downloadStatus === 'install-failed-multi';
  const isReady = downloadStatus === 'downloaded';
  const isDownloadRetrying = downloadStatus === 'download-failed-retrying';
  const isMultiFail = downloadStatus === 'install-failed-multi';

  const handleAction = () => {
    if (isInstallFailed || isMultiFail) {
      window.electron?.updater?.openReleases?.();
    } else if (isReady) {
      window.electron?.updater?.installUpdate();
    }
  };

  const handleDismiss = () => {
    setDismissing(true);
    setVisible(false);
    setDiagnosticsOpen(false);
    setTimeout(() => setDismissed(true), 250);
  };

  const className = [
    'update-toast',
    visible && 'visible',
    dismissing && 'dismissing',
    isInstallFailed && 'update-toast--failed',
    isDownloadRetrying && 'update-toast--retry',
  ].filter(Boolean).join(' ');

  let subtitle;
  if (isMultiFail) {
    subtitle = 'Install keeps failing — download manually';
  } else if (isInstallFailed) {
    subtitle = 'Install failed — download from GitHub';
  } else if (isReady) {
    subtitle = 'Restart to update';
  } else if (isDownloadRetrying) {
    subtitle = 'Download failed, retrying…';
  } else if (downloadStatus === 'downloading' && progress > 0) {
    subtitle = `Downloading… ${Math.round(progress)}%`;
  } else {
    subtitle = 'Downloading…';
  }

  const actionIcon = (isInstallFailed || isMultiFail) ? ExternalLink : RotateCcw;
  const actionEnabled = isReady || isInstallFailed || isMultiFail;
  const actionTitle = (isInstallFailed || isMultiFail)
    ? 'Download update from GitHub'
    : isReady
      ? 'Restart and install update'
      : 'Downloading update…';

  return (
    <>
      <div className={className} ref={toastRef}>
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
            icon={actionIcon}
            size={15}
            color="#DEDADA"
            onClick={handleAction}
            disabled={!actionEnabled}
            title={actionTitle}
            variant="outline"
            style={{ borderColor: 'rgba(222, 218, 218, 0.4)' }}
          />
          <PanelIconButton
            icon={Info}
            size={15}
            color="#DEDADA"
            onClick={() => setDiagnosticsOpen((v) => !v)}
            title={diagnosticsOpen ? 'Hide diagnostics' : 'Show update diagnostics'}
            variant="ghost"
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
      <UpdateDiagnosticsCard
        isOpen={diagnosticsOpen}
        anchorBottom={toastHeight > 0 ? toastHeight + 32 : 16}
        onClose={() => setDiagnosticsOpen(false)}
      />
    </>
  );
}
