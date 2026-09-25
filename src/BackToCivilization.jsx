import React, { useState, useEffect, useRef, memo } from 'react';
import './BackToCivilization.css';
import { useViewportBounds } from './hooks/useViewportBounds';
import { useMobileLandscapeShell } from './hooks/useMobileLandscapeShell.js';
import useGraphStore from './store/graphStore.js';
import { haptic } from './services/haptics.js';

const BackToCivilization = ({
  isVisible,
  onClick,
  panOffset,
  zoomLevel,
  containerRef,
  canvasSize,
  viewportSize,
  clusteringEnabled = false,
  clusterInfo = {}
}) => {
  const leftPanelExpanded = useGraphStore(state => state.leftPanelExpanded);
  const rightPanelExpanded = useGraphStore(state => state.rightPanelExpanded);
  const typeListMode = useGraphStore(state => state.typeListMode);
  const mobileLandscapeShell = useMobileLandscapeShell();
  const viewportBounds = useViewportBounds(
    leftPanelExpanded,
    rightPanelExpanded,
    typeListMode !== 'closed'
  );
  const [animationState, setAnimationState] = useState(null);
  const componentRef = useRef(null);

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
    if (!component) return;

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
      if (component) {
        component.removeEventListener('animationend', handleAnimationEnd);
      }
    };
  }, [animationState]);

  // Don't render if not visible and no animation state
  if (!isVisible && !animationState) {
    return null;
  }

  // Center within the usable viewport so the button doesn't sit behind panels
  // on desktop. In exclusive (mobile-style) mode the hook returns full-window
  // bounds, so the button stays centered on screen there too.
  const centerX = viewportBounds.x + viewportBounds.width / 2;

  // Measured DOWN FROM THE TOP OF THE CANVAS, not from the top of the screen.
  // viewportBounds.y is the header's height, which the fullscreen landscape
  // shell drops to 0 — so the old fixed 120 stopped meaning "70px into the
  // canvas" there and started meaning "120px into a 396px-tall screen", nearly
  // a third of the way down.
  //
  // The gap tightens in the shell for the same reason the header went: with the
  // whole screen barely taller than a desktop canvas is wide, a constant inset
  // reads as a much deeper one. 40 keeps the pill at roughly the proportion of
  // the canvas that 70 puts it at on desktop.
  const topGap = mobileLandscapeShell ? 40 : 70;
  const centerY = viewportBounds.y + topGap;

  // Dynamic class name based on animation state
  let className = 'back-to-civilization';
  if (animationState === 'popping') {
    className += ' is-popping';
  } else if (animationState === 'visible_steady') {
    className += ' is-visible-steady';
  } else if (animationState === 'shrinking') {
    className += ' is-shrinking';
  }

  // Determine display text based on clustering mode
  const displayText = clusteringEnabled && clusterInfo.mainClusterSize > 0
    ? `Back to Civilization (${clusterInfo.mainClusterSize} nodes)`
    : 'Back to Civilization';

  return (
    <div
      ref={componentRef}
      className={className}
      style={{
        position: 'fixed',
        left: centerX,
        top: centerY,
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
      onClick={(e) => {
        // Kept in lockstep with onClick rather than gated on isVisible: the pill
        // stays clickable while shrinking, and a haptic that disagreed with
        // whether the jump happened would be worse than one that always matches.
        haptic('viewportJump');
        onClick?.(e);
      }}
      title={clusteringEnabled
        ? `Navigate to main cluster (${clusterInfo.mainClusterSize || 0} nodes, ${clusterInfo.outlierCount || 0} outliers)`
        : 'Navigate to all nodes'
      }
    >
      <div className="back-to-civilization-pill">
        <span className="back-to-civilization-text">{displayText}</span>
      </div>
    </div>
  );
};

// Memoized (render sweep): it re-rendered on every NodeCanvas render, props unchanged.
export default memo(BackToCivilization);
