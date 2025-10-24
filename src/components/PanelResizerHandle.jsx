import React, { useState } from 'react';

/**
 * Vertical, mobile-friendly resizer handle styled like a pill/home bar.
 * - Renders slightly outside the panel edge
 * - Low-opacity by default; increases on hover; full on active
 * - Touch and mouse friendly
 */
const PanelResizerHandle = ({ side = 'right', onMouseDown, onTouchStart, isActive = false, offset = 12, heightRatio = 0.25 }) => {
  const [isHover, setIsHover] = useState(false);

  const baseOpacity = isActive ? 1 : (isHover ? 0.22 : 0.10);
  const baseColor = `rgba(38,0,0,${baseOpacity})`; // header maroon

  const style = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 18,
    height: `${Math.round(heightRatio * 100)}%`,
    minHeight: 60,
    maxHeight: 280,
    borderRadius: 999,
    backgroundColor: baseColor,
    cursor: 'col-resize',
    zIndex: 10002,
    touchAction: 'none',
    transition: 'background-color 120ms ease, opacity 120ms ease'
  };

  if (side === 'left') {
    style.right = `-${offset}px`;
  } else {
    style.left = `-${offset}px`;
  }

  return (
    <div
      style={style}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    />
  );
};

export default PanelResizerHandle;


