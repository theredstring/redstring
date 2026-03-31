import React, { useState, useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
import PanelIconButton from './shared/PanelIconButton.jsx';
import { useTheme } from '../hooks/useTheme.js';

/**
 * UpdateToast — bottom-right notification shown when an Electron auto-update
 * has been downloaded and is ready to install.
 */
export default function UpdateToast() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    if (!window.electron?.updater?.onUpdateReady) return;
    window.electron.updater.onUpdateReady((info) => {
      setUpdateInfo(info);
      // Trigger slide-in on next frame
      requestAnimationFrame(() => setVisible(true));
    });
  }, []);

  if (!updateInfo || dismissed) return null;

  const handleRestart = () => {
    window.electron?.updater?.installUpdate();
  };

  const handleDismiss = () => {
    setVisible(false);
    // Wait for slide-out animation before unmounting
    setTimeout(() => setDismissed(true), 250);
  };

  const containerStyle = {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 10,
    backgroundColor: theme.darkMode ? '#1a1616' : '#f5f0f0',
    border: `1px solid ${theme.canvas.border}`,
    boxShadow: theme.darkMode
      ? '0 4px 20px rgba(0,0,0,0.5)'
      : '0 4px 20px rgba(0,0,0,0.15)',
    transform: visible ? 'translateY(0)' : 'translateY(calc(100% + 30px))',
    opacity: visible ? 1 : 0,
    transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
    fontFamily: "'EmOne', sans-serif",
    pointerEvents: 'auto',
  };

  const textStyle = {
    fontSize: 13,
    fontWeight: 600,
    color: theme.canvas.textPrimary,
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  const versionStyle = {
    fontSize: 11,
    color: theme.canvas.textSecondary,
    marginLeft: 2,
  };

  return (
    <div style={containerStyle}>
      <span style={textStyle}>
        Restart to Update
        {updateInfo.version && (
          <span style={versionStyle}>v{updateInfo.version}</span>
        )}
      </span>
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
  );
}
