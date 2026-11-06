import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Eye, X } from 'lucide-react';
import './ReadOnlyHost.css';
import Modal from '../../shared/Modal.jsx';
import { DialogButton } from '../../shared/Dialog.jsx';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import { ZOOM_BAR_HEIGHT } from '../layers/ZoomBar.jsx';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import useGraphStore from '../../../store/graphStore.js';
import useReadOnlyUniverse, { setReadOnlyFailure } from '../../../store/readOnlyUniverse.js';
import { useBottomPanelTop } from '../../../store/bottomPanelTop.js';
import { useTheme } from '../../../hooks/useTheme.js';
import { useViewportBounds } from '../../../hooks/useViewportBounds';
import { DEFAULT_ZOOM_BAR_POSITION } from '../../../constants';
import { buildAppLink, clearSharedLinkFromAddress, isInstalledApp } from '../../../services/sharedLink.js';
import { makeCopyOfOpenUniverse } from '../actions/makeCopy.js';

const NUDGE_MS = 2400;

// Clearance above the TypeList, as the desktop-app pill and the control panels
// leave, and above a control panel.
const BOTTOM_GAP = 20;
const PANEL_GAP = 12;

/**
 * The read-only universe's pill: that it's read only, and the way to make it
 * yours. A refused edit brings the offer forward. Also the message when a shared
 * link can't be opened.
 */
const ReadOnlyHost = () => {
  const theme = useTheme();
  const active = useReadOnlyUniverse((s) => s.active);
  const nudge = useReadOnlyUniverse((s) => s.nudge);
  const failure = useReadOnlyUniverse((s) => s.failure);
  const [nudged, setNudged] = useState(false);
  const [copying, setCopying] = useState(false);
  const [animationState, setAnimationState] = useState(null);
  const wrapperRef = useRef(null);
  // What the pill links to while it shrinks away, after the universe has gone.
  const lastActive = useRef(null);
  if (active) lastActive.current = active;

  const leftPanelExpanded = useGraphStore((s) => s.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore((s) => s.rightPanelExpanded);
  const typeListVisible = useGraphStore((s) => s.typeListMode !== 'closed');
  const zoomBarBelow = useGraphStore((s) =>
    s.showZoomBar !== false && (s.zoomBarPosition ?? DEFAULT_ZOOM_BAR_POSITION) === 'bottom');
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListVisible);
  const bottomPanelTop = useBottomPanelTop();

  useEffect(() => {
    if (active) {
      setAnimationState((state) => (state === 'visible_steady' ? state : 'popping'));
    } else {
      setAnimationState((state) => (state ? 'shrinking' : state));
    }
  }, [active]);

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

  // Centred in the usable canvas, as the other pills are: on top of a control
  // panel when one is up, otherwise just over the TypeList (and the zoom bar when
  // it shares the strip).
  const centerX = viewportBounds.x + viewportBounds.width / 2;
  const bottom = bottomPanelTop !== null
    ? bottomPanelTop + PANEL_GAP
    : viewportBounds.bottomReserved + BOTTOM_GAP + (zoomBarBelow ? ZOOM_BAR_HEIGHT + 8 : 0);

  let wrapperClass = 'read-only-pill-wrapper';
  if (animationState === 'popping') wrapperClass += ' is-popping';
  else if (animationState === 'visible_steady') wrapperClass += ' is-visible-steady';
  else if (animationState === 'shrinking') wrapperClass += ' is-shrinking';

  const showing = active || lastActive.current;

  return (
    <>
      {animationState && showing && (
        <div
          ref={wrapperRef}
          className={wrapperClass}
          style={{ left: centerX, bottom }}
          onAnimationEnd={(e) => {
            if (e.target !== wrapperRef.current) return;
            if (animationState === 'popping') setAnimationState('visible_steady');
            else if (animationState === 'shrinking') setAnimationState(null);
          }}
        >
          <div data-testid="read-only-bar" className={`read-only-pill${nudged ? ' is-nudged' : ''}`}>
            <span className="read-only-pill-status">
              <Eye size={16} strokeWidth={2.5} style={{ flexShrink: 0 }} />
              {nudged ? 'Make a copy to edit' : 'Read only'}
            </span>
            <button
              type="button"
              data-testid="read-only-make-copy"
              className="read-only-pill-button is-primary"
              disabled={copying}
              onClick={makeCopy}
            >
              <Copy size={13} strokeWidth={2.5} />
              Make a Copy
            </button>
            {!isInstalledApp() && (
              <a
                data-testid="read-only-open-in-app"
                className="read-only-pill-button"
                href={buildAppLink(showing.sourceUrl) || undefined}
              >
                <ExternalLink size={13} strokeWidth={2.5} />
                Open in App
              </a>
            )}
            <span data-testid="read-only-close">
              <PanelIconButton icon={X} size={14} color="maroon" strokeWidth={2.5} onClick={close} title="Close" />
            </span>
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
