import React, { useState, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * PanelIconButton - Reusable icon button matching right panel style
 * with PieMenu-style hover effects
 *
 * Features:
 * - Matches right panel icon button style (simple dark icons)
 * - PieMenu-style hover effect (light gray fill with maroon stroke, matching PieMenu bubbles)
 * - Conditional fill support (for star/saved buttons)
 * - Works with any Lucide icon
 * - Compact design for slim views
 *
 * @param {Object} props
 * @param {React.Component} props.icon - Lucide icon component
 * @param {number} [props.size=20] - Icon size in pixels (matches right panel icons)
 * @param {string} [props.color] - Icon color (defaults to theme.canvas.textPrimary)
 * @param {boolean} [props.filled=false] - Whether icon should be filled
 * @param {string} [props.fillColor] - Fill color when filled (defaults to theme.accent.primary)
 * @param {boolean} [props.fillOnHover=false] - Whether icon should fill when hovered
 * @param {string} [props.hoverFillColor] - Fill color when hovered (defaults to theme.accent.primary)
 * @param {Function} props.onClick - Click handler
 * @param {string} [props.title] - Tooltip text
 * @param {boolean} [props.disabled=false] - Whether button is disabled
 * @param {number} [props.strokeWidth=2] - Default stroke width for icon
 * @param {number} [props.hoverStrokeWidth] - Stroke width on hover
 * @param {string} [props.hoverTextColor] - Text color on hover
 * @param {Object} [props.style] - Additional inline styles
 * @param {string} [props.className] - Additional CSS class
 */
const PanelIconButton = ({
  icon: IconComponent,
  size = 16,
  color,
  label,
  labelPosition = 'right',
  variant = 'ghost',
  filled = false,
  fillColor,
  fillOnHover = false,
  hoverFillColor,
  onClick,
  title,
  active = false,
  disabled = false,
  strokeWidth = 2,
  hoverStrokeWidth,
  hoverTextColor,
  style = {},
  className = ''
}) => {
  const theme = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  // Use theme colors as defaults
  const isSolid = variant === 'solid';
  const actualColor = color || (isSolid ? theme.canvas.bg : theme.canvas.textPrimary);
  const actualFillColor = fillColor || theme.accent.primary;
  const hoverStrokeColor = variant === 'danger' ? '#F44336' : theme.accent.primary;
  const actualHoverFillColor = hoverFillColor || hoverStrokeColor;

  const handleClick = (e) => {
    if (touchHandledRef.current) return; // Already handled by touch
    if (!disabled && onClick) {
      e.stopPropagation();
      onClick(e);
    }
  };

  // Track whether touch already handled the action to prevent double-fire with onClick.
  // Cannot use e.preventDefault() in onTouchEnd since React registers it as passive.
  const touchHandledRef = useRef(false);

  const handleTouchEnd = (e) => {
    if (!disabled && onClick) {
      e.stopPropagation();
      touchHandledRef.current = true;
      onClick(e);
      setTimeout(() => { touchHandledRef.current = false; }, 400);
    }
  };

  const isPill = !!label;

  const buttonStyle = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: isPill ? '6px 14px' : '6px',
    borderWidth: (variant === 'outline' || isSolid) ? '1px' : '0',
    borderStyle: (variant === 'outline' || isSolid) ? 'solid' : 'none',
    borderColor: variant === 'outline' ? (theme.darkMode ? theme.canvas.border : 'rgba(38, 0, 0, 0.3)') : (isSolid ? theme.canvas.textPrimary : 'transparent'),
    background: isSolid ? theme.canvas.textPrimary : 'transparent',
    backgroundColor: isSolid ? theme.canvas.textPrimary : 'transparent',
    color: actualColor,
    backgroundImage: 'none',
    boxShadow: 'none',
    outline: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    appearance: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    flexShrink: 0,
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    borderRadius: isPill ? '20px' : '50%',
    ...style
  };

  // PieMenu-style hover effect: light gray fill with accent stroke (3px)
  // Always use light hover background in both light and dark modes
  const showActiveState = (isHovered || active) && !disabled;
  const hoverStyles = showActiveState ? {
    backgroundColor: '#DEDADA',
    boxShadow: `0 0 0 3px ${hoverStrokeColor}`,
    borderColor: 'transparent',
    color: hoverTextColor || hoverStrokeColor,
    transform: 'scale(1.04)' // Natively adding hover grow
  } : {
    transform: 'scale(1)'
  };

  const currentStrokeWidth = showActiveState && hoverStrokeWidth ? hoverStrokeWidth : strokeWidth;

  return (
    <button
      className={`panel-icon-button ${variant} ${active ? 'active' : ''} ${className}`}
      style={{ ...buttonStyle, ...hoverStyles }}
      type="button"
      onClick={handleClick}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlur={() => setIsHovered(false)}
      title={title || label}
      disabled={disabled}
      aria-label={title || label}
    >
      {label && labelPosition === 'left' && (
        <span style={{ 
          fontSize: '13px', 
          fontWeight: 600, 
          fontFamily: "'EmOne', sans-serif",
          color: 'inherit'
        }}>
          {label}
        </span>
      )}
      
      {IconComponent && (
        <IconComponent
          size={size}
          color={showActiveState ? (variant === 'danger' ? '#F44336' : actualHoverFillColor) : actualColor}
          fill={filled ? (showActiveState ? actualHoverFillColor : actualFillColor) : 'none'}
          strokeWidth={currentStrokeWidth}
          style={{
            flexShrink: 0,
            transition: 'color 0.2s ease, fill 0.2s ease, stroke-width 0.2s ease',
          }}
        />
      )}

      {label && labelPosition === 'right' && (
        <span style={{ 
          fontSize: '13px', 
          fontWeight: 600, 
          fontFamily: "'EmOne', sans-serif",
          color: 'inherit'
        }}>
          {label}
        </span>
      )}
    </button>
  );
};

export default PanelIconButton;
