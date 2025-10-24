import React, { useState, useEffect, useRef } from 'react';
import './BackToCivilization.css';

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

  // Calculate position - center horizontally, slightly below header
  const centerX = viewportSize.width / 2;
  const centerY = 120; // Fixed position below header (header is ~80px)

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
      onClick={onClick}
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

export default BackToCivilization;
