import React, { useState, useEffect, useRef } from 'react';
import { MonitorDown, X } from 'lucide-react';
import './DownloadAppPill.css';
import { useViewportBounds } from './hooks/useViewportBounds';
import useGraphStore from './store/graphStore.js';
import PanelIconButton from './components/shared/PanelIconButton.jsx';
import { haptic } from './services/haptics.js';
import {
  canOfferDesktopDownload,
  isDesktopDownloadDismissed,
  dismissDesktopDownload,
  openDesktopDownload,
} from './utils/desktopDownload.js';

/**
 * A one-time nudge toward the desktop build, shown on the web only.
 *
 * Modelled on BackToCivilization — same pill, same pop/shrink, same
 * panel-aware centering — but anchored to the bottom, riding above the
 * TypeList when it's open. Acting on it or dismissing it retires it for good.
 */

// Long enough that the pill doesn't pop while the app is still opening a
// universe, short enough to still read as part of arriving.
const APPEAR_DELAY_MS = 2000;

// Clearance above the TypeList (or the bottom edge when it's closed). Matches
// the 20px the bottom control panels leave.
const BOTTOM_GAP = 20;

const DownloadAppPill = ({ suppressed = false }) => {
  const leftPanelExpanded = useGraphStore(state => state.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(state => state.rightPanelExpanded);
  const typeListMode = useGraphStore(state => state.typeListMode);
  const typeListVisible = typeListMode !== 'closed';
  const viewportBounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded, typeListVisible);

  // Settled once, on mount: whether this browser is ever a candidate. Both
  // halves are stable for the session — the device doesn't change under us, and
  // the stored flag only ever moves in the one direction, from here.
  const [dismissed, setDismissed] = useState(
    () => !canOfferDesktopDownload() || isDesktopDownloadDismissed()
  );
  const [delayComplete, setDelayComplete] = useState(false);
  const [animationState, setAnimationState] = useState(null);
  const componentRef = useRef(null);

  useEffect(() => {
    if (dismissed) return undefined;
    const timer = setTimeout(() => setDelayComplete(true), APPEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dismissed]);

  const isVisible = !dismissed && delayComplete && !suppressed;

  // Handle visibility changes with animations
  useEffect(() => {
    if (isVisible) {
      if (animationState !== 'popping' && animationState !== 'visible_steady') {
        setAnimationState('popping');
      }
    } else {
      if (animationState === 'visible_steady' || animationState === 'popping') {
        setAnimationState('shrinking');
      }
    }
  }, [isVisible, animationState]);

  // Handle animation end events
  useEffect(() => {
    const component = componentRef.current;
    if (!component) return undefined;

    const handleAnimationEnd = (e) => {
      if (e.target === component) {
        if (animationState === 'popping') {
          setAnimationState('visible_steady');
        } else if (animationState === 'shrinking') {
          setAnimationState(null);
        }
      }
    };

    component.addEventListener('animationend', handleAnimationEnd);
    return () => {
      component.removeEventListener('animationend', handleAnimationEnd);
    };
  }, [animationState]);

  // Don't render if not visible and no animation state
  if (!isVisible && !animationState) {
    return null;
  }

  const retire = () => {
    dismissDesktopDownload();
    setDismissed(true);
  };

  const handleDownload = () => {
    haptic('menuSelect');
    openDesktopDownload();
    // Taking the offer retires it too — the nudge has done its job, and it
    // would be strange to keep asking someone who has just gone to fetch it.
    retire();
  };

  const handleDismiss = () => {
    haptic('menuSelect');
    retire();
  };

  // Centered in the usable viewport so the pill doesn't sit behind a panel, and
  // lifted clear of the TypeList when that's open (bottomReserved is its height,
  // or 0 when it's closed).
  const centerX = viewportBounds.x + viewportBounds.width / 2;
  const bottom = viewportBounds.bottomReserved + BOTTOM_GAP;

  let className = 'download-app-pill-wrapper';
  if (animationState === 'popping') {
    className += ' is-popping';
  } else if (animationState === 'visible_steady') {
    className += ' is-visible-steady';
  } else if (animationState === 'shrinking') {
    className += ' is-shrinking';
  }

  return (
    <div
      ref={componentRef}
      className={className}
      style={{
        position: 'fixed',
        left: centerX,
        bottom,
        transform: 'translateX(-50%)',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <div
        className="download-app-pill"
        onClick={handleDownload}
        title="Download the Redstring desktop app"
      >
        <MonitorDown size={16} strokeWidth={2.5} className="download-app-pill-icon" />
        <span className="download-app-pill-text">Recommended: Download App Here</span>
        {/* PanelIconButton stops the click from reaching the pill, so dismissing
            never also opens the download page. */}
        <PanelIconButton
          icon={X}
          size={14}
          color="maroon"
          strokeWidth={2.5}
          onClick={handleDismiss}
          title="Don't show this again"
        />
      </div>
    </div>
  );
};

export default DownloadAppPill;
