import React, { useState } from 'react';

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
 * @param {string} [props.color="#260000"] - Icon color (default dark maroon like right panel buttons)
 * @param {boolean} [props.filled=false] - Whether icon should be filled
 * @param {string} [props.fillColor="maroon"] - Fill color when filled
 * @param {boolean} [props.fillOnHover=false] - Whether icon should fill when hovered
 * @param {string} [props.hoverFillColor="maroon"] - Fill color when hovered
 * @param {Function} props.onClick - Click handler
 * @param {string} [props.title] - Tooltip text
 * @param {boolean} [props.disabled=false] - Whether button is disabled
 * @param {Object} [props.style] - Additional inline styles
 * @param {string} [props.className] - Additional CSS class
 */
const PanelIconButton = ({
  icon: IconComponent,
  size = 20,
  color = '#260000',
  filled = false,
  fillColor = 'maroon',
  fillOnHover = false,
  hoverFillColor = 'maroon',
  onClick,
  title,
  disabled = false,
  style = {},
  className = ''
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = (e) => {
    if (!disabled && onClick) {
      e.stopPropagation();
      onClick(e);
    }
  };

  const buttonStyle = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    border: 'none',
    // Forcefully clear any global button background styles
    background: 'transparent',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
    outline: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    appearance: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    flexShrink: 0,
    transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
    borderRadius: '50%',
    ...style
  };

  // PieMenu-style hover effect: light gray fill (#DEDADA) with maroon stroke (3px)
  const hoverStyles = isHovered && !disabled ? {
    backgroundColor: '#DEDADA',
    boxShadow: '0 0 0 3px maroon',
  } : {};

  return (
    <button
      className={`panel-icon-button ${className}`}
      style={{ ...buttonStyle, ...hoverStyles }}
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlur={() => setIsHovered(false)}
      title={title}
      disabled={disabled}
      aria-label={title}
    >
      <IconComponent
        size={size}
        color={isHovered && !disabled ? hoverFillColor : color}
        fill={filled ? (isHovered && !disabled ? hoverFillColor : fillColor) : 'none'}
        style={{
          flexShrink: 0,
          transition: 'color 0.2s ease, fill 0.2s ease',
        }}
      />
    </button>
  );
};

export default PanelIconButton;
