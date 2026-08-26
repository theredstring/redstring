import React, { useState } from 'react';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * ActionChip - pill-shaped outline action button.
 *
 * Replaces five copies of the same hand-rolled button that hardcoded
 * `#DEDADA` fill / `#7A0000` border+text. Those fills were light-mode-only:
 * on a dark panel they read as bright blobs, and the outline colors were the
 * unreadable brand maroon.
 *
 * Outline-only by design — the chip takes its color from the surface it sits
 * on, so it works on the panel background, on a discovered-universe card, and
 * in either theme. Hover supplies the fill instead of the resting state.
 *
 * @param {Object} props
 * @param {React.Component} [props.icon] - Lucide icon component
 * @param {string} props.label - Chip text
 * @param {Function} props.onClick
 * @param {string} [props.title] - Tooltip
 * @param {boolean} [props.disabled=false]
 * @param {boolean} [props.stopPropagation=false] - Swallow the click (chips inside clickable rows)
 * @param {Object} [props.style] - Extra styles merged last
 */
const ActionChip = ({
  icon: Icon,
  label,
  onClick,
  title,
  disabled = false,
  stopPropagation = false,
  style = {}
}) => {
  const theme = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  const accent = theme.canvas.brandText;

  const handleClick = (e) => {
    if (stopPropagation) e.stopPropagation();
    if (!disabled) onClick?.(e);
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '6px 12px',
        // No resting fill — the surface shows through.
        backgroundColor: isHovered ? theme.canvas.hover : 'transparent',
        border: `2px solid ${accent}`,
        borderRadius: 20,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background-color 0.2s ease, transform 0.2s ease',
        transform: isHovered ? 'scale(1.02)' : 'scale(1)',
        fontFamily: "'EmOne', sans-serif",
        fontSize: '0.7rem',
        fontWeight: 700,
        color: accent,
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {Icon && <Icon size={14} />}
      {label}
    </button>
  );
};

export default ActionChip;
