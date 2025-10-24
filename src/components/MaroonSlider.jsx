import React from 'react';
import './MaroonSlider.css';

const MaroonSlider = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  suffix = ''
}) => {
  return (
    <div className="maroon-slider" aria-disabled={disabled}>
      {label && (
        <label className="maroon-slider__label">
          {label}
        </label>
      )}
      <div className="maroon-slider__control">
        <input
          className="maroon-slider__range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
          disabled={disabled}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
        />
        <div className="maroon-slider__value">
          {value}
          {suffix}
        </div>
      </div>
    </div>
  );
};

export default MaroonSlider;


