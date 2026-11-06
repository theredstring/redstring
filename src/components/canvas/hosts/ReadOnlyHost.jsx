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
import { DEFAULT_ZOOM_BAR_POSITION, OVER_PANELS_Z_INDEX, isExclusivePanelMode } from '../../../constants';
import { buildAppLink, clearSharedLinkFromAddress, isInstalledApp } from '../../../services/sharedLink.js';
import { makeCopyOfOpenUniverse } from '../actions/makeCopy.js';

// Clearance above the TypeList, as the desktop-app pill and the control panels
// leave, and above a control panel.
const BOTTOM_GAP = 20;
const PANEL_GAP = 12;

/**
 * The read-only universe's pill: that it's read only, and the way to make it
 * yours. Its X only hides it: leaving the universe is the X on its row in
 * Universes, where a visit opens. Also the message when a shared link can't be
 * opened.
 */
const ReadOnlyHost = () => {
  const theme = useTheme();
  const active = useReadOnlyUniverse((s) => s.active);
  const failure = useReadOnlyUniverse((s) => s.failure);
  const [copying, setCopying] = useState(false);
  const [hidden, setHidden] = useState(false);
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

  // Each visit starts with the pill, on Universes. Where the panels take turns the
  // tab is ready but stays shut, or it would cover what they came to look at.
  const visiting = active?.sourceUrl;
  useEffect(() => {
    setHidden(false);
    if (!visiting) return;
    useCanvasUIStore.getState().openLeftPanelView('federation');
    if (!isExclusivePanelMode()) useGraphStore.getState().setLeftPanelExpanded(true);
  }, [visiting]);

  const pillUp = !!active && !hidden;
  useEffect(() => {
    if (pillUp) {
      setAnimationState((state) => (state === 'visible_steady' ? state : 'popping'));
    } else {
      setAnimationState((state) => (state ? 'shrinking' : state));
    }
  }, [pillUp]);

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

  // The middle of the window, as the other pills are: on top of a control panel
  // when one is up, otherwise just over the TypeList (and the zoom bar when it
  // shares the strip).
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
          style={{ left: '50%', bottom, zIndex: OVER_PANELS_Z_INDEX }}
          onAnimationEnd={(e) => {
            if (e.target !== wrapperRef.current) return;
            if (animationState === 'popping') setAnimationState('visible_steady');
            else if (animationState === 'shrinking') setAnimationState(null);
          }}
        >
          <div data-testid="read-only-bar" className="read-only-pill">
            <span className="read-only-pill-status">
              <Eye size={16} strokeWidth={2.5} style={{ flexShrink: 0 }} />
              Read Only
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
            <span data-testid="read-only-hide">
              <PanelIconButton icon={X} size={14} color="maroon" strokeWidth={2.5} onClick={() => setHidden(true)} title="Hide" />
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
