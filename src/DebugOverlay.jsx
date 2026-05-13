import React, { useState, useEffect, useCallback } from 'react';
import './DebugOverlay.css';
import { HEADER_HEIGHT, PANEL_CLOSE_ICON_SIZE } from './constants';
import { X, RefreshCw } from 'lucide-react';

/**
 * On-screen debug panel. Mobile-friendly (touch drag, viewport-clamped).
 *
 * Two render modes, chosen by debugData shape:
 *  - `debugData._sync` present → structured sync-engine diagnostics with
 *    action buttons (retry, force-save, refresh) wired via `actions` prop.
 *    Used to debug "Awaiting sync engine forever" on mobile, where devtools
 *    aren't easily accessible.
 *  - otherwise → generic key/value dump (legacy debug usage).
 */
const DebugOverlay = ({ debugData, hideOverlay, actions = null }) => {
  const clampPosition = useCallback((x, y, w, h) => ({
    x: Math.max(8, Math.min(x, (window.innerWidth || 1024) - Math.min(w, window.innerWidth - 16))),
    y: Math.max(HEADER_HEIGHT + 4, Math.min(y, (window.innerHeight || 768) - 80)),
  }), []);

  const initialWidth = Math.min(420, Math.max(280, (window.innerWidth || 400) - 24));
  const initialHeight = Math.min(560, (window.innerHeight || 600) - HEADER_HEIGHT - 80);
  const initialX = Math.max(8, (window.innerWidth || 1024) - initialWidth - 12);
  const initialY = HEADER_HEIGHT + 8;

  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [dragOffset, setDragOffset] = useState(null);
  const [resizeStart, setResizeStart] = useState(null);

  // Unified pointer-based drag — works for mouse + touch + pen.
  const startDrag = (e) => {
    const point = e.touches ? e.touches[0] : e;
    setDragOffset({ x: point.clientX - position.x, y: point.clientY - position.y });
    e.preventDefault();
  };

  useEffect(() => {
    if (!dragOffset) return;
    const move = (e) => {
      const point = e.touches ? e.touches[0] : e;
      const next = clampPosition(point.clientX - dragOffset.x, point.clientY - dragOffset.y, size.width, size.height);
      setPosition(next);
      if (e.cancelable) e.preventDefault();
    };
    const end = () => setDragOffset(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, [dragOffset, size.width, size.height, clampPosition]);

  const startResize = (e) => {
    e.stopPropagation();
    const point = e.touches ? e.touches[0] : e;
    setResizeStart({ x: point.clientX, y: point.clientY, width: size.width, height: size.height });
    e.preventDefault();
  };

  useEffect(() => {
    if (!resizeStart) return;
    const move = (e) => {
      const point = e.touches ? e.touches[0] : e;
      setSize({
        width: Math.max(240, resizeStart.width + (point.clientX - resizeStart.x)),
        height: Math.max(120, resizeStart.height + (point.clientY - resizeStart.y)),
      });
      if (e.cancelable) e.preventDefault();
    };
    const end = () => setResizeStart(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, [resizeStart]);

  const isSyncMode = debugData && typeof debugData === 'object' && debugData._sync;

  return (
    <div
      className="debug-overlay"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        width: `${size.width}px`,
        height: `${size.height}px`,
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        color: '#EFE8E5',
        padding: '10px 14px 14px',
        fontFamily: 'monospace',
        fontSize: '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20000,
        borderRadius: '10px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
        touchAction: 'none',
      }}
    >
      {/* Drag handle */}
      <div
        className="drag-handle"
        style={{
          width: '60px',
          height: '6px',
          backgroundColor: '#EFE8E5',
          borderRadius: '3px',
          margin: '2px auto 8px',
          cursor: 'grab',
          touchAction: 'none',
          flexShrink: 0,
        }}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      {/* Title bar */}
      <div style={{
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        padding: '4px 6px',
        marginBottom: '8px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <strong>{isSyncMode ? 'Sync Diagnostics' : 'Debug Mode'}</strong>
        <button
          onClick={hideOverlay}
          style={{
            background: 'none',
            border: 'none',
            color: '#EFE8E5',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="Close debug overlay"
        >
          <X size={PANEL_CLOSE_ICON_SIZE} />
        </button>
      </div>

      {/* Action buttons (sync mode) */}
      {isSyncMode && actions && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 10,
          flexShrink: 0,
        }}>
          {actions.onRetrySyncEngine && (
            <button
              onClick={actions.onRetrySyncEngine}
              style={diagButtonStyle}
            >
              <RefreshCw size={12} />
              Retry sync engine
            </button>
          )}
          {actions.onForceSave && (
            <button
              onClick={actions.onForceSave}
              style={diagButtonStyle}
            >
              Force save now
            </button>
          )}
          {actions.onClearGitHubAppCache && (
            <button
              onClick={actions.onClearGitHubAppCache}
              style={{ ...diagButtonStyle, backgroundColor: '#3a1500', borderColor: '#c75200' }}
              title="Wipe stored GitHub App installation data so next sync attempt uses OAuth instead. One-shot — server may re-populate on reload."
            >
              Clear App cache (one-shot)
            </button>
          )}
          {actions.onDirectGitHubProbe && (
            <button
              onClick={actions.onDirectGitHubProbe}
              style={{ ...diagButtonStyle, backgroundColor: '#003a15', borderColor: '#2dbb5a' }}
              title="Direct GitHub API probe with each cached token. Bypasses the sync engine entirely. The verdict line tells you whether the failure is server-side (token), network-layer (Private Relay/proxy), or engine-level (stale token)."
            >
              Direct GitHub probe
            </button>
          )}
          {actions.onDumpAuthState && (
            <button
              onClick={actions.onDumpAuthState}
              style={{ ...diagButtonStyle, backgroundColor: '#001a3a', borderColor: '#3a78c7' }}
              title="Dump live auth state to the action log: cached install ID, App account, repo grant (with live check against GitHub), OAuth user identity, and active universe's linked repo. Tells you whether the failure is install-grant, account-mismatch, or universe-config."
            >
              Dump auth state
            </button>
          )}
          {actions.onRefresh && (
            <button
              onClick={actions.onRefresh}
              style={diagButtonStyle}
            >
              Refresh
            </button>
          )}
        </div>
      )}

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {isSyncMode ? <SyncDiagnostics data={debugData} /> : <GenericDebug data={debugData} />}
      </div>

      {/* Resize handle */}
      <div
        className="resize-handle"
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '24px',
          height: '24px',
          cursor: 'se-resize',
          touchAction: 'none',
          background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.25) 50%)',
          borderBottomRightRadius: 10,
        }}
        onMouseDown={startResize}
        onTouchStart={startResize}
      />
    </div>
  );
};

const diagButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px',
  backgroundColor: '#260000',
  color: '#EFE8E5',
  border: '1px solid #7A0000',
  borderRadius: 14,
  fontFamily: 'monospace',
  fontSize: 11,
  cursor: 'pointer',
};

const SectionRow = ({ label, value, mono = true }) => (
  <div style={{ display: 'flex', gap: 6, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
    <span style={{ color: '#9aa', minWidth: 110, flexShrink: 0 }}>{label}</span>
    <span style={{
      color: '#EFE8E5',
      wordBreak: 'break-all',
      fontFamily: mono ? 'monospace' : 'inherit',
    }}>
      {value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
    </span>
  </div>
);

const Section = ({ title, children, tone = '#66d9ef', headerExtra = null }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
      <div style={{ color: tone, fontWeight: 'bold' }}>{title}</div>
      {headerExtra}
    </div>
    {children}
  </div>
);

const SyncDiagnostics = ({ data }) => {
  const { _sync, device, auth, universe, engine, saveCoordinator, lastActions, _meta } = data;
  return (
    <div>
      {_meta?.notice && (
        <div style={{
          padding: '6px 8px',
          marginBottom: 8,
          backgroundColor: 'rgba(255, 200, 0, 0.12)',
          border: '1px solid rgba(255, 200, 0, 0.4)',
          borderRadius: 4,
          color: '#FFD479',
        }}>{_meta.notice}</div>
      )}

      <Section title="Device">
        <SectionRow label="userAgent" value={device?.userAgent} />
        <SectionRow label="isMobile" value={device?.isMobile} />
        <SectionRow label="isTouch" value={device?.isTouch} />
        <SectionRow label="hasFileAccess" value={device?.hasFileAccess} />
        <SectionRow label="isGitOnlyMode" value={device?.isGitOnlyMode} />
        <SectionRow label="sourceOfTruth (default)" value={device?.defaultSourceOfTruth} />
      </Section>

      <Section title="Auth" tone="#a6e22e">
        <SectionRow label="isAuthenticated" value={auth?.isAuthenticated} />
        <SectionRow label="authType" value={auth?.authType} />
        <SectionRow label="user" value={auth?.user} />
        <SectionRow label="oauthScope" value={auth?.oauthScope} />
        <SectionRow label="appInstallationId" value={auth?.appInstallationId} />
        <SectionRow label="tokenExpiresAt" value={auth?.tokenExpiresAt} />
        <SectionRow label="tokenSource" value={auth?.tokenSource} />
        <SectionRow label="hasOauthInMemory" value={auth?.hasOauthInMemory} />
        <SectionRow label="hasAppInMemory" value={auth?.hasAppInMemory} />
        <SectionRow label="hasOauthStored" value={auth?.hasOauthStored} />
        <SectionRow label="hasAppStored" value={auth?.hasAppStored} />
      </Section>

      <Section title="Active universe" tone="#fd971f">
        <SectionRow label="slug" value={universe?.slug} />
        <SectionRow label="name" value={universe?.name} />
        <SectionRow label="gitRepo.enabled" value={universe?.gitEnabled} />
        <SectionRow label="gitRepo.linkedRepo" value={universe?.linkedRepo} />
        <SectionRow label="gitRepo.universeFolder" value={universe?.universeFolder} />
        <SectionRow label="gitRepo.universeFile" value={universe?.universeFile} />
        <SectionRow label="sourceOfTruth" value={universe?.sourceOfTruth} />
        <SectionRow label="nodeCount" value={universe?.nodeCount} />
      </Section>

      <Section title="Sync engine" tone="#f92672">
        <SectionRow label="hasEngine" value={engine?.hasEngine} />
        <SectionRow label="isRunning" value={engine?.isRunning} />
        <SectionRow label="isHealthy" value={engine?.isHealthy} />
        <SectionRow label="isInBackoff" value={engine?.isInBackoff} />
        <SectionRow label="consecutiveErrors" value={engine?.consecutiveErrors} />
        <SectionRow label="pendingCommits" value={engine?.pendingCommits} />
        <SectionRow label="lastCommitTime" value={engine?.lastCommitTime} />
        <SectionRow label="lastErrorTime" value={engine?.lastErrorTime} />
        <SectionRow label="lastError" value={engine?.lastError} />
        <SectionRow label="statusLabel" value={engine?.statusLabel} />
      </Section>

      {saveCoordinator && (
        <Section title="Save coordinator" tone="#e6db74">
          <SectionRow label="isEnabled" value={saveCoordinator.isEnabled} />
          <SectionRow label="isSaving" value={saveCoordinator.isSaving} />
          <SectionRow label="isDirty" value={saveCoordinator.isDirty} />
          <SectionRow label="hasUnsavedChanges" value={saveCoordinator.hasUnsavedChanges} />
          <SectionRow label="pendingHash" value={saveCoordinator.pendingHashSet} />
          <SectionRow label="pendingString" value={saveCoordinator.pendingStringSet} />
          <SectionRow label="lastSaveHash" value={saveCoordinator.lastSaveHashSet} />
          <SectionRow label="hasLastState" value={saveCoordinator.hasLastState} />
          <SectionRow label="hasNextStateToProcess" value={saveCoordinator.hasNextStateToProcess} />
          <SectionRow label="hasSaveWorker" value={saveCoordinator.hasSaveWorker} />
          <SectionRow label="workerProcessing" value={saveCoordinator.workerProcessing} />
          <SectionRow label="workerDirty" value={saveCoordinator.workerDirty} />
          <SectionRow label="workerWatchdogPending" value={saveCoordinator.workerWatchdogPending} />
          <SectionRow label="saveTimerPending" value={saveCoordinator.saveTimerPending} />
          <SectionRow label="workerTimerPending" value={saveCoordinator.workerTimerPending} />
          <SectionRow label="isGlobalDragging" value={saveCoordinator.isGlobalDragging} />
          <SectionRow label="ms since interactionStart" value={saveCoordinator.msSinceInteractionStart} />
          <SectionRow label="ms since interactionEnd" value={saveCoordinator.msSinceInteractionEnd} />
          <SectionRow label="hasLoadedFromFile" value={saveCoordinator.hasLoadedFromFile} />
          <SectionRow label="hasFileStorage" value={saveCoordinator.hasFileStorage} />
          <SectionRow label="hasGitSyncEngine" value={saveCoordinator.hasGitSyncEngine} />
          <SectionRow label="gitEngineHealthy" value={saveCoordinator.gitEngineHealthy} />
          {saveCoordinator.error && (
            <SectionRow label="error" value={saveCoordinator.error} />
          )}
        </Section>
      )}

      {Array.isArray(lastActions) && lastActions.length > 0 && (
        <Section title="Recent actions" tone="#ae81ff" headerExtra={<CopyActionLogButton actions={lastActions} />}>
          {lastActions.slice().reverse().map((entry, idx) => (
            <div
              key={idx}
              style={{
                padding: '2px 0',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                // The overlay's outer container sets touchAction: 'none' to
                // make drag-to-move work — that also disables tap-and-hold
                // selection. Re-enable it here so users can long-press to
                // select / copy log content.
                userSelect: 'text',
                WebkitUserSelect: 'text',
                touchAction: 'auto',
                cursor: 'text',
              }}
            >
              <div style={{ color: entry.ok ? '#a6e22e' : '#f92672' }}>
                [{entry.ts}] {entry.label} {entry.ok ? 'ok' : 'failed'}
              </div>
              {entry.detail && (
                <div style={{ marginLeft: 8, color: '#bbb', wordBreak: 'break-all' }}>{entry.detail}</div>
              )}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
};

const CopyActionLogButton = ({ actions }) => {
  const [label, setLabel] = useState('Copy log');
  const onCopy = useCallback(async () => {
    const text = actions
      .slice()
      .reverse()
      .map((e) => `[${e.ts}] ${e.label} ${e.ok ? 'ok' : 'failed'}${e.detail ? `\n    ${e.detail}` : ''}`)
      .join('\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for environments without async clipboard (older WebKit, file://)
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
      }
      setLabel('Copied!');
    } catch {
      setLabel('Copy failed');
    }
    setTimeout(() => setLabel('Copy log'), 1500);
  }, [actions]);

  return (
    <button
      onClick={onCopy}
      style={{
        background: 'rgba(174, 129, 255, 0.18)',
        border: '1px solid rgba(174, 129, 255, 0.55)',
        color: '#ae81ff',
        cursor: 'pointer',
        fontSize: '10px',
        padding: '2px 8px',
        borderRadius: 3,
        fontFamily: 'monospace',
      }}
    >
      {label}
    </button>
  );
};

const GenericDebug = ({ data }) => (
  <>
    {data && typeof data === 'object' && Object.entries(data).map(([key, value]) => (
      <div key={key} style={{
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '5px 0',
        marginBottom: '5px',
      }}>
        <strong style={{ color: '#66d9ef' }}>{key}:</strong>
        <pre style={{
          margin: '5px 0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
        </pre>
      </div>
    ))}
    {!data && <div style={{ color: '#777' }}>No debug data</div>}
  </>
);

export default DebugOverlay;
