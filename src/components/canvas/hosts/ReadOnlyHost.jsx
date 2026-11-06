import React, { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Eye, X } from 'lucide-react';
import Modal from '../../shared/Modal.jsx';
import { DialogButton } from '../../shared/Dialog.jsx';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useReadOnlyUniverse, { setReadOnlyFailure } from '../../../store/readOnlyUniverse.js';
import { useTheme } from '../../../hooks/useTheme.js';
import { HEADER_HEIGHT } from '../../../constants';
import { buildAppLink, clearSharedLinkFromAddress } from '../../../services/sharedLink.js';
import { makeCopyOfOpenUniverse } from '../actions/makeCopy.js';

const NUDGE_MS = 2400;

const isInstalledApp = () => typeof window !== 'undefined'
  && (!!window.electron || window.Capacitor?.isNativePlatform?.() === true);

/**
 * The read-only universe's bar, over the canvas: what you're looking at, and
 * the way to make it yours. A refused edit brings the offer forward. Also the
 * message when a shared link can't be opened.
 */
const ReadOnlyHost = () => {
  const theme = useTheme();
  const active = useReadOnlyUniverse((s) => s.active);
  const nudge = useReadOnlyUniverse((s) => s.nudge);
  const failure = useReadOnlyUniverse((s) => s.failure);
  const [nudged, setNudged] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!nudge) return undefined;
    setNudged(true);
    const timer = setTimeout(() => setNudged(false), NUDGE_MS);
    return () => clearTimeout(timer);
  }, [nudge]);

  const close = useCallback(async () => {
    const { default: universeBackend } = await import('../../../services/universeBackend.js');
    await universeBackend.closeReadOnlyUniverse();
  }, []);

  const makeCopy = useCallback(async () => {
    setCopying(true);
    try {
      await makeCopyOfOpenUniverse();
    } finally {
      setCopying(false);
    }
  }, []);

  const dismissFailure = useCallback(() => {
    const atBoot = failure?.atBoot;
    setReadOnlyFailure(null);
    if (atBoot) {
      // Nothing of theirs was read on the way to this link. Start the app properly.
      clearSharedLinkFromAddress();
      window.location.reload();
    } else {
      useCanvasUIStore.getState().openLeftPanelView('federation');
    }
  }, [failure]);

  const barButton = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderRadius: 14,
    border: `1px solid ${theme.canvas.border}`,
    background: 'transparent',
    color: theme.canvas.textPrimary,
    fontFamily: "'EmOne', sans-serif",
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  };

  return (
    <>
      {active && (
        // The full width, with the bar centred in it: a box positioned from the
        // middle of the screen can only be half as wide before it wraps.
        <div
          style={{
            position: 'fixed',
            top: `calc(${HEADER_HEIGHT}px + var(--safe-area-top, 0px) + 10px)`,
            left: 16,
            right: 16,
            zIndex: 20000,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none'
          }}
        >
        <div
          data-testid="read-only-bar"
          style={{
            pointerEvents: 'auto',
            transform: `scale(${nudged ? 1.04 : 1})`,
            transition: 'transform 0.18s ease',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px 6px 12px',
            borderRadius: 20,
            backgroundColor: theme.canvas.bg,
            border: `1px solid ${nudged ? theme.canvas.brand : theme.canvas.border}`,
            color: theme.canvas.textPrimary,
            fontFamily: "'EmOne', sans-serif",
            fontSize: '0.8rem'
          }}
        >
          <Eye size={15} style={{ flexShrink: 0, color: theme.canvas.brand }} />
          <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
            {active.name}
          </span>
          <span style={{ color: nudged ? theme.canvas.brand : theme.canvas.textSecondary, whiteSpace: 'nowrap' }}>
            {nudged ? 'Make a copy to edit' : 'Read only'}
          </span>
          <button
            type="button"
            data-testid="read-only-make-copy"
            disabled={copying}
            onClick={makeCopy}
            style={{ ...barButton, border: 'none', background: theme.canvas.brand, color: '#DEDADA', opacity: copying ? 0.6 : 1 }}
          >
            <Copy size={13} />
            Make a Copy
          </button>
          {!isInstalledApp() && (
            <a
              data-testid="read-only-open-in-app"
              href={buildAppLink(active.sourceUrl) || undefined}
              style={{ ...barButton, textDecoration: 'none' }}
            >
              <ExternalLink size={13} />
              Open in App
            </a>
          )}
          <button
            type="button"
            data-testid="read-only-close"
            title="Close"
            aria-label="Close"
            onClick={close}
            style={{ ...barButton, border: 'none', padding: 4 }}
          >
            <X size={15} />
          </button>
        </div>
        </div>
      )}

      <Modal
        isOpen={!!failure}
        onClose={dismissFailure}
        title="Couldn't open this link"
        size="small"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
          <div data-testid="read-only-failure" style={{ fontSize: '0.9rem', color: theme.canvas.textPrimary, lineHeight: 1.4 }}>
            {failure?.message}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <DialogButton onClick={dismissFailure} label={failure?.atBoot ? 'Go to Redstring' : 'OK'} />
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ReadOnlyHost;
