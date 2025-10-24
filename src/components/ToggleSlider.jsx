import React from 'react';
import './ToggleSlider.css';

/**
 * Reusable Toggle Slider Component
 * Creates a slider toggle similar to the ConnectionBrowser's "In Graph" ↔ "All Connections" toggle
 */
const ToggleSlider = ({ 
  options, 
  value, 
  onChange, 
  rightContent = null,
  className = ''
}) => {
  if (!options || options.length !== 2) {
    console.error('ToggleSlider requires exactly 2 options');
    return null;
  }

  return (
    <div className={`toggle-slider-control ${className}`}>
      <div className="toggle-slider">
        {options.map((option) => (
          <button
            key={option.value}
            className={`toggle-button ${value === option.value ? 'active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {rightContent && (
        <div className="toggle-right-content">
          {rightContent}
        </div>
      )}
    </div>
  );
};

export default ToggleSlider;
