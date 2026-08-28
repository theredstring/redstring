import React, { useState, useRef, forwardRef } from 'react';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * The hover-grow this button borrows from the canvas pie menu.
 *
 * These two values are the whole of `.pie-bubble-hover` / `.pie-chevron-hover`
 * in PieMenu.css. They are restated here rather than imported because the pie
 * menu states them in CSS on SVG groups and this is an inline-styled DOM button
 * — there is no shared sheet to reach for. If PieMenu.css ever retunes its
 * hover, retune these to match; the point of the component is that a panel
 * button and a pie bubble grow the same way under the cursor.
 */
const PIE_HOVER_SCALE = 1.1;
/**
 * Pills grow less.
 *
 * A single proportional scale reads very differently at the two shapes this
 * button takes. On a ~28px circle, 1.1 is under 3px of growth. On a 110px pill
 * it is 11px — wider than the gap most callers leave between two of them, so
 * hovering one made it collide with its neighbour. Keeping the growth roughly
 * constant in PIXELS rather than in proportion is what makes the two shapes
 * feel like the same gesture.
 */
const PIE_HOVER_SCALE_PILL = 1.04;
const PIE_HOVER_TRANSITION = '0.15s ease';

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
const PanelIconButton = forwardRef(({
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
  labelFontSize = 13,
  style = {},
  className = '',
  // Set by callers that use this button to open something (InfoPopover, the
  // About row's state chooser) so assistive tech knows it toggles a surface.
  ariaExpanded,
  ariaHasPopup
// Forwarded so a caller that opens a popover can hand the node to
// AnchoredPopoverBox as its `triggerRef`. Without it the box's outside-click
// dismiss can't tell the trigger apart from anywhere else, and a second click
// closes and reopens in the same gesture instead of toggling.
}, ref) => {
  const theme = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  // Use theme colors as defaults
  const isSolid = variant === 'solid';
  const actualColor = color || (isSolid ? theme.canvas.bg : theme.canvas.textPrimary);
  const actualFillColor = fillColor || theme.accent.primary;
  const hoverStrokeColor = variant === 'danger' ? '#F44336' : theme.accent.primary;
  const actualHoverFillColor = hoverFillColor || hoverStrokeColor;

  const handleClick = (e) => {
    if (touchHandledRef.current) {
      // Already handled by touch. The browser still emits a compatibility click
      // after touchend, and swallowing it silently is not enough: it must also
      // be stopped, or it bubbles to a clickable ancestor and fires that a
      // second time (e.g. a chevron inside a row that is itself a toggle).
      e.stopPropagation();
      e.preventDefault();
      return;
    }
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
    // Timing is lifted from .pie-bubble-hover in PieMenu.css rather than chosen
    // here, so this button's grow reads as the same gesture as a pie bubble's.
    // Listed per-property instead of `all` because `all` also animates the
    // padding/border swap a variant change brings, which the bubbles never do.
    transition: [
      `transform ${PIE_HOVER_TRANSITION}`,
      `background-color ${PIE_HOVER_TRANSITION}`,
      `box-shadow ${PIE_HOVER_TRANSITION}`,
      `border-color ${PIE_HOVER_TRANSITION}`,
      `color ${PIE_HOVER_TRANSITION}`
    ].join(', '),
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
    transform: `scale(${isPill ? PIE_HOVER_SCALE_PILL : PIE_HOVER_SCALE})`
  } : {
    transform: 'scale(1)'
  };

  const currentStrokeWidth = showActiveState && hoverStrokeWidth ? hoverStrokeWidth : strokeWidth;

  return (
    <button
      ref={ref}
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
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
    >
      {label && labelPosition === 'left' && (
        <span style={{ 
          fontSize: `${labelFontSize}px`,
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
            transition: `color ${PIE_HOVER_TRANSITION}, fill ${PIE_HOVER_TRANSITION}, stroke-width ${PIE_HOVER_TRANSITION}`,
          }}
        />
      )}

      {label && labelPosition === 'right' && (
        <span style={{ 
          fontSize: `${labelFontSize}px`,
          fontWeight: 600, 
          fontFamily: "'EmOne', sans-serif",
          color: 'inherit'
        }}>
          {label}
        </span>
      )}
    </button>
  );
});

PanelIconButton.displayName = 'PanelIconButton';

export default PanelIconButton;
