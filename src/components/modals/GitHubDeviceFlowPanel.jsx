import React, { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Github, Loader2 } from 'lucide-react';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { openVerificationUrl } from '../../services/githubDeviceFlow.js';

/**
 * Presentational device-flow UI — the user code, verification URL, and poll
 * status. Contains NO overlay/backdrop of its own so it can be embedded inline
 * (e.g. inside the onboarding wizard's GitHub step on Electron, where a stacked
 * modal would render behind the wizard's own overlay) or wrapped in a Modal by
 * GitHubDeviceFlowModal for the Universes panel.
 *
 * Driven entirely by props — the caller owns the polling promise and mutates
 * the cancel signal it passed in when the user clicks Cancel.
 */
const GitHubDeviceFlowPanel = ({
  onCancel,
  title = 'Connect to GitHub',
  subtitle,
  userCode,
  verificationUri,
  verificationUriComplete,
  expiresAt,
  status = 'pending',
  errorMessage = null,
  showTitle = false,
  compact = false
}) => {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState('');
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining('');
      return;
    }
    const tick = () => {
      const secs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      const mm = Math.floor(secs / 60);
      const ss = secs % 60;
      setRemaining(`${mm}:${ss.toString().padStart(2, '0')}`);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [expiresAt]);

  const handleCopy = async () => {
    if (!userCode) return;
    try {
      if (window.electron?.clipboard?.writeText) {
        await window.electron.clipboard.writeText(userCode);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(userCode);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — UI still shows the code so the user can copy manually
    }
  };

  const handleOpenBrowser = async () => {
    const url = verificationUriComplete || verificationUri;
    if (!url) return;
    await openVerificationUrl(url);
  };

  const statusLabel = errorMessage
    ? errorMessage
    : status === 'slow-down'
      ? 'GitHub asked us to slow down — still waiting…'
      : status === 'network-error'
        ? 'Network blip — retrying…'
        : 'Waiting for you to approve in the browser…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 14, padding: compact ? '2px 2px 4px' : '4px 4px 8px' }}>
      {showTitle && (
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: theme.canvas.textPrimary, fontFamily: "'EmOne', sans-serif" }}>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Github size={compact ? 16 : 20} color={theme.canvas.textPrimary} />
        <div style={{ fontSize: compact ? '0.8rem' : '0.85rem', color: theme.canvas.textPrimary }}>
          {subtitle || 'Authorize Redstring on GitHub.com to continue.'}
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${theme.canvas.textPrimary}`,
          borderRadius: 10,
          padding: compact ? '8px 12px' : '14px 12px',
          display: 'flex',
          flexDirection: compact ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 12 : 6,
          backgroundColor: theme.canvas.bg
        }}
      >
        {!compact && (
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1.5, color: theme.canvas.textSecondary }}>
            Your code
          </div>
        )}
        <div
          style={{
            fontFamily: "'Menlo', 'Monaco', monospace",
            fontSize: compact ? '1.2rem' : '1.6rem',
            fontWeight: 700,
            letterSpacing: compact ? 3 : 4,
            color: theme.canvas.textPrimary,
            userSelect: 'all'
          }}
        >
          {userCode || '— — — —'}
        </div>
        <button
          onClick={handleCopy}
          disabled={!userCode}
          style={{
            background: 'none',
            border: `1px solid ${theme.canvas.textSecondary}`,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: userCode ? 'pointer' : 'default',
            color: theme.canvas.textPrimary,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.75rem'
          }}
        >
          <Copy size={12} />
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>

      {compact ? (
        <div style={{ fontSize: '0.75rem', color: theme.canvas.textPrimary, lineHeight: 1.4 }}>
          Enter this code at <strong>{verificationUri || 'github.com/login/device'}</strong> and approve — we'll detect it automatically.
        </div>
      ) : (
        <div style={{ fontSize: '0.78rem', color: theme.canvas.textPrimary, lineHeight: 1.4 }}>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Open <strong>{verificationUri || 'github.com/login/device'}</strong> in your browser.</li>
            <li>Enter the code above and approve the request.</li>
            <li>Come back here — we'll detect it automatically.</li>
          </ol>
        </div>
      )}

      <PanelIconButton
        label="Open GitHub in browser"
        variant="solid"
        icon={ExternalLink}
        onClick={handleOpenBrowser}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.72rem',
          color: theme.canvas.textSecondary
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!errorMessage && <Loader2 size={12} className="spin" style={{ animation: 'spin 1s linear infinite' }} />}
          <span style={{ color: errorMessage ? '#c62828' : theme.canvas.textSecondary }}>{statusLabel}</span>
        </span>
        {remaining && !errorMessage && (
          <span>Expires in {remaining}</span>
        )}
      </div>

      <PanelIconButton label="Cancel" variant="outline" onClick={onCancel} />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default GitHubDeviceFlowPanel;
