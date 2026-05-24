import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Trash2, FileText, ExternalLink, X } from 'lucide-react';
import PanelIconButton from './shared/PanelIconButton.jsx';
import './UpdateDiagnosticsCard.css';

/**
 * UpdateDiagnosticsCard — popover above UpdateToast (or standalone bottom-right)
 * surfacing the full updater state so wedged installs can be diagnosed and
 * recovered without spelunking the filesystem.
 */
export default function UpdateDiagnosticsCard({ isOpen, anchorBottom = 16, onClose }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'check' | 'clear' | 'log'
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [statusLine, setStatusLine] = useState(null);

  const refresh = useCallback(async () => {
    if (!window.electron?.updater?.getDiagnostics) return;
    try {
      const data = await window.electron.updater.getDiagnostics();
      setDiagnostics(data);
    } catch (err) {
      setStatusLine(`Could not load diagnostics: ${err?.message || err}`);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    if (window.electron?.updater?.onDiagnosticsUpdated) {
      window.electron.updater.onDiagnosticsUpdated((payload) => {
        if (payload) setDiagnostics(payload);
        else refresh();
      });
    }
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const handleCheck = async () => {
    setBusy('check');
    setStatusLine(null);
    try {
      const res = await window.electron?.updater?.checkNow?.();
      if (res?.ok === false) {
        setStatusLine(`Check failed: ${res.error || 'unknown'}`);
      } else {
        setStatusLine('Check started.');
      }
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const handleClear = async () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setBusy('clear');
    setStatusLine(null);
    try {
      const res = await window.electron?.updater?.clearCache?.();
      if (res?.ok === false) {
        setStatusLine(`Clear failed: ${res.error || 'unknown'}`);
      } else if (res?.removedPaths?.length) {
        setStatusLine(`Cleared ${res.removedPaths.length} path(s).`);
      } else {
        setStatusLine('Nothing to clear.');
      }
    } finally {
      setBusy(null);
      setConfirmingClear(false);
      refresh();
    }
  };

  const handleOpenLog = async () => {
    setBusy('log');
    setStatusLine(null);
    try {
      const res = await window.electron?.updater?.openLog?.();
      if (res?.ok === false) setStatusLine(`Open log failed: ${res.error || 'unknown'}`);
    } finally {
      setBusy(null);
    }
  };

  const handleOpenReleases = () => {
    window.electron?.updater?.openReleases?.();
  };

  const formatTime = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  const renderFailedCounts = () => {
    const counts = diagnostics?.persistedState?.failedInstallCount;
    if (!counts || Object.keys(counts).length === 0) return '—';
    return Object.entries(counts)
      .map(([v, n]) => `${v}: ${n}`)
      .join(', ');
  };

  const squirrel = diagnostics?.squirrel;

  return (
    <div className="update-diagnostics-card" style={{ bottom: anchorBottom }}>
      <div className="update-diagnostics-card-header">
        <div className="update-diagnostics-card-title">Update Diagnostics</div>
        <PanelIconButton
          icon={X}
          size={14}
          color="#DEDADA"
          onClick={onClose}
          title="Close diagnostics"
          variant="ghost"
        />
      </div>

      <div className="update-diagnostics-card-body">
        <Section label="App">
          <Row k="Version" v={diagnostics?.appVersion || '—'} />
          <Row k="Platform" v={diagnostics?.platform || '—'} />
          <Row k="Packaged" v={String(!!diagnostics?.isPackaged)} />
        </Section>

        <Section label="Update state">
          <Row
            k="Available"
            v={diagnostics?.availableUpdateInfo?.version || '—'}
          />
          <Row
            k="Downloaded"
            v={diagnostics?.pendingUpdateInfo?.version || '—'}
          />
          <Row
            k="Last download at"
            v={formatTime(diagnostics?.persistedState?.lastDownloadedAt)}
          />
          <Row k="Failed installs" v={renderFailedCounts()} />
          <Row
            k="Last preflight"
            v={diagnostics?.persistedState?.lastPreflightOutcome || '—'}
          />
        </Section>

        {squirrel ? (
          <Section label="Squirrel (macOS)">
            <Row k="State file" v={squirrel.stateFileExists ? '✓ exists' : '✗ missing'} />
            <Row
              k="Bundle URL"
              v={squirrel.parsedUpdateBundleURL || '—'}
              monospace
            />
            <Row
              k="Bundle exists"
              v={squirrel.parsedUpdateBundleURL ? (squirrel.updateBundleExists ? '✓ yes' : '✗ NO') : '—'}
              highlight={squirrel.parsedUpdateBundleURL && !squirrel.updateBundleExists}
            />
            <Row k="Cache dir" v={squirrel.cacheDirExists ? '✓ exists' : '✗ missing'} />
          </Section>
        ) : (
          <Section label="Squirrel">
            <Row k="Status" v="N/A on this platform" />
          </Section>
        )}

        <Section label="Log">
          <Row
            k="Path"
            v={diagnostics?.logFilePath || '—'}
            monospace
          />
        </Section>

        {statusLine && (
          <div className="update-diagnostics-card-status">{statusLine}</div>
        )}
      </div>

      <div className="update-diagnostics-card-actions">
        <PanelIconButton
          icon={RefreshCw}
          size={14}
          color="#DEDADA"
          onClick={handleCheck}
          disabled={busy === 'check'}
          title="Check for updates now"
          variant="outline"
          style={{ borderColor: 'rgba(222, 218, 218, 0.4)' }}
        />
        <PanelIconButton
          icon={Trash2}
          size={14}
          color={confirmingClear ? '#F44336' : '#DEDADA'}
          onClick={handleClear}
          disabled={busy === 'clear'}
          title={confirmingClear ? 'Click again to confirm cache clear' : 'Clear update cache'}
          variant="outline"
          style={{ borderColor: confirmingClear ? 'rgba(244, 67, 54, 0.6)' : 'rgba(222, 218, 218, 0.4)' }}
        />
        <PanelIconButton
          icon={FileText}
          size={14}
          color="#DEDADA"
          onClick={handleOpenLog}
          disabled={busy === 'log'}
          title="Open log file"
          variant="outline"
          style={{ borderColor: 'rgba(222, 218, 218, 0.4)' }}
        />
        <PanelIconButton
          icon={ExternalLink}
          size={14}
          color="#DEDADA"
          onClick={handleOpenReleases}
          title="Open GitHub releases"
          variant="outline"
          style={{ borderColor: 'rgba(222, 218, 218, 0.4)' }}
        />
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="update-diagnostics-card-section">
      <div className="update-diagnostics-card-section-label">{label}</div>
      <div className="update-diagnostics-card-section-rows">{children}</div>
    </div>
  );
}

function Row({ k, v, monospace, highlight }) {
  return (
    <div className={`update-diagnostics-card-row${highlight ? ' update-diagnostics-card-row--highlight' : ''}`}>
      <span className="update-diagnostics-card-row-k">{k}</span>
      <span className={`update-diagnostics-card-row-v${monospace ? ' update-diagnostics-card-row-v--mono' : ''}`}>{v}</span>
    </div>
  );
}
